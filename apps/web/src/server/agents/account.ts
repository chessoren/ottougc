import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import {
  brands,
  channelObjectives,
  channels,
  formatBandits,
  personas,
  posts,
  strategies,
} from "@/server/db/schema";
import { produceScenario } from "./production";

import { ACCOUNT_SYSTEM } from "./prompts";
import { runAgent } from "./runtime";
import { toolsFor } from "./tools";
import { renderPost, schedulePost } from "./tools/publishing";
import type { RunResult, ToolContext } from "./types";

/**
 * The account agent — one daily production run for one channel.
 *
 * This is where the product actually happens. Everything else exists to make
 * this run good: the knowledge base gives it craft, the memory gives it
 * continuity, the bandit gives it a reason to try something new, and the editing
 * tools let it produce a montage rather than a slideshow.
 */

export async function runDailyProduction(
  channelId: string,
  options: { scenarioId?: string } = {},
): Promise<RunResult> {
  const context = await loadChannelContext(channelId);

  const prompt = `
Today: ${new Date().toISOString().slice(0, 10)}

YOUR CHANNEL
${context.channelSummary}

YOUR CHARACTER
${context.personaSummary}

YOUR STRATEGY
${context.strategySummary}

THIS WEEK
${context.objectivesSummary}

BRAND
${context.brandSummary}

Make today's video. Follow your order: memory, targets, performance, channel health,
scenario, script, generate, cut, check, render, schedule, memory.

Remember: you are not making an ad. You are making a situation, and the product is
what gets somebody out of it — once, late, in passing.
`.trim();

  return runAgent({
    kind: "ACCOUNT",
    brandId: context.brandId,
    channelId,
    label: `Daily run — ${context.channelName}`,
    goal: "Make, cut, check and schedule today's video.",
    system: ACCOUNT_SYSTEM,
    prompt,
    tools: toolsFor("ACCOUNT"),
    maxSteps: 70,
    temperature: 0.95,
    usePipeline: true,
    fallback: (ctx) => produceDeterministically(channelId, ctx, options),
  });
}

/* ========================================================================== */

interface ChannelContext {
  brandId: string;
  channelName: string;
  channelSummary: string;
  personaSummary: string;
  strategySummary: string;
  objectivesSummary: string;
  brandSummary: string;
}

async function loadChannelContext(channelId: string): Promise<ChannelContext> {
  const [row] = await db
    .select({
      channel: channels,
      persona: personas,
      brand: brands,
    })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!row) throw new Error("Channel not found.");

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.channelId, channelId), eq(strategies.isActive, true)))
    .limit(1);

  const objectives = await db
    .select()
    .from(channelObjectives)
    .where(and(eq(channelObjectives.channelId, channelId), eq(channelObjectives.status, "ACTIVE")))
    .orderBy(channelObjectives.priority);

  const dna = row.brand.brandDna as Record<string, unknown> | null;

  return {
    brandId: row.brand.id,
    channelName: row.channel.handle ?? row.channel.title ?? channelId,
    channelSummary: [
      `Name: ${row.channel.title ?? "sans titre"} (${row.channel.handle ?? "sans handle"})`,
      `Status: ${row.channel.status}${row.channel.status === "WARMING" ? ` — jour ${row.channel.warmingDay} de chauffe` : ""}`,
      `Subscribers: ${row.channel.subscriberCount} · Posted: ${row.channel.videoCount}`,
      `Cadence: ${row.channel.dailyPostTarget}/day, slots ${JSON.stringify(row.channel.publishSlots)}`,
    ].join("\n"),
    personaSummary: row.persona
      ? [
          `${row.persona.displayName}, archetype ${row.persona.archetype}, audience ${row.persona.awarenessLevel}`,
          row.persona.occupation ? `${row.persona.occupation}${row.persona.city ? `, ${row.persona.city}` : ""}` : "",
          row.persona.backstory ? `Background: ${row.persona.backstory}` : "",
          `Locked appearance (attached to every shot automatically): ${row.persona.appearancePrompt}`,
        ]
          .filter(Boolean)
          .join("\n")
      : "NO CHARACTER SET — say so and stop.",
    strategySummary: strategy
      ? [
          `Angle: ${strategy.thesis}`,
          `Scenario mix: ${JSON.stringify(strategy.formatMix)}`,
          `Preferred hooks: ${JSON.stringify(strategy.hookArchetypes)}`,
          `WHEN THE BRAND MAY APPEAR: ${strategy.brandIntroductionRule}`,
          `Brand presence: ${strategy.brandDensity}`,
        ].join("\n")
      : "NO ACTIVE STRATEGY — say so and stop.",
    objectivesSummary:
      objectives.length > 0
        ? objectives
            .map(
              (o) =>
                `- [P${o.priority}] ${o.statement} — ${o.metric} ${o.comparator} ${o.targetValue} (now: ${o.currentValue})`,
            )
            .join("\n")
        : "No targets set.",
    brandSummary: [
      `${row.brand.name}${row.brand.domain ? ` — ${row.brand.domain}` : ""}`,
      row.brand.tagline ?? "",
      dna ? `Material: ${JSON.stringify(dna).slice(0, 1200)}` : "No brand material recorded.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/* ==========================================================================
   Production
   ========================================================================== */

/**
 * Produce today's video.
 *
 * Delegates to the scenario pipeline, which builds the character if it does not
 * exist, picks a scenario for its shape, writes it against real brand material,
 * compiles every beat into a shot specification, generates the clips with the
 * character's reference images attached, and assembles the montage.
 *
 * The model is used for the two things that need judgement — what happens in the
 * story, and what people say. Everything else is craft, and craft is code.
 */
async function produceDeterministically(
  channelId: string,
  ctx: ToolContext,
  options: { scenarioId?: string } = {},
): Promise<{ output: unknown; summary: string }> {
  const result = await produceScenario(channelId, ctx, options);

  const rendered = (await renderPost.handler({} as never, ctx)) as {
    error?: string;
    renderJobId?: string;
  };
  if (rendered.error) throw new Error(rendered.error);

  const [channel] = await db
    .select({ slots: channels.publishSlots })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  const slot = nextPublishSlot((channel?.slots as number[]) ?? [18], "Europe/Paris");
  await schedulePost.handler(
    { publishAtIso: slot.toISOString(), rationale: "Highest-volume slot." } as never,
    ctx,
  );

  const summary = [
    `${result.scenarioName} — ${result.shots} shot${result.shots === 1 ? "" : "s"}, ${(result.durationMs / 1000).toFixed(1)}s.`,
    `Hook: “${result.hook}”.`,
    `Cost $${result.costUsd.toFixed(3)}.`,
    result.degraded && result.notes.some((n) => n.startsWith("Omni shot"))
      ? "WARNING: Omni failed and a stand-in was used, so this cannot be published."
      : result.degraded
        ? "Writer fell back to the rule-based script; media may still be live."
        : "",
    result.notes.length ? `Notes: ${result.notes.slice(0, 2).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { output: { ...result, renderJobId: rendered.renderJobId, scheduledFor: slot.toISOString() }, summary };
}






/** Next occurrence of one of the channel's publish slots, at least 30 min out. */
function nextPublishSlot(slots: number[], _timezone: string): Date {
  const hours = slots?.length ? slots : [18];
  const now = new Date();
  const candidates: Date[] = [];
  for (const offsetDays of [0, 1]) {
    for (const h of hours) {
      const d = new Date(now);
      d.setDate(d.getDate() + offsetDays);
      d.setHours(h, 30, 0, 0);
      candidates.push(d);
    }
  }
  const soonest = candidates
    .filter((d) => d.getTime() > now.getTime() + 30 * 60 * 1000)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return soonest ?? new Date(now.getTime() + 2 * 60 * 60 * 1000);
}


export { loadChannelContext };
