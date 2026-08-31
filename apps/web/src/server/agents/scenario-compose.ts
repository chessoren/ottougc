import "server-only";

import type { Scenario } from "@/server/knowledge/scenarios";
import type { Timeline, Overlay, VideoClip, AudioClip } from "@/server/edit/timeline";

import type { WrittenScenario } from "./scenario-writer";

/**
 * Timeline assembly from a scenario.
 *
 * The scenario's declared shape drives the montage: its overlay mode decides
 * what sits on screen, its music mode decides the mix, its register decides the
 * cutting rhythm. That is why the shape is declared on the scenario rather than
 * inferred from the script — two videos with identical scripts and different
 * shapes must come out looking like different accounts.
 */

export interface ComposeInput {
  timelineId: string;
  scenario: Scenario;
  written: WrittenScenario;
  clips: Array<{ url: string; durationMs: number; beatIndex: number }>;
  musicUrl?: string;
  beatGridMs: number[];
}

const FPS = 60;

export function composeFromScenario(input: ComposeInput): Timeline {
  const { scenario, written, clips } = input;

  const video: VideoClip[] = [];
  const overlays: Overlay[] = [];
  const audio: AudioClip[] = [];

  let cursor = 0;

  for (const [i, beat] of scenario.beats.entries()) {
    const clip = clips.find((c) => c.beatIndex === i);
    if (!clip) continue;

    const w = written.beats[i];
    const durationMs = Math.min(clip.durationMs, beat.durationSeconds * 1000);

    video.push({
      id: `v${i}`,
      src: clip.url,
      kind: "video",
      startMs: cursor,
      durationMs,
      sourceInMs: 0,
      layer: 0,
      layout: { mode: "full" },
      fit: "cover",
      opacity: 1,
      effects: effectsFor(scenario, i),
      transitionIn: transitionFor(scenario, i),
      note: beat.label,
    });

    // Omni renders dialogue with the picture, so a speaking beat needs no voice
    // track — the clip's own audio is the performance.
    if (w?.overlayText) {
      overlays.push(...overlayFor(scenario, w.overlayText, cursor, durationMs, i));
    }

    cursor += durationMs;
  }

  const durationMs = cursor;

  if (input.musicUrl) {
    audio.push({
      id: "music",
      src: input.musicUrl,
      bus: "music",
      startMs: 0,
      durationMs,
      sourceInMs: 0,
      gain: musicGainFor(scenario),
      automation: [],
      loop: true,
      fadeInMs: 220,
      fadeOutMs: scenario.family === "DRAMA" ? 900 : 320,
    });
  }

  return {
    id: input.timelineId,
    formatId: scenario.id,
    fps: FPS,
    width: 1080,
    height: 1920,
    durationMs,
    background: "#000000",
    video,
    overlays,
    audio,
    beatGridMs: input.beatGridMs,
    editNotes: scenario.editNotes.join(" · "),
  };
}

/* ── Overlays ────────────────────────────────────────────────────────────── */

/**
 * The overlay mode is the scenario's signature on screen.
 *
 * A POV line and a set of story cards are not two styles of the same thing: one
 * is a caption on a moment, the other is the narration itself. Rendering them
 * identically would collapse the difference the taxonomy exists to create.
 */
function overlayFor(
  scenario: Scenario,
  text: string,
  startMs: number,
  durationMs: number,
  index: number,
): Overlay[] {
  const id = `o${index}`;

  switch (scenario.shape.overlay) {
    case "POV_LINE":
      return [
        {
          type: "storyCard",
          id,
          text,
          startMs: startMs + 150,
          durationMs: durationMs - 150,
          anchor: { y: 1290, align: "center" },
          enter: "fadeSlide",
          style: {
            fontSize: 52,
            color: "#FFFFFF",
            shadow: true,
            background: "transparent",
            maxWidth: 900,
            align: "center",
          },
        },
      ];

    case "STORY_CARDS": {
      // One card per sentence, spread across the beat: the whole point is that
      // they arrive one thought at a time.
      const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
      const each = durationMs / Math.max(sentences.length, 1);
      return sentences.map((sentence, i) => ({
        type: "storyCard" as const,
        id: `${id}_${i}`,
        text: sentence,
        startMs: startMs + i * each,
        durationMs: each,
        anchor: { y: 700, align: "center" },
        enter: "fadeSlide" as const,
        style: {
          fontSize: 50,
          color: "#FFFFFF",
          shadow: true,
          background: "transparent",
          maxWidth: 880,
          align: "center" as const,
        },
      }));
    }

    case "MEME_BANDS":
      return [
        {
          type: "textBar",
          id,
          text,
          startMs,
          durationMs,
          anchor: { y: index === 0 ? 300 : 1500, align: "center" },
          enter: "none",
          style: {
            background: "#FFFFFF",
            color: "#000000",
            fontSize: 44,
            fontWeight: 800,
            uppercase: false,
            radius: 6,
            paddingX: 22,
            paddingY: 12,
            maxWidth: 940,
            shadow: false,
          },
        },
      ];

    case "STATIC_HEADLINE":
      return [
        {
          type: "textBar",
          id,
          text,
          startMs: 0,
          durationMs: 999_999,
          anchor: { y: 340, align: "center" },
          enter: "none",
          style: {
            background: "rgba(0,0,0,0.72)",
            color: "#FFFFFF",
            fontSize: 40,
            fontWeight: 700,
            uppercase: false,
            radius: 10,
            paddingX: 20,
            paddingY: 12,
            maxWidth: 900,
            shadow: false,
          },
        },
      ];

    case "SUBTITLES":
      return [
        {
          type: "storyCard",
          id,
          text,
          startMs,
          durationMs,
          anchor: { y: 1560, align: "center" },
          enter: "none",
          style: {
            fontSize: 42,
            color: "#FFFFFF",
            shadow: true,
            background: "transparent",
            maxWidth: 960,
            align: "center",
          },
        },
      ];

    case "CHAT":
      return [
        {
          type: "chatBubble",
          id,
          side: index % 2 === 0 ? "incoming" : "outgoing",
          text,
          startMs: startMs + 200,
          durationMs: durationMs - 200,
          typingMs: 700,
        },
      ];

    case "CAPTIONS":
      // Word-level captions are laid down by the editor from the audio track,
      // not from a beat's overlay text.
      return [];

    default:
      return [];
  }
}

/* ── Rhythm ──────────────────────────────────────────────────────────────── */

/**
 * Effects per beat.
 *
 * Drama is the one family that gets long, still shots — everything else needs
 * constant micro-movement, because a static frame on a recommendation feed reads
 * as a stalled video and gets scrolled.
 */
function effectsFor(scenario: Scenario, index: number): VideoClip["effects"] {
  if (scenario.family === "DRAMA") {
    return [
      {
        type: "kenBurns",
        fromScale: 1.0,
        toScale: 1.05,
        fromX: 0,
        toX: 0,
        fromY: 0,
        toY: -6,
        easing: "linear",
      },
    ];
  }

  const effects: VideoClip["effects"] = [
    {
      type: "kenBurns",
      fromScale: index === 0 ? 1.12 : 1.02,
      toScale: index === 0 ? 1.02 : 1.08,
      fromX: 0,
      toX: index % 2 === 0 ? 10 : -10,
      fromY: 0,
      toY: -8,
      easing: index === 0 ? "easeOut" : "linear",
    },
  ];

  // A punch on the first beat of a micro scenario: it is the only beat there is.
  if (scenario.family === "MICRO" && index === 0) {
    effects.push({ type: "punchIn", atMs: 900, scale: 1.14, attackMs: 110, holdMs: 340, releaseMs: 180 });
  }

  return effects;
}

function transitionFor(scenario: Scenario, index: number): VideoClip["transitionIn"] {
  if (index === 0) return { type: "cut", durationMs: 0, direction: "left" };
  if (scenario.family === "DRAMA") return { type: "fade", durationMs: 260, direction: "left" };
  if (scenario.family === "MICRO") return { type: "cut", durationMs: 0, direction: "left" };
  return { type: "whipPan", durationMs: 130, direction: index % 2 === 0 ? "left" : "right" };
}

/**
 * Music level.
 *
 * When the music carries the video it sits forward; when there is dialogue it
 * sits well under. Omni renders speech into the clip itself, so there is no
 * separate voice bus to duck against — the level has to be right at the mix.
 */
function musicGainFor(scenario: Scenario): number {
  if (scenario.shape.music === "DRIVES") return 0.62;
  if (scenario.shape.speech === "NONE") return 0.5;
  return 0.16;
}
