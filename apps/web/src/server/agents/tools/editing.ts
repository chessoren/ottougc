import { composeTimeline, type ScriptBeat } from "@/server/edit/compose";
import {
  buildDuckingAutomation,
  effectSchema,
  hasBlockingIssues,
  overlaySchema,
  snapToBeat,
  snapToBreath,
  validateTimeline,
  type Overlay,
  type VideoClip,
} from "@/server/edit/timeline";
import { getFormat } from "@/server/knowledge";

import { getWorkspace } from "../workspace";
import type { AgentTool } from "../types";

/**
 * Editing tools.
 *
 * This is the toolset that turns the agent from a *generator* into an *editor*.
 * The model does not write a Remotion component; it performs edit operations on
 * a timeline the way a human would in a NLE: lay a rough cut, then move a cut
 * onto a breath, punch in on a number, drop the music under a line, hold a
 * freeze on the result, stack a text bar over the reaction.
 *
 * Design decisions that matter:
 *   - Times are milliseconds on the master timeline. No frames, no ratios.
 *   - Snapping is done *for* the model. `place_cut` pulls the cut onto the
 *     nearest breath group automatically, because a model asked to "cut at 3412ms"
 *     will happily slice a word in half.
 *   - Every mutation returns the validation report, so the agent sees the
 *     consequence of its edit immediately instead of discovering it at render.
 */

function ws(runId: string) {
  return getWorkspace(runId);
}

function requireTimeline(runId: string) {
  const w = ws(runId);
  if (!w.timeline) {
    throw new Error(
      "No timeline yet. Call build_rough_cut first to lay down the assembly.",
    );
  }
  return w.timeline;
}

function report(runId: string) {
  const t = requireTimeline(runId);
  const issues = validateTimeline(t);
  return {
    durationMs: t.durationMs,
    clips: t.video.length,
    overlays: t.overlays.length,
    audioTracks: t.audio.length,
    blocking: hasBlockingIssues(issues),
    issues: issues.slice(0, 12),
  };
}

export const buildRoughCut: AgentTool = {
  name: "build_rough_cut",
  description:
    "Lays down the assembly from your beats and the footage already generated: one shot per beat, cuts snapped to the breath, ken burns, hook banner, kinetic captions, music ducked. Call this ONCE after generating the voice and the shots. Then refine with the other editing tools.",
  parameters: {
    type: "object",
    properties: {
      beats: {
        type: "array",
        description: "Your script beats, in order.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            startMs: { type: "number" },
            endMs: { type: "number" },
            narration: { type: "string" },
            onScreenText: { type: "string" },
            visual: { type: "string" },
            patternInterrupt: { type: "string" },
          },
          required: ["label", "startMs", "endMs", "visual"],
        },
      },
      hookText: { type: "string", description: "The hook banner. Seven words maximum." },
      formatId: { type: "string" },
    },
    required: ["beats", "hookText", "formatId"],
  },
  async handler(args: { beats: ScriptBeat[]; hookText: string; formatId: string }, ctx) {
    const w = ws(ctx.runId);
    w.beats = args.beats;

    if (w.assets.clips.length === 0) {
      return {
        error:
          "No footage generated. Generate at least one shot before editing.",
      };
    }

    w.timeline = composeTimeline({
      timelineId: `tl_${ctx.runId.slice(0, 8)}`,
      formatId: args.formatId,
      beats: args.beats,
      assets: w.assets,
      hookText: args.hookText,
      brandName: "",
    });

    const r = report(ctx.runId);
    return {
      ...r,
      cuts: w.timeline.video.map((c) => ({
        id: c.id,
        startMs: c.startMs,
        durationMs: c.durationMs,
        note: c.note,
      })),
      advice:
        "Assembly laid down. Now refine it: add cuts, punch in on the impact words, annotate the screen recordings, and run check_timeline before rendering.",
    };
  },
};

export const placeCut: AgentTool = {
  name: "place_cut",
  description:
    "Moves a cut. The time you ask for is snapped to the nearest end of a breath group, or to the nearest musical downbeat if there's no voice: cutting mid-word is the most recognisable sign of an automated edit.",
  parameters: {
    type: "object",
    properties: {
      clipId: { type: "string", description: "The shot whose in-point you're moving." },
      toMs: { type: "number" },
      snap: {
        type: "string",
        enum: ["breath", "beat", "none"],
        description: "breath = on the breath (default with voice), beat = on the downbeat.",
      },
    },
    required: ["clipId", "toMs"],
  },
  async handler(args: { clipId: string; toMs: number; snap?: string }, ctx) {
    const t = requireTimeline(ctx.runId);
    const w = ws(ctx.runId);
    const index = t.video.findIndex((c) => c.id === args.clipId);
    if (index <= 0) {
      return { error: `Shot \"${args.clipId}\" not found, or it's the first shot, which starts at zero.` };
    }

    const mode = args.snap ?? (w.assets.voiceover ? "breath" : "beat");
    let target = args.toMs;
    if (mode === "breath" && w.assets.voiceover) {
      target = snapToBreath(target, w.assets.voiceover.breathGroupEndsMs);
    } else if (mode === "beat" && t.beatGridMs.length) {
      target = snapToBeat(target, t.beatGridMs);
    }

    const prev = t.video[index - 1]!;
    const clip = t.video[index]!;
    const prevStart = prev.startMs;
    const clipEnd = clip.startMs + clip.durationMs;
    target = Math.max(prevStart + 400, Math.min(clipEnd - 400, target));

    prev.durationMs = target - prev.startMs;
    clip.durationMs = clipEnd - target;
    clip.startMs = target;

    return { moved: true, requestedMs: args.toMs, actualMs: target, snappedBy: mode, ...report(ctx.runId) };
  },
};

export const splitClip: AgentTool = {
  name: "split_clip",
  description:
    "Splits a shot in two. Use it to add density: a talking head holding the same framing for more than 2.5s loses people.",
  parameters: {
    type: "object",
    properties: {
      clipId: { type: "string" },
      atMs: { type: "number", description: "Absolute time on the timeline." },
    },
    required: ["clipId", "atMs"],
  },
  async handler(args: { clipId: string; atMs: number }, ctx) {
    const t = requireTimeline(ctx.runId);
    const index = t.video.findIndex((c) => c.id === args.clipId);
    if (index === -1) return { error: `Plan « ${args.clipId} » introuvable.` };

    const clip = t.video[index]!;
    const local = args.atMs - clip.startMs;
    if (local < 300 || local > clip.durationMs - 300) {
      return { error: `Cut point outside the shot (it runs ${clip.startMs} to ${clip.startMs + clip.durationMs}ms, and 300ms of margin is required).` };
    }

    const second: VideoClip = {
      ...clip,
      id: `${clip.id}b`,
      startMs: args.atMs,
      durationMs: clip.durationMs - local,
      sourceInMs: clip.sourceInMs + local,
      effects: [],
      transitionIn: { type: "cut", durationMs: 0, direction: "left" },
    };
    clip.durationMs = local;
    t.video.splice(index + 1, 0, second);

    return { split: true, newClipId: second.id, ...report(ctx.runId) };
  },
};

export const addClip: AgentTool = {
  name: "add_clip",
  description:
    "Inserts already-generated footage at a given time and layout (full frame, top/bottom split, picture-in-picture, cutout). This is how you build a reaction-over-demo split.",
  parameters: {
    type: "object",
    properties: {
      src: { type: "string", description: "Asset URL, as returned by a generation tool." },
      kind: { type: "string", enum: ["video", "image", "screencast"] },
      startMs: { type: "number" },
      durationMs: { type: "number" },
      layer: { type: "number", description: "0 = background. 1 and above sit on top." },
      layout: {
        type: "object",
        description:
          "{ mode: 'full' } | { mode: 'splitH', share: 0.45, position: 'top'|'bottom' } | { mode: 'pip', x, y, size, shape } | { mode: 'cutout', anchor, scale }",
        properties: {
          mode: { type: "string", enum: ["full", "splitH", "pip", "cutout"] },
          share: { type: "number" },
          position: { type: "string", enum: ["top", "bottom"] },
          x: { type: "number" },
          y: { type: "number" },
          size: { type: "number" },
          shape: { type: "string", enum: ["circle", "rounded"] },
          anchor: { type: "string", enum: ["bottomLeft", "bottomRight", "bottomCenter"] },
          scale: { type: "number" },
        },
      },
      note: { type: "string" },
    },
    required: ["src", "startMs", "durationMs"],
  },
  async handler(
    args: {
      src: string;
      kind?: string;
      startMs: number;
      durationMs: number;
      layer?: number;
      layout?: Record<string, unknown>;
      note?: string;
    },
    ctx,
  ) {
    const t = requireTimeline(ctx.runId);
    const clip = {
      id: `v${t.video.length}_${Math.round(args.startMs)}`,
      src: args.src,
      kind: (args.kind ?? "video") as VideoClip["kind"],
      startMs: args.startMs,
      durationMs: args.durationMs,
      sourceInMs: 0,
      layer: args.layer ?? 1,
      layout: (args.layout ?? { mode: "full" }) as VideoClip["layout"],
      fit: "cover" as const,
      opacity: 1,
      // A clip the agent adds by hand is b-roll under an existing mix, so it
      // comes in silent. Speech-carrying clips are placed by the composer.
      audioGain: 0,
      effects: [],
      transitionIn: { type: "cut" as const, durationMs: 0, direction: "left" as const },
      note: args.note,
    };
    t.video.push(clip);
    t.video.sort((a, b) => a.layer - b.layer || a.startMs - b.startMs);
    return { added: true, clipId: clip.id, ...report(ctx.runId) };
  },
};

export const applyEffect: AgentTool = {
  name: "apply_effect",
  description:
    "Applies an effect. punchIn = a scale break on one syllable, the most useful of these, placed on impact words and numbers. kenBurns = continuous drift. glitch = attention reset. color = desaturates the 'before' side of a comparison. shake = handheld energy. freeze and speed hold or time-warp the picture and are REFUSED on any shot that carries spoken dialogue, because the voice does not warp with it.",
  parameters: {
    type: "object",
    properties: {
      clipId: { type: "string" },
      effect: {
        type: "object",
        description:
          "{type:'punchIn', atMs, scale, attackMs, holdMs, releaseMs} | {type:'kenBurns', fromScale, toScale, toX, toY} | {type:'freeze', atMs, durationMs} | {type:'glitch', atMs, style} | {type:'speed', rate} | {type:'color', saturation, contrast, grain, blurPx} | {type:'shake', amplitudePx, frequencyHz}",
        properties: {
          type: {
            type: "string",
            enum: ["punchIn", "kenBurns", "freeze", "glitch", "speed", "color", "shake"],
          },
          atMs: { type: "number", description: "Relative to the start of the shot." },
          scale: { type: "number" },
          attackMs: { type: "number" },
          holdMs: { type: "number" },
          releaseMs: { type: "number" },
          fromScale: { type: "number" },
          toScale: { type: "number" },
          toX: { type: "number" },
          toY: { type: "number" },
          durationMs: { type: "number" },
          style: { type: "string", enum: ["invert", "crt", "rgbSplit"] },
          rate: { type: "number" },
          saturation: { type: "number" },
          contrast: { type: "number" },
          brightness: { type: "number" },
          grain: { type: "number" },
          blurPx: { type: "number" },
          amplitudePx: { type: "number" },
          frequencyHz: { type: "number" },
        },
        required: ["type"],
      },
    },
    required: ["clipId", "effect"],
  },
  async handler(args: { clipId: string; effect: Record<string, unknown> }, ctx) {
    const t = requireTimeline(ctx.runId);
    const clip = t.video.find((c) => c.id === args.clipId);
    if (!clip) return { error: `Plan « ${args.clipId} » introuvable.` };

    const parsed = effectSchema.safeParse(args.effect);
    if (!parsed.success) {
      return {
        error: `Effet invalide : ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ")}`,
      };
    }
    // Two effects move the picture without moving the sound, and this clip's
    // sound is somebody speaking. Refused with the reason, so the agent can pick
    // a different effect rather than silently shipping a mouth that stops
    // moving mid-sentence.
    if (clip.audioGain > 0 && (parsed.data.type === "speed" || parsed.data.type === "freeze")) {
      return {
        error: `"${parsed.data.type}" cannot be applied to ${args.clipId}: this shot carries its own dialogue, and time-warping the picture desynchronises it from the voice.`,
        hint: "punchIn, kenBurns, shake, glitch and color all work here — they change how the frame looks, not which frame it is.",
      };
    }

    clip.effects.push(parsed.data);
    return { applied: true, effectCount: clip.effects.length, ...report(ctx.runId) };
  },
};

export const setTransition: AgentTool = {
  name: "set_transition",
  description:
    "Sets how a shot enters. Use 'cut' in nine cases out of ten: dissolves make a video look corporate. whipPan and zoomBlur for energetic breaks, wipe for before/after.",
  parameters: {
    type: "object",
    properties: {
      clipId: { type: "string" },
      type: { type: "string", enum: ["cut", "whipPan", "wipe", "slide", "fade", "zoomBlur"] },
      durationMs: { type: "number" },
      direction: { type: "string", enum: ["left", "right", "up", "down"] },
    },
    required: ["clipId", "type"],
  },
  async handler(args: { clipId: string; type: string; durationMs?: number; direction?: string }, ctx) {
    const t = requireTimeline(ctx.runId);
    const clip = t.video.find((c) => c.id === args.clipId);
    if (!clip) return { error: `Plan « ${args.clipId} » introuvable.` };
    clip.transitionIn = {
      type: args.type as never,
      durationMs: args.type === "cut" ? 0 : (args.durationMs ?? 180),
      direction: (args.direction ?? "left") as never,
    };
    return { set: true, ...report(ctx.runId) };
  },
};

export const addOverlay: AgentTool = {
  name: "add_overlay",
  description:
    "Adds an overlay: fixed text band, story card, hand-drawn annotation on a screen recording, timer, step badge, comment card, chat bubble. Stay inside the safe area — y between 300 and 1400 — or the platform's own interface covers it.",
  parameters: {
    type: "object",
    properties: {
      overlay: {
        type: "object",
        description:
          "Un objet overlay complet. type: 'textBar' | 'storyCard' | 'annotation' | 'timer' | 'stepBadge' | 'commentCard' | 'chatBubble'. Tous ont id, startMs, durationMs et anchor:{y,align}.",
        properties: {
          type: {
            type: "string",
            enum: ["textBar", "storyCard", "annotation", "timer", "stepBadge", "commentCard", "chatBubble"],
          },
          id: { type: "string" },
          text: { type: "string" },
          startMs: { type: "number" },
          durationMs: { type: "number" },
          anchor: {
            type: "object",
            properties: {
              y: { type: "number" },
              align: { type: "string", enum: ["left", "center", "right"] },
              x: { type: "number" },
            },
            required: ["y"],
          },
          shape: { type: "string", enum: ["circle", "arrow", "underline", "box"] },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          color: { type: "string" },
          mode: { type: "string", enum: ["countdown", "stopwatch"] },
          fromMs: { type: "number" },
          index: { type: "number" },
          label: { type: "string" },
          author: { type: "string" },
          likes: { type: "number" },
          side: { type: "string", enum: ["incoming", "outgoing"] },
          typingMs: { type: "number" },
          style: { type: "object" },
          enter: { type: "string" },
        },
        required: ["type", "id", "startMs"],
      },
    },
    required: ["overlay"],
  },
  async handler(args: { overlay: Record<string, unknown> }, ctx) {
    const t = requireTimeline(ctx.runId);
    const parsed = overlaySchema.safeParse(args.overlay);
    if (!parsed.success) {
      return {
        error: `Overlay invalide : ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ")}`,
      };
    }
    t.overlays = t.overlays.filter((o) => o.id !== (parsed.data as Overlay).id);
    t.overlays.push(parsed.data as Overlay);
    return { added: true, ...report(ctx.runId) };
  },
};

export const removeOverlay: AgentTool = {
  name: "remove_overlay",
  description: "Removes an overlay by id.",
  parameters: {
    type: "object",
    properties: { overlayId: { type: "string" } },
    required: ["overlayId"],
  },
  async handler(args: { overlayId: string }, ctx) {
    const t = requireTimeline(ctx.runId);
    const before = t.overlays.length;
    t.overlays = t.overlays.filter((o) => o.id !== args.overlayId);
    return { removed: before !== t.overlays.length, ...report(ctx.runId) };
  },
};

export const duckMusic: AgentTool = {
  name: "duck_music_under_voice",
  description:
    "Builds the music automation: down to -18dB under the voice, back up to -9dB in the gaps. Without it the voice is unintelligible and quality control blocks the video.",
  parameters: {
    type: "object",
    properties: {
      duckedGain: { type: "number", description: "0.12 by default (about -18dB)." },
      openGain: { type: "number", description: "0.35 by default (about -9dB)." },
    },
  },
  async handler(args: { duckedGain?: number; openGain?: number }, ctx) {
    const t = requireTimeline(ctx.runId);
    const voice = t.audio.filter((a) => a.bus === "voice");
    const music = t.audio.filter((a) => a.bus === "music");
    if (music.length === 0) return { error: "No music track on the timeline." };

    const segments = voice.map((v) => ({ startMs: v.startMs, durationMs: v.durationMs }));
    for (const m of music) {
      m.automation = segments.length
        ? buildDuckingAutomation(segments, {
            duckedGain: args.duckedGain,
            openGain: args.openGain,
          })
        : [{ atMs: 0, gain: args.openGain ?? 0.35, rampMs: 0 }];
    }
    return { ducked: true, points: music[0]!.automation.length, ...report(ctx.runId) };
  },
};

export const addSoundEffect: AgentTool = {
  name: "add_sound_effect",
  description:
    "Places a sound effect. An impact sound on frame zero is required: more than 50ms of opening silence kills the hook. Real notification sounds are the most effective audio pattern interrupts there are.",
  parameters: {
    type: "object",
    properties: {
      preset: {
        type: "string",
        enum: [
          "whoosh_impact",
          "pop_transition",
          "keyboard_haptic",
          "validation_ding",
          "bell_validate",
          "magic_harp_rise",
          "notification_bip",
          "imessage_send",
          "imessage_receive",
          "vinyl_stop",
          "soft_haptic_click",
        ],
      },
      atMs: { type: "number" },
      gain: { type: "number" },
    },
    required: ["preset", "atMs"],
  },
  async handler(args: { preset: string; atMs: number; gain?: number }, ctx) {
    const t = requireTimeline(ctx.runId);
    t.audio.push({
      id: `sfx_${args.preset}_${Math.round(args.atMs)}`,
      src: `/sfx/${args.preset}.wav`,
      bus: "sfx",
      startMs: args.atMs,
      durationMs: 900,
      sourceInMs: 0,
      gain: args.gain ?? 0.7,
      automation: [],
      loop: false,
      fadeInMs: 0,
      fadeOutMs: 80,
    });
    return { added: true, ...report(ctx.runId) };
  },
};

export const checkTimeline: AgentTool = {
  name: "check_timeline",
  description:
    "Checks the edit: gaps in the video track, overlays outside the safe area, a static hook, stretches with no visual break, music that isn't ducked, unreadable captions, cards held too briefly. Call this before any render. While a blocking error remains, rendering is refused.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const t = requireTimeline(ctx.runId);
    const issues = validateTimeline(t);
    const format = getFormat(t.formatId);

    // Format-specific craft checks that the generic validator cannot express.
    const extra: string[] = [];
    if (format?.family === "TALKING_HEAD") {
      const longHolds = t.video.filter((c) => c.layer === 0 && c.durationMs > 2500);
      if (longHolds.length > 0 && format.id === "FORMAT_26") {
        extra.push(
          `${longHolds.length} shot(s) hold the same framing for more than 2.5s. ${format.id} wants a cut every 1.4s on average — split them and add cutaways.`,
        );
      }
    }
    const cutsPerSecond = t.video.filter((c) => c.layer === 0).length / (t.durationMs / 1000);
    if (cutsPerSecond < 0.12 && t.durationMs > 12000) {
      extra.push(
        `Low edit density: ${cutsPerSecond.toFixed(2)} cuts per second. Short-form wants at least 0.2.`,
      );
    }

    return {
      blocking: hasBlockingIssues(issues),
      errorCount: issues.filter((i) => i.severity === "ERROR").length,
      warningCount: issues.filter((i) => i.severity === "WARNING").length,
      issues,
      craftNotes: extra,
      summary: `${t.video.length} plans, ${t.overlays.length} calques, ${t.audio.length} pistes audio, ${(t.durationMs / 1000).toFixed(1)} s.`,
    };
  },
};

export const describeTimeline: AgentTool = {
  name: "describe_timeline",
  description: "Reads back the edit: every shot with its effects, every overlay, every audio track.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const t = requireTimeline(ctx.runId);
    return {
      durationMs: t.durationMs,
      video: t.video.map((c) => ({
        id: c.id,
        startMs: c.startMs,
        durationMs: c.durationMs,
        layer: c.layer,
        layout: c.layout.mode,
        kind: c.kind,
        effects: c.effects.map((e) => e.type),
        transition: c.transitionIn.type,
        note: c.note,
      })),
      overlays: t.overlays.map((o) => ({
        id: o.id,
        type: o.type,
        startMs: "startMs" in o ? o.startMs : (o.words[0]?.startMs ?? 0),
        y: "anchor" in o ? o.anchor.y : undefined,
      })),
      audio: t.audio.map((a) => ({
        id: a.id,
        bus: a.bus,
        startMs: a.startMs,
        durationMs: a.durationMs,
        automationPoints: a.automation.length,
      })),
      editNotes: t.editNotes,
    };
  },
};

export const setEditNotes: AgentTool = {
  name: "set_edit_notes",
  description:
    "Record your editing choices. This is shown next to the video in the dashboard: say why you cut there, why that rhythm, what you're testing.",
  parameters: {
    type: "object",
    properties: { notes: { type: "string" } },
    required: ["notes"],
  },
  async handler(args: { notes: string }, ctx) {
    requireTimeline(ctx.runId).editNotes = args.notes;
    return { saved: true };
  },
};

export const EDITING_TOOLS: AgentTool[] = [
  buildRoughCut,
  placeCut,
  splitClip,
  addClip,
  applyEffect,
  setTransition,
  addOverlay,
  removeOverlay,
  duckMusic,
  addSoundEffect,
  checkTimeline,
  describeTimeline,
  setEditNotes,
];
