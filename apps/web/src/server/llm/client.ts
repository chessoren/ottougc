import "server-only";

import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";

import { env, capabilities } from "@/lib/env";

/**
 * One narrow interface over the model, so the agent runtime never touches a
 * vendor SDK directly.
 *
 * Two implementations:
 *   - `GeminiBrain`      — Vertex AI or AI Studio, whichever is credentialed.
 *   - `DeterministicBrain` — no credentials. It does NOT fake reasoning: it
 *     returns a structured refusal that the runtime turns into a rule-based
 *     plan drawn from the knowledge base. The pipeline still produces real
 *     scripts and real videos, it just stops being creative. That distinction
 *     is surfaced in the dashboard rather than hidden.
 */

export interface LlmMessage {
  role: "user" | "model";
  /** Plain text turn. */
  text?: string;
  /** Result of a tool the runtime executed on the model's behalf. */
  functionResponse?: { name: string; response: unknown };
  /** A tool call the model previously made (replayed for context). */
  functionCall?: { name: string; args: Record<string, unknown> };
}

export interface LlmToolDef {
  name: string;
  description: string;
  /** JSON Schema object describing the arguments. */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  model?: string;
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  /** Force a JSON object response matching this schema (no tools in this mode). */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResponse {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  /** True when produced by the deterministic fallback rather than a model. */
  degraded: boolean;
}

export interface Brain {
  readonly kind: "gemini" | "deterministic";
  generate(req: LlmRequest): Promise<LlmResponse>;
}

/* ==========================================================================
   Pricing — used to bill usage back and to enforce the daily budget
   ========================================================================== */

/** USD per 1M tokens. Gemini 3.7 Flash introductory pricing, 2026. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3-flash": { input: 0.5, output: 2.5 },
  "gemini-3.1-pro": { input: 2.5, output: 15 },
  "gemini-3.1-flash-lite": { input: 0.15, output: 0.6 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model] ?? MODEL_PRICING["gemini-3.7-flash"]!;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/* ==========================================================================
   Gemini
   ========================================================================== */

let cachedClient: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  if (cachedClient) return cachedClient;

  if (env.gcpServiceAccount && env.gcpProjectId) {
    // Vertex global endpoint: Gemini 3.7 Flash is not served from us-central1.
    cachedClient = new GoogleGenAI({
      vertexai: true,
      project: env.gcpProjectId,
      location: env.gcpGeminiLocation,
      googleAuthOptions: { credentials: env.gcpServiceAccount as never },
    });
  } else if (env.geminiApiKey) {
    cachedClient = new GoogleGenAI({ apiKey: env.geminiApiKey });
  } else {
    throw new Error("No Gemini credentials configured");
  }
  return cachedClient;
}

class GeminiBrain implements Brain {
  readonly kind = "gemini" as const;

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const model = req.model ?? env.models.brain;
    const ai = client();

    const contents = req.messages.map((m) => {
      if (m.functionResponse) {
        return {
          role: "user" as const,
          parts: [
            {
              functionResponse: {
                name: m.functionResponse.name,
                response: asRecord(m.functionResponse.response),
              },
            },
          ],
        };
      }
      if (m.functionCall) {
        return {
          role: "model" as const,
          parts: [{ functionCall: { name: m.functionCall.name, args: m.functionCall.args } }],
        };
      }
      return { role: m.role, parts: [{ text: m.text ?? "" }] };
    });

    const config: Record<string, unknown> = {
      systemInstruction: req.system,
      temperature: req.temperature ?? 0.9,
      maxOutputTokens: req.maxOutputTokens ?? 8192,
    };

    if (req.tools?.length) {
      config.tools = [
        {
          functionDeclarations: req.tools.map(
            (t): FunctionDeclaration => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            }),
          ),
        },
      ];
    }

    if (req.responseSchema) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = req.responseSchema;
    }

    const res = await ai.models.generateContent({ model, contents, config });

    const usage = res.usageMetadata;
    return {
      text: res.text ?? "",
      functionCalls: (res.functionCalls ?? []).map((fc) => ({
        name: fc.name ?? "",
        args: (fc.args ?? {}) as Record<string, unknown>,
      })),
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model,
      degraded: false,
    };
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return { output: v };
}

/* ==========================================================================
   Deterministic fallback
   ========================================================================== */

/**
 * Used when no model credentials exist.
 *
 * It returns an explicit marker instead of inventing prose. The agent runtime
 * recognises the marker and switches that step to its rule-based planner, which
 * composes briefs and scripts directly from the knowledge base. The system stays
 * fully functional end-to-end; it simply stops improvising.
 */
export const DEGRADED_MARKER = "__OTTOUGC_NO_MODEL__";

class DeterministicBrain implements Brain {
  readonly kind = "deterministic" as const;

  async generate(req: LlmRequest): Promise<LlmResponse> {
    return {
      text: DEGRADED_MARKER,
      functionCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      model: req.model ?? "deterministic",
      degraded: true,
    };
  }
}

let brainSingleton: Brain | null = null;

export function getBrain(): Brain {
  if (brainSingleton) return brainSingleton;
  brainSingleton = capabilities.llm.configured ? new GeminiBrain() : new DeterministicBrain();
  return brainSingleton;
}

/** Test seam. */
export function __setBrain(b: Brain | null) {
  brainSingleton = b;
}
