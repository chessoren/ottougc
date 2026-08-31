/**
 * The edit timeline — OttoUGC's intermediate representation for a montage.
 *
 * Why an IR at all: the agent must be able to *edit*, not just assemble. Giving
 * Gemini 28 hard-coded Remotion compositions would let it pick a template and
 * fill slots. Giving it a timeline lets it cut on a consonant, punch in on a
 * number, duck the music under a line, hold a freeze for 220 ms and stack a text
 * bar over a reaction — which is the difference between generated content and
 * edited content.
 *
 * The IR is plain JSON. It is produced by the editor agent's tools, validated
 * here, persisted in `render_jobs.input_props`, and rendered by a single generic
 * Remotion composition. One renderer, unlimited formats.
 */

import { z } from "zod";

export const FPS = 60;
export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

/* ==========================================================================
   Effects
   ========================================================================== */

const easingSchema = z.enum(["linear", "easeOut", "easeInOut", "spring"]).default("easeOut");

/** Continuous camera move over a clip. The workhorse of edited short-form. */
const kenBurnsSchema = z.object({
  type: z.literal("kenBurns"),
  fromScale: z.number().min(0.8).max(2.5).default(1),
  toScale: z.number().min(0.8).max(2.5).default(1.08),
  fromX: z.number().default(0),
  toX: z.number().default(0),
  fromY: z.number().default(0),
  toY: z.number().default(0),
  easing: easingSchema,
});

/** Instant scale rupture on a syllable, then release. DOC-003 technique 1. */
const punchInSchema = z.object({
  type: z.literal("punchIn"),
  atMs: z.number().min(0),
  scale: z.number().min(1.02).max(1.6).default(1.18),
  attackMs: z.number().min(40).max(400).default(120),
  holdMs: z.number().min(0).max(2000).default(480),
  releaseMs: z.number().min(40).max(600).default(200),
});

/** One-frame inversion + white noise. Resets visual attention. */
const glitchSchema = z.object({
  type: z.literal("glitch"),
  atMs: z.number().min(0),
  frames: z.number().min(1).max(4).default(1),
  style: z.enum(["invert", "crt", "rgbSplit"]).default("invert"),
});

const shakeSchema = z.object({
  type: z.literal("shake"),
  amplitudePx: z.number().min(0).max(40).default(6),
  frequencyHz: z.number().min(0.5).max(12).default(3.5),
});

const speedSchema = z.object({
  type: z.literal("speed"),
  rate: z.number().min(0.2).max(4).default(1.5),
  /** Ramp the rate change rather than stepping it. */
  rampMs: z.number().min(0).max(1000).default(0),
});

const freezeSchema = z.object({
  type: z.literal("freeze"),
  atMs: z.number().min(0),
  durationMs: z.number().min(60).max(4000).default(220),
});

const colorSchema = z.object({
  type: z.literal("color"),
  saturation: z.number().min(0).max(2).default(1),
  contrast: z.number().min(0.5).max(2).default(1),
  brightness: z.number().min(0.5).max(1.6).default(1),
  /** Warm/cool shift in degrees of hue rotation. */
  hueRotate: z.number().min(-60).max(60).default(0),
  grain: z.number().min(0).max(1).default(0),
  blurPx: z.number().min(0).max(30).default(0),
});

export const effectSchema = z.discriminatedUnion("type", [
  kenBurnsSchema,
  punchInSchema,
  glitchSchema,
  shakeSchema,
  speedSchema,
  freezeSchema,
  colorSchema,
]);

export type Effect = z.infer<typeof effectSchema>;

/* ==========================================================================
   Layout — how a clip occupies the frame
   ========================================================================== */

export const layoutSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("full") }),
  /** Horizontal split, e.g. reaction on top / demo below. */
  z.object({
    mode: z.literal("splitH"),
    /** Share of the frame height this clip gets, 0-1. */
    share: z.number().min(0.2).max(0.8).default(0.45),
    position: z.enum(["top", "bottom"]),
  }),
  /** Picture-in-picture bubble. */
  z.object({
    mode: z.literal("pip"),
    x: z.number().default(60),
    y: z.number().default(1180),
    size: z.number().min(160).max(720).default(360),
    shape: z.enum(["circle", "rounded"]).default("circle"),
  }),
  /** Cut-out subject over a background clip (green-screen commentary). */
  z.object({
    mode: z.literal("cutout"),
    anchor: z.enum(["bottomLeft", "bottomRight", "bottomCenter"]).default("bottomRight"),
    scale: z.number().min(0.2).max(1).default(0.55),
  }),
]);

export type Layout = z.infer<typeof layoutSchema>;

/* ==========================================================================
   Video track
   ========================================================================== */

export const videoClipSchema = z.object({
  id: z.string(),
  /** Which generated asset this clip plays. */
  assetId: z.string().optional(),
  src: z.string(),
  kind: z.enum(["video", "image", "screencast", "color"]).default("video"),
  /** Where the clip sits on the master timeline. */
  startMs: z.number().min(0),
  durationMs: z.number().min(60),
  /** In-point inside the source media. */
  sourceInMs: z.number().min(0).default(0),
  layer: z.number().int().min(0).max(9).default(0),
  layout: layoutSchema.default({ mode: "full" }),
  fit: z.enum(["cover", "contain"]).default("cover"),
  effects: z.array(effectSchema).default([]),
  /** Transition applied at this clip's IN point. */
  transitionIn: z
    .object({
      type: z.enum(["cut", "whipPan", "wipe", "slide", "fade", "zoomBlur"]).default("cut"),
      durationMs: z.number().min(0).max(600).default(0),
      direction: z.enum(["left", "right", "up", "down"]).default("left"),
    })
    .default({ type: "cut", durationMs: 0, direction: "left" }),
  opacity: z.number().min(0).max(1).default(1),
  /**
   * How loud this clip's own audio plays.
   *
   * It defaults to silent because that was true for years: the video model made
   * pictures, a separate voice track carried the words, and letting a clip's
   * audio through only added noise to the mix.
   *
   * Omni changed that. It renders the dialogue *inside* the clip, in sync with
   * the mouth, and that performance is the entire soundtrack of a talking-head
   * video. The renderer muted it unconditionally, which is why the first
   * finished videos played silent under a music bed — the woman was speaking
   * and nobody could hear her.
   *
   * Still explicit rather than always-on: a narrated scenario wants the clip
   * held right down under the voice-over, and a silent-reaction scenario wants
   * it off entirely.
   */
  audioGain: z.number().min(0).max(2).default(0),
  /** Free-text note from the editor agent, surfaced in the storyboard UI. */
  note: z.string().optional(),
});

export type VideoClip = z.infer<typeof videoClipSchema>;

/* ==========================================================================
   Overlay track
   ========================================================================== */

const anchorSchema = z.object({
  /** Absolute Y in a 1080x1920 frame. Must fall inside the safe band. */
  y: z.number().min(0).max(FRAME_HEIGHT),
  align: z.enum(["left", "center", "right"]).default("center"),
  x: z.number().optional(),
});

/** Static banner over the hook. Never animates — it is a poster, not a subtitle. */
const textBarSchema = z.object({
  type: z.literal("textBar"),
  id: z.string(),
  text: z.string().max(180),
  startMs: z.number().min(0),
  durationMs: z.number().min(120),
  anchor: anchorSchema,
  style: z
    .object({
      background: z.string().default("#FE2C55"),
      color: z.string().default("#FFFFFF"),
      fontSize: z.number().min(24).max(120).default(58),
      fontWeight: z.number().min(400).max(900).default(900),
      uppercase: z.boolean().default(true),
      radius: z.number().min(0).max(60).default(14),
      paddingX: z.number().min(0).max(80).default(28),
      paddingY: z.number().min(0).max(60).default(16),
      maxWidth: z.number().min(300).max(1040).default(900),
      shadow: z.boolean().default(true),
    })
    .default({}),
  enter: z.enum(["none", "pop", "slideUp"]).default("pop"),
});

/** Word-by-word kinetic captions driven by real timings. */
const captionTrackSchema = z.object({
  type: z.literal("captions"),
  id: z.string(),
  words: z.array(
    z.object({
      word: z.string(),
      startMs: z.number().min(0),
      endMs: z.number().min(0),
      emphasis: z.boolean().default(false),
    }),
  ),
  anchor: anchorSchema,
  wordsPerBlock: z.number().int().min(1).max(4).default(3),
  style: z
    .object({
      fontSize: z.number().min(32).max(110).default(64),
      color: z.string().default("#FFFFFF"),
      highlight: z.string().default("#FFE600"),
      strokeWidth: z.number().min(0).max(20).default(12),
      strokeColor: z.string().default("#000000"),
      uppercase: z.boolean().default(true),
    })
    .default({}),
});

/** Hand-drawn circle / arrow pointing at part of the UI. */
const annotationSchema = z.object({
  type: z.literal("annotation"),
  id: z.string(),
  shape: z.enum(["circle", "arrow", "underline", "box"]).default("circle"),
  x: z.number(),
  y: z.number(),
  width: z.number().default(280),
  height: z.number().default(160),
  rotation: z.number().default(0),
  color: z.string().default("#FE2C55"),
  startMs: z.number().min(0),
  durationMs: z.number().min(120),
  label: z.string().optional(),
});

/** Countdown / stopwatch, used by the timed-hack and comparison formats. */
const timerSchema = z.object({
  type: z.literal("timer"),
  id: z.string(),
  mode: z.enum(["countdown", "stopwatch"]).default("countdown"),
  fromMs: z.number().min(0).default(30000),
  startMs: z.number().min(0),
  durationMs: z.number().min(500),
  anchor: anchorSchema,
  /** Turns red and pulses below this remaining time. */
  urgentBelowMs: z.number().min(0).default(10000),
  freezeAtEnd: z.boolean().default(true),
});

/** Progress badge for step-based formats: "1", "2", "3" + green check. */
const stepBadgeSchema = z.object({
  type: z.literal("stepBadge"),
  id: z.string(),
  index: z.number().int().min(1).max(9),
  label: z.string().optional(),
  startMs: z.number().min(0),
  durationMs: z.number().min(200),
  checkAtMs: z.number().min(0).optional(),
  anchor: anchorSchema,
});

/** A comment bubble reproduced over the video (Format 17). */
const commentCardSchema = z.object({
  type: z.literal("commentCard"),
  id: z.string(),
  author: z.string().default("@utilisateur"),
  text: z.string().max(300),
  likes: z.number().int().min(0).default(0),
  startMs: z.number().min(0),
  durationMs: z.number().min(300),
  anchor: anchorSchema,
});

/** Chat bubble sequence (Format 12). */
const chatBubbleSchema = z.object({
  type: z.literal("chatBubble"),
  id: z.string(),
  side: z.enum(["incoming", "outgoing"]),
  text: z.string().max(300),
  startMs: z.number().min(0),
  durationMs: z.number().min(200),
  /** Typing indicator shown before the bubble lands. */
  typingMs: z.number().min(0).max(3000).default(0),
  imageSrc: z.string().optional(),
});

/** Full-frame story card for text-over-video formats. */
const storyCardSchema = z.object({
  type: z.literal("storyCard"),
  id: z.string(),
  text: z.string().max(400),
  startMs: z.number().min(0),
  durationMs: z.number().min(500),
  anchor: anchorSchema,
  style: z
    .object({
      fontSize: z.number().min(28).max(96).default(54),
      color: z.string().default("#FFFFFF"),
      shadow: z.boolean().default(true),
      background: z.string().default("transparent"),
      maxWidth: z.number().min(400).max(1000).default(880),
      align: z.enum(["left", "center"]).default("center"),
    })
    .default({}),
  enter: z.enum(["fadeSlide", "none", "typewriter"]).default("fadeSlide"),
});

export const overlaySchema = z.discriminatedUnion("type", [
  textBarSchema,
  captionTrackSchema,
  annotationSchema,
  timerSchema,
  stepBadgeSchema,
  commentCardSchema,
  chatBubbleSchema,
  storyCardSchema,
]);

export type Overlay = z.infer<typeof overlaySchema>;

/* ==========================================================================
   Audio track
   ========================================================================== */

export const gainPointSchema = z.object({
  atMs: z.number().min(0),
  gain: z.number().min(0).max(2),
  /** Ramp duration to reach this gain from the previous point. */
  rampMs: z.number().min(0).max(2000).default(80),
});

export const audioClipSchema = z.object({
  id: z.string(),
  src: z.string(),
  bus: z.enum(["voice", "music", "sfx"]),
  startMs: z.number().min(0),
  durationMs: z.number().min(20),
  sourceInMs: z.number().min(0).default(0),
  gain: z.number().min(0).max(2).default(1),
  /** Automation envelope. Music ducking under the voice lives here. */
  automation: z.array(gainPointSchema).default([]),
  loop: z.boolean().default(false),
  fadeInMs: z.number().min(0).max(3000).default(0),
  fadeOutMs: z.number().min(0).max(3000).default(0),
});

export type AudioClip = z.infer<typeof audioClipSchema>;

/* ==========================================================================
   Timeline
   ========================================================================== */

export const timelineSchema = z.object({
  id: z.string(),
  formatId: z.string(),
  fps: z.literal(FPS).default(FPS),
  width: z.literal(FRAME_WIDTH).default(FRAME_WIDTH),
  height: z.literal(FRAME_HEIGHT).default(FRAME_HEIGHT),
  durationMs: z.number().min(3000).max(180000),
  background: z.string().default("#000000"),
  video: z.array(videoClipSchema).default([]),
  overlays: z.array(overlaySchema).default([]),
  audio: z.array(audioClipSchema).default([]),
  /** Downbeats from the music provider, so cuts can be snapped to them. */
  beatGridMs: z.array(z.number()).default([]),
  /** Editor agent's own account of the montage, shown in the review UI. */
  editNotes: z.string().optional(),
});

export type Timeline = z.infer<typeof timelineSchema>;

export function emptyTimeline(id: string, formatId: string, durationMs: number): Timeline {
  return timelineSchema.parse({ id, formatId, durationMs });
}

/* ==========================================================================
   Validation — the QA gate that runs before a single frame is rendered
   ========================================================================== */

export interface TimelineIssue {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  /** Where in the timeline, in ms, so the UI can seek to it. */
  atMs?: number;
}

const SAFE_TOP = 220;
const SAFE_BOTTOM = 1450;
const SAFE_RIGHT = 920;

/**
 * Checks that catch the mistakes an LLM actually makes when editing.
 *
 * Every rule here corresponds to a failure that is invisible in the JSON and
 * obvious in the rendered video: text under the platform chrome, a hole in the
 * video track, a cut that lands mid-syllable, a hook that violates the frame-0
 * rules, music louder than the voice.
 */
export function validateTimeline(t: Timeline): TimelineIssue[] {
  const issues: TimelineIssue[] = [];

  /* -- Coverage: no black holes in the video track ----------------------- */
  const base = t.video.filter((c) => c.layer === 0).sort((a, b) => a.startMs - b.startMs);
  if (base.length === 0) {
    issues.push({ severity: "ERROR", code: "NO_VIDEO", message: "La timeline n'a aucun plan sur la couche 0." });
  } else {
    if (base[0]!.startMs > 0) {
      issues.push({
        severity: "ERROR",
        code: "GAP_AT_START",
        message: `The video starts at ${base[0]!.startMs}ms, so the first ${base[0]!.startMs}ms would be black. Frame zero has to be bright and contrasty.`,
        atMs: 0,
      });
    }
    let cursor = 0;
    for (const clip of base) {
      if (clip.startMs > cursor + 40) {
        issues.push({
          severity: "ERROR",
          code: "GAP",
          message: `A ${clip.startMs - cursor}ms gap in the video track at ${cursor}ms.`,
          atMs: cursor,
        });
      }
      cursor = Math.max(cursor, clip.startMs + clip.durationMs);
    }
    if (cursor < t.durationMs - 40) {
      issues.push({
        severity: "ERROR",
        code: "GAP_AT_END",
        message: `The video track stops at ${cursor}ms but the timeline runs ${t.durationMs}ms.`,
        atMs: cursor,
      });
    }
  }

  /* -- Safe zones -------------------------------------------------------- */
  for (const o of t.overlays) {
    const y = "anchor" in o ? o.anchor.y : undefined;
    if (y === undefined) continue;
    // Captions carry their timing per word rather than on the overlay itself.
    const at = "startMs" in o ? o.startMs : (o.words[0]?.startMs ?? 0);
    if (y < SAFE_TOP) {
      issues.push({
        severity: "ERROR",
        code: "SAFE_ZONE_TOP",
        message: `Overlay "${o.id}" sits at y=${y}, under the platform header (dead zone 0-${SAFE_TOP}px). It will be invisible.`,
        atMs: at,
      });
    }
    if (y > SAFE_BOTTOM) {
      issues.push({
        severity: "ERROR",
        code: "SAFE_ZONE_BOTTOM",
        message: `Overlay "${o.id}" sits at y=${y}, behind the caption and the progress bar (dead zone ${SAFE_BOTTOM}-1920px).`,
        atMs: at,
      });
    }
    if ("anchor" in o && o.anchor.x !== undefined && o.anchor.x > SAFE_RIGHT) {
      issues.push({
        severity: "WARNING",
        code: "SAFE_ZONE_RIGHT",
        message: `Overlay "${o.id}" sits at x=${o.anchor.x}, under the button column (past ${SAFE_RIGHT}px).`,
        atMs: at,
      });
    }
  }

  /* -- Hook rules (DOC-001) ---------------------------------------------- */
  const firstClip = base[0];
  if (firstClip && firstClip.effects.length === 0 && firstClip.durationMs > 1800) {
    issues.push({
      severity: "WARNING",
      code: "STATIC_HOOK",
      message:
        "The first shot holds for more than 1.8s with no effect: a static frame on a static subject, which is disqualifying for a hook. Add a punch-in or a ken burns.",
      atMs: 0,
    });
  }
  const hasEarlyAudio = t.audio.some((a) => a.startMs <= 50);
  if (!hasEarlyAudio) {
    issues.push({
      severity: "WARNING",
      code: "SILENT_START",
      message: "No audio starts before 50ms. More than 0.05s of opening silence kills the hook.",
      atMs: 0,
    });
  }

  /* -- Pattern interrupt density ----------------------------------------- */
  const interruptTimes = t.video
    .flatMap((c) =>
      c.effects
        .filter((e) => e.type === "punchIn" || e.type === "glitch" || e.type === "freeze")
        .map((e) => ("atMs" in e ? c.startMs + e.atMs : c.startMs)),
    )
    .concat(base.slice(1).map((c) => c.startMs))
    .sort((a, b) => a - b);

  let last = 0;
  for (const t2 of interruptTimes) {
    if (t2 - last > 4200) {
      issues.push({
        severity: "WARNING",
        code: "FLAT_STRETCH",
        message: `${Math.round((t2 - last) / 1000)} s sans aucune rupture visuelle entre ${last} ms et ${t2} ms. Ajouter un pattern interrupt.`,
        atMs: last,
      });
    }
    last = t2;
  }
  if (t.durationMs - last > 4200 && t.durationMs > 6000) {
    issues.push({
      severity: "WARNING",
      code: "FLAT_STRETCH_END",
      message: `${Math.round((t.durationMs - last) / 1000)}s with no visual break before the end.`,
      atMs: last,
    });
  }

  /* -- Audio ------------------------------------------------------------- */
  const voice = t.audio.filter((a) => a.bus === "voice");
  const music = t.audio.filter((a) => a.bus === "music");
  for (const m of music) {
    const overlapsVoice = voice.some(
      (v) => v.startMs < m.startMs + m.durationMs && m.startMs < v.startMs + v.durationMs,
    );
    if (overlapsVoice && m.automation.length === 0 && m.gain > 0.2) {
      issues.push({
        severity: "ERROR",
        code: "NO_DUCKING",
        message: `Music "${m.id}" plays at ${m.gain} under the voice with no ducking automation. The voice will be unintelligible.`,
        atMs: m.startMs,
      });
    }
  }

  /* -- Caption legibility ------------------------------------------------ */
  for (const o of t.overlays) {
    if (o.type !== "captions") continue;
    for (const w of o.words) {
      if (w.endMs - w.startMs < 80) {
        issues.push({
          severity: "WARNING",
          code: "CAPTION_TOO_FAST",
          message: `The word "${w.word}" is on screen for only ${w.endMs - w.startMs}ms — unreadable.`,
          atMs: w.startMs,
        });
        break;
      }
    }
  }
  for (const o of t.overlays) {
    if (o.type !== "storyCard") continue;
    const words = o.text.trim().split(/\s+/).length;
    // ~4 words/second is a comfortable reading pace on a phone.
    const needed = (words / 4) * 1000;
    if (o.durationMs < needed * 0.8) {
      issues.push({
        severity: "WARNING",
        code: "CARD_TOO_SHORT",
        message: `La carte « ${o.id} » affiche ${words} mots pendant ${o.durationMs} ms — il en faut environ ${Math.round(needed)} ms pour la lire.`,
        atMs: o.startMs,
      });
    }
  }

  /* -- Bounds ------------------------------------------------------------ */
  for (const c of t.video) {
    if (c.startMs + c.durationMs > t.durationMs + 40) {
      issues.push({
        severity: "WARNING",
        code: "CLIP_OVERRUNS",
        message: `Shot "${c.id}" runs ${c.startMs + c.durationMs - t.durationMs}ms past the end of the timeline.`,
        atMs: t.durationMs,
      });
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: TimelineIssue[]): boolean {
  return issues.some((i) => i.severity === "ERROR");
}

/* ==========================================================================
   Helpers used by the editing tools
   ========================================================================== */

/** Snap a time to the nearest downbeat within tolerance. */
export function snapToBeat(ms: number, beatGridMs: number[], toleranceMs = 180): number {
  if (beatGridMs.length === 0) return ms;
  let best = ms;
  let bestDelta = Infinity;
  for (const b of beatGridMs) {
    const d = Math.abs(b - ms);
    if (d < bestDelta) {
      bestDelta = d;
      best = b;
    }
  }
  return bestDelta <= toleranceMs ? best : ms;
}

/**
 * Snap a cut to the nearest breath group end.
 *
 * Cutting mid-word is the single most recognisable sign of an automated edit.
 * Breath-group boundaries come from real word timings, so the cut lands where a
 * human editor would put it.
 */
export function snapToBreath(ms: number, breathEndsMs: number[], toleranceMs = 320): number {
  if (breathEndsMs.length === 0) return ms;
  let best = ms;
  let bestDelta = Infinity;
  for (const b of breathEndsMs) {
    const d = Math.abs(b - ms);
    if (d < bestDelta) {
      bestDelta = d;
      best = b;
    }
  }
  return bestDelta <= toleranceMs ? best : ms;
}

/** Build a ducking envelope: music drops under every voice segment. */
export function buildDuckingAutomation(
  voiceSegments: Array<{ startMs: number; durationMs: number }>,
  opts: { duckedGain?: number; openGain?: number; rampMs?: number } = {},
): Array<{ atMs: number; gain: number; rampMs: number }> {
  const ducked = opts.duckedGain ?? 0.12; // about -18 dB
  const open = opts.openGain ?? 0.35; // about -9 dB
  const ramp = opts.rampMs ?? 140;

  const points: Array<{ atMs: number; gain: number; rampMs: number }> = [
    { atMs: 0, gain: open, rampMs: 0 },
  ];

  for (const seg of [...voiceSegments].sort((a, b) => a.startMs - b.startMs)) {
    points.push({ atMs: Math.max(0, seg.startMs - ramp), gain: ducked, rampMs: ramp });
    points.push({ atMs: seg.startMs + seg.durationMs, gain: open, rampMs: ramp * 2 });
  }

  // Collapse points that land on the same instant.
  return points.filter((p, i, arr) => i === 0 || p.atMs !== arr[i - 1]!.atMs);
}

/** Group caption words into readable blocks. */
export function groupCaptionBlocks(
  words: Array<{ word: string; startMs: number; endMs: number; emphasis?: boolean }>,
  perBlock = 3,
) {
  const blocks: Array<{ startMs: number; endMs: number; words: typeof words }> = [];
  for (let i = 0; i < words.length; i += perBlock) {
    const chunk = words.slice(i, i + perBlock);
    if (chunk.length === 0) continue;
    blocks.push({ startMs: chunk[0]!.startMs, endMs: chunk.at(-1)!.endMs, words: chunk });
  }
  return blocks;
}
