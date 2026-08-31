/**
 * Operator CLI.
 *
 * Every autonomous behaviour of the product is reachable from here, which means
 * the whole system can be exercised end to end without a browser, a cron or a
 * credential. That is deliberate: if a behaviour can only be triggered through
 * the UI, it cannot be tested, and if it cannot be tested it does not work.
 *
 *   pnpm agent plan            — the manager designs the fleet
 *   pnpm agent produce [n]     — run daily production on n channels
 *   pnpm agent simulate [days] — inject simulated metrics to exercise the engine
 *   pnpm agent ingest          — pull metrics, apply darwinian verdicts
 *   pnpm agent analyse         — interpret results, write lessons to memory
 *   pnpm agent review          — weekly fleet review
 *   pnpm agent publish         — publish everything whose slot has come
 *   pnpm agent day             — one full simulated day, in order
 *   pnpm agent status          — where everything stands
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { capabilitySnapshot, env } from "@/lib/env";
import { db } from "@/server/db";
import {
  agentRuns,
  brands,
  channels,
  fleetDecisions,
  fleetReviews,
  personas,
  posts,
  renderJobs,
} from "@/server/db/schema";

import { runDailyProduction } from "./account";
import { runAnalysis, ingestMetrics } from "./analyst";
import { runWeeklyReview } from "./fleet-review";
import { planFleet } from "./manager";

async function defaultBrandId(): Promise<string> {
  const [brand] = await db.select({ id: brands.id }).from(brands).orderBy(brands.createdAt).limit(1);
  if (!brand) throw new Error("No brand in the database. Run pnpm db:seed first.");
  return brand.id;
}

function heading(text: string) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
  console.log("─".repeat(Math.min(text.length, 72)));
}

async function cmdStatus() {
  const brandId = await defaultBrandId();
  const caps = capabilitySnapshot();

  heading("What's connected");
  for (const [name, value] of Object.entries(caps)) {
    if (typeof value === "boolean") {
      console.log(`  ${value ? "●" : "○"} ${name}`);
      continue;
    }
    const v = value as { configured?: boolean; via?: string; driver?: string; canPublish?: boolean };
    const detail = v.via ?? v.driver ?? "";
    console.log(
      `  ${v.configured ? "●" : "○"} ${name}${detail ? ` (${detail})` : ""}${v.canPublish === false && v.configured ? " — dry run" : ""}`,
    );
  }

  heading("Channels");
  const fleet = await db
    .select({
      handle: channels.handle,
      status: channels.status,
      target: channels.dailyPostTarget,
      persona: personas.displayName,
      archetype: personas.archetype,
      subs: channels.subscriberCount,
    })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .where(eq(channels.brandId, brandId))
    .orderBy(channels.slotIndex);

  for (const c of fleet) {
    console.log(
      `  ${(c.handle ?? "?").padEnd(16)} ${c.status.padEnd(14)} ${String(c.target).padEnd(3)}/j  ${c.persona ?? "\x1b[31mno character\x1b[0m"}${c.archetype ? ` [${c.archetype}]` : ""}`,
    );
  }

  heading("Production");
  const byStatus = await db
    .select({ status: posts.status, n: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.brandId, brandId))
    .groupBy(posts.status);
  if (byStatus.length === 0) console.log("  no posts");
  for (const s of byStatus) console.log(`  ${s.status.padEnd(20)} ${s.n}`);

  const jobs = await db
    .select({ status: renderJobs.status, n: sql<number>`count(*)::int` })
    .from(renderJobs)
    .groupBy(renderJobs.status);
  if (jobs.length) {
    heading("Renders");
    for (const j of jobs) console.log(`  ${j.status.padEnd(20)} ${j.n}`);
  }

  heading("Recent runs");
  const runs = await db
    .select({
      kind: agentRuns.kind,
      label: agentRuns.label,
      status: agentRuns.status,
      steps: agentRuns.stepCount,
      duration: agentRuns.durationMs,
      summary: agentRuns.summary,
    })
    .from(agentRuns)
    .where(eq(agentRuns.brandId, brandId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(8);
  for (const r of runs) {
    const mark = r.status === "SUCCEEDED" ? "✓" : r.status === "FAILED" ? "✗" : "…";
    console.log(`  ${mark} [${r.kind}] ${r.label} — ${r.steps} steps, ${r.duration ?? 0}ms`);
    if (r.summary) console.log(`      ${r.summary.slice(0, 150)}`);
  }
}

async function cmdPlan() {
  const brandId = await defaultBrandId();
  heading("Casting");
  const run = await planFleet(brandId);
  console.log(run.summary);
  if (run.degraded) console.log("\n(rule-based mode — no Gemini key configured)");
}

async function cmdProduce(count: number, scenarioId?: string) {
  const brandId = await defaultBrandId();
  const fleet = await db
    .select({ id: channels.id, handle: channels.handle, target: channels.dailyPostTarget })
    .from(channels)
    .innerJoin(personas, eq(personas.channelId, channels.id))
    .where(and(eq(channels.brandId, brandId), sql`${channels.dailyPostTarget} > 0`))
    .orderBy(channels.slotIndex)
    .limit(count);

  if (fleet.length === 0) {
    console.log("No channel is ready. Run pnpm agent plan first.");
    return;
  }

  heading(`Production — ${fleet.length} channel${fleet.length === 1 ? "" : "s"}${scenarioId ? ` · ${scenarioId}` : ""}`);
  for (const c of fleet) {
    process.stdout.write(`  ${c.handle} … `);
    try {
      const run = await runDailyProduction(c.id, scenarioId ? { scenarioId } : {});
      console.log(`✓ ${run.summary.slice(0, 220)}`);
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Renders are queued in the background; a CLI process must not exit before
  // they finish or it kills its own encodes mid-write.
  const { waitForIdle } = await import("@/server/render/queue");
  process.stdout.write("  rendering … ");
  await waitForIdle().catch((e) => console.log(`\n  ${e.message}`));
  console.log("done");
}

async function cmdSimulate(days: number) {
  const brandId = await defaultBrandId();
  heading("Simulated metrics");
  console.log(
    "  \x1b[33mThese are simulated numbers\x1b[0m — they exist to exercise the decision engine",
  );
  console.log("  before real YouTube Analytics data is flowing.\n");

  const { backdatePublished, simulateMetrics } = await import("@/server/darwin/simulate");
  const backdated = await backdatePublished(brandId, days);
  const result = await simulateMetrics({ brandId });

  console.log(`  ${backdated} post(s) backdated over ${days} days`);
  console.log(
    `  ${result.posts} post(s) filled · ${result.outliers} outlier(s) · ${result.totalViews.toLocaleString("en-US")} simulated views`,
  );
}

async function cmdIngest() {
  const brandId = await defaultBrandId();
  heading("Metrics and verdicts");
  const outcomes = await ingestMetrics(brandId);
  if (outcomes.length === 0) {
    console.log("  No post reached a new checkpoint.");
    return;
  }
  for (const o of outcomes) {
    console.log(`  ${o.postId.slice(0, 8)} @${o.checkpoint} → ${o.verdict} (${o.score.toFixed(3)})`);
    console.log(`      ${o.rationale}`);
  }
}

async function cmdAnalyse() {
  const brandId = await defaultBrandId();
  heading("Analysis");
  const run = await runAnalysis(brandId);
  console.log(run.summary);
}

async function cmdReview() {
  const brandId = await defaultBrandId();
  heading("Weekly review");
  const run = await runWeeklyReview(brandId);
  console.log(run.summary);

  const [latest] = await db
    .select({ id: fleetReviews.id, narrative: fleetReviews.narrative })
    .from(fleetReviews)
    .where(eq(fleetReviews.brandId, brandId))
    .orderBy(desc(fleetReviews.createdAt))
    .limit(1);

  if (latest) {
    const decisions = await db
      .select({
        action: fleetDecisions.action,
        rationale: fleetDecisions.rationale,
        before: fleetDecisions.quotaBefore,
        after: fleetDecisions.quotaAfter,
        handle: channels.handle,
      })
      .from(fleetDecisions)
      .innerJoin(channels, eq(channels.id, fleetDecisions.channelId))
      .where(eq(fleetDecisions.reviewId, latest.id));

    console.log("");
    for (const d of decisions) {
      console.log(`  ${(d.handle ?? "?").padEnd(16)} ${d.action.padEnd(12)} ${d.before} → ${d.after}/j`);
      console.log(`      ${d.rationale}`);
    }
  }
}

async function cmdPublish() {
  const brandId = await defaultBrandId();
  heading(`Posting${env.dryRunPublishing ? " (dry run)" : ""}`);
  const { publishDueposts } = await import("@/server/publishing/scheduler");
  const outcomes = await publishDueposts(brandId);
  if (outcomes.length === 0) {
    console.log("  Nothing ready to post.");
    return;
  }
  for (const o of outcomes) {
    console.log(
      o.published
        ? `  ✓ ${o.postId.slice(0, 8)} → ${o.url}${o.dryRun ? " (dry-run)" : ""}`
        : `  ✗ ${o.postId.slice(0, 8)} — ${o.reason}`,
    );
  }
}

async function cmdDay(count: number) {
  await cmdPlan();
  await cmdProduce(count);
  await cmdPublish();
  await cmdIngest();
  await cmdStatus();
}

async function main() {
  const [, , command = "status", arg, arg2] = process.argv;
  switch (command) {
    case "plan":
      await cmdPlan();
      break;
    case "produce":
      await cmdProduce(Number(arg ?? 1), arg2);
      break;
    case "simulate":
      await cmdSimulate(Number(arg ?? 5));
      break;
    case "ingest":
      await cmdIngest();
      break;
    case "analyse":
    case "analyze":
      await cmdAnalyse();
      break;
    case "review":
      await cmdReview();
      break;
    case "publish":
      await cmdPublish();
      break;
    case "day":
      await cmdDay(Number(arg ?? 3));
      break;
    case "status":
    default:
      await cmdStatus();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
