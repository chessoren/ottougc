import { eq } from "drizzle-orm";

import { personas, postAssets } from "@/server/db/schema";
import { getMediaProvider } from "@/server/media";
import { getWorkspace } from "../workspace";
import type { AgentTool } from "../types";

/**
 * Generation tools.
 *
 * Two rules are enforced here rather than left to the prompt, because a model
 * will violate both under pressure:
 *
 *  1. **Every avatar shot carries the persona's appearance seed.** The agent
 *     cannot describe the person freely; it describes the *action* and the seed
 *     is prepended. This is what stops the face drifting between clip 3 and clip 4.
 *  2. **Every generation is charged against the daily budget before it runs.**
 *     `ctx.spend()` throws when the brand is out of budget, so an agent stuck in
 *     a regeneration loop stops instead of emptying the account.
 */

function assetRecord(
  postId: string | undefined,
  kind: string,
  sequence: number,
  asset: Awaited<ReturnType<ReturnType<typeof getMediaProvider>["generateVideoClip"]>>,
  prompt: string,
) {
  return {
    postId: postId!,
    kind: kind as never,
    status: "READY" as const,
    sequence,
    url: asset.url,
    localPath: asset.localPath,
    prompt,
    provider: asset.provider,
    model: asset.model,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    costUsd: asset.costUsd.toFixed(5),
    meta: asset.meta as never,
  };
}

export const generateAvatarClip: AgentTool = {
  name: "generate_avatar_clip",
  description:
    "Generates a shot with this channel's character. Describe ONLY the action, the framing, the expression and the room — the character's appearance and reference images are attached automatically so the same face comes back every time. Never describe hair, age or clothes yourself.",
  parameters: {
    type: "object",
    properties: {
      beatIndex: { type: "number", description: "Which beat of the script this shot is for." },
      action: {
        type: "string",
        description:
          "What the character does and how it's filmed. For example: pulls out one earphone sharply and turns to the lens, eyebrows up, chest-up selfie angle, handheld.",
      },
      durationSeconds: { type: "number", description: "Entre 2 et 8." },
      fast: {
        type: "boolean",
        description: "Faster, cheaper tier. Use it for secondary shots.",
      },
    },
    required: ["beatIndex", "action", "durationSeconds"],
  },
  async handler(
    args: { beatIndex: number; action: string; durationSeconds: number; fast?: boolean },
    ctx,
  ) {
    if (!ctx.channelId) return { error: "No channel in context." };

    const [persona] = await ctx.db
      .select({
        appearancePrompt: personas.appearancePrompt,
        displayName: personas.displayName,
      })
      .from(personas)
      .where(eq(personas.channelId, ctx.channelId))
      .limit(1);

    const provider = getMediaProvider();
    const duration = Math.max(2, Math.min(8, args.durationSeconds));
    const estimated = provider.live ? (args.fast ? 0.15 : 0.4) * duration : 0;
    await ctx.spend(estimated, `avatar clip beat ${args.beatIndex}`);

    const asset = await provider.generateVideoClip({
      prompt: args.action,
      appearanceSeed: persona?.appearancePrompt ?? undefined,
      durationSeconds: duration,
      aspectRatio: "9:16",
      generateAudio: false, // we supply our own voice-over
      fast: args.fast,
    });

    if (ctx.postId) {
      await ctx.db
        .insert(postAssets)
        .values(assetRecord(ctx.postId, "AVATAR_CLIP", args.beatIndex, asset, args.action));
    }

    const ws = getWorkspace(ctx.runId);
    ws.assets.clips.push({
      beatIndex: args.beatIndex,
      src: asset.url,
      kind: "video",
      durationMs: asset.durationMs ?? duration * 1000,
      animateAsClip: Boolean(asset.meta?.animateAsClip),
    });

    return {
      url: asset.url,
      durationMs: asset.durationMs,
      provider: asset.provider,
      costUsd: asset.costUsd,
      live: provider.live,
    };
  },
};

export const generateBrollClip: AgentTool = {
  name: "generate_broll_clip",
  description:
    "Generates a faceless cutaway: an object, a room, a hand, an atmosphere. Use these heavily — plenty of cutaways is what separates an edited video from a filmed one.",
  parameters: {
    type: "object",
    properties: {
      beatIndex: { type: "number" },
      shot: {
        type: "string",
        description:
          "The shot, described the way you'd brief it. For example: macro close-up of a hand setting a cold mug down on a wooden desk, late afternoon light, shallow depth of field.",
      },
      durationSeconds: { type: "number" },
      fast: { type: "boolean" },
    },
    required: ["beatIndex", "shot", "durationSeconds"],
  },
  async handler(args: { beatIndex: number; shot: string; durationSeconds: number; fast?: boolean }, ctx) {
    const provider = getMediaProvider();
    const duration = Math.max(1, Math.min(8, args.durationSeconds));
    await ctx.spend(provider.live ? (args.fast ? 0.15 : 0.4) * duration : 0, `broll beat ${args.beatIndex}`);

    const asset = await provider.generateVideoClip({
      prompt: args.shot,
      durationSeconds: duration,
      aspectRatio: "9:16",
      generateAudio: false,
      fast: args.fast ?? true,
    });

    if (ctx.postId) {
      await ctx.db
        .insert(postAssets)
        .values(assetRecord(ctx.postId, "BROLL_CLIP", args.beatIndex, asset, args.shot));
    }

    getWorkspace(ctx.runId).assets.clips.push({
      beatIndex: args.beatIndex,
      src: asset.url,
      kind: "video",
      durationMs: asset.durationMs ?? duration * 1000,
      animateAsClip: Boolean(asset.meta?.animateAsClip),
    });

    return { url: asset.url, durationMs: asset.durationMs, costUsd: asset.costUsd, live: provider.live };
  },
};

export const generateStills: AgentTool = {
  name: "generate_stills",
  description:
    "Generates stills. Pass the SAME `seriesSeed` across a series: that's what makes them look like photos taken the same day on the same device.",
  parameters: {
    type: "object",
    properties: {
      beatIndex: { type: "number" },
      prompt: { type: "string" },
      count: { type: "number", description: "1 to 8." },
      seriesSeed: { type: "number", description: "Same value across a whole series." },
      hiFi: { type: "boolean", description: "Higher-fidelity tier, more expensive, for key images." },
    },
    required: ["beatIndex", "prompt"],
  },
  async handler(
    args: { beatIndex: number; prompt: string; count?: number; seriesSeed?: number; hiFi?: boolean },
    ctx,
  ) {
    const provider = getMediaProvider();
    const count = Math.max(1, Math.min(8, args.count ?? 1));
    await ctx.spend(provider.live ? (args.hiFi ? 0.06 : 0.039) * count : 0, `stills beat ${args.beatIndex}`);

    const assets = await provider.generateImages({
      prompt: args.prompt,
      aspectRatio: "9:16",
      count,
      seed: args.seriesSeed,
      hiFi: args.hiFi,
    });

    const ws = getWorkspace(ctx.runId);
    for (const [i, asset] of assets.entries()) {
      if (ctx.postId) {
        await ctx.db
          .insert(postAssets)
          .values(assetRecord(ctx.postId, "STILL", args.beatIndex + i, asset, args.prompt));
      }
      ws.assets.clips.push({
        beatIndex: args.beatIndex + i,
        src: asset.url,
        kind: "image",
        durationMs: 3000,
      });
    }

    return {
      urls: assets.map((a) => a.url),
      costUsd: assets.reduce((s, a) => s + a.costUsd, 0),
      live: provider.live,
    };
  },
};

export const synthesizeVoiceover: AgentTool = {
  name: "synthesize_voiceover",
  description:
    "Records the whole voice track in one pass and returns word-by-word timings AND the ends of breath groups. Those timings drive the edit: cuts snap to the breaths, punch-ins to the impact words. ALWAYS generate the voice before editing.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The full narration, punctuated. Punctuation creates the breaths, and the breaths are where the cuts land, so punctuate carefully.",
      },
    },
    required: ["text"],
  },
  async handler(args: { text: string }, ctx) {
    if (!ctx.channelId) return { error: "No channel in context." };

    const [persona] = await ctx.db
      .select({
        ttsVoiceName: personas.ttsVoiceName,
        ttsSpeakingRate: personas.ttsSpeakingRate,
        ttsPitch: personas.ttsPitch,
      })
      .from(personas)
      .where(eq(personas.channelId, ctx.channelId))
      .limit(1);

    const provider = getMediaProvider();
    await ctx.spend(provider.live ? (args.text.length / 1_000_000) * 30 : 0, "voiceover");

    const asset = await provider.synthesizeSpeech({
      text: args.text,
      voiceName: persona?.ttsVoiceName ?? "fr-FR-Chirp3-HD-Aoede",
      languageCode: "fr-FR",
      speakingRate: persona?.ttsSpeakingRate ?? 1.08,
      pitch: persona?.ttsPitch ?? 0,
      targetLufs: -14,
    });

    if (ctx.postId) {
      await ctx.db.insert(postAssets).values({
        postId: ctx.postId,
        kind: "VOICEOVER",
        status: "READY",
        sequence: 0,
        url: asset.url,
        localPath: asset.localPath,
        prompt: args.text,
        provider: asset.provider,
        model: asset.model,
        durationMs: asset.durationMs,
        costUsd: asset.costUsd.toFixed(5),
        meta: { alignment: asset.alignment } as never,
      });
    }

    const ws = getWorkspace(ctx.runId);
    ws.assets.voiceover = {
      src: asset.url,
      durationMs: asset.durationMs ?? asset.alignment.durationMs,
      words: asset.alignment.words,
      breathGroupEndsMs: asset.alignment.breathGroupEndsMs,
    };

    // Return a compact view: full word timings would flood the context on every
    // subsequent step, and the editor tools read them from the workspace anyway.
    return {
      url: asset.url,
      durationMs: asset.alignment.durationMs,
      wordCount: asset.alignment.words.length,
      breathGroupEndsMs: asset.alignment.breathGroupEndsMs,
      emphasisWords: asset.alignment.words
        .filter((w) => w.emphasis)
        .slice(0, 12)
        .map((w) => ({ word: w.word, atMs: w.startMs })),
      live: provider.live,
    };
  },
};

export const generateMusicBed: AgentTool = {
  name: "generate_music_bed",
  description:
    "Generates the music bed and returns the beat grid. In scenarios with no voice, the cuts land on this grid.",
  parameters: {
    type: "object",
    properties: {
      mood: {
        type: "string",
        description:
          "For example: tense lo-fi instrumental, muted bass, gradual build, no vocals. Always say 'no vocals'.",
      },
      durationSeconds: { type: "number" },
      bpm: { type: "number", description: "120-128 for standard short-form." },
    },
    required: ["mood", "durationSeconds"],
  },
  async handler(args: { mood: string; durationSeconds: number; bpm?: number }, ctx) {
    const provider = getMediaProvider();
    const duration = Math.max(5, Math.min(120, args.durationSeconds));
    await ctx.spend(provider.live ? 0.06 * Math.ceil(duration / 30) : 0, "music");

    const asset = await provider.generateMusic({
      prompt: args.mood,
      durationSeconds: duration,
      bpm: args.bpm ?? 124,
      wantBeatGrid: true,
    });

    if (ctx.postId) {
      await ctx.db.insert(postAssets).values({
        postId: ctx.postId,
        kind: "MUSIC",
        status: "READY",
        sequence: 0,
        url: asset.url,
        localPath: asset.localPath,
        prompt: args.mood,
        provider: asset.provider,
        model: asset.model,
        durationMs: asset.durationMs,
        costUsd: asset.costUsd.toFixed(5),
        meta: { bpm: asset.bpm, beatGridMs: asset.beatGridMs } as never,
      });
    }

    getWorkspace(ctx.runId).assets.music = {
      src: asset.url,
      durationMs: asset.durationMs ?? duration * 1000,
      beatGridMs: asset.beatGridMs,
    };

    return { url: asset.url, bpm: asset.bpm, beatGridMs: asset.beatGridMs.slice(0, 24), live: provider.live };
  },
};

export const captureScreencast: AgentTool = {
  name: "capture_screencast",
  description:
    "Records the customer's real product by driving a real browser. This is the only unarguable proof you have — always prefer it to a generated reconstruction.",
  parameters: {
    type: "object",
    properties: {
      beatIndex: { type: "number" },
      url: { type: "string", description: "Starting URL." },
      steps: {
        type: "array",
        description: "Actions to run, in order.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["click", "type", "wait", "scroll", "hover"] },
            selector: { type: "string" },
            text: { type: "string" },
            ms: { type: "number" },
          },
          required: ["action"],
        },
      },
      durationSeconds: { type: "number" },
    },
    required: ["beatIndex", "url", "steps", "durationSeconds"],
  },
  async handler(
    args: { beatIndex: number; url: string; steps: unknown[]; durationSeconds: number },
    ctx,
  ) {
    // Playwright capture is provisioned by the render worker, not the web process.
    // Until a worker is attached we return an explicit, honest placeholder rather
    // than a fake success: a silently faked screencast would be the one asset in
    // the whole pipeline whose absence the QA agent could not detect.
    const { captureAppScreencast } = await import("@/server/media/screencast");
    const result = await captureAppScreencast({
      url: args.url,
      steps: args.steps as never,
      durationSeconds: args.durationSeconds,
    });

    if (ctx.postId) {
      await ctx.db.insert(postAssets).values({
        postId: ctx.postId,
        kind: "SCREENCAST",
        status: result.captured ? "READY" : "FAILED",
        sequence: args.beatIndex,
        url: result.url,
        prompt: `${args.url} — ${args.steps.length} steps`,
        provider: result.provider,
        model: "playwright",
        durationMs: Math.round(args.durationSeconds * 1000),
        costUsd: "0",
        error: result.captured ? null : result.reason,
        // `isPlaceholder` is what QA reads to block a proof format that has no
        // real capture. Omitting it here silently defeats that gate.
        meta: {
          steps: args.steps,
          isPlaceholder: result.isPlaceholder,
          captured: result.captured,
          provider: result.provider,
        } as never,
      });
    }

    getWorkspace(ctx.runId).assets.clips.push({
      beatIndex: args.beatIndex,
      src: result.url,
      kind: "screencast",
      durationMs: Math.round(args.durationSeconds * 1000),
      animateAsClip: !result.captured,
    });

    return result;
  },
};

export const MEDIA_TOOLS: AgentTool[] = [
  generateAvatarClip,
  generateBrollClip,
  generateStills,
  synthesizeVoiceover,
  generateMusicBed,
  captureScreencast,
];
