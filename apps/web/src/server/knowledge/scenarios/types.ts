import type { Angle, Lighting, Performance, Ambience } from "../prompting/vocabulary";
import type { ShotArchetype } from "../prompting/shot";
import type { AwarenessLevel } from "../types";

/**
 * Scenarios.
 *
 * This replaces the old "format" taxonomy, which described videos by *subject*
 * — a comparison, a testimonial, a tutorial — and therefore produced thirty
 * variations of one talking head.
 *
 * A scenario is described by its **shape** first: how long it runs, how many
 * shots it holds, whether a face appears, whether anyone speaks, what sits on
 * screen, and what register it is played in. Two scenarios with the same subject
 * but different shapes are genuinely different videos; two with the same shape
 * are not, however different their scripts.
 *
 * The second organising idea is that a scenario is a **situation**, not a pitch.
 * The product does not get introduced — it turns out to be the thing that
 * resolves the situation, and it is named once, late, in passing.
 */

/* ── Shape ───────────────────────────────────────────────────────────────── */

/** Whether a human face carries the video. */
export type FacePresence = "NONE" | "ONE" | "TWO_PLUS";

/** Where speech comes from, if anywhere. */
export type SpeechMode =
  /** Nobody speaks. Music and text carry it. */
  | "NONE"
  /** Spoken on camera, generated with the picture by Omni. */
  | "SYNC"
  /** Narrated over pictures that are not of the speaker. */
  | "VOICEOVER"
  /** Overheard dialogue between people who are not addressing the camera. */
  | "DIEGETIC";

/** What sits on top of the picture. */
export type OverlayMode =
  | "NONE"
  /** A single line, bottom third, usually starting "POV:". */
  | "POV_LINE"
  /** Successive cards of narration, one thought at a time. */
  | "STORY_CARDS"
  /** Word-by-word kinetic captions of the spoken track. */
  | "CAPTIONS"
  /** Bottom-anchored translation-style subtitles, drama convention. */
  | "SUBTITLES"
  /** A messaging thread rendered over or instead of the picture. */
  | "CHAT"
  /** Meme convention: a fixed line top and bottom. */
  | "MEME_BANDS"
  /** A headline that stays put for the whole clip. */
  | "STATIC_HEADLINE";

/** How much work the music does. */
export type MusicMode =
  | "NONE"
  /** Underneath, ducked below any voice. */
  | "BED"
  /** The music carries the video; there is nothing else to listen to. */
  | "DRIVES"
  /** A recognisable needle-drop that lands on a specific beat. */
  | "PUNCTUATES";

/** How the footage asks to be read. */
export type Register =
  /** Somebody filmed this themselves, for real. */
  | "CANDID"
  /** Openly performed, and the audience is in on it. */
  | "STAGED"
  /** Not filmed by anyone: a camera, a call, a screen. */
  | "FOUND"
  /** Fiction, and it knows it. */
  | "FICTION";

export interface ScenarioShape {
  durationMs: [number, number];
  shotCount: [number, number];
  face: FacePresence;
  speech: SpeechMode;
  overlay: OverlayMode;
  music: MusicMode;
  register: Register;
}

/* ── Beats ───────────────────────────────────────────────────────────────── */

export interface ScenarioBeat {
  label: string;
  /** What this beat has to accomplish. Handed to the writer verbatim. */
  purpose: string;
  /** The shape of this specific shot. Drives the prompt compiler. */
  archetype: ShotArchetype;
  durationSeconds: number;
  /**
   * What physically happens. A template the writer rewrites with real brand
   * material; `{{...}}` slots are filled before the model ever sees it.
   */
  direction: string;
  /** Spoken aloud in the clip, if this beat has speech. */
  line?: string;
  /** Text laid over this beat. */
  overlayText?: string;
  lighting: Lighting;
  performance?: Performance;
  ambience?: Ambience;
  /** Overrides the archetype's default angle when the beat needs a specific one. */
  angleOverride?: Angle;
  /** The break in pattern that keeps the viewer here. */
  interrupt?: string;
}

/* ── Scenario ────────────────────────────────────────────────────────────── */

export interface Scenario {
  id: string;
  name: string;
  slug: string;
  family: ScenarioFamily;
  shape: ScenarioShape;

  /** The situation. Says nothing about the product. */
  premise: string;

  /**
   * How the product enters the *story*. Not how it is presented — scenarios do
   * not present. This describes the role it plays in the events.
   */
  productRole: string;

  /** When and how the brand may be named. */
  brandEntry: {
    /** Fraction of the runtime before which the brand must not appear. */
    atRatio: number;
    manner: string;
  };

  awarenessFit: AwarenessLevel[];
  beats: ScenarioBeat[];

  /** Why this works, in terms of what the viewer is doing. */
  whyItWorks: string;

  /** Level 0-3 on the CTA ladder. Most scenarios sit at 0 or 1. */
  ctaLevel: 0 | 1 | 2 | 3;

  benchmarks: {
    retention3s: number;
    completionRate: number;
    shareRate: number;
    saveRate: number;
  };

  /** Marginal cost in USD at current model prices. */
  estimatedCostUsd: number;

  /** Things that kill this specific scenario. */
  forbidden: string[];

  /** Craft notes for the editor. */
  editNotes: string[];
}

export type ScenarioFamily =
  /** Four to eight seconds, one idea, usually one shot. */
  | "MICRO"
  /** A situation with a turn, ten to twenty-five seconds. */
  | "SITUATION"
  /** Performed fiction with acts and characters. */
  | "DRAMA"
  /** No face at all. */
  | "FACELESS"
  /** Responds to something outside itself. */
  | "REACTIVE"
  /** Shows a real thing happening on a real screen. */
  | "EVIDENCE"
  /** Part of a running series. */
  | "SERIAL";

/** Rough seconds of runtime, for planning. */
export function nominalSeconds(scenario: Scenario): number {
  return (scenario.shape.durationMs[0] + scenario.shape.durationMs[1]) / 2000;
}

/**
 * A signature that distinguishes one shape from another.
 *
 * Used to keep a channel's format mix genuinely varied: two scenarios sharing a
 * signature look the same to a viewer scrolling past, whatever their scripts
 * say, so the allocator treats them as one arm rather than two.
 */
export function shapeSignature(shape: ScenarioShape): string {
  const bucket =
    shape.durationMs[1] <= 9000 ? "micro" : shape.durationMs[1] <= 22000 ? "short" : "long";
  return [bucket, shape.face, shape.speech, shape.overlay, shape.register].join("/");
}
