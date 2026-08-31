import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  agentRuns,
  brands,
  channelObjectives,
  channels,
  fleetDecisions,
  fleetReviews,
  formatBandits,
  personas,
  postComments,
  posts,
  renderJobs,
  strategies,
} from "@/server/db/schema";

/**
 * Dashboard reads.
 *
 * Kept in one module so every page shares the same definitions of "active",
 * "outlier" and "today". Two pages computing the same number differently is the
 * fastest way to make an operator stop trusting a dashboard.
 */

export async function getPrimaryBrand() {
  const [brand] = await db.select().from(brands).orderBy(brands.createdAt).limit(1);
  return brand ?? null;
}

export async function getOverview(brandId: string) {
  const dayAgo = new Date(Date.now() - 86400_000);
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${posts.status} = 'PUBLISHED')::int`,
      ready: sql<number>`count(*) filter (where ${posts.status} = 'READY')::int`,
      inFlight: sql<number>`count(*) filter (where ${posts.status} in ('SCRIPTING','GENERATING_MEDIA','RENDERING','QA_PENDING'))::int`,
      rejected: sql<number>`count(*) filter (where ${posts.status} = 'QA_REJECTED')::int`,
      failed: sql<number>`count(*) filter (where ${posts.status} = 'FAILED')::int`,
      views: sql<number>`coalesce(sum(${posts.views}),0)::int`,
      clicks: sql<number>`coalesce(sum(${posts.linkClicks}),0)::int`,
      signups: sql<number>`coalesce(sum(${posts.signups}),0)::int`,
      outliers: sql<number>`count(*) filter (where ${posts.darwinianAction} in ('DOUBLE_DOWN','AMPLIFY'))::int`,
      killed: sql<number>`count(*) filter (where ${posts.darwinianAction} = 'KILL')::int`,
    })
    .from(posts)
    .where(eq(posts.brandId, brandId));

  const [today] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.brandId, brandId), gte(posts.createdAt, dayAgo)));

  const [week] = await db
    .select({
      n: sql<number>`count(*)::int`,
      views: sql<number>`coalesce(sum(${posts.views}),0)::int`,
    })
    .from(posts)
    .where(and(eq(posts.brandId, brandId), gte(posts.createdAt, weekAgo)));

  const [fleet] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${channels.status} = 'ACTIVE')::int`,
      warming: sql<number>`count(*) filter (where ${channels.status} = 'WARMING')::int`,
      pending: sql<number>`count(*) filter (where ${channels.status} = 'PENDING_AUTH')::int`,
      paused: sql<number>`count(*) filter (where ${channels.status} in ('PAUSED','COOLDOWN','FLAGGED','TOKEN_EXPIRED'))::int`,
      subs: sql<number>`coalesce(sum(${channels.subscriberCount}),0)::int`,
    })
    .from(channels)
    .where(eq(channels.brandId, brandId));

  const [renders] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${renderJobs.status} in ('QUEUED','GENERATING'))::int`,
      failed: sql<number>`count(*) filter (where ${renderJobs.status} = 'FAILED')::int`,
    })
    .from(renderJobs)
    .innerJoin(posts, eq(posts.id, renderJobs.postId))
    .where(eq(posts.brandId, brandId));

  return {
    totals,
    todayCount: today?.n ?? 0,
    week: week ?? { n: 0, views: 0 },
    fleet,
    renders: renders ?? { queued: 0, failed: 0 },
  };
}

export async function getFleet(brandId: string) {
  const rows = await db
    .select({
      id: channels.id,
      handle: channels.handle,
      title: channels.title,
      status: channels.status,
      slotIndex: channels.slotIndex,
      warmingDay: channels.warmingDay,
      dailyPostTarget: channels.dailyPostTarget,
      subscriberCount: channels.subscriberCount,
      externalId: channels.externalId,
      thumbnailUrl: channels.thumbnailUrl,
      lastPublishedAt: channels.lastPublishedAt,
      personaName: personas.displayName,
      archetype: personas.archetype,
      awareness: personas.awarenessLevel,
      appearance: personas.appearancePrompt,
      thesis: strategies.thesis,
      brandDensity: strategies.brandDensity,
      brandRule: strategies.brandIntroductionRule,
      formatMix: strategies.formatMix,
    })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .leftJoin(strategies, and(eq(strategies.channelId, channels.id), eq(strategies.isActive, true)))
    .where(eq(channels.brandId, brandId))
    .orderBy(channels.slotIndex);

  const stats = await db
    .select({
      channelId: posts.channelId,
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${posts.status} = 'PUBLISHED')::int`,
      views: sql<number>`coalesce(sum(${posts.views}),0)::int`,
      clicks: sql<number>`coalesce(sum(${posts.linkClicks}),0)::int`,
      outliers: sql<number>`count(*) filter (where ${posts.darwinianAction} in ('DOUBLE_DOWN','AMPLIFY'))::int`,
      avgScore: sql<number>`coalesce(avg(${posts.performanceScore}),0)`,
      avgRetention: sql<number>`coalesce(avg(${posts.retention3s}),0)`,
    })
    .from(posts)
    .where(eq(posts.brandId, brandId))
    .groupBy(posts.channelId);

  const objectives = await db
    .select({
      channelId: channelObjectives.channelId,
      statement: channelObjectives.statement,
      metric: channelObjectives.metric,
      comparator: channelObjectives.comparator,
      target: channelObjectives.targetValue,
      current: channelObjectives.currentValue,
    })
    .from(channelObjectives)
    .innerJoin(channels, eq(channels.id, channelObjectives.channelId))
    .where(and(eq(channels.brandId, brandId), eq(channelObjectives.status, "ACTIVE")));

  return rows.map((c) => ({
    ...c,
    stats: stats.find((s) => s.channelId === c.id) ?? null,
    objectives: objectives.filter((o) => o.channelId === c.id),
  }));
}

export type FleetChannel = Awaited<ReturnType<typeof getFleet>>[number];

export async function getPosts(
  brandId: string,
  opts: { limit?: number; channelId?: string; status?: string } = {},
) {
  const conditions = [eq(posts.brandId, brandId)];
  if (opts.channelId) conditions.push(eq(posts.channelId, opts.channelId));
  if (opts.status) conditions.push(eq(posts.status, opts.status as never));

  return db
    .select({
      id: posts.id,
      formatId: posts.formatId,
      hookText: posts.hookText,
      title: posts.title,
      status: posts.status,
      videoUrl: posts.renderedVideoUrl,
      durationMs: posts.durationMs,
      externalUrl: posts.externalUrl,
      publishedAt: posts.publishedAt,
      scheduledFor: posts.scheduledFor,
      createdAt: posts.createdAt,
      views: posts.views,
      likes: posts.likes,
      comments: posts.comments,
      shares: posts.shares,
      saves: posts.saves,
      retention3s: posts.retention3s,
      completionRate: posts.completionRate,
      linkClicks: posts.linkClicks,
      signups: posts.signups,
      score: posts.performanceScore,
      decision: posts.darwinianAction,
      rationale: posts.darwinianRationale,
      qaVerdict: posts.qaVerdict,
      failureReason: posts.failureReason,
      channelId: posts.channelId,
      personaName: personas.displayName,
      handle: channels.handle,
    })
    .from(posts)
    .leftJoin(channels, eq(channels.id, posts.channelId))
    .leftJoin(personas, eq(personas.channelId, posts.channelId))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(opts.limit ?? 60);
}

export type DashboardPost = Awaited<ReturnType<typeof getPosts>>[number];

export async function getAgentRuns(brandId: string, limit = 40) {
  return db
    .select({
      id: agentRuns.id,
      kind: agentRuns.kind,
      label: agentRuns.label,
      status: agentRuns.status,
      summary: agentRuns.summary,
      steps: agentRuns.stepCount,
      durationMs: agentRuns.durationMs,
      costUsd: agentRuns.costUsd,
      model: agentRuns.model,
      startedAt: agentRuns.startedAt,
      handle: channels.handle,
      personaName: personas.displayName,
    })
    .from(agentRuns)
    .leftJoin(channels, eq(channels.id, agentRuns.channelId))
    .leftJoin(personas, eq(personas.channelId, agentRuns.channelId))
    .where(eq(agentRuns.brandId, brandId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);
}

export type AgentRunRow = Awaited<ReturnType<typeof getAgentRuns>>[number];

export async function getFormatPerformance(brandId: string) {
  const rows = await db
    .select({
      formatId: posts.formatId,
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${posts.status} = 'PUBLISHED')::int`,
      outliers: sql<number>`count(*) filter (where ${posts.darwinianAction} in ('DOUBLE_DOWN','AMPLIFY'))::int`,
      kills: sql<number>`count(*) filter (where ${posts.darwinianAction} = 'KILL')::int`,
      avgScore: sql<number>`coalesce(avg(${posts.performanceScore}),0)`,
      views: sql<number>`coalesce(sum(${posts.views}),0)::int`,
    })
    .from(posts)
    .where(eq(posts.brandId, brandId))
    .groupBy(posts.formatId);

  const bandits = await db
    .select({
      formatId: formatBandits.formatId,
      alpha: sql<number>`sum(${formatBandits.alpha})`,
      beta: sql<number>`sum(${formatBandits.beta})`,
      trials: sql<number>`sum(${formatBandits.trials})::int`,
    })
    .from(formatBandits)
    .innerJoin(channels, eq(channels.id, formatBandits.channelId))
    .where(eq(channels.brandId, brandId))
    .groupBy(formatBandits.formatId);

  return rows
    .map((r) => {
      const b = bandits.find((x) => x.formatId === r.formatId);
      return {
        ...r,
        // Posterior mean of Beta(alpha, beta): the current belief about this
        // format's win rate, which is what the allocator samples from.
        estimatedWinRate: b ? Number(b.alpha) / (Number(b.alpha) + Number(b.beta)) : null,
        trials: b?.trials ?? r.total,
      };
    })
    .sort((a, b) => Number(b.avgScore) - Number(a.avgScore));
}

export async function getLatestReview(brandId: string) {
  const [review] = await db
    .select()
    .from(fleetReviews)
    .where(eq(fleetReviews.brandId, brandId))
    .orderBy(desc(fleetReviews.createdAt))
    .limit(1);

  if (!review) return null;

  const decisions = await db
    .select({
      action: fleetDecisions.action,
      rationale: fleetDecisions.rationale,
      quotaBefore: fleetDecisions.quotaBefore,
      quotaAfter: fleetDecisions.quotaAfter,
      medianScore: fleetDecisions.medianScore,
      views: fleetDecisions.views,
      postsPublished: fleetDecisions.postsPublished,
      handle: channels.handle,
      personaName: personas.displayName,
    })
    .from(fleetDecisions)
    .innerJoin(channels, eq(channels.id, fleetDecisions.channelId))
    .leftJoin(personas, eq(personas.channelId, fleetDecisions.channelId))
    .where(eq(fleetDecisions.reviewId, review.id));

  return { review, decisions };
}

export async function getRecentComments(brandId: string, limit = 20) {
  return db
    .select({
      id: postComments.id,
      text: postComments.text,
      author: postComments.authorName,
      intent: postComments.intent,
      likeCount: postComments.likeCount,
      repliedAt: postComments.repliedAt,
      replyText: postComments.replyText,
      publishedAt: postComments.publishedAt,
      hookText: posts.hookText,
    })
    .from(postComments)
    .innerJoin(posts, eq(posts.id, postComments.postId))
    .where(eq(posts.brandId, brandId))
    .orderBy(desc(postComments.publishedAt))
    .limit(limit);
}

/** Daily production and views. Gaps are filled so zero days show as zero. */
export async function getDailySeries(brandId: string, days = 21) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${posts.createdAt}, 'YYYY-MM-DD')`,
      produced: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${posts.status} = 'PUBLISHED')::int`,
      views: sql<number>`coalesce(sum(${posts.views}),0)::int`,
    })
    .from(posts)
    .where(and(eq(posts.brandId, brandId), gte(posts.createdAt, since)))
    .groupBy(sql`to_char(${posts.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${posts.createdAt}, 'YYYY-MM-DD')`);

  const out: Array<{ day: string; produced: number; published: number; views: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    out.push(rows.find((r) => r.day === d) ?? { day: d, produced: 0, published: 0, views: 0 });
  }
  return out;
}
