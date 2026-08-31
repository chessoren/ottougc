/**
 * The timeline schema, mirrored from the web app.
 *
 * Duplicated on purpose rather than imported across the workspace boundary: the
 * Remotion bundle must stay free of server-only code (database drivers, Google
 * SDKs), and this file is the contract between the two. It is validated on the
 * server before a render is ever queued, so this copy only needs the types.
 */

export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export type Easing = "linear" | "easeOut" | "easeInOut" | "spring";

export type Effect =
  | { type: "kenBurns"; fromScale: number; toScale: number; fromX: number; toX: number; fromY: number; toY: number; easing: Easing }
  | { type: "punchIn"; atMs: number; scale: number; attackMs: number; holdMs: number; releaseMs: number }
  | { type: "glitch"; atMs: number; frames: number; style: "invert" | "crt" | "rgbSplit" }
  | { type: "shake"; amplitudePx: number; frequencyHz: number }
  | { type: "speed"; rate: number; rampMs: number }
  | { type: "freeze"; atMs: number; durationMs: number }
  | { type: "color"; saturation: number; contrast: number; brightness: number; hueRotate: number; grain: number; blurPx: number };

export type Layout =
  | { mode: "full" }
  | { mode: "splitH"; share: number; position: "top" | "bottom" }
  | { mode: "pip"; x: number; y: number; size: number; shape: "circle" | "rounded" }
  | { mode: "cutout"; anchor: "bottomLeft" | "bottomRight" | "bottomCenter"; scale: number };

export interface VideoClip {
  id: string;
  src: string;
  kind: "video" | "image" | "screencast" | "color";
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  layer: number;
  layout: Layout;
  fit: "cover" | "contain";
  effects: Effect[];
  transitionIn: {
    type: "cut" | "whipPan" | "wipe" | "slide" | "fade" | "zoomBlur";
    durationMs: number;
    direction: "left" | "right" | "up" | "down";
  };
  opacity: number;
  /**
   * Volume of the clip's own audio, 0 to 2.
   *
   * Omni renders the dialogue inside the clip, so for a talking shot this is the
   * whole soundtrack. Mirrors `videoClipSchema.audioGain` in the web app.
   */
  audioGain: number;
  note?: string;
}

export interface Anchor {
  y: number;
  align: "left" | "center" | "right";
  x?: number;
}

export type Overlay =
  | {
      type: "textBar";
      id: string;
      text: string;
      startMs: number;
      durationMs: number;
      anchor: Anchor;
      style: {
        background: string; color: string; fontSize: number; fontWeight: number;
        uppercase: boolean; radius: number; paddingX: number; paddingY: number;
        maxWidth: number; shadow: boolean;
      };
      enter: "none" | "pop" | "slideUp";
    }
  | {
      type: "captions";
      id: string;
      words: Array<{ word: string; startMs: number; endMs: number; emphasis: boolean }>;
      anchor: Anchor;
      wordsPerBlock: number;
      style: {
        fontSize: number; color: string; highlight: string;
        strokeWidth: number; strokeColor: string; uppercase: boolean;
      };
    }
  | {
      type: "annotation";
      id: string;
      shape: "circle" | "arrow" | "underline" | "box";
      x: number; y: number; width: number; height: number; rotation: number;
      color: string; startMs: number; durationMs: number; label?: string;
    }
  | {
      type: "timer";
      id: string;
      mode: "countdown" | "stopwatch";
      fromMs: number; startMs: number; durationMs: number;
      anchor: Anchor; urgentBelowMs: number; freezeAtEnd: boolean;
    }
  | {
      type: "stepBadge";
      id: string; index: number; label?: string;
      startMs: number; durationMs: number; checkAtMs?: number; anchor: Anchor;
    }
  | {
      type: "commentCard";
      id: string; author: string; text: string; likes: number;
      startMs: number; durationMs: number; anchor: Anchor;
    }
  | {
      type: "chatBubble";
      id: string; side: "incoming" | "outgoing"; text: string;
      startMs: number; durationMs: number; typingMs: number; imageSrc?: string;
    }
  | {
      type: "storyCard";
      id: string; text: string; startMs: number; durationMs: number; anchor: Anchor;
      style: {
        fontSize: number; color: string; shadow: boolean;
        background: string; maxWidth: number; align: "left" | "center";
      };
      enter: "fadeSlide" | "none" | "typewriter";
    };

export interface AudioClip {
  id: string;
  src: string;
  bus: "voice" | "music" | "sfx";
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  gain: number;
  automation: Array<{ atMs: number; gain: number; rampMs: number }>;
  loop: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface Timeline {
  id: string;
  formatId: string;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  background: string;
  video: VideoClip[];
  overlays: Overlay[];
  audio: AudioClip[];
  beatGridMs: number[];
  editNotes?: string;
}

export const EMPTY_TIMELINE: Timeline = {
  id: "empty",
  formatId: "FORMAT_21",
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  durationMs: 15000,
  background: "#000000",
  video: [],
  overlays: [],
  audio: [],
  beatGridMs: [],
};
