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
import { transcribeClip, type ClipTranscript } from "@/server/media/captions";
import { buildCharacter, getCharacter, hasCharacter } from "@/server/persona/build";

import { buildStoryboard } from "./storyboard";
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
 *   5. the whole sequence is drawn as storyboard panels, each conditioned on the
 *      character's photographs and on the panel before it, and each inspected,
 *   6. the video model animates an approved panel rather than imagining a frame,
 *   7. the timeline is assembled from the scenario's declared shape.
 *
 * Steps one and five are what make a fleet of personas possible. Step two is
 * what stops ten channels producing the same video. Step four is what stops the
 * prompts being vague, and step five is what stops the frame being wrong: the
 * image model composes far better than the video model, so the frame is decided
 * in stills, cheaply, before anything expensive is generated.
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
  if (written.writerFailure) {
    notes.push(`The writer fell back to templates — ${written.writerFailure}.`);
    await ctx.note(`Scene writing failed: ${written.writerFailure}`);
  }

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

  /* 5. Shot specifications ------------------------------------------------ */
  //
  // Every shot is specified before anything is generated, because the storyboard
  // needs the whole sequence: panel two is drawn from panel one, so they cannot
  // be built one at a time as the clips are made.
  const planned: Array<{ beatIndex: number; spec: ShotSpec; line?: string }> = [];

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
      durationSeconds: shotSeconds(beat.durationSeconds, w.line),
      avoid: scenario.forbidden.filter((f) => f.length < 60),
    };

    // A screen the shot cannot honestly show.
    //
    // Several scenarios direct an insert "on the screen", and the video model
    // obliges by inventing one: a run came back with a fabricated Shopify
    // dashboard, another with a fake Instagram analytics grid. Both are
    // interfaces that do not exist, presented as evidence, in a product whose
    // whole claims policy exists to stop exactly that.
    //
    // So the screen is removed from the direction and the shot becomes what it
    // should have been — the hands, and the face reacting to what is on it.
    // When the brand's own screenshots have been collected, they go here
    // instead; until then, showing nothing beats showing a forgery.
    if (
      spec.archetype !== "MIRROR" &&
      spec.archetype !== "FOUND_FOOTAGE" &&
      /\b(screen|phone|laptop|tablet|monitor|display|dashboard)\b/i.test(spec.action)
    ) {
      spec.action = `${spec.action.replace(
        /\b(the |a |their )?(screen|phone|laptop|tablet|monitor|display|dashboard)\b/gi,
        "it",
      )} The device itself is out of frame or face down — we see only their hands and their reaction to it.`;
      notes.push(`Shot ${i + 1}: the scripted screen was removed — no real capture to show.`);
    }

    const problems = critiqueShot(spec);
    if (problems.length > 0) {
      notes.push(`Shot ${i + 1}: ${problems.join(" ")}`);
      await ctx.note(`Shot ${i + 1} flagged — ${problems[0]}`);
    }

    planned.push({ beatIndex: i, spec, line: w.line });
  }

  const sheetRefs = sheet.referenceImages.map((r) => r.url).filter(Boolean) as string[];

  /* 6. Storyboard ---------------------------------------------------------- */
  //
  // The frame is decided in images before it is decided in video. Each panel is
  // conditioned on the character's photographs and on the previous panel, then
  // inspected by a vision model. A rejected panel costs about thirteen cents; a
  // rejected clip costs sixty and forty seconds, so this is where the failure
  // rate is meant to live.
  await ctx.note(`Drawing the storyboard — ${planned.length} panels.`);
  const board = await buildStoryboard({
    shots: planned.map((p) => p.spec),
    characterRefs: sheetRefs,
    seed: seedOf(postId),
    onNote: (message) => ctx.note(message),
  });
  costUsd += board.costUsd;
  degraded ||= board.degraded;
  notes.push(...board.notes);

  for (const panel of board.panels) {
    await db.insert(postAssets).values({
      postId,
      kind: "STILL",
      sequence: panel.beatIndex,
      url: panel.url,
      prompt: panel.prompt,
      provider: "nano-banana",
      model: panel.model,
      costUsd: String(panel.costUsd),
      status: "READY",
      meta: {
        role: "STORYBOARD_PANEL",
        beatIndex: panel.beatIndex,
        attempts: panel.attempts,
        problems: panel.problems,
        verdict: panel.verdict,
        negativePrompt: panel.negativePrompt,
      } as never,
    });
  }

  /* 7. Shots --------------------------------------------------------------- */
  const media = getMediaProvider();
  const clips: Array<{
    url: string;
    durationMs: number;
    beatIndex: number;
    transcript?: ClipTranscript;
  }> = [];

  for (const [order, entry] of planned.entries()) {
    const { beatIndex: i, spec, line } = entry;
    const compiled = compileShot(spec);
    const panel = board.panels.find((p) => p.beatIndex === order);

    // The panel leads the reference list: it is the frame this clip has to
    // start from. The character photographs follow, so the face stays locked
    // even where the animation drifts away from the panel's composition.
    const referenceImageUrls = [...(panel ? [panel.url] : []), ...sheetRefs].slice(0, 7);

    try {
      const asset = await media.generateVideoClip({
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        appearanceSeed: sheet.anchor,
        referenceImageUrls,
        referenceImageUrl: panel?.url,
        durationSeconds: compiled.durationSeconds,
        aspectRatio: "9:16",
        // Omni's native audio carries the dialogue when the scenario has speech;
        // narrated and silent scenarios get their audio from the timeline.
        generateAudio: Boolean(line),
        speech: line,
        fast: scenario.family === "MICRO",
      });

      costUsd += asset.costUsd;
      const meta = (asset.meta ?? {}) as { isPlaceholder?: boolean; omniError?: string };
      if (meta.isPlaceholder) degraded = true;
      if (meta.omniError) notes.push(`Omni shot ${i + 1}: ${meta.omniError}`);

      const clipDurationMs = asset.durationMs ?? spec.durationSeconds * 1000;

      // Read the words back off the clip Omni just made.
      //
      // Not off the line we asked for: Omni paraphrases, pauses and swallows
      // words, and captions timed from the script drift out of sync inside two
      // seconds. Measuring what was actually said is the difference between
      // captions that look edited and captions that look automated.
      let transcript: ClipTranscript | undefined;
      if (line) {
        transcript = await transcribeClip(asset.url, line, clipDurationMs);
        if (transcript.estimated) {
          notes.push(`Shot ${i + 1}: caption timings estimated, not measured.`);
        }
      }

      clips.push({ url: asset.url, durationMs: clipDurationMs, beatIndex: i, transcript });

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
          shotArchetype: spec.archetype,
          negativePrompt: compiled.negativePrompt,
          panelUrl: panel?.url ?? null,
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

  /* 8. Music -------------------------------------------------------------- */
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

  /* 9. Timeline ----------------------------------------------------------- */
  const timeline = composeFromScenario({
    timelineId: `tl_${postId.slice(0, 8)}`,
    scenario,
    written,
    clips,
    musicUrl,
    beatGridMs,
    hookText: written.hook,
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

/**
 * How long a shot should actually be.
 *
 * The scenarios were written with four and five second beats, which came from a
 * time when a clip was a b-roll fragment under a voice-over. A beat that carries
 * a spoken line needs room to breathe: at three words a second, five seconds is
 * fifteen words, and the delivery comes out rushed because there is nowhere for
 * a pause to go.
 *
 * Eight seconds is the working length — close to Omni's ten second ceiling, and
 * it puts a three-shot scenario at around twenty-two seconds, which is where
 * short-form retention data says these videos should sit. Silent inserts stay
 * short: a held shot of nothing is where people leave.
 */
function shotSeconds(declared: number, line: string | undefined): number {
  if (!line?.trim()) return Math.min(10, Math.max(3, Math.round(Math.max(declared, 5))));

  // Length the line, then add air.
  //
  // A flat eight-second minimum was the first attempt and it padded: a
  // four-word line in an eight-second shot left four seconds of a person
  // sitting still, which measured as room tone and read as a stall. Two and a
  // half words a second is unhurried conversational delivery; a second and a
  // half of air covers the breath in and the beat after the last word.
  const words = line.trim().split(/\s+/).length;
  const spoken = words / 2.5;
  return Math.min(10, Math.max(4, Math.round(spoken + 1.6)));
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
