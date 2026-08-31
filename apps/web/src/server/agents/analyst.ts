import "server-only";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  channelObjectives,
  channels,
  formatBandits,
  hookBandits,
  metricSnapshots,
  posts,
  retentionCurves,
} from "@/server/db/schema";
import {
  decide,
  diagnoseRetention,
  scorePost,
  updateArm,
  type Checkpoint,
  type PostMetrics,
} from "@/server/darwin/engine";
import { getVideoAnalytics, getRetentionCurve, getVideoStats } from "@/server/integrations/youtube";

import { ANALYST_SYSTEM } from "./prompts";
import { runAgent } from "./runtime";
import { toolsFor } from "./tools";

/**
 * The analyst.
 *
 * Two halves that must not be confused:
 *   - `ingestMetrics` is arithmetic. It pulls numbers, applies the decision grid
 *     and updates the bandit posteriors. No model is involved, because a verdict
 *     that depends on a model's mood is not a verdict.
 *   - `runAnalysis` is interpretation. It asks the model *why*, and writes the
 *     answer into memory so tomorrow's production run inherits it.
 */

/** Which checkpoint a post is due for, given its age. */
export function dueCheckpoint(publishedAt: Date, done: Set<string>): Checkpoint | null {
  const ageMin = (Date.now() - publishedAt.getTime()) / 60000;
  const ladder: Array<[Checkpoint, number]> = [
    ["T2H", 120],
    ["T24H", 1440],
    ["T72H", 4320],
    ["T7D", 10080],
    ["T30D", 43200],
  ];
  for (const [checkpoint, minutes] of ladder) {
    if (ageMin >= minutes && !done.has(checkpoint)) return checkpoint;
  }
  return null;
}

export interface IngestOutcome {
  postId: string;
  checkpoint: Checkpoint;
  verdict: string;
  score: number;
  rationale: string;
}

/**
 * Pull metrics for every post that has reached a checkpoint, score it, decide,
 * and fold the result back into the bandits.
 */
export async function ingestMetrics(brandId: string): Promise<IngestOutcome[]> {
  const published = await db
    .select({
      id: posts.id,
      channelId: posts.channelId,
      formatId: posts.formatId,
      hookArchetype: posts.hookArchetype,
      externalId: posts.externalId,
      publishedAt: posts.publishedAt,
      durationMs: posts.durationMs,
      externalChannelId: channels.externalId,
    })
    .from(posts)
    .innerJoin(channels, eq(channels.id, posts.channelId))
    .where(
      and(eq(posts.brandId, brandId), eq(posts.status, "PUBLISHED"), isNotNull(posts.publishedAt)),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(200);

  const outcomes: IngestOutcome[] = [];

  for (const post of published) {
    if (!post.publishedAt) continue;

    const existing = await db
      .select({ checkpoint: metricSnapshots.checkpoint })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.postId, post.id));
    const done = new Set(existing.map((e) => e.checkpoint));

    const checkpoint = dueCheckpoint(new Date(post.publishedAt), done);
    if (!checkpoint) continue;

    const metrics = await collectMetrics(post);
    if (!metrics) continue;

    const consecutiveFailures = await countConsecutiveFailures(post.channelId, post.formatId);
    const decision = decide({ checkpoint, metrics, consecutiveFailures });

    await db
      .insert(metricSnapshots)
      .values({
        postId: post.id,
        checkpoint,
        ageMinutes: Math.round((Date.now() - new Date(post.publishedAt).getTime()) / 60000),
        avgViewDurationMs: metrics.views ? Math.round((metrics.completionRate * (post.durationMs ?? 0))) : 0,
        score: decision.score,
        ...metrics,
      })
      .onConflictDoNothing();

    // The denormalised columns on `posts` are what the dashboard reads; the
    // snapshots are what the engine replays.
    await db
      .update(posts)
      .set({
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saves,
        subscribersGained: metrics.subscribersGained,
        retention3s: metrics.retention3s,
        completionRate: metrics.completionRate,
        linkClicks: metrics.linkClicks,
        signups: metrics.signups,
        performanceScore: decision.score,
        darwinianAction: decision.verdict as never,
        darwinianRationale: decision.rationale,
        decidedAt: decision.verdict === "PENDING" ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));

    if (decision.verdict !== "PENDING") {
      await updateBandits(post, decision.verdict, decision.score, metrics.retention3s);
    }

    // Retention curves only become available once a video has real watch volume.
    if (checkpoint === "T24H" || checkpoint === "T72H") {
      await captureRetention(post);
    }

    outcomes.push({
      postId: post.id,
      checkpoint,
      verdict: decision.verdict,
      score: decision.score,
      rationale: decision.rationale,
    });
  }

  await refreshObjectiveProgress(brandId);
  return outcomes;
}

async function collectMetrics(post: {
  id: string;
  channelId: string;
  externalId: string | null;
  externalChannelId: string | null;
  publishedAt: Date | null;
  durationMs: number | null;
}): Promise<PostMetrics | null> {
  if (!post.externalId || !post.externalChannelId) {
    // Dry-run or not yet live: fall back to whatever is already stored so the
    // pipeline still exercises end to end.
    const [row] = await db
      .select({
        views: posts.views,
        likes: posts.likes,
        comments: posts.comments,
        shares: posts.shares,
        saves: posts.saves,
        subscribersGained: posts.subscribersGained,
        retention3s: posts.retention3s,
        completionRate: posts.completionRate,
        profileClicks: posts.profileClicks,
        linkClicks: posts.linkClicks,
        signups: posts.signups,
      })
      .from(posts)
      .where(eq(posts.id, post.id))
      .limit(1);
    return row ?? null;
  }

  const startDate = new Date(post.publishedAt ?? Date.now()).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  try {
    const [stats, analytics] = await Promise.all([
      getVideoStats({ channelId: post.channelId, videoIds: [post.externalId] }),
      getVideoAnalytics({
        channelId: post.channelId,
        externalChannelId: post.externalChannelId,
        videoId: post.externalId,
        startDate,
        endDate,
      }),
    ]);

    const s = stats.get(post.externalId);
    const durationMs = post.durationMs ?? s?.durationMs ?? 15000;

    // averageViewPercentage is reported 0-100; completion is that over 100.
    const completionRate = analytics ? analytics.averageViewPercentage / 100 : 0;

    // YouTube does not expose a 3s retention figure directly. The retention
    // curve does, and we read it there; this is a fallback estimate used only
    // until the curve becomes available.
    const retention3s = await retention3sFor(post.id, durationMs, completionRate);

    return {
      views: analytics?.views ?? s?.views ?? 0,
      likes: analytics?.likes ?? s?.likes ?? 0,
      comments: analytics?.comments ?? s?.comments ?? 0,
      shares: analytics?.shares ?? 0,
      saves: analytics?.videosAddedToPlaylists ?? 0,
      subscribersGained: analytics?.subscribersGained ?? 0,
      retention3s,
      completionRate,
      profileClicks: 0,
      linkClicks: await countAttribution(post.id, "CLICK"),
      signups: await countAttribution(post.id, "SIGNUP"),
    };
  } catch {
    return null;
  }
}

async function retention3sFor(
  postId: string,
  durationMs: number,
  completionRate: number,
): Promise<number> {
  const [curve] = await db
    .select({ points: retentionCurves.points })
    .from(retentionCurves)
    .where(eq(retentionCurves.postId, postId))
    .orderBy(desc(retentionCurves.capturedAt))
    .limit(1);

  if (curve) {
    const points = curve.points as Array<{ ratio: number; watched: number }>;
    const target = 3000 / Math.max(durationMs, 1);
    let closest = points[0];
    for (const p of points) {
      if (!closest || Math.abs(p.ratio - target) < Math.abs(closest.ratio - target)) closest = p;
    }
    if (closest) return closest.watched;
  }

  // Without a curve, approximate from completion. Short-form retention decays
  // roughly exponentially, so a video with 30% completion held far more than 30%
  // at the three-second mark.
  return Math.min(0.95, Math.max(completionRate, Math.pow(completionRate, 0.42)));
}

async function captureRetention(post: {
  id: string;
  channelId: string;
  externalId: string | null;
  externalChannelId: string | null;
  publishedAt: Date | null;
  durationMs: number | null;
}): Promise<void> {
  if (!post.externalId || !post.externalChannelId) return;
  try {
    const points = await getRetentionCurve({
      channelId: post.channelId,
      externalChannelId: post.externalChannelId,
      videoId: post.externalId,
      startDate: new Date(post.publishedAt ?? Date.now()).toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
    });
    if (points.length === 0) return;

    const diagnosis = diagnoseRetention(points, post.durationMs ?? 15000);
    await db.insert(retentionCurves).values({
      postId: post.id,
      points: points as never,
      biggestDropMs: diagnosis?.atMs,
      biggestDropMagnitude: diagnosis?.biggestDropMagnitude,
      analysis: diagnosis?.interpretation,
    });
  } catch {
    // Analytics lags publication; absence is expected, not an error.
  }
}

async function countConsecutiveFailures(channelId: string, formatId: string): Promise<number> {
  const recent = await db
    .select({ action: posts.darwinianAction })
    .from(posts)
    .where(
      and(eq(posts.channelId, channelId), eq(posts.formatId, formatId), isNotNull(posts.decidedAt)),
    )
    .orderBy(desc(posts.decidedAt))
    .limit(6);

  let streak = 0;
  for (const r of recent) {
    if (r.action === "KILL") streak++;
    else break;
  }
  return streak;
}

async function updateBandits(
  post: { channelId: string; formatId: string; hookArchetype: string | null },
  verdict: string,
  score: number,
  retention3s: number,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(formatBandits)
    .where(
      and(eq(formatBandits.channelId, post.channelId), eq(formatBandits.formatId, post.formatId)),
    )
    .limit(1);

  const arm = updateArm(
    {
      key: post.formatId,
      alpha: existing?.alpha ?? 1,
      beta: existing?.beta ?? 1,
      trials: existing?.trials ?? 0,
      meanScore: existing?.meanScore ?? 0,
    },
    verdict as never,
    score,
  );

  await db
    .insert(formatBandits)
    .values({
      channelId: post.channelId,
      formatId: post.formatId,
      alpha: arm.alpha,
      beta: arm.beta,
      trials: arm.trials,
      wins: (existing?.wins ?? 0) + (verdict === "DOUBLE_DOWN" || verdict === "AMPLIFY" ? 1 : 0),
      kills: (existing?.kills ?? 0) + (verdict === "KILL" ? 1 : 0),
      meanScore: arm.meanScore,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [formatBandits.channelId, formatBandits.formatId],
      set: {
        alpha: arm.alpha,
        beta: arm.beta,
        trials: arm.trials,
        wins: sql`${formatBandits.wins} + ${verdict === "DOUBLE_DOWN" || verdict === "AMPLIFY" ? 1 : 0}`,
        kills: sql`${formatBandits.kills} + ${verdict === "KILL" ? 1 : 0}`,
        meanScore: arm.meanScore,
        updatedAt: new Date(),
      },
    });

  if (post.hookArchetype) {
    const [row] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, post.channelId))
      .limit(1);
    if (!row) return;

    const hookArm = updateArm(
      { key: post.hookArchetype, alpha: 1, beta: 1, trials: 0, meanScore: 0 },
      verdict as never,
      retention3s,
    );
    await db
      .insert(hookBandits)
      .values({
        brandId: row.brandId,
        hookArchetype: post.hookArchetype,
        alpha: hookArm.alpha,
        beta: hookArm.beta,
        trials: 1,
        meanRetention3s: retention3s,
      })
      .onConflictDoUpdate({
        target: [hookBandits.brandId, hookBandits.hookArchetype],
        set: {
          alpha: sql`${hookBandits.alpha} + ${hookArm.alpha - 1}`,
          beta: sql`${hookBandits.beta} + ${hookArm.beta - 1}`,
          trials: sql`${hookBandits.trials} + 1`,
          meanRetention3s: sql`${hookBandits.meanRetention3s} + (${retention3s} - ${hookBandits.meanRetention3s}) / (${hookBandits.trials} + 1)`,
          updatedAt: new Date(),
        },
      });
  }
}

/** Recompute where each channel stands against its stated objectives. */
async function refreshObjectiveProgress(brandId: string): Promise<void> {
  const objectives = await db
    .select({ obj: channelObjectives, channelId: channels.id })
    .from(channelObjectives)
    .innerJoin(channels, eq(channels.id, channelObjectives.channelId))
    .where(and(eq(channels.brandId, brandId), eq(channelObjectives.status, "ACTIVE")));

  for (const { obj } of objectives) {
    const [agg] = await db
      .select({
        posts: sql<number>`count(*)::int`,
        views: sql<number>`coalesce(sum(${posts.views}),0)::int`,
        clicks: sql<number>`coalesce(sum(${posts.linkClicks}),0)::int`,
        shares: sql<number>`coalesce(sum(${posts.shares}),0)::int`,
        saves: sql<number>`coalesce(sum(${posts.saves}),0)::int`,
        signups: sql<number>`coalesce(sum(${posts.signups}),0)::int`,
        subs: sql<number>`coalesce(sum(${posts.subscribersGained}),0)::int`,
        avgRetention: sql<number>`coalesce(avg(${posts.retention3s}),0)`,
        avgCompletion: sql<number>`coalesce(avg(${posts.completionRate}),0)`,
      })
      .from(posts)
      .where(
        and(
          eq(posts.channelId, obj.channelId),
          eq(posts.status, "PUBLISHED"),
          sql`${posts.publishedAt} >= ${obj.periodStart}`,
        ),
      );

    const views = Math.max(agg?.views ?? 0, 1);
    const current =
      {
        retention3s: Number(agg?.avgRetention ?? 0),
        completionRate: Number(agg?.avgCompletion ?? 0),
        shareRate: (agg?.shares ?? 0) / views,
        saveRate: (agg?.saves ?? 0) / views,
        linkClickRate: (agg?.clicks ?? 0) / views,
        views: agg?.views ?? 0,
        signups: agg?.signups ?? 0,
        subscribersGained: agg?.subs ?? 0,
        postsPublished: agg?.posts ?? 0,
      }[obj.metric] ?? 0;

    const met =
      obj.comparator === ">=" ? current >= obj.targetValue
      : obj.comparator === ">" ? current > obj.targetValue
      : obj.comparator === "<=" ? current <= obj.targetValue
      : current < obj.targetValue;

    const expired = new Date(obj.periodEnd).getTime() < Date.now();

    await db
      .update(channelObjectives)
      .set({
        currentValue: current,
        status: expired ? (met ? "ACHIEVED" : "MISSED") : "ACTIVE",
        updatedAt: new Date(),
      })
      .where(eq(channelObjectives.id, obj.id));
  }
}

async function countAttribution(postId: string, kind: string): Promise<number> {
  const { attributionEvents } = await import("@/server/db/schema");
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attributionEvents)
    .where(and(eq(attributionEvents.postId, postId), eq(attributionEvents.kind, kind)));
  return row?.n ?? 0;
}

/* ========================================================================== */

/** The interpretive half: ask the model why, and write the answer into memory. */
export async function runAnalysis(brandId: string, channelId?: string) {
  const outcomes = await ingestMetrics(brandId);

  const prompt = `
Readings since the last analysis: ${outcomes.length}

${outcomes
  .slice(0, 25)
  .map((o) => `- ${o.postId.slice(0, 8)} @${o.checkpoint} → ${o.verdict} (score ${o.score.toFixed(3)}) : ${o.rationale}`)
  .join("\n") || "No post reached a new checkpoint."}

Analyse these. On the notable posts, pull the retention diagnosis. Separate a
scenario that fails from one that has barely been tried. Then write precise,
numbered lessons to memory.
`.trim();

  return runAgent({
    kind: "ANALYST",
    brandId,
    channelId,
    label: `Analysis — ${outcomes.length} reading${outcomes.length === 1 ? "" : "s"}`,
    goal: "Explain what happened and write actionable lessons to memory.",
    system: ANALYST_SYSTEM,
    prompt,
    tools: toolsFor("ANALYST"),
    maxSteps: 30,
    temperature: 0.4,
    fallback: async () => ({
      output: { outcomes },
      summary: `${outcomes.length} readings processed and verdicts applied. Without a model there is no causal interpretation — only the arithmetic scores and decisions.`,
    }),
  });
}
