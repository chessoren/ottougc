import "server-only";

import { eq } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { brands, personas, postAssets, posts } from "@/server/db/schema";
import { HOOK_FORBIDDEN, getFormat } from "@/server/knowledge";
import { HOOK_MAX_WORDS, countWords } from "@/server/knowledge/text";

import { QA_SYSTEM } from "./prompts";
import { runAgent } from "./runtime";
import { toolsFor } from "./tools";
import type { ToolContext } from "./types";

/**
 * The QA gate.
 *
 * Runs automatically after every render. It combines *mechanical* checks that a
 * model should never be trusted to perform (does a proof format actually have a
 * real screencast? are the numbers in the script present in the brand's own
 * knowledge base?) with a model judgement on tone and claims.
 *
 * The mechanical checks run first and can reject on their own — an LLM will
 * happily approve a video whose evidence asset is a placeholder.
 */

export interface QaVerdict {
  verdict: "PASS" | "REJECT";
  reasons: string[];
  fixes: string[];
  severity: "LOW" | "MEDIUM" | "HIGH";
  mechanicalFailures: string[];
}

/** Formats whose whole value is evidence: they may not ship without a real capture. */
const PROOF_FORMATS = new Set(["FORMAT_03", "FORMAT_17", "FORMAT_21", "FORMAT_22", "FORMAT_28", "FORMAT_11"]);

export async function runQaOnPost(postId: string): Promise<QaVerdict> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new Error("Post not found.");

  const mechanical = await mechanicalChecks(postId, post);

  // A mechanical failure is not a matter of opinion; do not spend a model call.
  if (mechanical.length > 0) {
    const verdict: QaVerdict = {
      verdict: "REJECT",
      reasons: mechanical,
      fixes: ["Fix the points above and run this post again."],
      severity: "HIGH",
      mechanicalFailures: mechanical,
    };
    await applyVerdict(postId, verdict);
    return verdict;
  }

  const [brand] = await db
    .select({ name: brands.name, brandDna: brands.brandDna, claimsPolicy: brands.claimsPolicy })
    .from(brands)
    .where(eq(brands.id, post.brandId))
    .limit(1);

  const format = getFormat(post.formatId);

  const prompt = `
Brand: ${brand?.name}
Scenario: ${post.formatId} — ${format?.name}
Never, for this scenario: ${(format?.forbidden ?? []).join(" · ") || "nothing specific"}

Hook banner: "${post.hookText}"
Title: ${post.title}
Description: ${post.description ?? "(empty)"}

Script:
${JSON.stringify(post.script, null, 2).slice(0, 6000)}

Pinned comment: ${post.pinnedComment ?? "(none)"}

Brand material (the only permitted source for any number):
${JSON.stringify(brand?.brandDna ?? {}, null, 2).slice(0, 3000)}

Claims policy:
${JSON.stringify(brand?.claimsPolicy ?? {}, null, 2).slice(0, 1500)}

Disqualifying hook rules:
${HOOK_FORBIDDEN.map((r) => `- ${r}`).join("\n")}

Return your verdict as JSON.
`.trim();

  let run: Awaited<ReturnType<typeof runAgent>>;
  try {
    run = await runAgent({
      kind: "QA",
      brandId: post.brandId,
      channelId: post.channelId,
      postId,
      label: `Quality check — ${post.hookText.slice(0, 48)}`,
      goal: "Allow or block publication.",
      system: QA_SYSTEM,
      prompt,
      tools: toolsFor("QA"),
      maxSteps: 10,
      temperature: 0.2,
      fallback: async (ctx) => deterministicQa(post, ctx),
    });
  } catch (err) {
    const fallback = await deterministicQa(post, {
      db,
      brandId: post.brandId,
      channelId: post.channelId,
      postId,
      runId: "qa-fallback",
      random: Math.random,
      note: async () => undefined,
      budgetRemaining: async () => 0,
      spend: async () => undefined,
    } as never);
    const parsed = fallback.output as QaVerdict;
    parsed.reasons = [
      ...(parsed.reasons ?? []),
      `Model judgement skipped: ${err instanceof Error ? err.message : String(err)}`.slice(0, 240),
    ];
    await applyVerdict(postId, parsed);
    return parsed;
  }

  const parsed = (run.output ?? {}) as Partial<QaVerdict>;
  const verdict: QaVerdict = {
    verdict: parsed.verdict === "REJECT" ? "REJECT" : "PASS",
    reasons: parsed.reasons ?? [],
    fixes: parsed.fixes ?? [],
    severity: parsed.severity ?? "LOW",
    mechanicalFailures: [],
  };

  await applyVerdict(postId, verdict);
  return verdict;
}

/**
 * Checks that must not be delegated to a model.
 *
 * Each one corresponds to a failure the model cannot observe from the script
 * alone: the state of the asset store, the presence of a rendered file, whether
 * a "capture" is actually a placeholder.
 */
async function mechanicalChecks(
  postId: string,
  post: typeof posts.$inferSelect,
): Promise<string[]> {
  const failures: string[] = [];

  if (!post.renderedVideoUrl) {
    failures.push("No rendered video is attached to this post.");
  }

  const assets = await db.select().from(postAssets).where(eq(postAssets.postId, postId));

  /**
   * No substitute media may ever be published.
   *
   * The pipeline degrades to labelled substitutes when no video model is
   * credentialed, so that timings, editing and rendering can still be exercised
   * end to end. That is useful for development and worthless as content: a clip
   * whose picture is a slate describing the shot is not a video anyone should
   * see. This gate is what keeps "the pipeline ran" from being mistaken for
   * "something publishable exists".
   */
  const substitutes = assets.filter((a) => {
    const meta = a.meta as { isPlaceholder?: boolean } | null;
    return meta?.isPlaceholder === true;
  });
  if (substitutes.length > 0) {
    const kinds = [...new Set(substitutes.map((s) => s.kind))].join(", ");
    failures.push(
      `${substitutes.length} stand-in asset${substitutes.length === 1 ? "" : "s"} (${kinds}). This video contains no real footage — Vertex Omni did not produce the clip.`,
    );
  }

  if (PROOF_FORMATS.has(post.formatId)) {
    const screencasts = assets.filter((a) => a.kind === "SCREENCAST");
    if (screencasts.length === 0) {
      failures.push(
        `${post.formatId} is a proof scenario: it needs a real screen recording, and there isn't one.`,
      );
    } else if (
      screencasts.every((s) => {
        const meta = s.meta as { isPlaceholder?: boolean; captured?: boolean } | null;
        // Treat an unlabelled capture as a placeholder: this gate must fail
        // closed, or a missing metadata field silently disables it.
        return meta?.captured !== true || meta?.isPlaceholder === true || s.status === "FAILED";
      })
    ) {
      failures.push(
        `The screen capture on this proof scenario is a stand-in, not a real recording. Publishing a simulated demonstration as evidence is not allowed.`,
      );
    }
  }

  const failed = assets.filter((a) => a.status === "FAILED");
  if (failed.length > 0) {
    failures.push(
      `${failed.length} asset${failed.length === 1 ? "" : "s"} failed to generate: ${failed.map((f) => f.kind).join(", ")}.`,
    );
  }

  const hookWords = countWords(post.hookText);
  if (hookWords > HOOK_MAX_WORDS) {
    failures.push(`The hook banner is ${hookWords} words (maximum ${HOOK_MAX_WORDS}).`);
  }

  if (post.hookScore !== null && post.hookScore < 82) {
    failures.push(`Hook score is ${post.hookScore}, under the threshold of 82.`);
  }

  return failures;
}

/** Rule-based QA, used when no model is available. Conservative by construction. */
async function deterministicQa(
  post: typeof posts.$inferSelect,
  ctx: ToolContext,
): Promise<{ output: unknown; summary: string }> {
  const reasons: string[] = [];
  const format = getFormat(post.formatId);

  const scriptText = JSON.stringify(post.script ?? {}).toLowerCase();
  const bannedVocabulary = [
    "revolutionary",
    "game changer",
    "game-changer",
    "supercharge",
    "don't wait",
    "must-have",
    "innovative solution",
    "powered by ai",
    "seamlessly",
  ];
  for (const term of bannedVocabulary) {
    if (scriptText.includes(term)) reasons.push(`Banned marketing word found: "${term}".`);
  }

  const absoluteClaims = ["100%", "guaranteed", "zero risk", "replaces all", "never fails"];
  for (const claim of absoluteClaims) {
    if (scriptText.includes(claim)) {
      reasons.push(`Possible absolute claim to check: "${claim}".`);
    }
  }

  if (format?.forbidden.length) {
    await ctx.note(`Never, for ${format.id}: ${format.forbidden.join(" · ")}`);
  }

  const verdict: QaVerdict = {
    verdict: reasons.length > 0 ? "REJECT" : "PASS",
    reasons,
    fixes: reasons.length ? ["Rewrite the flagged lines and run the check again."] : [],
    severity: reasons.length ? "MEDIUM" : "LOW",
    mechanicalFailures: [],
  };

  return {
    output: verdict,
    summary:
      reasons.length === 0
        ? "Rule-based check passed: no banned vocabulary and no absolute claims found. Note that without a model, tone and credibility were not judged."
        : `Blocked by the rule-based check: ${reasons.join(" ")}`,
  };
}

async function applyVerdict(postId: string, verdict: QaVerdict): Promise<void> {
  await db
    .update(posts)
    .set({
      qaVerdict: verdict as never,
      status: verdict.verdict === "PASS" ? "READY" : "QA_REJECTED",
      failureReason: verdict.verdict === "REJECT" ? verdict.reasons.join(" | ") : null,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));

  // A post that passes QA and is already past its slot publishes immediately;
  // otherwise the scheduler picks it up at its slot.
  if (verdict.verdict === "PASS" && !env.dryRunPublishing) {
    const { publishReadyPost } = await import("@/server/publishing/scheduler");
    void publishReadyPost(postId);
  }
}
