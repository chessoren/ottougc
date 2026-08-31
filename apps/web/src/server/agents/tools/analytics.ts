import { and, desc, eq, gte, sql } from "drizzle-orm";

import {
  channels,
  formatBandits,
  hookBandits,
  metricSnapshots,
  posts,
  retentionCurves,
} from "@/server/db/schema";
import { diagnoseRetention, scorePost } from "@/server/darwin/engine";

import type { AgentTool } from "../types";

/**
 * Analytics tools.
 *
 * These are what let an account agent learn instead of merely producing. The
 * important design choice is that they return *interpretations*, not raw rows: a
 * model handed a retention array will hallucinate a story about it, whereas a
 * model handed "you lose 22% of viewers at 6.2s, which is the post-hook drop —
 * your hook over-promised" can act.
 */

export const getRecentPerformance: AgentTool = {
  name: "get_recent_performance",
  description:
    "Recent performance for this channel: score, how many held past 3s, completion, shares, clicks, and the verdict on each post. Call this at the start of every run to know what's working.",
  parameters: {
    type: "object",
    properties: {
      days: { type: "number", description: "Window in days. 14 by default." },
      limit: { type: "number" },
    },
  },
  async handler(args: { days?: number; limit?: number }, ctx) {
    const since = new Date(Date.now() - (args.days ?? 14) * 86400_000);
    const conditions = [eq(posts.brandId, ctx.brandId), gte(posts.createdAt, since)];
    if (ctx.channelId) conditions.push(eq(posts.channelId, ctx.channelId));

    const rows = await ctx.db
      .select({
        id: posts.id,
        formatId: posts.formatId,
        hookArchetype: posts.hookArchetype,
        hookText: posts.hookText,
        status: posts.status,
        publishedAt: posts.publishedAt,
        views: posts.views,
        retention3s: posts.retention3s,
        completionRate: posts.completionRate,
        shares: posts.shares,
        saves: posts.saves,
        comments: posts.comments,
        linkClicks: posts.linkClicks,
        signups: posts.signups,
        performanceScore: posts.performanceScore,
        darwinianAction: posts.darwinianAction,
      })
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.performanceScore))
      .limit(Math.min(args.limit ?? 25, 60));

    const published = rows.filter((r) => r.status === "PUBLISHED");
    const winners = published.filter((r) => r.darwinianAction === "DOUBLE_DOWN" || r.darwinianAction === "AMPLIFY");
    const killed = published.filter((r) => r.darwinianAction === "KILL");

    return {
      posts: rows,
      summary: {
        published: published.length,
        winners: winners.length,
        killed: killed.length,
        outlierRate: published.length ? winners.length / published.length : 0,
        medianScore: median(published.map((p) => p.performanceScore)),
        bestHook: winners[0]?.hookText,
        bestFormat: winners[0]?.formatId,
      },
    };
  },
};

export const getRetentionDiagnosis: AgentTool = {
  name: "get_retention_diagnosis",
  description:
    "Reads the drop-off curve for a post: exactly where people leave, and what that means in practice (weak hook, promise not kept, demo too long, call to action too early). This is the most actionable tool you have for improving the next script.",
  parameters: {
    type: "object",
    properties: { postId: { type: "string" } },
    required: ["postId"],
  },
  async handler(args: { postId: string }, ctx) {
    const [post] = await ctx.db
      .select({ durationMs: posts.durationMs, hookText: posts.hookText, formatId: posts.formatId })
      .from(posts)
      .where(eq(posts.id, args.postId))
      .limit(1);
    if (!post) return { error: "Post introuvable." };

    const [curve] = await ctx.db
      .select({ points: retentionCurves.points, analysis: retentionCurves.analysis })
      .from(retentionCurves)
      .where(eq(retentionCurves.postId, args.postId))
      .orderBy(desc(retentionCurves.capturedAt))
      .limit(1);

    if (!curve) {
      return {
        error:
          "No drop-off curve available yet. YouTube Analytics only publishes one after enough watch time, usually 24 to 48 hours.",
      };
    }

    const points = curve.points as Array<{ ratio: number; watched: number }>;
    const diagnosis = diagnoseRetention(points, post.durationMs ?? 15000);

    return {
      hookText: post.hookText,
      formatId: post.formatId,
      retentionAt3s: sampleAt(points, 3000 / (post.durationMs ?? 15000)),
      retentionAt10s: sampleAt(points, 10000 / (post.durationMs ?? 15000)),
      diagnosis,
      storedAnalysis: curve.analysis,
    };
  },
};

export const getBanditState: AgentTool = {
  name: "get_bandit_state",
  description:
    "The explore/exploit state: for each scenario, how often it's been tried on this channel, how often it won, how often it was dropped, and its average score. A barely-tried scenario is worth exploring even on a low score — that's where the outliers are.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    if (!ctx.channelId) return { error: "No channel in context." };
    const formats = await ctx.db
      .select()
      .from(formatBandits)
      .where(eq(formatBandits.channelId, ctx.channelId))
      .orderBy(desc(formatBandits.meanScore));

    const hooks = await ctx.db
      .select()
      .from(hookBandits)
      .where(eq(hookBandits.brandId, ctx.brandId))
      .orderBy(desc(hookBandits.meanRetention3s));

    return {
      formats: formats.map((f) => ({
        formatId: f.formatId,
        trials: f.trials,
        wins: f.wins,
        kills: f.kills,
        meanScore: Number(f.meanScore.toFixed(3)),
        // Posterior mean of Beta(alpha, beta) — the current belief about win rate.
        estimatedWinRate: Number((f.alpha / (f.alpha + f.beta)).toFixed(3)),
        lastUsedAt: f.lastUsedAt,
      })),
      hooks: hooks.map((h) => ({
        archetype: h.hookArchetype,
        trials: h.trials,
        meanRetention3s: Number(h.meanRetention3s.toFixed(3)),
        estimatedWinRate: Number((h.alpha / (h.alpha + h.beta)).toFixed(3)),
      })),
      advice:
        formats.length === 0
          ? "No history on this channel yet — this is pure exploration, so try varied shapes."
          : "Four in five videos should use the highest estimated win rate; one in five should go to the least-tried.",
    };
  },
};

export const getChannelHealth: AgentTool = {
  name: "get_channel_health",
  description:
    "Channel health: status, warming day, cadence, subscribers, last post, and whether it's allowed to post today.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    if (!ctx.channelId) return { error: "No channel in context." };
    const [row] = await ctx.db
      .select({
        title: channels.title,
        handle: channels.handle,
        status: channels.status,
        warmingDay: channels.warmingDay,
        dailyPostTarget: channels.dailyPostTarget,
        publishSlots: channels.publishSlots,
        subscriberCount: channels.subscriberCount,
        videoCount: channels.videoCount,
        lastPublishedAt: channels.lastPublishedAt,
      })
      .from(channels)
      .where(eq(channels.id, ctx.channelId))
      .limit(1);
    if (!row) return { error: "Compte introuvable." };

    const hoursSince = row.lastPublishedAt
      ? (Date.now() - new Date(row.lastPublishedAt).getTime()) / 3600_000
      : Infinity;

    // Warming ramp: a brand-new channel that publishes twice a day on day one
    // looks automated. The ramp is what makes it look like a person starting out.
    const warmingCap =
      row.status === "WARMING" ? (row.warmingDay <= 3 ? 0 : row.warmingDay <= 7 ? 1 : 2) : row.dailyPostTarget;

    return {
      ...row,
      hoursSinceLastPost: Number.isFinite(hoursSince) ? Math.round(hoursSince) : null,
      allowedPostsToday: warmingCap,
      canPublishNow: hoursSince >= 4 && warmingCap > 0,
      note:
        row.status === "WARMING"
          ? `Warming up, day ${row.warmingDay}. Days 1-3: no posting, interaction only. Days 4-7: one a day. Day 8 onward: up to two.`
          : undefined,
    };
  },
};

export const compareToFleet: AgentTool = {
  name: "compare_to_fleet",
  description:
    "Compares this channel against the brand's others. Tells you whether a bad result is your strategy or general conditions.",
  parameters: { type: "object", properties: { days: { type: "number" } } },
  async handler(args: { days?: number }, ctx) {
    const since = new Date(Date.now() - (args.days ?? 14) * 86400_000);
    const rows = await ctx.db
      .select({
        channelId: posts.channelId,
        handle: channels.handle,
        title: channels.title,
        postCount: sql<number>`count(*)::int`,
        avgScore: sql<number>`coalesce(avg(${posts.performanceScore}), 0)`,
        avgRetention: sql<number>`coalesce(avg(${posts.retention3s}), 0)`,
        totalViews: sql<number>`coalesce(sum(${posts.views}), 0)::int`,
        totalClicks: sql<number>`coalesce(sum(${posts.linkClicks}), 0)::int`,
      })
      .from(posts)
      .innerJoin(channels, eq(channels.id, posts.channelId))
      .where(
        and(eq(posts.brandId, ctx.brandId), gte(posts.createdAt, since), eq(posts.status, "PUBLISHED")),
      )
      .groupBy(posts.channelId, channels.handle, channels.title);

    const mine = rows.find((r) => r.channelId === ctx.channelId);
    const fleetAvgScore = rows.length
      ? rows.reduce((s, r) => s + Number(r.avgScore), 0) / rows.length
      : 0;

    return {
      fleet: rows.map((r) => ({
        handle: r.handle ?? r.title,
        posts: r.postCount,
        avgScore: Number(Number(r.avgScore).toFixed(3)),
        avgRetention3s: Number(Number(r.avgRetention).toFixed(3)),
        views: r.totalViews,
        clicks: r.totalClicks,
        isYou: r.channelId === ctx.channelId,
      })),
      yourRank: mine
        ? rows.filter((r) => Number(r.avgScore) > Number(mine.avgScore)).length + 1
        : null,
      fleetAvgScore: Number(fleetAvgScore.toFixed(3)),
      verdict: mine
        ? Number(mine.avgScore) > fleetAvgScore
          ? "You're above the average. What you're doing is working — build on it."
          : "You're below the average. Conditions aren't the problem — change your angle."
        : "No published data for this channel yet.",
    };
  },
};

export const recordSnapshot: AgentTool = {
  name: "record_metric_snapshot",
  description:
    "Records a metrics reading at a checkpoint. Used by the analyst at the 2h, 24h and 72h passes.",
  parameters: {
    type: "object",
    properties: {
      postId: { type: "string" },
      checkpoint: { type: "string", enum: ["T2H", "T24H", "T72H", "T7D", "T30D"] },
      metrics: { type: "object" },
    },
    required: ["postId", "checkpoint", "metrics"],
  },
  async handler(
    args: { postId: string; checkpoint: string; metrics: Record<string, number> },
    ctx,
  ) {
    const m = {
      views: args.metrics.views ?? 0,
      likes: args.metrics.likes ?? 0,
      comments: args.metrics.comments ?? 0,
      shares: args.metrics.shares ?? 0,
      saves: args.metrics.saves ?? 0,
      subscribersGained: args.metrics.subscribersGained ?? 0,
      retention3s: args.metrics.retention3s ?? 0,
      completionRate: args.metrics.completionRate ?? 0,
      profileClicks: args.metrics.profileClicks ?? 0,
      linkClicks: args.metrics.linkClicks ?? 0,
      signups: args.metrics.signups ?? 0,
    };
    const score = scorePost(m);

    await ctx.db
      .insert(metricSnapshots)
      .values({
        postId: args.postId,
        checkpoint: args.checkpoint as never,
        ageMinutes: args.metrics.ageMinutes ?? 0,
        avgViewDurationMs: args.metrics.avgViewDurationMs ?? 0,
        score,
        ...m,
      })
      .onConflictDoNothing();

    return { recorded: true, score };
  },
};

export const ANALYTICS_TOOLS: AgentTool[] = [
  getRecentPerformance,
  getRetentionDiagnosis,
  getBanditState,
  getChannelHealth,
  compareToFleet,
  recordSnapshot,
];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sampleAt(points: Array<{ ratio: number; watched: number }>, ratio: number): number | null {
  if (points.length === 0 || ratio > 1) return null;
  let closest = points[0]!;
  for (const p of points) {
    if (Math.abs(p.ratio - ratio) < Math.abs(closest.ratio - ratio)) closest = p;
  }
  return Number(closest.watched.toFixed(3));
}
