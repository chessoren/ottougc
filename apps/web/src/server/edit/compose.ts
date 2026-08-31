import { getFormat } from "@/server/knowledge";
import { interruptSchedule } from "@/server/knowledge/retention";
import type { UgcFormat } from "@/server/knowledge/types";

import {
  buildDuckingAutomation,
  emptyTimeline,
  snapToBeat,
  snapToBreath,
  timelineSchema,
  type AudioClip,
  type Overlay,
  type Timeline,
  type VideoClip,
} from "./timeline";

/**
 * The deterministic editor.
 *
 * It composes a complete, well-formed montage from a script and its generated
 * assets — cuts placed on breath groups, punch-ins on emphasis words, music
 * ducked under the voice, captions grouped for legibility, safe zones respected.
 *
 * It serves two purposes:
 *   1. It is the **baseline** the editor agent receives and then improves. An
 *      agent handed an empty timeline produces mush; an agent handed a competent
 *      rough cut produces a good edit.
 *   2. It is the **fallback** when no model is credentialed, so the pipeline
 *      still ships watchable video.
 */

export interface ScriptBeat {
  label: string;
  startMs: number;
  endMs: number;
  narration?: string;
  onScreenText?: string;
  visual: string;
  sfx?: string[];
  patternInterrupt?: string;
}

export interface ComposeAssets {
  /** Generated clips keyed by the beat index they illustrate. */
  clips: Array<{
    beatIndex: number;
    src: string;
    kind: "video" | "image" | "screencast";
    durationMs: number;
    /** Mock provider returns a still that we animate as if it were a clip. */
    animateAsClip?: boolean;
  }>;
  voiceover?: {
    src: string;
    durationMs: number;
    words: Array<{ word: string; startMs: number; endMs: number; emphasis?: boolean }>;
    breathGroupEndsMs: number[];
  };
  music?: { src: string; durationMs: number; beatGridMs: number[] };
  sfx?: Array<{ src: string; atMs: number; gain?: number }>;
}

export interface ComposeInput {
  timelineId: string;
  formatId: string;
  beats: ScriptBeat[];
  assets: ComposeAssets;
  hookText: string;
  brandName: string;
  /** Overrides the format's nominal duration when the VO runs long or short. */
  durationMs?: number;
}

const HOOK_Y = 450;
const CAPTION_Y = 980;
const ANNOTATION_Y = 1250;

export function composeTimeline(input: ComposeInput): Timeline {
  const format = getFormat(input.formatId);
  const vo = input.assets.voiceover;
  const nominalMs = input.beats.at(-1)?.endMs ?? 15000;

  /**
   * The voice-over is the spine — but only when it actually covers the piece.
   *
   * A format whose beat sheet supplies narration for two beats out of five would
   * otherwise collapse a fifteen-second concept into a four-second clip, because
   * the montage would end when the voice does. So the narration drives the
   * timeline only when it spans at least 70% of the nominal length; below that,
   * the format's own timing wins and the voice is placed inside it.
   */
  const voDrivesTimeline = Boolean(vo && vo.durationMs >= nominalMs * 0.7);
  const durationMs =
    input.durationMs ?? (voDrivesTimeline ? vo!.durationMs + 900 : nominalMs);

  const t = emptyTimeline(input.timelineId, input.formatId, clamp(durationMs, 4000, 120000));
  t.beatGridMs = input.assets.music?.beatGridMs ?? [];

  const video: VideoClip[] = [];
  const overlays: Overlay[] = [];
  const audio: AudioClip[] = [];

  /* ---- 1. Video track: one clip per beat, cut on breath groups ---------- */
  const beats = [...input.beats].sort((a, b) => a.startMs - b.startMs);
  const scale = voDrivesTimeline && beats.length ? durationMs / (beats.at(-1)!.endMs || durationMs) : 1;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    const asset =
      input.assets.clips.find((c) => c.beatIndex === i) ??
      input.assets.clips[Math.min(i, input.assets.clips.length - 1)];

    // Scale the script's nominal timings onto the real narration length, then
    // pull each cut onto the nearest breath boundary so it never lands mid-word.
    let startMs = Math.round(beat.startMs * scale);
    let endMs = Math.round(beat.endMs * scale);
    if (voDrivesTimeline && vo) {
      if (i > 0) startMs = snapToBreath(startMs, vo.breathGroupEndsMs);
      if (i < beats.length - 1) endMs = snapToBreath(endMs, vo.breathGroupEndsMs);
    } else if (t.beatGridMs.length) {
      if (i > 0) startMs = snapToBeat(startMs, t.beatGridMs);
      if (i < beats.length - 1) endMs = snapToBeat(endMs, t.beatGridMs);
    }
    if (i === 0) startMs = 0;
    if (i === beats.length - 1) endMs = t.durationMs;
    if (endMs - startMs < 400) endMs = startMs + 400;

    const clipDuration = endMs - startMs;
    const kind = asset?.kind ?? "image";

    video.push({
      id: `v${i}`,
      src: asset?.src ?? "",
      kind: asset?.animateAsClip ? "image" : kind,
      startMs,
      durationMs: clipDuration,
      sourceInMs: 0,
      layer: 0,
      layout: { mode: "full" },
      fit: "cover",
      // This composer lays its own narration track, so the clips stay silent.
      audioGain: 0,
      opacity: 1,
      effects: baseEffects(i, clipDuration, kind, asset?.animateAsClip),
      transitionIn: transitionFor(i, format, beat),
      note: beat.label,
    });
  }

  /* ---- 2. Pattern interrupts where the format demands them ------------- */
  const schedule = interruptSchedule(t.durationMs);
  for (const at of schedule) {
    const host = video.find((c) => at >= c.startMs && at < c.startMs + c.durationMs);
    if (!host) continue;
    const local = at - host.startMs;
    // Skip if this clip already starts near the mark — the cut *is* the interrupt.
    if (local < 350) continue;
    const alreadyHas = host.effects.some(
      (e) => "atMs" in e && Math.abs((e as { atMs: number }).atMs - local) < 500,
    );
    if (alreadyHas) continue;
    host.effects.push({
      type: "punchIn",
      atMs: local,
      scale: 1.14,
      attackMs: 120,
      holdMs: 420,
      releaseMs: 200,
    });
  }

  /* ---- 3. Punch in on emphasis words ----------------------------------- */
  if (vo) {
    const emphasised = vo.words.filter((w) => w.emphasis).slice(0, 6);
    for (const w of emphasised) {
      const host = video.find((c) => w.startMs >= c.startMs && w.startMs < c.startMs + c.durationMs);
      if (!host) continue;
      const local = w.startMs - host.startMs;
      const near = host.effects.some(
        (e) => "atMs" in e && Math.abs((e as { atMs: number }).atMs - local) < 900,
      );
      if (near) continue;
      host.effects.push({
        type: "punchIn",
        atMs: local,
        scale: 1.09,
        attackMs: 90,
        holdMs: Math.max(160, w.endMs - w.startMs),
        releaseMs: 160,
      });
    }
  }

  /* ---- 4. Hook banner --------------------------------------------------- */
  if (input.hookText) {
    overlays.push({
      type: "textBar",
      id: "hook",
      text: input.hookText,
      startMs: 0,
      // The banner is a poster: it holds for the whole hook window, unmoving.
      durationMs: Math.min(3200, t.durationMs),
      anchor: { y: HOOK_Y, align: "center" },
      enter: "pop",
      style: {
        background: "#FE2C55",
        color: "#FFFFFF",
        fontSize: input.hookText.length > 48 ? 44 : 58,
        fontWeight: 900,
        uppercase: true,
        radius: 14,
        paddingX: 28,
        paddingY: 16,
        maxWidth: 920,
        shadow: true,
      },
    });
  }

  /* ---- 5. On-screen text per beat --------------------------------------- */
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (!beat.onScreenText || i === 0) continue; // beat 0 is covered by the hook banner
    const clip = video[i];
    if (!clip) continue;
    const words = beat.onScreenText.trim().split(/\s+/).length;
    overlays.push({
      type: "storyCard",
      id: `card${i}`,
      text: beat.onScreenText,
      startMs: clip.startMs + 200,
      // Reading pace: about 4 words per second, floor of 1.4s.
      durationMs: Math.min(clip.durationMs - 300, Math.max(1400, (words / 4) * 1000 + 500)),
      anchor: { y: 620, align: "center" },
      enter: "fadeSlide",
      style: {
        fontSize: 52,
        color: "#FFFFFF",
        shadow: true,
        background: "transparent",
        maxWidth: 880,
        align: "center",
      },
    });
  }

  /* ---- 6. Kinetic captions ---------------------------------------------- */
  if (vo && vo.words.length) {
    overlays.push({
      type: "captions",
      id: "captions",
      words: vo.words.map((w) => ({
        word: w.word,
        startMs: w.startMs,
        endMs: w.endMs,
        emphasis: Boolean(w.emphasis),
      })),
      anchor: { y: CAPTION_Y, align: "center" },
      wordsPerBlock: 3,
      style: {
        fontSize: 64,
        color: "#FFFFFF",
        highlight: "#FFE600",
        strokeWidth: 12,
        strokeColor: "#000000",
        uppercase: true,
      },
    });
  }

  /* ---- 7. Screencast annotations ---------------------------------------- */
  for (let i = 0; i < beats.length; i++) {
    const clip = video[i];
    const asset = input.assets.clips.find((c) => c.beatIndex === i);
    if (!clip || asset?.kind !== "screencast") continue;
    overlays.push({
      type: "annotation",
      id: `ann${i}`,
      shape: "circle",
      x: 540,
      y: ANNOTATION_Y,
      width: 300,
      height: 170,
      rotation: -4,
      color: "#FE2C55",
      startMs: clip.startMs + Math.round(clip.durationMs * 0.35),
      durationMs: 1100,
    });
  }

  /* ---- 8. Audio: voice, ducked music, sfx ------------------------------- */
  if (vo) {
    audio.push({
      id: "vo",
      src: vo.src,
      bus: "voice",
      startMs: 0,
      durationMs: vo.durationMs,
      sourceInMs: 0,
      gain: 1,
      automation: [],
      loop: false,
      fadeInMs: 0,
      fadeOutMs: 120,
    });
  }

  if (input.assets.music) {
    const voiceSegments = vo ? [{ startMs: 0, durationMs: vo.durationMs }] : [];
    audio.push({
      id: "music",
      src: input.assets.music.src,
      bus: "music",
      startMs: 0,
      durationMs: t.durationMs,
      sourceInMs: 0,
      gain: 1,
      automation: voiceSegments.length
        ? buildDuckingAutomation(voiceSegments)
        : [{ atMs: 0, gain: 0.38, rampMs: 0 }],
      loop: true,
      fadeInMs: 0,
      fadeOutMs: 600,
    });
  }

  for (const [i, s] of (input.assets.sfx ?? []).entries()) {
    audio.push({
      id: `sfx${i}`,
      src: s.src,
      bus: "sfx",
      startMs: s.atMs,
      durationMs: 900,
      sourceInMs: 0,
      gain: s.gain ?? 0.7,
      automation: [],
      loop: false,
      fadeInMs: 0,
      fadeOutMs: 80,
    });
  }

  t.video = video;
  t.overlays = overlays;
  t.audio = audio;
  t.editNotes = `Assembly: ${video.length} shots, ${overlays.length} overlays, cuts snapped to ${vo ? "the breath groups" : "the beat grid"}.`;

  return timelineSchema.parse(t);
}

/**
 * Opening effects per clip position.
 *
 * Clip 0 always gets an incoming move: a static first shot is eliminatory for the
 * hook. Later clips get a slow drift so no shot is ever visually frozen.
 */
function baseEffects(
  index: number,
  durationMs: number,
  kind: string,
  animateAsClip?: boolean,
): VideoClip["effects"] {
  const effects: VideoClip["effects"] = [];

  if (index === 0) {
    effects.push({
      type: "kenBurns",
      fromScale: 1.18,
      toScale: 1.02,
      fromX: 0,
      toX: 0,
      fromY: 0,
      toY: 0,
      easing: "easeOut",
    });
  } else if (kind === "screencast") {
    // Screencasts read better with a gentle push toward the action.
    effects.push({
      type: "kenBurns",
      fromScale: 1.0,
      toScale: 1.06,
      fromX: 0,
      toX: 0,
      fromY: 0,
      toY: -20,
      easing: "linear",
    });
  } else {
    const drift = index % 2 === 0 ? 1 : -1;
    effects.push({
      type: "kenBurns",
      fromScale: 1.04,
      toScale: 1.12,
      fromX: 0,
      toX: 18 * drift,
      fromY: 0,
      toY: -10,
      easing: "linear",
    });
  }

  // A still standing in for a clip needs a touch of handheld motion, otherwise
  // it reads as a slideshow.
  if (animateAsClip && durationMs > 900) {
    effects.push({ type: "shake", amplitudePx: 3, frequencyHz: 1.6 });
  }

  return effects;
}

function transitionFor(index: number, format: UgcFormat | undefined, beat: ScriptBeat) {
  if (index === 0) return { type: "cut" as const, durationMs: 0, direction: "left" as const };

  const hint = (beat.patternInterrupt ?? "").toLowerCase();
  if (hint.includes("whip")) {
    return { type: "whipPan" as const, durationMs: 160, direction: "left" as const };
  }
  if (hint.includes("wipe") || hint.includes("bascule")) {
    return { type: "wipe" as const, durationMs: 180, direction: "left" as const };
  }
  if (format?.family === "SLIDESHOW") {
    return { type: "slide" as const, durationMs: 220, direction: "left" as const };
  }
  // Hard cuts everywhere else: crossfades read as corporate video, not UGC.
  return { type: "cut" as const, durationMs: 0, direction: "left" as const };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
