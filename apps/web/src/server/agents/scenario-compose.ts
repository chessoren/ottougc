import "server-only";

import type { Scenario } from "@/server/knowledge/scenarios";
import type { Timeline, Overlay, VideoClip, AudioClip } from "@/server/edit/timeline";
import type { ClipTranscript } from "@/server/media/captions";

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
  clips: Array<{
    url: string;
    durationMs: number;
    beatIndex: number;
    /** Word timings read back off the clip's own audio. Drives the captions. */
    transcript?: ClipTranscript;
  }>;
  musicUrl?: string;
  beatGridMs: number[];
  /** The banner that carries the hook through the opening seconds. */
  hookText?: string;
}

const FPS = 60;

/**
 * Caption geometry, from what actually performs on a 1080x1920 feed.
 *
 * 64-88px is the readable band on a phone; below that the text is decoration.
 * Three words a block keeps the eye moving with the speech instead of asking it
 * to read a paragraph. The vertical anchor clears the platform's own bottom UI —
 * the like column and the title sit in the lowest ~15%, and a caption under them
 * is a caption nobody reads.
 */
const CAPTION_STYLE = {
  fontSize: 76,
  color: "#FFFFFF",
  highlight: "#FFE600",
  strokeWidth: 14,
  strokeColor: "#000000",
  uppercase: true,
} as const;

const CAPTION_ANCHOR_Y = 1180;

export function composeFromScenario(input: ComposeInput): Timeline {
  const { scenario, written, clips } = input;

  const video: VideoClip[] = [];
  const overlays: Overlay[] = [];
  const audio: AudioClip[] = [];

  let cursor = 0;
  const speaking: Array<{ startMs: number; endMs: number }> = [];

  for (const [i, beat] of scenario.beats.entries()) {
    const clip = clips.find((c) => c.beatIndex === i);
    if (!clip) continue;

    const w = written.beats[i];
    // The clip's real length, minus the last frame.
    //
    // Two lessons, both learned the hard way. Clamping to the scenario's
    // declared duration truncated the footage — an eight second take cut at
    // five, mid-word, with the captions still running. And landing exactly on
    // the final frame asks the renderer for a frame that may not be there, and
    // it answers by holding the previous one: a visible stall at every cut.
    //
    // So: whatever was generated is what gets cut, less one frame of margin.
    const durationMs = Math.max(500, clip.durationMs - Math.round(1000 / FPS));

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
      audioGain: clipGainFor(scenario, Boolean(w?.line)),
      effects: effectsFor(scenario, i),
      transitionIn: transitionFor(scenario, i),
      note: beat.label,
    });

    // Omni renders dialogue with the picture, so a speaking beat needs no voice
    // track — the clip's own audio is the performance.
    if (w?.overlayText) {
      overlays.push(...overlayFor(scenario, w.overlayText, cursor, durationMs, i));
    }

    // Captions come from the clip's own audio, offset onto the timeline.
    //
    // Every speaking beat gets them, whatever the scenario's overlay signature,
    // because most of the feed is watched with the sound off: without captions
    // the line is simply not delivered. The exception is a mode that already
    // fills the screen with its own text, where a second text layer would be
    // two things competing for the same eye.
    const captions = captionOverlayFor(scenario, clip.transcript, cursor, durationMs, i);
    if (captions) overlays.push(captions);

    if (w?.line) speaking.push({ startMs: cursor, endMs: cursor + durationMs });

    cursor += durationMs;
  }

  const durationMs = cursor;

  // The hook banner.
  //
  // Roughly half the people who leave a Short leave inside three seconds, and
  // most of them never hear a word of it. The banner is the only part of the
  // hook that is guaranteed to be delivered, so it is placed by the compositor
  // rather than left to whether the writer happened to fill in an overlay.
  const hook = hookBannerFor(scenario, input.hookText, overlays);
  if (hook) overlays.unshift(hook);

  // Room tone, under everything, always.
  //
  // Omni's clip audio stops when the speech stops. A shot held past its last
  // word therefore falls to digital silence, and a scenario whose shape declares
  // `music: NONE` has nothing under it at all — a rendered video measured -90
  // dBFS across five seconds in the middle of a sentence and four more at the
  // end. That is not "quiet", it is an absence, and it is the fastest way to
  // tell a viewer that a video was assembled rather than filmed.
  audio.push({
    id: "roomtone",
    src: "/sfx/room_tone.wav",
    bus: "sfx",
    startMs: 0,
    durationMs,
    sourceInMs: 0,
    // The floor sits far below the voice. It is meant to be noticed only by its
    // absence, and anything louder starts sounding like tape hiss.
    gain: 0.75,
    automation: [],
    loop: true,
    fadeInMs: 400,
    fadeOutMs: 700,
  });

  if (input.musicUrl) {
    audio.push({
      id: "music",
      src: input.musicUrl,
      bus: "music",
      startMs: 0,
      durationMs,
      sourceInMs: 0,
      gain: musicGainFor(scenario),
      automation: musicDucking(scenario, speaking, musicGainFor(scenario)),
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

/* ── Sound ───────────────────────────────────────────────────────────────── */

/**
 * How loud a clip's own audio sits in the mix.
 *
 * Omni renders speech with the picture, so for anything shot in sync the clip
 * *is* the soundtrack. Getting this wrong is not subtle: the renderer used to
 * mute every clip unconditionally, and the first finished videos played a music
 * bed over a woman visibly talking and completely inaudible.
 */
function clipGainFor(scenario: Scenario, beatHasLine: boolean): number {
  switch (scenario.shape.speech) {
    case "SYNC":
      // The performance, at unity and no higher.
      //
      // Pushing this to 1.35 to "give the voice presence" is digital gain on an
      // already-mastered clip: it does not add clarity, it adds distortion on
      // every peak. Presence comes from everything else being quieter, which is
      // what the room tone level and the ducking envelope are for.
      return beatHasLine ? 1 : 0.55;
    case "DIEGETIC":
      // Overheard dialogue: still the point, but the scene is not addressed to
      // the camera, so it sits slightly back.
      return beatHasLine ? 0.92 : 0.55;
    case "VOICEOVER":
      // A bed under the narration — room tone, not words.
      return 0.14;
    default:
      // Silent scenarios keep a little ambience: complete silence under a music
      // track is the most reliable tell that a clip was generated.
      return 0.28;
  }
}

/**
 * Duck the music under every shot that carries speech.
 *
 * A ramp rather than a step: an instant 12 dB drop is audible as a click and
 * reads as a machine doing the mix.
 */
function musicDucking(
  scenario: Scenario,
  speaking: Array<{ startMs: number; endMs: number }>,
  base: number,
): Array<{ atMs: number; rampMs: number; gain: number }> {
  if (speaking.length === 0) return [];
  const under = Math.min(base, scenario.family === "DRAMA" ? 0.2 : 0.13);
  const points: Array<{ atMs: number; rampMs: number; gain: number }> = [
    { atMs: 0, rampMs: 0, gain: base },
  ];

  for (const window of speaking) {
    points.push({ atMs: Math.max(0, window.startMs - 260), rampMs: 0, gain: base });
    points.push({ atMs: window.startMs, rampMs: 240, gain: under });
    points.push({ atMs: window.endMs, rampMs: 0, gain: under });
    points.push({ atMs: window.endMs + 380, rampMs: 360, gain: base });
  }

  return points.sort((a, b) => a.atMs - b.atMs);
}

/* ── Captions ────────────────────────────────────────────────────────────── */

/**
 * Overlay modes that already own the screen with their own text.
 *
 * Story cards *are* the narration, meme bands *are* the joke, and a chat thread
 * is the whole scene. Stacking word-level captions on top of any of them puts
 * two texts in one frame and the viewer reads neither.
 */
const TEXT_HEAVY_MODES = new Set(["STORY_CARDS", "MEME_BANDS", "CHAT"]);

function captionOverlayFor(
  scenario: Scenario,
  transcript: ClipTranscript | undefined,
  startMs: number,
  durationMs: number,
  index: number,
): Overlay | null {
  if (!transcript || transcript.words.length === 0) return null;
  if (TEXT_HEAVY_MODES.has(scenario.shape.overlay)) return null;

  // Shift the clip-relative timings onto the timeline, and drop anything that
  // runs past the cut — a caption outliving its shot is the classic tell of an
  // automated edit.
  const words = transcript.words
    .filter((w) => w.startMs < durationMs)
    .map((w) => ({
      word: w.word,
      startMs: startMs + w.startMs,
      endMs: startMs + Math.min(w.endMs, durationMs),
      emphasis: w.emphasis ?? false,
    }));

  if (words.length === 0) return null;

  // Subtitles are a calmer register than captions: same mechanism, four words at
  // a time instead of three, no colour shift, and lower in the frame.
  const subtitleRegister = scenario.shape.overlay === "SUBTITLES";

  return {
    type: "captions",
    id: `cap${index}`,
    words,
    anchor: { y: subtitleRegister ? CAPTION_ANCHOR_Y + 180 : CAPTION_ANCHOR_Y, align: "center" },
    wordsPerBlock: subtitleRegister ? 4 : 3,
    style: {
      ...CAPTION_STYLE,
      fontSize: subtitleRegister ? 60 : CAPTION_STYLE.fontSize,
      highlight: subtitleRegister ? CAPTION_STYLE.color : CAPTION_STYLE.highlight,
      uppercase: !subtitleRegister,
    },
  };
}

/**
 * The banner that carries the hook while the viewer decides.
 *
 * Held for the opening beat only. Past three seconds it stops being a hook and
 * starts being furniture, and it competes with the captions underneath it.
 */
function hookBannerFor(
  scenario: Scenario,
  hookText: string | undefined,
  existing: Overlay[],
): Overlay | null {
  const text = hookText?.trim();
  if (!text) return null;

  // A mode that already puts a permanent headline on screen has said it once;
  // saying it twice is worse than not saying it at all.
  if (scenario.shape.overlay === "STATIC_HEADLINE" || scenario.shape.overlay === "MEME_BANDS") {
    return null;
  }
  // Captions have no `startMs` of their own, so guard the property access
  // rather than assuming every overlay is time-anchored.
  const topIsTaken = existing.some(
    (o) => "startMs" in o && o.startMs < 2600 && "anchor" in o && (o.anchor?.y ?? 9999) < 900,
  );
  if (topIsTaken) return null;

  return {
    type: "textBar",
    id: "hook",
    text,
    startMs: 120,
    durationMs: 2600,
    anchor: { y: 430, align: "center" },
    enter: "pop",
    style: {
      background: "rgba(0,0,0,0.78)",
      color: "#FFFFFF",
      fontSize: 62,
      fontWeight: 800,
      uppercase: false,
      radius: 14,
      paddingX: 30,
      paddingY: 18,
      maxWidth: 900,
      shadow: true,
    },
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
      // Handled by `captionOverlayFor`, which reads the timings off the clip's
      // own audio rather than off the beat's overlay text. A beat's text is what
      // we asked for; the captions have to match what was actually said.
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
