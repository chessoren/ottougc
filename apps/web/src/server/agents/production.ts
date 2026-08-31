import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import {
  agentMemories,
  brandKnowledge,
  brands,
  channels,
  formatBandits,
  personas,
  postAssets,
  posts,
  strategies,
} from "@/server/db/schema";
import { allocate, type BanditArm } from "@/server/darwin/engine";
import { compileShot, critiqueShot, type ShotSpec } from "@/server/knowledge/prompting/shot";
import { ALL_SCENARIOS, defaultMixFor, getScenario, shapeSignature } from "@/server/knowledge/scenarios";
import type { Scenario } from "@/server/knowledge/scenarios";
import { getMediaProvider } from "@/server/media";
import { buildCharacter, getCharacter, hasCharacter } from "@/server/persona/build";

import { writeScenario } from "./scenario-writer";
import { composeFromScenario } from "./scenario-compose";
import { getWorkspace } from "./workspace";
import type { ToolContext } from "./types";

/**
 * Scenario production.
 *
 * The order is the design:
 *
 *   1. the character must exist before anything is generated,
 *   2. a scenario is chosen for its *shape*, not its subject,
 *   3. the writer fills the beats with real brand material,
 *   4. each beat is compiled into a shot specification and critiqued,
 *   5. clips are generated with the character's reference images attached,
 *   6. the timeline is assembled from the scenario's declared shape.
 *
 * Steps one and five are what make a fleet of personas possible. Step two is
 * what stops ten channels producing the same video. Step four is what stops the
 * prompts being vague.
 */

export interface ProductionResult {
  postId: string;
  scenarioId: string;
  scenarioName: string;
  hook: string;
  shots: number;
  durationMs: number;
  costUsd: number;
  degraded: boolean;
  notes: string[];
}

export async function produceScenario(
  channelId: string,
  ctx: ToolContext,
  options: { scenarioId?: string } = {},
): Promise<ProductionResult> {
  const notes: string[] = [];
  let costUsd = 0;
  let degraded = false;

  const [row] = await db
    .select({ channel: channels, persona: personas, brand: brands })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!row?.persona) {
    throw new Error("This channel has no character or strategy yet. Cast the creators first.");
  }

  /* 1. Character ---------------------------------------------------------- */
  if (!(await hasCharacter(channelId))) {
    await ctx.note("No character sheet yet — building the ICP and reference images.");
    const built = await buildCharacter(channelId);
    costUsd += built.costUsd;
    degraded ||= built.degraded;
    notes.push(
      `Character built: ${built.referencesGenerated} reference image${built.referencesGenerated === 1 ? "" : "s"}${built.referencesFailed ? `, ${built.referencesFailed} failed` : ""}.`,
    );
  }
  const { icp, sheet } = await getCharacter(channelId);
  if (!sheet) throw new Error("The character sheet could not be built.");

  /* 2. Scenario ----------------------------------------------------------- */
  const scenario = options.scenarioId
    ? getScenario(options.scenarioId)
    : await chooseScenario(channelId, row.persona.awarenessLevel, ctx);
  if (!scenario) throw new Error(`Unknown scenario: ${options.scenarioId}`);

  await ctx.note(
    `Scenario: ${scenario.name} — shape ${shapeSignature(scenario.shape)}, ${scenario.beats.length} shots.`,
  );

  /* 3. Writing ------------------------------------------------------------ */
  const knowledge = await db
    .select({ kind: brandKnowledge.kind, title: brandKnowledge.title, body: brandKnowledge.body })
    .from(brandKnowledge)
    .where(eq(brandKnowledge.brandId, row.brand.id))
    .orderBy(desc(brandKnowledge.weight))
    .limit(20);

  const memory = await db
    .select({ body: agentMemories.body })
    .from(agentMemories)
    .where(eq(agentMemories.channelId, channelId))
    .orderBy(desc(agentMemories.confidence))
    .limit(8);

  // Candidate opening lines from the brand's own material.
  //
  // Split into clauses rather than sentences: a knowledge entry's first sentence
  // is usually twenty words, which can only ever be hard-cut into something that
  // reads as broken. Clauses of three to seven words are the only fragments that
  // can actually be a banner.
  const hookSeeds = knowledge
    .filter((k) => ["PAIN", "PROOF"].includes(k.kind))
    .flatMap((k) => k.body.split(/(?<=[.!?;:])\s+|(?:\s+—\s+)|(?:,\s+(?=(?:so|but|and|which|because)\b))/i))
    .map((clause) => clause.trim().replace(/^[a-z]/, (c) => c.toUpperCase()))
    .filter((clause) => {
      const words = clause.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (words < 3 || words > 7) return false;
      // A clause opening on a conjunction is the back half of a sentence and
      // reads as though the video started late.
      return !/^(and|but|so|which|because|then|or|that's why|at |in |on )/i.test(clause);
    });

  const written = await writeScenario({
    scenario,
    hookSeeds,
    rotation: seedOf(channelId),
    brandName: row.brand.name,
    brandDna: (row.brand.brandDna ?? {}) as Record<string, string>,
    knowledge,
    icp,
    sheet,
    personaName: row.persona.displayName,
    memory: memory.map((m) => m.body),
    targetUrl: row.brand.targetUrl,
  });
  degraded ||= written.degraded;

  /* 4. Persist the post before spending on generation ---------------------- */
  const [post] = await db
    .insert(posts)
    .values({
      brandId: row.brand.id,
      channelId,
      formatId: scenario.id,
      hookArchetype: scenario.family,
      hookText: written.hook,
      title: written.title,
      description: written.description,
      tags: written.tags as never,
      script: { scenario: scenario.id, ...written } as never,
      pinnedComment: written.pinnedComment,
      status: "GENERATING_MEDIA",
    })
    .returning({ id: posts.id });

  const postId = post!.id;
  ctx.postId = postId;

  const utmContent = `${row.channel.handle ?? "channel"}_${postId.slice(0, 8)}_${scenario.id}`;
  await db.update(posts).set({ utmContent }).where(eq(posts.id, postId));

  /* 5. Shots -------------------------------------------------------------- */
  const media = getMediaProvider();
  const clips: Array<{ url: string; durationMs: number; beatIndex: number }> = [];

  for (const [i, beat] of scenario.beats.entries()) {
    const w = written.beats[i];
    if (!w) continue;

    const spec: ShotSpec = {
      archetype: beat.archetype,
      subject: sheet.anchor,
      action: w.direction,
      speech: w.line,
      performance: beat.performance,
      environment: pickLocation(sheet.locations, i),
      angle: beat.angleOverride,
      lighting: beat.lighting,
      ambience: beat.ambience,
      durationSeconds: beat.durationSeconds,
      avoid: scenario.forbidden.filter((f) => f.length < 60),
    };

    const problems = critiqueShot(spec);
    if (problems.length > 0) {
      notes.push(`Shot ${i + 1}: ${problems.join(" ")}`);
      await ctx.note(`Shot ${i + 1} flagged — ${problems[0]}`);
    }

    const compiled = compileShot(spec);

    try {
      const asset = await media.generateVideoClip({
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        appearanceSeed: sheet.anchor,
        referenceImageUrls: sheet.referenceImages.map((r) => r.url).filter(Boolean) as string[],
        durationSeconds: compiled.durationSeconds,
        aspectRatio: "9:16",
        // Omni's native audio carries the dialogue when the scenario has speech;
        // narrated and silent scenarios get their audio from the timeline.
        generateAudio: Boolean(w.line),
        speech: w.line,
        fast: scenario.family === "MICRO",
      });

      costUsd += asset.costUsd;
      const meta = (asset.meta ?? {}) as { isPlaceholder?: boolean; omniError?: string };
      if (meta.isPlaceholder) degraded = true;
      if (meta.omniError) notes.push(`Omni shot ${i + 1}: ${meta.omniError}`);

      clips.push({ url: asset.url, durationMs: asset.durationMs ?? beat.durationSeconds * 1000, beatIndex: i });

      await db.insert(postAssets).values({
        postId,
        kind: "BROLL_CLIP",
        sequence: i,
        url: asset.url,
        prompt: compiled.prompt,
        provider: asset.provider,
        model: asset.model,
        costUsd: String(asset.costUsd),
        durationMs: asset.durationMs,
        status: "READY",
        meta: {
          shotArchetype: beat.archetype,
          negativePrompt: compiled.negativePrompt,
          critique: problems,
          ...(asset.meta ?? {}),
        } as never,
      });
    } catch (error) {
      notes.push(
        `Shot ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      degraded = true;
    }
  }

  if (clips.length === 0) {
    await db
      .update(posts)
      .set({ status: "FAILED", failureReason: "No shot could be generated.", updatedAt: new Date() })
      .where(eq(posts.id, postId));
    throw new Error("No shot could be generated.");
  }

  /* 6. Music -------------------------------------------------------------- */
  let musicUrl: string | undefined;
  let beatGridMs: number[] = [];
  if (scenario.shape.music !== "NONE") {
    const totalSeconds = scenario.beats.reduce((s, b) => s + b.durationSeconds, 0);
    try {
      const music = await media.generateMusic({
        prompt: musicBriefFor(scenario),
        durationSeconds: Math.ceil(totalSeconds) + 2,
        wantBeatGrid: true,
      });
      musicUrl = music.url;
      beatGridMs = music.beatGridMs ?? [];
      costUsd += music.costUsd;
      await db.insert(postAssets).values({
        postId,
        kind: "MUSIC",
        url: music.url,
        prompt: musicBriefFor(scenario),
        provider: music.provider,
        model: music.model,
        costUsd: String(music.costUsd),
        durationMs: music.durationMs,
        status: "READY",
        meta: { bpm: music.bpm, isPlaceholder: (music.meta as { isPlaceholder?: boolean })?.isPlaceholder } as never,
      });
    } catch {
      notes.push("Music could not be generated; cut without it.");
    }
  }

  /* 7. Timeline ----------------------------------------------------------- */
  const timeline = composeFromScenario({
    timelineId: `tl_${postId.slice(0, 8)}`,
    scenario,
    written,
    clips,
    musicUrl,
    beatGridMs,
  });

  // The render tool reads the timeline from the run workspace, so the editing
  // tools can still be used to revise it before it is committed to a render.
  const ws = getWorkspace(ctx.runId);
  ws.timeline = timeline;

  await db
    .update(posts)
    .set({
      durationMs: timeline.durationMs,
      productionCostUsd: String(costUsd.toFixed(4)),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));

  return {
    postId,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    hook: written.hook,
    shots: clips.length,
    durationMs: timeline.durationMs,
    costUsd,
    degraded,
    notes,
  };
}

/* ========================================================================== */

/**
 * Choose a scenario.
 *
 * Thompson sampling over the channel's own history, but with a constraint the
 * old allocator lacked: the scenario must not share a *shape* with the last two
 * videos this channel published. Sampling on performance alone converges on one
 * winning shape and the account becomes monotonous long before the numbers say
 * anything is wrong.
 */
async function chooseScenario(
  channelId: string,
  awareness: string,
  ctx: ToolContext,
): Promise<Scenario> {
  const [strategy] = await db
    .select({ formatMix: strategies.formatMix })
    .from(strategies)
    .where(and(eq(strategies.channelId, channelId), eq(strategies.isActive, true)))
    .limit(1);

  const mix =
    (strategy?.formatMix as Record<string, number> | undefined) ?? defaultMixFor(awareness);
  const candidateIds = Object.keys(mix).filter((id) => getScenario(id));
  const candidates = (candidateIds.length ? candidateIds : ALL_SCENARIOS.map((s) => s.id))
    .map((id) => getScenario(id)!)
    .filter(Boolean);

  const recent = await db
    .select({ formatId: posts.formatId })
    .from(posts)
    .where(eq(posts.channelId, channelId))
    .orderBy(desc(posts.createdAt))
    .limit(2);

  const recentShapes = new Set(
    recent.map((r) => getScenario(r.formatId)).filter(Boolean).map((s) => shapeSignature(s!.shape)),
  );

  const fresh = candidates.filter((s) => !recentShapes.has(shapeSignature(s.shape)));
  const pool = fresh.length >= 2 ? fresh : candidates;

  if (fresh.length < 2 && recentShapes.size > 0) {
    await ctx.note(
      "Too few unused shapes available, so the variety constraint was relaxed for this run.",
    );
  }

  const stored = await db
    .select()
    .from(formatBandits)
    .where(eq(formatBandits.channelId, channelId));

  const arms: BanditArm[] = pool.map((s) => {
    const row = stored.find((b) => b.formatId === s.id);
    return {
      key: s.id,
      alpha: row?.alpha ?? 1 + (mix[s.id] ?? 0) * 2,
      beta: row?.beta ?? 1,
      trials: row?.trials ?? 0,
      meanScore: row?.meanScore ?? 0,
    };
  });

  const [choice] = allocate(arms, 1, ctx.random, 0.25);
  const chosen = getScenario(choice?.key ?? pool[0]!.id) ?? pool[0]!;

  await db
    .insert(formatBandits)
    .values({ channelId, formatId: chosen.id, lastUsedAt: new Date() })
    .onConflictDoUpdate({
      target: [formatBandits.channelId, formatBandits.formatId],
      set: { lastUsedAt: new Date(), updatedAt: new Date() },
    });

  return chosen;
}

/** Rotate through the character's rooms so every video is not filmed in one corner. */
function pickLocation(locations: string[], index: number): string {
  if (locations.length === 0) return "an ordinary lived-in room with real clutter";
  return locations[index % locations.length]!;
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function musicBriefFor(scenario: Scenario): string {
  switch (scenario.family) {
    case "MICRO":
      return "short dry instrumental, one loop, round bass and hi-hat, no vocals, no dramatic build";
    case "DRAMA":
      return scenario.id === "S21"
        ? "melodrama instrumental: slow piano, strings rising very gradually, lots of space, no vocals"
        : "tense instrumental, low pads, a dull pulse that accelerates, no vocals";
    case "FACELESS":
      return "slow ambient instrumental, warm pads, almost motionless, no vocals";
    case "SERIAL":
      return "light repetitive instrumental, identical every episode, no vocals";
    default:
      return "quiet instrumental, soft texture, low level, no vocals";
  }
}
