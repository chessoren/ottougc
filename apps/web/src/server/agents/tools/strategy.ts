import { and, eq } from "drizzle-orm";

import {
  channelObjectives,
  channels,
  formatBandits,
  personas,
  strategies,
} from "@/server/db/schema";
import { allocate, type BanditArm } from "@/server/darwin/engine";
import { ALL_FORMATS, FORMAT_MIX_DEFAULT, PERSONA_ARCHETYPES, getFormat } from "@/server/knowledge";
import { getScenario } from "@/server/knowledge/scenarios";

import type { AgentTool } from "../types";

/**
 * Strategy tools — the manager's instruments, plus the account agent's ability
 * to revise its own plan.
 */

export const listPersonaArchetypes: AgentTool = {
  name: "list_persona_archetypes",
  description:
    "The ten available character archetypes, with their awareness level, the shapes they suit, their brand presence and their appearance seed. Two channels must NEVER share an archetype.",
  parameters: { type: "object", properties: {} },
  async handler() {
    return PERSONA_ARCHETYPES.map((p) => ({
      id: p.id,
      name: p.name,
      awareness: p.awareness,
      angle: p.angle,
      dominantFormats: p.dominantFormats,
      brandDensity: p.brandDensity,
      contentPillars: p.contentPillars,
    }));
  },
};

export const listChannels: AgentTool = {
  name: "list_channels",
  description:
    "Lists the brand's channels with their character, status, cadence and active strategy. The starting point for any decision.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const rows = await ctx.db
      .select({
        id: channels.id,
        handle: channels.handle,
        title: channels.title,
        status: channels.status,
        slotIndex: channels.slotIndex,
        warmingDay: channels.warmingDay,
        dailyPostTarget: channels.dailyPostTarget,
        subscriberCount: channels.subscriberCount,
        lastPublishedAt: channels.lastPublishedAt,
        personaName: personas.displayName,
        personaArchetype: personas.archetype,
        awareness: personas.awarenessLevel,
      })
      .from(channels)
      .leftJoin(personas, eq(personas.channelId, channels.id))
      .where(eq(channels.brandId, ctx.brandId))
      .orderBy(channels.slotIndex);
    return rows;
  },
};

export const createPersona: AgentTool = {
  name: "create_persona",
  description:
    "Creates or replaces a channel's character: the person the audience believes they're watching. `appearancePrompt` is locked and injected into EVERY generation for this channel — describe a face, an age, exact hair, clothes and a room, all invariant. A vague appearance produces a different face in every shot, which gives the account away immediately.",
  parameters: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      displayName: { type: "string" },
      archetype: { type: "string", description: "One of the ten archetypes." },
      awarenessLevel: {
        type: "string",
        enum: ["UNAWARE", "PROBLEM_AWARE", "SOLUTION_AWARE", "PRODUCT_AWARE", "MOST_AWARE"],
      },
      age: { type: "number" },
      occupation: { type: "string" },
      city: { type: "string" },
      backstory: {
        type: "string",
        description:
          "This person's background. The writer draws anecdotes from it, so the more concrete it is, the less generic the stories sound.",
      },
      appearancePrompt: {
        type: "string",
        description:
          "Invariant physical description, in English, in casting terms. For example: woman, 27, wavy chestnut hair tied back, oversized beige sweatshirt, bright flat with plants, natural window light.",
      },
      voiceProfile: {
        type: "object",
        description:
          "{ pace, fillers, catchphrases, bannedWords } — how this person speaks.",
      },
      ttsVoiceName: { type: "string", description: "Ex. fr-FR-Chirp3-HD-Aoede" },
      ttsSpeakingRate: { type: "number" },
    },
    required: ["channelId", "displayName", "archetype", "appearancePrompt"],
  },
  async handler(
    args: {
      channelId: string;
      displayName: string;
      archetype: string;
      awarenessLevel?: string;
      age?: number;
      occupation?: string;
      city?: string;
      backstory?: string;
      appearancePrompt: string;
      voiceProfile?: object;
      ttsVoiceName?: string;
      ttsSpeakingRate?: number;
    },
    ctx,
  ) {
    if (args.appearancePrompt.trim().split(/\s+/).length < 8) {
      return {
        error:
          "The appearance anchor is too vague (under eight words). It has to fix age, hair, clothes, room and light, or the face changes between shots.",
      };
    }

    const values = {
      channelId: args.channelId,
      displayName: args.displayName,
      archetype: args.archetype,
      awarenessLevel: (args.awarenessLevel ?? "PROBLEM_AWARE") as never,
      age: args.age,
      occupation: args.occupation,
      city: args.city,
      backstory: args.backstory,
      appearancePrompt: args.appearancePrompt,
      voiceProfile: (args.voiceProfile ?? null) as never,
      ttsVoiceName: args.ttsVoiceName ?? "fr-FR-Chirp3-HD-Aoede",
      ttsSpeakingRate: args.ttsSpeakingRate ?? 1.08,
      updatedAt: new Date(),
    };

    const [existing] = await ctx.db
      .select({ id: personas.id })
      .from(personas)
      .where(eq(personas.channelId, args.channelId))
      .limit(1);

    if (existing) {
      await ctx.db.update(personas).set(values).where(eq(personas.id, existing.id));
      return { personaId: existing.id, updated: true };
    }
    const [row] = await ctx.db.insert(personas).values(values).returning({ id: personas.id });
    return { personaId: row!.id, created: true };
  },
};

export const setStrategy: AgentTool = {
  name: "set_strategy",
  description:
    "Sets or revises a channel's strategy: its angle, its audience, its scenario mix, its hook archetypes, its content pillars, and above all WHEN THE BRAND MAY APPEAR. A new version supersedes the old one, which is kept for history.",
  parameters: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      thesis: {
        type: "string",
        description: "In one paragraph: what angle this channel owns, and why it's different from the others.",
      },
      icp: { type: "object", description: "{ role, age, painPoints[], jargon[], watches[] }" },
      formatMix: {
        type: "object",
        description:
          "Poids par format, somme = 1. Ex. { FORMAT_21: 0.3, FORMAT_23: 0.25, FORMAT_04: 0.2, FORMAT_28: 0.25 }",
      },
      hookArchetypes: { type: "array", items: { type: "string" } },
      contentPillars: { type: "array", items: { type: "string" } },
      brandIntroductionRule: {
        type: "string",
        description:
          "When and how the brand may appear here. For example: never before 60% of the story, never introduced, only used.",
      },
      brandDensity: { type: "number", description: "0 = never mentioned, 1 = the brand is the subject." },
      postingCadence: { type: "object", description: "{ postsPerDay, slots: [18, 12] }" },
      rationale: { type: "string", description: "Why this strategy rather than another." },
    },
    required: ["channelId", "thesis", "formatMix", "brandIntroductionRule"],
  },
  async handler(
    args: {
      channelId: string;
      thesis: string;
      icp?: object;
      formatMix: Record<string, number>;
      hookArchetypes?: string[];
      contentPillars?: string[];
      brandIntroductionRule: string;
      brandDensity?: number;
      postingCadence?: object;
      rationale?: string;
    },
    ctx,
  ) {
    // Scenarios first, legacy formats second: both id spaces are accepted while
    // the catalogue migrates.
    const unknown = Object.keys(args.formatMix).filter((k) => !getScenario(k) && !getFormat(k));
    if (unknown.length) {
      return {
        error: `Unknown scenarios in the mix: ${unknown.join(", ")}. Call list_scenarios.`,
      };
    }
    const sum = Object.values(args.formatMix).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.02) {
      return { error: `The mix sums to ${sum.toFixed(2)} instead of 1. Renormalise it.` };
    }

    const [current] = await ctx.db
      .select({ version: strategies.version })
      .from(strategies)
      .where(and(eq(strategies.channelId, args.channelId), eq(strategies.isActive, true)))
      .limit(1);

    await ctx.db
      .update(strategies)
      .set({ isActive: false, supersededAt: new Date() })
      .where(and(eq(strategies.channelId, args.channelId), eq(strategies.isActive, true)));

    const [row] = await ctx.db
      .insert(strategies)
      .values({
        channelId: args.channelId,
        version: (current?.version ?? 0) + 1,
        isActive: true,
        thesis: args.thesis,
        icp: (args.icp ?? null) as never,
        formatMix: args.formatMix as never,
        hookArchetypes: (args.hookArchetypes ?? []) as never,
        contentPillars: (args.contentPillars ?? []) as never,
        brandIntroductionRule: args.brandIntroductionRule,
        brandDensity: args.brandDensity ?? 0.35,
        postingCadence: (args.postingCadence ?? null) as never,
        rationale: args.rationale,
      })
      .returning({ id: strategies.id, version: strategies.version });

    // Seed the bandit with the strategy's own priors, so the first week already
    // explores in the direction the manager intended.
    for (const [formatId, weight] of Object.entries(args.formatMix)) {
      await ctx.db
        .insert(formatBandits)
        .values({
          channelId: args.channelId,
          formatId,
          alpha: 1 + weight * 2,
          beta: 1,
        })
        .onConflictDoNothing();
    }

    return { strategyId: row!.id, version: row!.version };
  },
};

export const getActiveStrategy: AgentTool = {
  name: "get_active_strategy",
  description: "Reads back the channel's active strategy: angle, scenario mix, and when the brand may appear.",
  parameters: {
    type: "object",
    properties: { channelId: { type: "string" } },
  },
  async handler(args: { channelId?: string }, ctx) {
    const channelId = args.channelId ?? ctx.channelId;
    if (!channelId) return { error: "No channel in context." };
    const [row] = await ctx.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.channelId, channelId), eq(strategies.isActive, true)))
      .limit(1);
    return row ?? { error: "No active strategy for this channel." };
  },
};

export const setObjectives: AgentTool = {
  name: "set_objectives",
  description:
    "Sets a channel's measurable targets for the period. A vague target is useless: each one names a metric and a threshold. These are what the weekly review judges against.",
  parameters: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      horizon: { type: "string", enum: ["WEEK", "MONTH", "QUARTER"] },
      objectives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            statement: { type: "string" },
            metric: {
              type: "string",
              enum: [
                "retention3s",
                "completionRate",
                "shareRate",
                "saveRate",
                "linkClickRate",
                "views",
                "signups",
                "subscribersGained",
                "postsPublished",
              ],
            },
            comparator: { type: "string", enum: [">=", "<=", ">", "<"] },
            targetValue: { type: "number" },
            priority: { type: "number" },
          },
          required: ["statement", "metric", "targetValue"],
        },
      },
    },
    required: ["channelId", "objectives"],
  },
  async handler(
    args: {
      channelId: string;
      horizon?: string;
      objectives: Array<{
        statement: string;
        metric: string;
        comparator?: string;
        targetValue: number;
        priority?: number;
      }>;
    },
    ctx,
  ) {
    const horizon = args.horizon ?? "WEEK";
    const periodStart = new Date();
    const periodEnd = new Date(
      periodStart.getTime() +
        (horizon === "WEEK" ? 7 : horizon === "MONTH" ? 30 : 90) * 86400_000,
    );

    await ctx.db
      .update(channelObjectives)
      .set({ status: "SUPERSEDED", updatedAt: new Date() })
      .where(
        and(
          eq(channelObjectives.channelId, args.channelId),
          eq(channelObjectives.status, "ACTIVE"),
          eq(channelObjectives.horizon, horizon),
        ),
      );

    const inserted = [];
    for (const [i, o] of args.objectives.entries()) {
      const [row] = await ctx.db
        .insert(channelObjectives)
        .values({
          channelId: args.channelId,
          horizon,
          statement: o.statement,
          metric: o.metric,
          comparator: o.comparator ?? ">=",
          targetValue: o.targetValue,
          priority: o.priority ?? i + 1,
          periodStart,
          periodEnd,
        })
        .returning({ id: channelObjectives.id });
      inserted.push(row!.id);
    }
    return { created: inserted.length, ids: inserted, periodEnd: periodEnd.toISOString() };
  },
};

export const allocateProduction: AgentTool = {
  name: "allocate_production",
  description:
    "Allocates today's videos across scenarios by Thompson sampling: four in five to the highest estimated win rate, one in five to the least tried. Use this to decide what to make today instead of guessing.",
  parameters: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      slots: { type: "number", description: "How many videos to make." },
      exploreRatio: { type: "number", description: "0.2 by default." },
    },
    required: ["channelId", "slots"],
  },
  async handler(args: { channelId: string; slots: number; exploreRatio?: number }, ctx) {
    const stored = await ctx.db
      .select()
      .from(formatBandits)
      .where(eq(formatBandits.channelId, args.channelId));

    const [strategy] = await ctx.db
      .select({ formatMix: strategies.formatMix })
      .from(strategies)
      .where(and(eq(strategies.channelId, args.channelId), eq(strategies.isActive, true)))
      .limit(1);

    const mix = (strategy?.formatMix as Record<string, number>) ?? FORMAT_MIX_DEFAULT;
    const candidates = Object.keys(mix).filter((k) => (mix[k] ?? 0) > 0);

    const arms: BanditArm[] = candidates.map((formatId) => {
      const row = stored.find((s) => s.formatId === formatId);
      return {
        key: formatId,
        // The strategy's weight is the prior: an untried format the manager
        // believes in still gets sampled ahead of one it does not.
        alpha: row?.alpha ?? 1 + (mix[formatId] ?? 0) * 2,
        beta: row?.beta ?? 1,
        trials: row?.trials ?? 0,
        meanScore: row?.meanScore ?? 0,
      };
    });

    if (arms.length === 0) return { error: "No scenarios in the active strategy's mix." };

    const result = allocate(arms, args.slots, ctx.random, args.exploreRatio ?? 0.2);

    return {
      allocation: result.map((r) => {
        const f = getFormat(r.key);
        return {
          formatId: r.key,
          formatName: f?.name,
          mode: r.mode,
          sampledWinRate: Number(r.sampledTheta.toFixed(3)),
          estimatedCostUsd: f?.estimatedCostUsd,
          durationMs: f?.durationMs,
        };
      }),
      totalEstimatedCostUsd: Number(
        result
          .reduce((s, r) => s + (getFormat(r.key)?.estimatedCostUsd ?? 0), 0)
          .toFixed(3),
      ),
    };
  },
};

export const setChannelCadence: AgentTool = {
  name: "set_channel_cadence",
  description:
    "Adjusts a channel's cadence: posts per day and time slots. Used to apply a review decision.",
  parameters: {
    type: "object",
    properties: {
      channelId: { type: "string" },
      dailyPostTarget: { type: "number" },
      publishSlots: { type: "array", items: { type: "number" }, description: "Heures locales, ex. [12, 18]." },
      status: {
        type: "string",
        enum: ["WARMING", "ACTIVE", "COOLDOWN", "PAUSED"],
      },
      reason: { type: "string" },
    },
    required: ["channelId"],
  },
  async handler(
    args: {
      channelId: string;
      dailyPostTarget?: number;
      publishSlots?: number[];
      status?: string;
      reason?: string;
    },
    ctx,
  ) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (args.dailyPostTarget !== undefined) {
      patch.dailyPostTarget = Math.max(0, Math.min(4, args.dailyPostTarget));
    }
    if (args.publishSlots) patch.publishSlots = args.publishSlots;
    if (args.status) patch.status = args.status;

    await ctx.db.update(channels).set(patch).where(eq(channels.id, args.channelId));
    await ctx.note(`Cadence adjusted on ${args.channelId}: ${args.reason ?? "no reason given"}`);
    return { updated: true, ...patch };
  },
};

export const STRATEGY_TOOLS = [
  listPersonaArchetypes,
  listChannels,
  createPersona,
  setStrategy,
  getActiveStrategy,
  setObjectives,
  allocateProduction,
  setChannelCadence,
];
