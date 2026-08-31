import "server-only";

import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";

import { env, capabilities, googleCredentials } from "@/lib/env";

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
  /**
   * A model turn replayed **verbatim**, exactly as the API returned it.
   *
   * Gemini 3.x attaches a `thoughtSignature` to every function call and refuses
   * the next request if it is missing:
   *
   *   "Function call is missing a thought_signature in functionCall parts.
   *    This is required for tools to work correctly."
   *
   * Reconstructing the turn from `{name, args}` drops that signature, so the
   * second step of every tool-using run failed with a 400 — which is why nothing
   * in this codebase was able to run a real agent loop. The parts are opaque to
   * us and must be handed back untouched.
   */
  parts?: unknown[];
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
  /** Overrides the configured reasoning depth for this one call. */
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
}

export interface LlmResponse {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  /** True when produced by the deterministic fallback rather than a model. */
  degraded: boolean;
  /**
   * The model's turn exactly as returned, for replaying into the next request.
   * Carries the thought signatures that Gemini 3.x requires.
   */
  modelParts?: unknown[];
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
      googleAuthOptions: googleCredentials(),
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
      // A verbatim turn goes back untouched — signatures and all.
      if (m.parts) return { role: m.role, parts: m.parts as never };
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
      // Thinking is billed out of the same budget as the answer, so a cap tuned
      // for the answer alone returns an empty string: a "ping" costs ~112
      // thought tokens before a single character of output. Structured writing
      // needs room for both.
      maxOutputTokens: req.maxOutputTokens ?? 16384,
      thinkingConfig: { thinkingLevel: req.thinkingLevel ?? env.models.thinking },
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

    const res = await withRetry(() => ai.models.generateContent({ model, contents, config }));

    const usage = res.usageMetadata;
    return {
      modelParts: res.candidates?.[0]?.content?.parts as unknown[] | undefined,
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

/**
 * Retry the transient refusals, and only those.
 *
 * A 429 from Vertex is a rate limit, not a verdict: it means "later", and a run
 * that treats it as fatal throws away every clip it has already paid for. One
 * such refusal, nineteen steps into a production run, cost about three dollars
 * of generated footage and produced nothing.
 *
 * A 400 or a 404 is a real answer and is not retried — the model id is wrong, or
 * the request is malformed, and waiting will not change either.
 */
async function withRetry<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|500|INTERNAL|deadline/i.test(message);
      if (!transient || attempt === attempts - 1) throw error;
      // 2s, 6s, 14s — long enough to clear a per-minute quota window.
      const waitMs = 2000 * (2 ** attempt) - 1000 + Math.floor(Math.random() * 400);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
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
