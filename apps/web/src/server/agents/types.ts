import type { db as Db } from "@/server/db";

export type AgentKind =
  | "MANAGER"
  | "ACCOUNT"
  | "SONAR"
  | "SCRIPTWRITER"
  | "VISUAL_DIRECTOR"
  | "AUDIO_ENGINEER"
  | "EDITOR"
  | "QA"
  | "COMMUNITY_MANAGER"
  | "ANALYST";

/**
 * Everything a tool is allowed to touch.
 *
 * Tools receive a context rather than importing the database directly, so a run
 * can be scoped, budgeted and traced. `spend()` is the hard stop: a tool that
 * would push the brand past its daily generation budget throws instead of
 * silently burning credit.
 */
export interface ToolContext {
  db: typeof Db;
  runId: string;
  brandId: string;
  channelId?: string;
  postId?: string;
  /** Emit an intermediate note into the run trace. */
  note(message: string): Promise<void>;
  /** Register spend; throws `BudgetExceededError` past the daily cap. */
  spend(usd: number, reason: string): Promise<void>;
  /** Remaining budget in USD for this brand today. */
  budgetRemaining(): Promise<number>;
  /** Deterministic RNG for this run, so allocations are replayable. */
  random(): number;
}

export interface AgentTool<Args = Record<string, unknown>, Result = unknown> {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
  /** Which agent roles may call this tool. Empty = all. */
  allowedFor?: AgentKind[];
  handler(args: Args, ctx: ToolContext): Promise<Result>;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly attempted: number,
    public readonly remaining: number,
  ) {
    super(
      `Daily generation budget exceeded: tried to spend $${attempted.toFixed(3)} with $${remaining.toFixed(3)} left.`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface RunResult {
  runId: string;
  /** Final structured output, if the agent produced one. */
  output: unknown;
  summary: string;
  degraded: boolean;
  steps: number;
  costUsd: number;
  toolCalls: Array<{ name: string; args: unknown; result: unknown; isError: boolean }>;
}
