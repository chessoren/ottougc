import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { brands, channels, personas, strategies } from "@/server/db/schema";
import { PERSONA_ARCHETYPES, allocateArchetypes } from "@/server/knowledge";
import { defaultMixFor, getScenario, shapeSignature } from "@/server/knowledge/scenarios";

import { MANAGER_SYSTEM } from "./prompts";
import { runAgent } from "./runtime";
import { toolsFor } from "./tools";
import { createPersona, setObjectives, setStrategy } from "./tools/strategy";
import type { RunResult, ToolContext } from "./types";

/**
 * The manager agent.
 *
 * Two jobs: standing the fleet up (`planFleet`), and the daily dispatch that
 * wakes each account agent. The weekly review lives in `fleet-review.ts` because
 * it operates on a different clock and different evidence.
 */

export async function planFleet(brandId: string): Promise<RunResult> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand) throw new Error("Brand not found.");

  const fleet = await db
    .select({
      id: channels.id,
      title: channels.title,
      handle: channels.handle,
      slotIndex: channels.slotIndex,
      status: channels.status,
      hasPersona: personas.id,
    })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .where(eq(channels.brandId, brandId))
    .orderBy(channels.slotIndex);

  const prompt = `
Brand: ${brand.name}${brand.domain ? ` (${brand.domain})` : ""}
Traffic goes to: ${brand.targetUrl ?? "not set"}
Daily posting target across the set: ${brand.dailyPostTarget} videos.

Channels (${fleet.length}):
${fleet.map((c) => `- ${c.handle ?? c.title ?? c.id} [slot ${c.slotIndex}] status=${c.status} character=${c.hasPersona ? "set" : "MISSING"}`).join("\n") || "no channels connected yet"}

Design the whole set. For EVERY channel above, without exception: create its
character, set its strategy, set this week's targets. Make sure no archetype is used
twice and that the funnel is covered end to end.
`.trim();

  return runAgent({
    kind: "MANAGER",
    brandId,
    label: `Casting — ${brand.name}`,
    goal: "Give every channel a character, a strategy and measurable targets.",
    system: MANAGER_SYSTEM,
    prompt,
    tools: toolsFor("MANAGER"),
    maxSteps: 60,
    fallback: (ctx) => planFleetDeterministic(brandId, ctx),
  });
}

/**
 * Rule-based fleet planning.
 *
 * Used when no model is credentialed. It is not a stub: it allocates real
 * archetypes from the taxonomy, writes real strategies with real format mixes,
 * and sets real objectives. The fleet is genuinely operational; it simply has
 * not been reasoned about.
 */
async function planFleetDeterministic(
  brandId: string,
  ctx: ToolContext,
): Promise<{ output: unknown; summary: string }> {
  const fleet = await db
    .select({ id: channels.id, slotIndex: channels.slotIndex, title: channels.title })
    .from(channels)
    .where(eq(channels.brandId, brandId))
    .orderBy(channels.slotIndex);

  if (fleet.length === 0) {
    return {
      output: { channelsPlanned: 0 },
      summary: "No channels yet, so there is nothing to plan. Connect a YouTube channel first.",
    };
  }

  const archetypes = allocateArchetypes(fleet.length);
  const planned: string[] = [];

  for (const [i, channel] of fleet.entries()) {
    const archetype = archetypes[i]!;
    await ctx.note(`Assigning ${archetype.name} to ${channel.title ?? channel.id}`);

    await createPersona.handler(
      {
        channelId: channel.id,
        displayName: archetype.name,
        archetype: archetype.id,
        awarenessLevel: archetype.awareness,
        backstory: archetype.angle,
        appearancePrompt: archetype.appearanceSeed,
        voiceProfile: { pace: archetype.voice },
        ttsVoiceName: VOICES[i % VOICES.length],
        ttsSpeakingRate: 1.06 + (i % 3) * 0.03,
      } as never,
      ctx,
    );

    // The mix is drawn from the scenarios this awareness level can carry, then
    // tilted toward whichever shapes suit the archetype. Shapes, not subjects:
    // an archetype is a way of filming, not a topic.
    const mix = defaultMixFor(archetype.awareness);
    const preferredShapes = SHAPE_PREFERENCE[archetype.id] ?? [];
    if (preferredShapes.length) {
      for (const id of Object.keys(mix)) {
        const scenario = getScenario(id);
        if (!scenario) continue;
        if (preferredShapes.some((p) => shapeSignature(scenario.shape).includes(p))) {
          mix[id] = mix[id]! * 2.4;
        }
      }
      const total = Object.values(mix).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(mix)) mix[k] = Number((mix[k]! / total).toFixed(4));
      const drift = 1 - Object.values(mix).reduce((a, b) => a + b, 0);
      const biggest = Object.entries(mix).sort((a, b) => b[1] - a[1])[0]![0];
      mix[biggest] = Number((mix[biggest]! + drift).toFixed(4));
    }

    await setStrategy.handler(
      {
        channelId: channel.id,
        thesis: `${archetype.name}. ${archetype.angle}`,
        formatMix: mix,
        hookArchetypes: HOOKS_FOR_ARCHETYPE[archetype.id] ?? ["LOSS_AVERSION", "SPEED_SHOCK"],
        contentPillars: archetype.contentPillars,
        brandIntroductionRule: brandRuleFor(archetype.brandDensity),
        brandDensity: archetype.brandDensity,
        postingCadence: { postsPerDay: 1, slots: [18] },
        rationale:
          "Rule-based plan: archetype assigned for funnel coverage, mix weighted toward the shapes that suit it.",
      } as never,
      ctx,
    );

    await setObjectives.handler(
      {
        channelId: channel.id,
        horizon: "WEEK",
        objectives: objectivesFor(archetype.awareness),
      } as never,
      ctx,
    );

    planned.push(`${channel.title ?? channel.id} → ${archetype.name}`);
  }

  return {
    output: { channelsPlanned: planned.length, assignments: planned },
    summary: `${planned.length} channel${planned.length === 1 ? "" : "s"} given a character, a strategy and weekly targets: ${planned.join(" · ")}.`,
  };
}

/**
 * Objectives differ by funnel position, because judging an UNAWARE channel on
 * click-through is the fastest way to kill the top of the funnel.
 */
function objectivesFor(awareness: string) {
  if (awareness === "UNAWARE") {
    return [
      {
        statement: "Hold more than half of viewers past three seconds",
        metric: "retention3s",
        comparator: ">=",
        targetValue: 0.5,
        priority: 1,
      },
      {
        statement: "Reach 1.5% shares — the heaviest signal there is",
        metric: "shareRate",
        comparator: ">=",
        targetValue: 0.015,
        priority: 2,
      },
      { statement: "Post 7 videos this week", metric: "postsPublished", comparator: ">=", targetValue: 7, priority: 3 },
    ];
  }
  if (awareness === "PROBLEM_AWARE") {
    return [
      { statement: "Average completion above 30%", metric: "completionRate", comparator: ">=", targetValue: 0.3, priority: 1 },
      { statement: "Save rate above 5%", metric: "saveRate", comparator: ">=", targetValue: 0.05, priority: 2 },
      { statement: "Post 7 videos this week", metric: "postsPublished", comparator: ">=", targetValue: 7, priority: 3 },
    ];
  }
  return [
    { statement: "Click-through above 1.5%", metric: "linkClickRate", comparator: ">=", targetValue: 0.015, priority: 1 },
    { statement: "Hold 55% past three seconds", metric: "retention3s", comparator: ">=", targetValue: 0.55, priority: 2 },
    { statement: "Post 7 videos this week", metric: "postsPublished", comparator: ">=", targetValue: 7, priority: 3 },
  ];
}

function brandRuleFor(density: number): string {
  if (density <= 0.15) {
    return "The brand is never introduced. It appears at most once, after 60% of the story, as an object in the room the character uses without comment.";
  }
  if (density <= 0.45) {
    return "The brand is named once, in the final third, as the answer to something set up earlier. Never a logo, never a price.";
  }
  if (density <= 0.7) {
    return "The brand is on screen from the demonstration onward but only named at the end, pointing at the profile.";
  }
  return "The brand is openly the subject. This channel talks to an already-warm audience, so the first shot may show the product.";
}

const VOICES = [
  "en-US-Chirp3-HD-Aoede",
  "en-US-Chirp3-HD-Charon",
  "en-US-Chirp3-HD-Fenrir",
  "en-US-Chirp3-HD-Kore",
  "en-US-Chirp3-HD-Leda",
  "en-US-Chirp3-HD-Orus",
  "en-US-Chirp3-HD-Puck",
  "en-US-Chirp3-HD-Zephyr",
];

/**
 * Which video shapes each archetype films in.
 *
 * Matched on the shape signature rather than on scenario ids, so adding a
 * scenario to the catalogue automatically reaches the archetypes it suits
 * without anyone updating a list.
 */
const SHAPE_PREFERENCE: Record<string, string[]> = {
  SKEPTIC_REVIEWER: ["SYNC/CAPTIONS", "TWO_PLUS"],
  LIFESTYLE_STORYTELLER: ["micro", "STORY_CARDS", "FICTION"],
  PRODUCTIVITY_HACKER: ["STATIC_HEADLINE", "NONE/NONE"],
  SHOCKED_INSIDER: ["SYNC/CAPTIONS", "FOUND"],
  BENCHMARK_JUDGE: ["STATIC_HEADLINE", "VOICEOVER"],
  WORKPLACE_HUMORIST: ["micro", "MEME_BANDS", "STAGED"],
  MYTH_BUSTER: ["SYNC/CAPTIONS", "CHAT"],
  RIGOROUS_TESTER: ["STATIC_HEADLINE", "VOICEOVER"],
  STREET_INTERVIEWER: ["TWO_PLUS", "STAGED"],
  SPEED_TEACHER: ["FOUND", "STATIC_HEADLINE"],
};

const HOOKS_FOR_ARCHETYPE: Record<string, string[]> = {
  SKEPTIC_REVIEWER: ["MYTH_BUSTER", "LOSS_AVERSION", "COGNITIVE_DISSONANCE"],
  LIFESTYLE_STORYTELLER: ["PERSONAL_CRISIS", "RELATABLE_HUMOR", "POV_IMMERSION"],
  PRODUCTIVITY_HACKER: ["FORBIDDEN_LIST", "SPEED_SHOCK", "ILLICIT_LEAK"],
  SHOCKED_INSIDER: ["COGNITIVE_DISSONANCE", "SPEED_SHOCK", "SOCIAL_PROOF_INVERSION"],
  BENCHMARK_JUDGE: ["SPEED_SHOCK", "LOSS_AVERSION", "MYTH_BUSTER"],
  WORKPLACE_HUMORIST: ["RELATABLE_HUMOR", "POV_IMMERSION"],
  MYTH_BUSTER: ["ILLICIT_LEAK", "MYTH_BUSTER", "COGNITIVE_DISSONANCE"],
  RIGOROUS_TESTER: ["SOCIAL_PROOF_INVERSION", "MYTH_BUSTER", "SPEED_SHOCK"],
  STREET_INTERVIEWER: ["PERSONAL_CRISIS", "RELATABLE_HUMOR"],
  SPEED_TEACHER: ["SPEED_SHOCK", "FORBIDDEN_LIST"],
};

export { PERSONA_ARCHETYPES };
