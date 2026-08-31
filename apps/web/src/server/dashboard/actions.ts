"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { channels, personas } from "@/server/db/schema";
import { runDailyProduction } from "@/server/agents/account";
import { ingestMetrics } from "@/server/agents/analyst";
import { runWeeklyReview } from "@/server/agents/fleet-review";
import { planFleet } from "@/server/agents/manager";
import { publishDueposts } from "@/server/publishing/scheduler";

/**
 * Operator actions.
 *
 * Everything the daily cron does can also be triggered by hand from the
 * dashboard. That is not a convenience: a scheduled system nobody can run on
 * demand is a system nobody can debug.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function planFleetNow(brandId: string): Promise<ActionResult> {
  try {
    const run = await planFleet(brandId);
    revalidatePath("/dashboard", "layout");
    return {
      ok: true,
      message: run.degraded ? `${run.summary} (rule-based mode)` : run.summary.slice(0, 200),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function produceNow(brandId: string, count = 1): Promise<ActionResult> {
  try {
    const fleet = await db
      .select({ id: channels.id, handle: channels.handle })
      .from(channels)
      .innerJoin(personas, eq(personas.channelId, channels.id))
      .where(and(eq(channels.brandId, brandId), sql`${channels.dailyPostTarget} > 0`))
      .orderBy(channels.slotIndex)
      .limit(count);

    if (fleet.length === 0) {
      return { ok: false, message: "No channel is ready. Cast your creators first." };
    }

    let ok = 0;
    const failures: string[] = [];
    for (const c of fleet) {
      try {
        await runDailyProduction(c.id);
        ok++;
      } catch (err) {
        failures.push(`${c.handle} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // The render queue keeps working after this returns; the dashboard polls.
    revalidatePath("/dashboard", "layout");
    return {
      ok: ok > 0,
      message:
        failures.length === 0
          ? `${ok} video${ok === 1 ? "" : "s"} started. Rendering continues in the background.`
          : `${ok} succeeded, ${failures.length} failed — ${failures[0]}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function ingestNow(brandId: string): Promise<ActionResult> {
  try {
    const outcomes = await ingestMetrics(brandId);
    revalidatePath("/dashboard", "layout");
    return {
      ok: true,
      message:
        outcomes.length === 0
          ? "No post reached a new checkpoint."
          : `${outcomes.length} verdict${outcomes.length === 1 ? "" : "s"} recorded.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function reviewNow(brandId: string): Promise<ActionResult> {
  try {
    const run = await runWeeklyReview(brandId);
    revalidatePath("/dashboard", "layout");
    return { ok: true, message: run.summary.slice(0, 200) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishNow(brandId: string): Promise<ActionResult> {
  try {
    const outcomes = await publishDueposts(brandId);
    revalidatePath("/dashboard", "layout");
    const published = outcomes.filter((o) => o.published).length;
    const blocked = outcomes.find((o) => !o.published);
    return {
      ok: true,
      message:
        outcomes.length === 0
          ? "Nothing ready to post."
          : `${published}/${outcomes.length} posted.${blocked ? ` Blocked: ${blocked.reason}` : ""}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
