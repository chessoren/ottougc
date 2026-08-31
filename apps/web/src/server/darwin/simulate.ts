import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { channels, personas, posts } from "@/server/db/schema";
import { getFormat } from "@/server/knowledge";

/**
 * Metric simulation.
 *
 * Explicitly a simulation, and labelled as such everywhere it writes: it exists
 * to exercise the darwinian engine before real YouTube analytics are flowing,
 * and to make the dashboard legible on day one.
 *
 * The numbers are not random noise. They are drawn from a distribution that
 * reproduces the property the whole product is built on — a heavy tail, where a
 * handful of posts carry almost all the views — because an engine tuned against
 * a normal distribution would learn the wrong thresholds entirely.
 */

export interface SimulationOptions {
  brandId: string;
  /** Deterministic runs, so a demo replays identically. */
  seed?: number;
  /** Share of posts that become outliers. Real fleets sit at 5-10%. */
  outlierRate?: number;
}

export interface SimulationResult {
  posts: number;
  outliers: number;
  totalViews: number;
}

export async function simulateMetrics(opts: SimulationOptions): Promise<SimulationResult> {
  const rng = mulberry32(opts.seed ?? 20260828);
  const outlierRate = opts.outlierRate ?? 0.08;

  const rows = await db
    .select({
      id: posts.id,
      formatId: posts.formatId,
      publishedAt: posts.publishedAt,
      awareness: personas.awarenessLevel,
      subs: channels.subscriberCount,
    })
    .from(posts)
    .leftJoin(personas, eq(personas.channelId, posts.channelId))
    .leftJoin(channels, eq(channels.id, posts.channelId))
    .where(sql`${posts.brandId} = ${opts.brandId} and ${posts.status} = 'PUBLISHED'`)
    .orderBy(desc(posts.publishedAt));

  let outliers = 0;
  let totalViews = 0;

  for (const post of rows) {
    const format = getFormat(post.formatId);
    const isOutlier = rng() < outlierRate;
    if (isOutlier) outliers++;

    // Log-normal views: the shape that actually occurs on a recommendation feed.
    // Ordinary posts land in the hundreds-to-low-thousands; an outlier is one to
    // two orders of magnitude above, which is exactly what makes the median a
    // useless summary and the outlier rate the number that matters.
    const base = Math.exp(6.2 + gaussian(rng) * 0.85);
    const views = Math.round(isOutlier ? base * (12 + rng() * 40) : base);
    totalViews += views;

    // Retention centred on the format's own benchmark, so a format that really
    // is stronger shows up as stronger and the bandit learns something true.
    const benchRetention = format?.benchmarks.retention3s ?? 0.62;
    const benchCompletion = format?.benchmarks.completionRate ?? 0.3;
    const benchShare = format?.benchmarks.shareRate ?? 0.012;
    const benchSave = format?.benchmarks.saveRate ?? 0.04;

    const lift = isOutlier ? 1.25 : 1;
    const retention3s = clamp(benchRetention * lift + gaussian(rng) * 0.07, 0.12, 0.95);
    const completionRate = clamp(benchCompletion * lift + gaussian(rng) * 0.05, 0.05, 0.85);
    const shareRate = clamp(benchShare * lift * (1 + gaussian(rng) * 0.4), 0, 0.09);
    const saveRate = clamp(benchSave * lift * (1 + gaussian(rng) * 0.4), 0, 0.16);

    // Cold-audience formats convert far less per view. Judging them on click
    // rate is exactly the mistake the weekly review guards against, so the
    // simulation reproduces the effect rather than flattening it.
    const awarenessFactor =
      post.awareness === "UNAWARE" ? 0.25 : post.awareness === "PROBLEM_AWARE" ? 0.7 : 1.25;
    const clickRate = clamp(0.014 * awarenessFactor * lift * (1 + gaussian(rng) * 0.5), 0, 0.09);

    const linkClicks = Math.round(views * clickRate);
    const signups = Math.round(linkClicks * (0.18 + rng() * 0.14));

    await db
      .update(posts)
      .set({
        views,
        likes: Math.round(views * (0.03 + rng() * 0.05)),
        comments: Math.round(views * (0.004 + rng() * 0.006)),
        shares: Math.round(views * shareRate),
        saves: Math.round(views * saveRate),
        subscribersGained: Math.round(views * 0.002 * lift),
        retention3s,
        completionRate,
        linkClicks,
        signups,
        // Backdate so the checkpoint ladder has something to fire on.
        publishedAt: post.publishedAt ?? new Date(Date.now() - 4 * 86400_000),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
  }

  return { posts: rows.length, outliers, totalViews };
}

/** Backdate published posts so the T+2h/T+24h/T+72h ladder has elapsed. */
export async function backdatePublished(brandId: string, days = 5): Promise<number> {
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(sql`${posts.brandId} = ${brandId} and ${posts.status} = 'PUBLISHED'`);

  for (const [i, row] of rows.entries()) {
    const age = 1 + ((i * 7) % (days * 24)); // spread across the window, in hours
    await db
      .update(posts)
      .set({ publishedAt: new Date(Date.now() - age * 3600_000) })
      .where(eq(posts.id, row.id));
  }
  return rows.length;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
