import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  channelObjectives,
  channels,
  fleetDecisions,
  fleetReviews,
  personas,
  posts,
  strategies,
} from "@/server/db/schema";

import { FLEET_REVIEW_SYSTEM } from "./prompts";
import { runAgent } from "./runtime";
import { toolsFor } from "./tools";
import { setChannelCadence, setStrategy } from "./tools/strategy";
import type { RunResult, ToolContext } from "./types";

/**
 * The weekly fleet review.
 *
 * Once a week the manager looks at every channel and decides its fate. This is a
 * different exercise from the daily darwinian verdict: the daily engine judges a
 * *video*, this judges a *channel*. A channel can publish three losing videos and
 * still be the right bet; a channel can publish competent videos for a month and
 * still deserve to be repositioned because its angle does not reach anyone.
 *
 * Guardrails that are enforced in code, not left to the prompt:
 *   - a channel younger than three weeks is never killed,
 *   - never more than a third of the fleet killed in one review,
 *   - UNAWARE channels are judged on retention and shares, not clicks.
 */

export type FleetAction = "KEEP" | "DOUBLE_DOWN" | "REPOSITION" | "THROTTLE" | "KILL" | "REVIVE";

export interface ChannelReviewStats {
  channelId: string;
  handle: string;
  archetype: string | null;
  awareness: string | null;
  ageDays: number;
  status: string;
  postsPublished: number;
  views: number;
  medianScore: number;
  avgRetention3s: number;
  avgCompletion: number;
  shareRate: number;
  linkClickRate: number;
  signups: number;
  outliers: number;
  kills: number;
  objectivesMet: number;
  objectivesTotal: number;
  quotaBefore: number;
}

export async function gatherFleetStats(
  brandId: string,
  periodStart: Date,
): Promise<ChannelReviewStats[]> {
  const rows = await db
    .select({
      channelId: channels.id,
      handle: channels.handle,
      title: channels.title,
      status: channels.status,
      createdAt: channels.createdAt,
      dailyPostTarget: channels.dailyPostTarget,
      archetype: personas.archetype,
      awareness: personas.awarenessLevel,
    })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .where(eq(channels.brandId, brandId))
    .orderBy(channels.slotIndex);

  const stats: ChannelReviewStats[] = [];

  for (const c of rows) {
    const published = await db
      .select({
        score: posts.performanceScore,
        views: posts.views,
        retention3s: posts.retention3s,
        completionRate: posts.completionRate,
        shares: posts.shares,
        linkClicks: posts.linkClicks,
        signups: posts.signups,
        action: posts.darwinianAction,
      })
      .from(posts)
      .where(
        and(
          eq(posts.channelId, c.channelId),
          eq(posts.status, "PUBLISHED"),
          gte(posts.publishedAt, periodStart),
        ),
      );

    const objectives = await db
      .select({ status: channelObjectives.status, current: channelObjectives.currentValue, target: channelObjectives.targetValue, comparator: channelObjectives.comparator })
      .from(channelObjectives)
      .where(eq(channelObjectives.channelId, c.channelId));

    const views = published.reduce((s, p) => s + p.views, 0);
    const denom = Math.max(views, 1);

    stats.push({
      channelId: c.channelId,
      handle: c.handle ?? c.title ?? c.channelId.slice(0, 8),
      archetype: c.archetype,
      awareness: c.awareness,
      ageDays: Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 86400_000),
      status: c.status,
      postsPublished: published.length,
      views,
      medianScore: median(published.map((p) => p.score)),
      avgRetention3s: mean(published.map((p) => p.retention3s)),
      avgCompletion: mean(published.map((p) => p.completionRate)),
      shareRate: published.reduce((s, p) => s + p.shares, 0) / denom,
      linkClickRate: published.reduce((s, p) => s + p.linkClicks, 0) / denom,
      signups: published.reduce((s, p) => s + p.signups, 0),
      outliers: published.filter((p) => p.action === "DOUBLE_DOWN" || p.action === "AMPLIFY").length,
      kills: published.filter((p) => p.action === "KILL").length,
      objectivesMet: objectives.filter((o) => meetsTarget(o)).length,
      objectivesTotal: objectives.length,
      quotaBefore: c.dailyPostTarget,
    });
  }

  return stats;
}

export async function runWeeklyReview(brandId: string): Promise<RunResult> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 86400_000);
  const stats = await gatherFleetStats(brandId, periodStart);

  const fleetMedian = median(stats.filter((s) => s.postsPublished > 0).map((s) => s.medianScore));
  const totals = stats.reduce(
    (acc, s) => ({
      posts: acc.posts + s.postsPublished,
      views: acc.views + s.views,
      clicks: acc.clicks + Math.round(s.linkClickRate * s.views),
      signups: acc.signups + s.signups,
      outliers: acc.outliers + s.outliers,
    }),
    { posts: 0, views: 0, clicks: 0, signups: 0, outliers: 0 },
  );

  const [review] = await db
    .insert(fleetReviews)
    .values({
      brandId,
      periodStart,
      periodEnd,
      totalPosts: totals.posts,
      totalViews: totals.views,
      totalLinkClicks: totals.clicks,
      totalSignups: totals.signups,
      medianScore: fleetMedian,
      outlierRate: totals.posts ? totals.outliers / totals.posts : 0,
    })
    .returning({ id: fleetReviews.id });

  const reviewId = review!.id;

  const prompt = `
Week of ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}.

ACROSS THE SET — median score ${fleetMedian.toFixed(3)}, ${totals.posts} posts,
${totals.views.toLocaleString("en-US")} views, ${totals.clicks} clicks, ${totals.signups} signups,
${totals.outliers} outliers, ${totals.posts ? ((totals.outliers / totals.posts) * 100).toFixed(1) : "0"}% of everything made.

PER CHANNEL
${stats
  .map(
    (s) =>
      `- ${s.handle} [${s.archetype ?? "no character"} / ${s.awareness ?? "?"}] ${s.ageDays}d old, ${s.status}
   ${s.postsPublished} posts · ${s.views.toLocaleString("en-US")} views · median ${s.medianScore.toFixed(3)}
   held3s ${(s.avgRetention3s * 100).toFixed(1)}% · completion ${(s.avgCompletion * 100).toFixed(1)}% · shares ${(s.shareRate * 100).toFixed(2)}% · clicks ${(s.linkClickRate * 100).toFixed(2)}%
   ${s.outliers} outliers, ${s.kills} dropped · targets ${s.objectivesMet}/${s.objectivesTotal} · currently ${s.quotaBefore}/day`,
  )
  .join("\n")}

Decide for every channel. Cite the numbers behind each call.
Apply them with set_channel_cadence, and set_strategy for repositions.
Finish with the JSON.
`.trim();

  const run = await runAgent({
    kind: "MANAGER",
    brandId,
    label: `Weekly review — ${stats.length} channels`,
    goal: "Decide what happens to each channel and reallocate production.",
    system: FLEET_REVIEW_SYSTEM,
    prompt,
    tools: toolsFor("MANAGER"),
    maxSteps: 45,
    temperature: 0.5,
    fallback: (ctx) => reviewDeterministically(stats, fleetMedian, ctx),
  });

  // Persist decisions, whether they came from the model or the rule engine.
  const output = (run.output ?? {}) as {
    narrative?: string;
    decisions?: Array<{ channelId: string; action: FleetAction; rationale: string; quotaAfter?: number }>;
  };

  const decisions = applyGuardrails(output.decisions ?? [], stats);

  for (const d of decisions) {
    const s = stats.find((x) => x.channelId === d.channelId);
    await db.insert(fleetDecisions).values({
      reviewId,
      channelId: d.channelId,
      action: d.action,
      postsPublished: s?.postsPublished ?? 0,
      views: s?.views ?? 0,
      medianScore: s?.medianScore ?? 0,
      linkClickRate: s?.linkClickRate ?? 0,
      objectivesMet: s?.objectivesMet ?? 0,
      objectivesTotal: s?.objectivesTotal ?? 0,
      quotaBefore: s?.quotaBefore ?? 0,
      quotaAfter: d.quotaAfter ?? s?.quotaBefore ?? 0,
      rationale: d.rationale,
    });

    await applyDecision(d);
  }

  await db
    .update(fleetReviews)
    .set({ runId: run.runId, narrative: output.narrative ?? run.summary })
    .where(eq(fleetReviews.id, reviewId));

  return run;
}

/**
 * Structural limits on what a review may do.
 *
 * The model proposes; this decides what is allowed. Killing a two-week-old
 * UNAWARE channel because it has no clicks is exactly the mistake that destroys
 * the top of the funnel, and it is far too easy a mistake for a model looking at
 * a table of conversion rates to make.
 */
function applyGuardrails(
  proposed: Array<{ channelId: string; action: FleetAction; rationale: string; quotaAfter?: number }>,
  stats: ChannelReviewStats[],
): Array<{ channelId: string; action: FleetAction; rationale: string; quotaAfter?: number }> {
  const maxKills = Math.floor(stats.length / 3);
  let kills = 0;

  return proposed.map((d) => {
    const s = stats.find((x) => x.channelId === d.channelId);
    if (!s) return d;

    if (d.action === "KILL") {
      if (s.ageDays < 21) {
        return {
          ...d,
          action: "THROTTLE",
          quotaAfter: Math.max(1, Math.floor(s.quotaBefore / 2)),
          rationale: `${d.rationale} — Downgraded to THROTTLE: this channel is only ${s.ageDays} days old, and warming up plus finding an audience takes three weeks.`,
        };
      }
      if (kills >= maxKills) {
        return {
          ...d,
          action: "THROTTLE",
          quotaAfter: Math.max(1, Math.floor(s.quotaBefore / 2)),
          rationale: `${d.rationale} — Downgraded to THROTTLE: already at the cap of one third of the set per review.`,
        };
      }
      kills++;
    }
    return d;
  });
}

async function applyDecision(d: {
  channelId: string;
  action: FleetAction;
  rationale: string;
  quotaAfter?: number;
}): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  switch (d.action) {
    case "DOUBLE_DOWN":
      patch.dailyPostTarget = Math.min(4, (d.quotaAfter ?? 2));
      patch.status = "ACTIVE";
      break;
    case "THROTTLE":
      patch.dailyPostTarget = Math.max(0, d.quotaAfter ?? 1);
      patch.status = "COOLDOWN";
      break;
    case "KILL":
      patch.dailyPostTarget = 0;
      patch.status = "PAUSED";
      break;
    case "REVIVE":
      patch.dailyPostTarget = d.quotaAfter ?? 1;
      patch.status = "ACTIVE";
      break;
    case "REPOSITION":
      patch.dailyPostTarget = d.quotaAfter ?? 1;
      patch.status = "ACTIVE";
      break;
    case "KEEP":
    default:
      if (d.quotaAfter !== undefined) patch.dailyPostTarget = d.quotaAfter;
      break;
  }
  await db.update(channels).set(patch).where(eq(channels.id, d.channelId));
}

/** Rule-based review. Same decision frame, no interpretation. */
async function reviewDeterministically(
  stats: ChannelReviewStats[],
  fleetMedian: number,
  ctx: ToolContext,
): Promise<{ output: unknown; summary: string }> {
  const decisions: Array<{ channelId: string; action: FleetAction; rationale: string; quotaAfter: number }> = [];

  for (const s of stats) {
    // UNAWARE channels build the audience the others convert; judging them on
    // clicks would kill the top of the funnel.
    const primaryMetric =
      s.awareness === "UNAWARE" ? s.avgRetention3s : s.linkClickRate * 20 + s.avgCompletion;
    const fleetBar = s.awareness === "UNAWARE" ? 0.45 : fleetMedian;

    let action: FleetAction;
    let quotaAfter = s.quotaBefore;
    let rationale: string;

    if (s.postsPublished === 0) {
      action = "KEEP";
      rationale = `Nothing posted this period, so nothing to judge. Check that it is producing.`;
    } else if (s.outliers > 0 && s.medianScore >= fleetMedian) {
      action = "DOUBLE_DOWN";
      quotaAfter = Math.min(4, s.quotaBefore + 1);
      rationale = `${s.outliers} outlier${s.outliers === 1 ? "" : "s"} and a median score of ${s.medianScore.toFixed(3)}, above the set median (${fleetMedian.toFixed(3)}). Cadence raised to ${quotaAfter}/day.`;
    } else if (s.objectivesTotal > 0 && s.objectivesMet === s.objectivesTotal) {
      action = "KEEP";
      rationale = `All targets met (${s.objectivesMet}/${s.objectivesTotal}). Nothing to change.`;
    } else if (primaryMetric < fleetBar * 0.6 && s.ageDays >= 21) {
      action = "REPOSITION";
      rationale = `Main metric at ${primaryMetric.toFixed(3)} against ${fleetBar.toFixed(3)} expected, on a ${s.ageDays}-day-old channel. That is an angle problem, not an execution problem.`;
    } else if (primaryMetric < fleetBar * 0.8) {
      action = "THROTTLE";
      quotaAfter = Math.max(1, s.quotaBefore - 1);
      rationale = `Under the bar (${primaryMetric.toFixed(3)} against ${fleetBar.toFixed(3)}). Cadence cut to ${quotaAfter}/day, budget moved to the channels that are working.`;
    } else {
      action = "KEEP";
      rationale = `Performing as expected: median score ${s.medianScore.toFixed(3)}, ${s.objectivesMet}/${s.objectivesTotal} targets met.`;
    }

    decisions.push({ channelId: s.channelId, action, rationale, quotaAfter });
    await ctx.note(`${s.handle} → ${action} : ${rationale}`);
  }

  const counts = decisions.reduce<Record<string, number>>((acc, d) => {
    acc[d.action] = (acc[d.action] ?? 0) + 1;
    return acc;
  }, {});

  return {
    output: {
      narrative: `Rule-based review of ${stats.length} channels. Set median: ${fleetMedian.toFixed(3)}. ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
      decisions,
    },
    summary: `${stats.length} channels reviewed: ${Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}.`,
  };
}

/* ========================================================================== */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function meetsTarget(o: { current: number; target: number; comparator: string }): boolean {
  switch (o.comparator) {
    case ">":
      return o.current > o.target;
    case "<=":
      return o.current <= o.target;
    case "<":
      return o.current < o.target;
    default:
      return o.current >= o.target;
  }
}
