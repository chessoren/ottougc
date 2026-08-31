/**
 * Retention mechanics — DOC-003, DOC-006, DOC-009, DOC-010, DOC-015.
 *
 * This module is what turns a script into something that survives the feed. The
 * scriptwriter must place a pattern interrupt at every interval below, and the
 * QA agent rejects any timeline that leaves a gap longer than the format allows.
 */

/** Algorithmic checkpoints. Falling below the floor caps distribution. */
export const RETENTION_CHECKPOINTS = [
  {
    atMs: 3000,
    name: "Filtre du pouce",
    floor: 0.45,
    consequence: "Under 45% at three seconds, the video is capped in the 300-500 view bucket.",
  },
  {
    atMs: 5000,
    name: "Interest filter",
    floor: 0.4,
    consequence:
      "A drop of more than 15 points between three and five seconds marks the hook as misleading and stops the recommendation.",
  },
  {
    atMs: 10000,
    name: "Filtre d'engagement",
    floor: 0.28,
    consequence: "You need 28-35% still watching at ten seconds to get past ten thousand views.",
  },
];

/** The reference curve a good video follows. Used to diagnose drop-offs. */
export const TARGET_RETENTION_CURVE = [
  { atMs: 0, ratio: 1.0 },
  { atMs: 3000, ratio: 0.72 },
  { atMs: 5000, ratio: 0.64 },
  { atMs: 10000, ratio: 0.52 },
  { atMs: 15000, ratio: 0.44 },
];

export interface PatternInterrupt {
  id: string;
  name: string;
  effect: string;
  implementation: string;
  /** Which layer of the render applies it. */
  layer: "VIDEO" | "AUDIO" | "OVERLAY";
}

export const PATTERN_INTERRUPTS: PatternInterrupt[] = [
  {
    id: "SNAP_ZOOM",
    name: "Snap zoom in/out",
    effect: "A scale break on one key syllable, back to the original framing 600ms later.",
    implementation: "scale 1.0 → 1.22 en 120 ms, maintien 480 ms, retour en 200 ms.",
    layer: "VIDEO",
  },
  {
    id: "GLITCH_JOLT",
    name: "Glitch subliminal",
    effect: "Resets the attention reflex without breaking comprehension.",
    implementation: "One frame inverted or CRT-scanned, plus 40ms of white noise.",
    layer: "VIDEO",
  },
  {
    id: "WHIP_PAN",
    name: "Whip-pan",
    effect: "Simulates an operator turning sharply toward another screen.",
    implementation: "Flou directionnel horizontal 180 px sur 8 frames, coupe au milieu.",
    layer: "VIDEO",
  },
  {
    id: "REAL_LIFE_AUDIO",
    name: "A real notification sound",
    effect:
      "A Slack ping, a phone ring, a message ding: the brain has to check whether the sound came from its own room.",
    implementation: "Effect at -6dB, no reverb, outside the music.",
    layer: "AUDIO",
  },
  {
    id: "MUSIC_DROP",
    name: "Suppression brutale de la musique",
    effect: "400ms of silence on a hard line. The silence creates a tension people cannot sit with.",
    implementation: "Gain musique → 0 en 20 ms, maintien 400 ms, retour en 120 ms.",
    layer: "AUDIO",
  },
  {
    id: "ARROW_STICKER",
    name: "Hand-drawn annotation",
    effect: "A hand-drawn circle or a blinking red arrow on one detail of the interface.",
    implementation: "Animated inside the safe area, three blinks at 4Hz.",
    layer: "OVERLAY",
  },
  {
    id: "FORMAT_SWITCH",
    name: "Switch de format visuel",
    effect: "Full frame to a 50/50 split to a picture-in-picture inset.",
    implementation: "Transition en 180 ms avec easing out-quint.",
    layer: "VIDEO",
  },
  {
    id: "HECKLER_CUT",
    name: "Interruption par un second avatar",
    effect: "A second face appears for 0.8s (\"wait, that can't be right\").",
    implementation: "Full-frame insert for 800ms, hard cut either side.",
    layer: "VIDEO",
  },
];

/** How many interrupts a video needs, and roughly where. */
export function interruptSchedule(durationMs: number): number[] {
  if (durationMs <= 12000) return [2500, 5800, 8500];
  if (durationMs <= 18000) return [2200, 5000, 8200, 11500, 14000];
  const marks: number[] = [];
  for (let t = 2500; t < durationMs - 2000; t += 3000) marks.push(t);
  return marks;
}

/**
 * Safe zones for a 1080×1920 vertical frame.
 * Anything placed in a danger zone is covered by platform chrome and is, for the
 * viewer, simply not there.
 */
export const SAFE_ZONES = {
  frame: { width: 1080, height: 1920 },
  danger: {
    top: { y0: 0, y1: 220, reason: "Header / bandeau live" },
    right: { x0: 920, x1: 1080, reason: "Profil, like, partage, son" },
    bottom: { y0: 1450, y1: 1920, reason: "Caption, sound, progress bar" },
  },
  optimal: { y0: 300, y1: 1400 },
  anchors: {
    /** Hook banner, upper median. */
    hook: { y: 450, align: "center" as const },
    /** Word-by-word captions, screen centre. */
    captions: { y: 980, align: "center" as const },
    /** Screencast annotations, lower safe edge. */
    annotations: { y: 1250, align: "left" as const },
  },
};

/** Kinetic caption rules (DOC-006). */
export const CAPTION_RULES = {
  wordsPerBlock: [1, 3] as [number, number],
  fontFamily: "Montserrat ExtraBold, Inter, sans-serif",
  fontSizePx: 64,
  strokeWidthPx: 12,
  strokeColor: "#000000",
  color: "#FFFFFF",
  highlightColor: "#FFE600",
  altHighlightColor: "#00FF66",
  /** Entry animation, phoneme-aligned. */
  enter: { scaleFrom: 0.8, scaleOvershoot: 1.15, scaleTo: 1.0, durationMs: 100 },
  uppercase: true,
} as const;

/** Loop architectures that push completion rate above 100% (DOC-010). */
export const LOOP_ARCHITECTURES = [
  {
    id: "SYNTACTIC_CIRCLE",
    name: "Phrase circulaire",
    rule: "The last sentence has to join grammatically onto the first.",
    example:
      "End: \"and if you want to know how I did it…\" → Start: \"watch this screen.\"",
  },
  {
    id: "ACTION_LOOP",
    name: "Boucle visuelle d'action",
    rule: "The last shot shows the click whose result the first shot shows.",
    example: "End: a click on Generate. Start: the sound of that click and the result appearing.",
  },
  {
    id: "FRACTAL_ZOOM",
    name: "Zoom match",
    rule: "An extreme zoom into one pixel at the end, zooming out from that same pixel at the start.",
    example: "End: zoom into the button. Start: pull back from the button to the face.",
  },
];

/** Mid-roll relaunch lines that prevent the 5s and 9s drop-offs (DOC-015). */
export const MIDROLL_HOOKS = [
  { atMs: 5000, line: "But that's not even the worst part…" },
  { atMs: 9000, line: "Watch what happens when I press this…" },
  { atMs: 11000, line: "And here's where almost everyone gets it wrong…" },
];

/**
 * CTA ladder (DOC-009). The mix is enforced fleet-wide, not per video: an
 * account that closes every video with "link in bio" trains its audience to
 * scroll past it.
 */
export const CTA_LADDER = [
  {
    level: 0 as const,
    name: "CTA inconscient",
    line: "I've put the template in the usual place.",
    purpose: "Drives people to the profile without asking for anything.",
    fleetShare: 0.4,
  },
  {
    level: 1 as const,
    name: "CTA de sauvegarde",
    line: "Save this to try tonight.",
    purpose: "Triggers a save, which counts about seven times a like.",
    fleetShare: 0.3,
  },
  {
    level: 2 as const,
    name: "Trigger word",
    line: "Comment ACCESS and I'll send you the method.",
    purpose: "Generates the comment volume that pushes the video out.",
    fleetShare: 0.2,
  },
  {
    level: 3 as const,
    name: "Direct close",
    line: "It's still free while they're in beta, link is pinned on my profile.",
    purpose: "Direct conversion. 3.5-7.2% profile clicks.",
    fleetShare: 0.1,
  },
];

/** Interaction weights the algorithm applies (DOC-037). Drives our own scoring. */
export const SIGNAL_WEIGHTS = {
  share: 10,
  save: 7,
  completion: 6,
  comment: 4,
  like: 1,
} as const;

/** Publishing windows in the audience's local time (DOC-040). */
export const PUBLISH_WINDOWS = [
  { label: "Lunch break", from: "11:45", to: "13:15", weight: 0.25 },
  { label: "Sortie de bureau", from: "17:30", to: "19:30", weight: 0.45 },
  { label: "Session nocturne", from: "21:30", to: "23:00", weight: 0.3 },
];

/** Two posts on one channel must never be closer than this. */
export const MIN_SPACING_MS = 4 * 60 * 60 * 1000;
