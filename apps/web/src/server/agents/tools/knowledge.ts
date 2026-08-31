import { and, desc, eq, sql } from "drizzle-orm";

import { agentMemories, brandKnowledge, brands, channelObjectives, competitorInsights } from "@/server/db/schema";
import {
  ALL_FORMATS,
  CTA_LADDER,
  HOOK_ARCHETYPES,
  HOOK_FORBIDDEN,
  HOOK_TIMELINE,
  LOOP_ARCHITECTURES,
  MIDROLL_HOOKS,
  PATTERN_INTERRUPTS,
  SAFE_ZONES,
  VISUAL_HOOKS,
  getFormat,
  hookEfficacyScore,
} from "@/server/knowledge";
import { HOOK_MAX_WORDS, countWords } from "@/server/knowledge/text";

import type { AgentTool } from "../types";

/**
 * Knowledge tools.
 *
 * The agent is never given the entire grimoire in its system prompt — 28 formats
 * with full beat sheets is roughly 30k tokens, paid on every step. Instead it
 * gets an index and pulls the one format it decided to shoot. That keeps steps
 * cheap and, more importantly, forces the model to *choose* a format explicitly
 * rather than blending three of them into mush.
 */

export const listFormats: AgentTool = {
  name: "list_formats",
  description:
    "Lists every available scenario with its family, target awareness level, brand presence, estimated cost and benchmarks. Call this before choosing one.",
  parameters: {
    type: "object",
    properties: {
      awareness: {
        type: "string",
        enum: ["UNAWARE", "PROBLEM_AWARE", "SOLUTION_AWARE", "PRODUCT_AWARE", "MOST_AWARE"],
        description: "Only return scenarios suited to this awareness level.",
      },
      maxCostUsd: { type: "number", description: "Cost ceiling per video." },
    },
  },
  async handler(args: { awareness?: string; maxCostUsd?: number }) {
    return ALL_FORMATS.filter(
      (f) =>
        (!args.awareness || f.awarenessFit.includes(args.awareness as never)) &&
        (!args.maxCostUsd || f.estimatedCostUsd <= args.maxCostUsd),
    ).map((f) => ({
      id: f.id,
      name: f.name,
      family: f.family,
      premise: f.premise,
      brandDensity: f.brandDensity,
      durationMs: f.durationMs,
      ctaLevel: f.ctaLevel,
      estimatedCostUsd: f.estimatedCostUsd,
      needsGeneratedVideo: f.mediaNeeds.includes("AVATAR_CLIP") || f.mediaNeeds.includes("BROLL_CLIP"),
      benchmarks: f.benchmarks,
    }));
  },
};

export const getFormatSpec: AgentTool = {
  name: "get_format_spec",
  description:
    "The full sheet for a scenario: its beats with timings, the visual direction for each, example lines, production rules and what's forbidden. Call this before writing.",
  parameters: {
    type: "object",
    properties: { formatId: { type: "string", description: "Ex. FORMAT_21" } },
    required: ["formatId"],
  },
  async handler(args: { formatId: string }) {
    const f = getFormat(args.formatId);
    if (!f) return { error: `Format inconnu : ${args.formatId}` };
    return f;
  },
};

export const getCraftRules: AgentTool = {
  name: "get_craft_rules",
  description:
    "The craft rules that apply everywhere: the anatomy of a four-second hook, the disqualifying mistakes, pattern-interrupt techniques, screen safe areas, the call-to-action ladder, loop structures, mid-video re-hooks.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: ["hook", "interrupts", "safezones", "cta", "loop", "midroll", "all"],
      },
    },
  },
  async handler(args: { topic?: string }) {
    const topic = args.topic ?? "all";
    const all = {
      hook: { timeline: HOOK_TIMELINE, forbidden: HOOK_FORBIDDEN, archetypes: HOOK_ARCHETYPES, visual: VISUAL_HOOKS },
      interrupts: PATTERN_INTERRUPTS,
      safezones: SAFE_ZONES,
      cta: CTA_LADDER,
      loop: LOOP_ARCHITECTURES,
      midroll: MIDROLL_HOOKS,
    };
    return topic === "all" ? all : (all as Record<string, unknown>)[topic];
  },
};

export const scoreHook: AgentTool = {
  name: "score_hook",
  description:
    "Scores a hook. Anything under 82 must be rewritten BEFORE you spend a single generation credit. Run this on your hook before generating anything.",
  parameters: {
    type: "object",
    properties: {
      visualAggression: {
        type: "number",
        description:
          "0-100. How much motion is in frame zero. A static shot is 10. A snap zoom with a physical action is 85.",
      },
      audioVelocity: {
        type: "number",
        description: "0-100. Speech rate (aim for 3.8-4.4 syllables a second) and the level of the opening sound.",
      },
      cognitiveDissonance: {
        type: "number",
        description: "0-100. The gap between what's on screen and what the voice says. Identical is 5.",
      },
      safeZoneCompliance: { type: "number", description: "0-100. How well it respects the safe areas." },
      hookText: { type: "string" },
    },
    required: ["visualAggression", "audioVelocity", "cognitiveDissonance", "safeZoneCompliance"],
  },
  async handler(args: {
    visualAggression: number;
    audioVelocity: number;
    cognitiveDissonance: number;
    safeZoneCompliance: number;
    hookText?: string;
  }) {
    const score = hookEfficacyScore(args);
    const wordCount = args.hookText ? countWords(args.hookText) : 0;
    const violations: string[] = [];
    if (wordCount > HOOK_MAX_WORDS) {
      violations.push(`Banner is ${wordCount} words — maximum ${HOOK_MAX_WORDS}.`);
    }
    return {
      score,
      threshold: 82,
      passes: score >= 82 && violations.length === 0,
      violations,
      advice:
        score >= 82
          ? "Hook passes. You can generate."
          : "Under the threshold. Add motion to frame zero and widen the gap between the on-screen text and the voice before trying again.",
    };
  },
};

export const getBrandDna: AgentTool = {
  name: "get_brand_dna",
  description:
    "The brand material: the real chore, the old way, confirmed numbers, the audience, their vocabulary, objections, the offer, and the claims policy. EVERY number you use comes from here.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const rows = await ctx.db
      .select({
        name: brands.name,
        domain: brands.domain,
        targetUrl: brands.targetUrl,
        tagline: brands.tagline,
        brandDna: brands.brandDna,
        claimsPolicy: brands.claimsPolicy,
        onboardingAnswers: brands.onboardingAnswers,
        locale: brands.primaryLocale,
      })
      .from(brands)
      .where(eq(brands.id, ctx.brandId))
      .limit(1);
    if (!rows[0]) return { error: "Marque introuvable." };
    return rows[0];
  },
};

export const searchBrandKnowledge: AgentTool = {
  name: "search_brand_knowledge",
  description:
    "Searches the brand's knowledge base: chores, objections, proof, vocabulary, stories, restrictions. Use it to find real material instead of inventing any.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["PAIN", "OBJECTION", "PROOF", "JARGON", "ICP", "STORY", "FORBIDDEN", "FEATURE"],
      },
      query: { type: "string", description: "Keywords to search for." },
      limit: { type: "number" },
    },
  },
  async handler(args: { kind?: string; query?: string; limit?: number }, ctx) {
    const conditions = [eq(brandKnowledge.brandId, ctx.brandId)];
    if (args.kind) conditions.push(eq(brandKnowledge.kind, args.kind));
    if (args.query) {
      conditions.push(
        sql`(${brandKnowledge.title} ilike ${"%" + args.query + "%"} or ${brandKnowledge.body} ilike ${"%" + args.query + "%"})`,
      );
    }
    return ctx.db
      .select({
        kind: brandKnowledge.kind,
        title: brandKnowledge.title,
        body: brandKnowledge.body,
        weight: brandKnowledge.weight,
        source: brandKnowledge.source,
      })
      .from(brandKnowledge)
      .where(and(...conditions))
      .orderBy(desc(brandKnowledge.weight))
      .limit(Math.min(args.limit ?? 20, 50));
  },
};

export const getSonarInsights: AgentTool = {
  name: "get_sonar_insights",
  description:
    "Competitive intelligence: questions left unanswered under competitors' videos, frustrations people voice, features they ask for, and hooks that have worked in this niche.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["CONTENT_GAP", "PAIN_INVERSION", "FEATURE_DEMAND", "OBJECTION", "HOOK"],
      },
      onlyUnexploited: { type: "boolean", description: "Only return what hasn't been used yet." },
      limit: { type: "number" },
    },
  },
  async handler(args: { kind?: string; onlyUnexploited?: boolean; limit?: number }, ctx) {
    const conditions = [eq(competitorInsights.brandId, ctx.brandId)];
    if (args.kind) conditions.push(eq(competitorInsights.kind, args.kind));
    if (args.onlyUnexploited) conditions.push(eq(competitorInsights.exploited, false));
    return ctx.db
      .select({
        id: competitorInsights.id,
        kind: competitorInsights.kind,
        body: competitorInsights.body,
        frequency: competitorInsights.frequency,
        sentiment: competitorInsights.sentiment,
      })
      .from(competitorInsights)
      .where(and(...conditions))
      .orderBy(desc(competitorInsights.frequency))
      .limit(Math.min(args.limit ?? 15, 50));
  },
};

/* ==========================================================================
   Memory — what makes an account agent more than a stateless prompt
   ========================================================================== */

export const recallMemory: AgentTool = {
  name: "recall_memory",
  description:
    "Your long-term memory on this channel and brand: what worked, what failed, what you learned about the audience, the constraints you set yourself. CALL THIS FIRST every run — it is what makes you different from an agent with no past.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["LESSON", "WINNER", "LOSER", "AUDIENCE", "CONSTRAINT"] },
      limit: { type: "number" },
    },
  },
  async handler(args: { kind?: string; limit?: number }, ctx) {
    const conditions = [eq(agentMemories.brandId, ctx.brandId)];
    if (args.kind) conditions.push(eq(agentMemories.kind, args.kind));
    if (ctx.channelId) {
      conditions.push(
        sql`(${agentMemories.channelId} = ${ctx.channelId} or ${agentMemories.channelId} is null)`,
      );
    }
    return ctx.db
      .select({
        id: agentMemories.id,
        kind: agentMemories.kind,
        body: agentMemories.body,
        confidence: agentMemories.confidence,
        timesApplied: agentMemories.timesApplied,
        evidence: agentMemories.evidence,
        createdAt: agentMemories.createdAt,
      })
      .from(agentMemories)
      .where(and(...conditions))
      .orderBy(desc(agentMemories.confidence), desc(agentMemories.createdAt))
      .limit(Math.min(args.limit ?? 25, 60));
  },
};

export const saveMemory: AgentTool = {
  name: "save_memory",
  description:
    "Writes a lasting lesson to memory. Use it when you find something that should change your future decisions. Be specific and numbered: a vague memory is useless in three weeks.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["LESSON", "WINNER", "LOSER", "AUDIENCE", "CONSTRAINT"] },
      body: { type: "string", description: "The lesson, in one to three sentences, with the numbers." },
      confidence: { type: "number", description: "0 to 1. How sure you are." },
      evidence: { type: "object", description: "Evidence: post ids, metrics observed." },
      scope: {
        type: "string",
        enum: ["CHANNEL", "BRAND"],
        description: "CHANNEL = only true for this channel. BRAND = true for all of them.",
      },
    },
    required: ["kind", "body"],
  },
  async handler(
    args: { kind: string; body: string; confidence?: number; evidence?: object; scope?: string },
    ctx,
  ) {
    const [row] = await ctx.db
      .insert(agentMemories)
      .values({
        brandId: ctx.brandId,
        channelId: args.scope === "BRAND" ? null : (ctx.channelId ?? null),
        kind: args.kind,
        body: args.body,
        confidence: args.confidence ?? 0.6,
        evidence: (args.evidence ?? null) as never,
      })
      .returning({ id: agentMemories.id });
    return { saved: true, id: row?.id };
  },
};

export const getObjectives: AgentTool = {
  name: "get_objectives",
  description:
    "Your active targets for this channel, with where you currently stand. Today's decisions should serve them.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    if (!ctx.channelId) return { error: "No channel in this run's context." };
    return ctx.db
      .select({
        id: channelObjectives.id,
        statement: channelObjectives.statement,
        metric: channelObjectives.metric,
        comparator: channelObjectives.comparator,
        target: channelObjectives.targetValue,
        current: channelObjectives.currentValue,
        status: channelObjectives.status,
        priority: channelObjectives.priority,
        periodEnd: channelObjectives.periodEnd,
        progressNotes: channelObjectives.progressNotes,
      })
      .from(channelObjectives)
      .where(
        and(eq(channelObjectives.channelId, ctx.channelId), eq(channelObjectives.status, "ACTIVE")),
      )
      .orderBy(channelObjectives.priority);
  },
};

export const updateObjectiveProgress: AgentTool = {
  name: "update_objective_progress",
  description:
    "Note your progress on a target: where you are, and what you plan to do about the gap.",
  parameters: {
    type: "object",
    properties: {
      objectiveId: { type: "string" },
      progressNotes: { type: "string" },
    },
    required: ["objectiveId", "progressNotes"],
  },
  async handler(args: { objectiveId: string; progressNotes: string }, ctx) {
    await ctx.db
      .update(channelObjectives)
      .set({ progressNotes: args.progressNotes, updatedAt: new Date() })
      .where(eq(channelObjectives.id, args.objectiveId));
    return { updated: true };
  },
};

export const KNOWLEDGE_TOOLS: AgentTool[] = [
  listFormats,
  getFormatSpec,
  getCraftRules,
  scoreHook,
  getBrandDna,
  searchBrandKnowledge,
  getSonarInsights,
  recallMemory,
  saveMemory,
  getObjectives,
  updateObjectiveProgress,
];
