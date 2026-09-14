import "server-only";

import {
  Agent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  FunctionTool,
  type JSONSchema,
  type JSONValue,
} from "@strands-agents/sdk";
import { eq, gte, sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { agentRuns, agentSteps, usageEvents } from "@/server/db/schema";
import { estimateCostUsd, getBrain, strandsModel } from "@/server/llm/client";

import { BudgetExceededError, type AgentKind, type AgentTool, type RunResult, type ToolContext } from "./types";

/**
 * The agent loop, on the Strands Agents SDK.
 *
 * Strands owns the loop itself: call Gemini, execute whatever tools it asks
 * for, feed the results back, repeat — including the Gemini 3 thought
 * signatures that used to have to be replayed by hand. Everything interesting
 * still lives in the tools; this file wires them in and keeps three properties:
 *
 *   - **Every step is persisted.** `agent_steps` is an append-only trace of what
 *     the fleet decided and why. Strands hooks write the model's messages and
 *     each tool call as they happen. It is what the dashboard renders, and what
 *     makes "why did channel 4 publish that?" answerable three weeks later.
 *   - **Tool failures are fed back, not thrown.** Strands turns a tool error
 *     into an error result the model can recover from; a crashed run cannot.
 *   - **Budget is enforced inside the loop.** A tool that would overspend
 *     cancels the agent, and the run fails with the budget error. An agent
 *     cannot spend its way out of a bad plan.
 */

export interface RunOptions {
  kind: AgentKind;
  brandId: string;
  channelId?: string;
  postId?: string;
  parentRunId?: string;
  label: string;
  goal?: string;
  system: string;
  prompt: string;
  tools?: AgentTool[];
  model?: string;
  maxSteps?: number;
  temperature?: number;
  /** Seed for the run's RNG, so bandit allocation is replayable. */
  seed?: number;
  /** Fallback used when no model is credentialed. Receives the same context. */
  fallback?: (ctx: ToolContext) => Promise<{ output: unknown; summary: string }>;
  /**
   * Run the fallback even when Gemini is live.
   *
   * Account production uses this: the model still writes the scene and the
   * character, but the shot compilation / Omni call / cut is a pipeline, not
   * seventy free-form tool calls. That is what keeps a $10 cap from vanishing
   * on a confused loop.
   */
  usePipeline?: boolean;
}

/** A tool result must be a JSON object, never a bare array or scalar. */
function asResponse(value: unknown): JSONValue {
  const json = JSON.parse(JSON.stringify(value ?? null)) as JSONValue;
  if (json && typeof json === "object" && !Array.isArray(json)) return json;
  return { output: json };
}

/** Mulberry32 — small, fast, seedable. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const brain = getBrain();
  const model = opts.model ?? env.models.brain;
  const maxSteps = opts.maxSteps ?? env.limits.maxAgentSteps;

  const [run] = await db
    .insert(agentRuns)
    .values({
      brandId: opts.brandId,
      channelId: opts.channelId,
      postId: opts.postId,
      parentRunId: opts.parentRunId,
      kind: opts.kind,
      label: opts.label,
      goal: opts.goal,
      model,
      status: "RUNNING",
    })
    .returning({ id: agentRuns.id });

  const runId = run!.id;
  let sequence = 0;
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let spentThisRun = 0;
  const toolCalls: RunResult["toolCalls"] = [];

  const rng = makeRng(opts.seed ?? hashSeed(runId));

  async function step(
    kind: "THOUGHT" | "TOOL_CALL" | "TOOL_RESULT" | "MESSAGE" | "DELEGATION" | "ERROR",
    payload: {
      tool?: string;
      content?: string;
      args?: unknown;
      result?: unknown;
      isError?: boolean;
      durationMs?: number;
    },
  ) {
    await db.insert(agentSteps).values({
      runId,
      sequence: sequence++,
      kind,
      tool: payload.tool,
      content: payload.content,
      args: payload.args as never,
      result: payload.result as never,
      isError: payload.isError ?? false,
      durationMs: payload.durationMs,
    });
  }

  const ctx: ToolContext = {
    db,
    runId,
    brandId: opts.brandId,
    channelId: opts.channelId,
    postId: opts.postId,
    random: rng,
    async note(message) {
      await step("THOUGHT", { content: message });
    },
    async budgetRemaining() {
      const spent = await spentToday();
      return Math.max(0, env.limits.dailyGenerationBudgetUsd - spent - spentThisRun);
    },
    async spend(usd, reason) {
      const remaining = await ctx.budgetRemaining();
      if (usd > remaining) throw new BudgetExceededError(usd, remaining);
      spentThisRun += usd;
      await db.insert(usageEvents).values({
        brandId: opts.brandId,
        postId: opts.postId,
        kind: "MEDIA_GENERATION",
        quantity: "1",
        unitPriceUsd: usd.toFixed(6),
        amountUsd: "0", // internal cost, not billed to the customer
        costUsd: usd.toFixed(5),
        billingPeriod: new Date().toISOString().slice(0, 7),
        meta: { reason } as never,
      });
    },
  };

  /* ---- Pipeline path: no model, or production that must not free-tool ---- */
  if (brain.kind === "deterministic" || opts.usePipeline) {
    if (!opts.fallback) {
      await finish("FAILED", null, "No model configured and no fallback for this agent.");
      return {
        runId,
        output: null,
        summary: "No model configured.",
        degraded: true,
        steps: sequence,
        costUsd: 0,
        toolCalls,
      };
    }
    await step("THOUGHT", {
      content:
        opts.usePipeline
          ? "Production pipeline: the model writes the scene and the character; compiled shots go to Omni; the cut is deterministic."
          : "No Gemini key found — falling back to the rule-based planner backed by the knowledge base. The pipeline still runs, it just does not improvise.",
    });
    try {
      const result = await opts.fallback(ctx);
      await finish("SUCCEEDED", result.output, result.summary);
      return {
        runId,
        output: result.output,
        summary: result.summary,
        degraded: brain.kind === "deterministic",
        steps: sequence,
        costUsd: spentThisRun,
        toolCalls,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step("ERROR", { content: message, isError: true });
      await finish("FAILED", null, message);
      throw err;
    }
  }

  /* ---- Normal path: a Strands agent ------------------------------------- */
  let finalText = "";
  let budgetError: BudgetExceededError | null = null;

  const tools = (opts.tools ?? []).map(
    (t) =>
      new FunctionTool({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters as JSONSchema,
        callback: async (input, toolContext) => {
          const args = (input ?? {}) as Record<string, unknown>;
          const started = Date.now();
          await step("TOOL_CALL", { tool: t.name, args });

          try {
            if (t.allowedFor?.length && !t.allowedFor.includes(opts.kind)) {
              throw new Error(`A ${opts.kind} agent is not allowed to call ${t.name}.`);
            }
            const result = await t.handler(args as never, ctx);
            await step("TOOL_RESULT", { tool: t.name, result, durationMs: Date.now() - started });
            toolCalls.push({ name: t.name, args, result, isError: false });
            return asResponse(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const errorResult = { error: message };
            await step("TOOL_RESULT", {
              tool: t.name,
              result: errorResult,
              isError: true,
              durationMs: Date.now() - started,
            });
            toolCalls.push({ name: t.name, args, result: errorResult, isError: true });
            // Budget exhaustion ends the run; anything else goes back to the
            // model as an error result so it can adapt.
            if (err instanceof BudgetExceededError) {
              budgetError = err;
              toolContext.agent instanceof Agent && toolContext.agent.cancel();
            }
            throw err;
          }
        },
      }),
  );

  const agent = new Agent({
    name: `ottougc-${opts.kind.toLowerCase().replace(/_/g, "-")}`,
    model: strandsModel({ modelId: model, temperature: opts.temperature }),
    systemPrompt: opts.system,
    tools,
    printer: false,
    traceAttributes: { "ottougc.run_id": runId, "ottougc.brand_id": opts.brandId },
  });

  agent.addHook(AfterModelCallEvent, async (event) => {
    const message = event.stopData?.message;
    if (!message) return;
    const text = textOf(message.content);
    if (text) {
      await step("MESSAGE", { content: text });
      finalText = text;
    }
  });

  // Tools the model invented never reach a callback; record them here.
  agent.addHook(AfterToolCallEvent, async (event) => {
    if (event.tool) return;
    const errorResult = { error: `Unknown tool: ${event.toolUse.name}` };
    await step("TOOL_CALL", { tool: event.toolUse.name, args: event.toolUse.input });
    await step("TOOL_RESULT", { tool: event.toolUse.name, result: errorResult, isError: true });
    toolCalls.push({ name: event.toolUse.name, args: event.toolUse.input, result: errorResult, isError: true });
  });

  try {
    const result = await agent.invoke(opts.prompt, { limits: { turns: maxSteps } });

    const usage = result.metrics?.accumulatedUsage;
    inputTokens = usage?.inputTokens ?? 0;
    outputTokens = usage?.outputTokens ?? 0;
    costUsd = estimateCostUsd(model, inputTokens, outputTokens);

    if (budgetError) throw budgetError;

    finalText = textOf(result.lastMessage.content) || finalText;
    const output = extractJson(finalText);
    await finish("SUCCEEDED", output, summarise(finalText));
    return {
      runId,
      output,
      summary: summarise(finalText),
      degraded: false,
      steps: sequence,
      costUsd: costUsd + spentThisRun,
      toolCalls,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await step("ERROR", { content: message, isError: true });
    await finish("FAILED", null, message);
    throw err;
  }

  async function finish(status: "SUCCEEDED" | "FAILED", output: unknown, summary: string) {
    const startedRow = await db
      .select({ startedAt: agentRuns.startedAt })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);
    const startedAt = startedRow[0]?.startedAt ?? new Date();

    await db
      .update(agentRuns)
      .set({
        status,
        output: output as never,
        summary,
        error: status === "FAILED" ? summary : null,
        inputTokens,
        outputTokens,
        costUsd: (costUsd + spentThisRun).toFixed(5),
        stepCount: sequence,
        finishedAt: new Date(),
        durationMs: Date.now() - new Date(startedAt).getTime(),
      })
      .where(eq(agentRuns.id, runId));
  }
}

/** The plain text of a message, without reasoning or tool blocks. */
export function textOf(content: readonly unknown[]): string {
  return (content as Array<{ type?: string; text?: string }>)
    .flatMap((block) => (block.type === "textBlock" && block.text ? [block.text] : []))
    .join("")
    .trim();
}

/** Sum of today's internal generation cost across the whole service. */
async function spentToday(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, startOfDay));

  return Number(rows[0]?.total ?? 0);
}

/** Models often wrap JSON in prose or a fence. Recover it without being strict. */
export function extractJson(text: string): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function summarise(text: string): string {
  if (!text) return "Aucune sortie textuelle.";
  const clean = text.replace(/```[\s\S]*?```/g, "").trim();
  const firstPara = clean.split(/\n\s*\n/)[0] ?? clean;
  return firstPara.slice(0, 500);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
