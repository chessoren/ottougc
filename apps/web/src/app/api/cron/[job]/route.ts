import { eq, sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { brands, channels, personas } from "@/server/db/schema";
import { runDailyProduction } from "@/server/agents/account";
import { ingestMetrics, runAnalysis } from "@/server/agents/analyst";
import { runWeeklyReview } from "@/server/agents/fleet-review";
import { planFleet } from "@/server/agents/manager";
import { publishDueposts } from "@/server/publishing/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled jobs.
 *
 *   produce   — every morning: each channel's agent makes its video
 *   publish   — every 30 minutes: anything whose slot has come goes live
 *   ingest    — hourly: pull metrics, apply the darwinian grid
 *   analyse   — nightly: interpret the day and write lessons to memory
 *   review    — weekly: the manager decides each channel's fate
 *   warm      — nightly: advance the warming ramp
 *
 * Protected by a shared secret rather than a session: these are called by a
 * scheduler, not a browser. A cron endpoint anyone can hit is a cron endpoint
 * anyone can use to burn your generation budget.
 */
const JOBS = ["produce", "publish", "ingest", "analyse", "review", "warm", "plan"] as const;
type Job = (typeof JOBS)[number];

export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const provided = new URL(request.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && provided !== secret) {
      return Response.json({ error: "Unauthorised." }, { status: 401 });
    }
  } else if (env.isProd) {
    return Response.json({ error: "CRON_SECRET must be set in production." }, { status: 500 });
  }

  if (!JOBS.includes(job as Job)) {
    return Response.json({ error: `Unknown job: ${job}`, known: JOBS }, { status: 404 });
  }

  const started = Date.now();
  const results: Array<Record<string, unknown>> = [];
  const search = new URL(request.url).searchParams;
  const limit = Number(search.get("limit") ?? "0");
  const scenarioId = search.get("scenario") ?? undefined;

  const activeBrands = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.isActive, true));

  for (const brand of activeBrands) {
    try {
      results.push({ brand: brand.name, ...(await runJob(job as Job, brand.id, { limit, scenarioId })) });
    } catch (err) {
      results.push({ brand: brand.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return Response.json({
    job,
    brands: activeBrands.length,
    durationMs: Date.now() - started,
    results,
  });
}

async function runJob(
  job: Job,
  brandId: string,
  extras: { limit: number; scenarioId?: string } = { limit: 0 },
): Promise<Record<string, unknown>> {
  const { limit, scenarioId } = extras;
  switch (job) {
    case "plan": {
      const run = await planFleet(brandId);
      return { summary: run.summary, degraded: run.degraded };
    }

    case "produce": {
      const fleet = await db
        .select({
          id: channels.id,
          handle: channels.handle,
          target: channels.dailyPostTarget,
          status: channels.status,
          warmingDay: channels.warmingDay,
        })
        .from(channels)
        .innerJoin(personas, eq(personas.channelId, channels.id))
        .where(eq(channels.brandId, brandId));

      const produced: string[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      let remaining = limit && limit > 0 ? limit : Number.POSITIVE_INFINITY;

      for (const c of fleet) {
        if (remaining <= 0) {
          skipped.push(`${c.handle} (limit)`);
          continue;
        }
        const allowance = allowedToday(c.status, c.warmingDay, c.target);
        if (allowance <= 0) {
          skipped.push(`${c.handle} (${c.status}, J${c.warmingDay})`);
          continue;
        }
        const n = Math.min(allowance, remaining);
        for (let i = 0; i < n; i++) {
          try {
            await runDailyProduction(c.id, scenarioId ? { scenarioId } : {});
            produced.push(c.handle ?? c.id);
            remaining -= 1;
          } catch (err) {
            failed.push(`${c.handle}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      return { produced: produced.length, skipped, failed, scenarioId: scenarioId ?? null };
    }

    case "publish": {
      const outcomes = await publishDueposts(brandId);
      return {
        attempted: outcomes.length,
        published: outcomes.filter((o) => o.published).length,
        blocked: outcomes.filter((o) => !o.published).map((o) => o.reason),
      };
    }

    case "ingest": {
      const outcomes = await ingestMetrics(brandId);
      return {
        verdicts: outcomes.length,
        doubleDown: outcomes.filter((o) => o.verdict === "DOUBLE_DOWN").length,
        kills: outcomes.filter((o) => o.verdict === "KILL").length,
      };
    }

    case "analyse": {
      const run = await runAnalysis(brandId);
      return { summary: run.summary, degraded: run.degraded };
    }

    case "review": {
      const run = await runWeeklyReview(brandId);
      return { summary: run.summary };
    }

    case "warm": {
      await db
        .update(channels)
        .set({ warmingDay: sql`${channels.warmingDay} + 1`, updatedAt: new Date() })
        .where(eq(channels.brandId, brandId));

      const promoted = await db
        .update(channels)
        .set({ status: "ACTIVE", dailyPostTarget: 2, updatedAt: new Date() })
        .where(
          sql`${channels.brandId} = ${brandId} and ${channels.status} = 'WARMING' and ${channels.warmingDay} > 14`,
        )
        .returning({ handle: channels.handle });

      return { promoted: promoted.map((p) => p.handle) };
    }
  }
}

/**
 * How many posts a channel may publish today.
 *
 * The warming ramp is not decoration: a brand-new channel publishing twice a day
 * from day one looks automated to both the audience and the platform.
 */
function allowedToday(status: string, warmingDay: number, target: number): number {
  if (["PAUSED", "FLAGGED", "TOKEN_EXPIRED", "PENDING_AUTH"].includes(status)) return 0;
  if (status === "WARMING") {
    if (warmingDay <= 3) return 0; // observation only
    if (warmingDay <= 7) return 1;
    return Math.min(2, target);
  }
  if (status === "COOLDOWN") return Math.min(1, target);
  return target;
}
