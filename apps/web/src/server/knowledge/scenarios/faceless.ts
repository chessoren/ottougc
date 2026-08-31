import type { Scenario } from "./types";

/**
 * Faceless scenarios — no human face at any point.
 *
 * Three reasons they matter, none cosmetic:
 *
 *   1. They are the insurance. If generated faces degrade, drift or get flagged,
 *      these keep posting.
 *   2. They are the cheapest videos in the catalogue by an order of magnitude,
 *      which is what makes a volume strategy arithmetically possible.
 *   3. They read as a completely different account. Someone who scrolls past a
 *      talking head does not recognise a text-over-video clip as the same thing.
 */
export const FACELESS_SCENARIOS: Scenario[] = [
  {
    id: "S30",
    name: "Text over video",
    slug: "text-over-video",
    family: "FACELESS",
    shape: {
      durationMs: [15000, 25000],
      shotCount: [3, 5],
      face: "NONE",
      speech: "NONE",
      overlay: "STORY_CARDS",
      music: "DRIVES",
      register: "CANDID",
    },
    premise:
      "A first-person story told entirely in text cards, laid over slow uneventful shots that illustrate nothing.",
    productRole: "Named in the second-to-last card, inside a sentence about something else.",
    brandEntry: {
      atRatio: 0.8,
      manner: "One mention in a card, mid-sentence, never at the end of one.",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The hook card",
        purpose: "A first card that opens a loop nobody can leave open.",
        archetype: "OBSERVER",
        durationSeconds: 4,
        direction:
          "A slow, uninteresting shot with nothing happening in it: a ceiling, a window, a road going past.",
        overlayText: "{{hookCard}}",
        lighting: "WINDOW_BACK",
        ambience: "ROOM_QUIET",
        interrupt: "The image says nothing, so all the attention goes to the text.",
      },
      {
        label: "Escalating",
        purpose: "Two or three cards that make the situation worse.",
        archetype: "OBSERVER",
        durationSeconds: 8,
        direction:
          "Slow uneventful shots: a journey, an empty room, a distant screen. The camera move is continuous and lazy.",
        overlayText: "{{bodyCards}}",
        lighting: "STREET_NIGHT",
        ambience: "STREET",
      },
      {
        label: "The turn",
        purpose: "The card where the story changes direction.",
        archetype: "OBSERVER",
        durationSeconds: 5,
        direction: "The shot gets brighter. Still nothing important in frame.",
        overlayText: "{{pivotCard}}",
        lighting: "GOLDEN_WINDOW",
        ambience: "ROOM_QUIET",
      },
      {
        label: "Closing",
        purpose: "Close the loop opened on the first card.",
        archetype: "OBSERVER",
        durationSeconds: 4,
        direction: "Back to something close to the first shot, in different light.",
        overlayText: "{{closingCard}}",
        lighting: "GOLDEN_WINDOW",
        ambience: "ROOM_QUIET",
      },
    ],
    whyItWorks:
      "With no face to read, attention has nowhere to go but the text. Reading is slower than listening, so retention is mechanically higher — as long as the picture never asks for attention.",
    benchmarks: { retention3s: 0.71, completionRate: 0.53, shareRate: 0.026, saveRate: 0.061 },
    estimatedCostUsd: 0.61,
    forbidden: [
      "A picture that illustrates the text",
      "A face, even from behind",
      "A card longer than fourteen words",
      "Music with lyrics",
    ],
    editNotes: [
      "The image has to be boring. An interesting image loses the text.",
      "Each card holds at least 1.6s.",
      "The camera never fully stops moving.",
    ],
  },

  {
    id: "S31",
    name: "Screen only",
    slug: "screen-only",
    family: "FACELESS",
    shape: {
      durationMs: [10000, 18000],
      shotCount: [1, 3],
      face: "NONE",
      speech: "VOICEOVER",
      overlay: "CAPTIONS",
      music: "BED",
      register: "FOUND",
    },
    premise:
      "Nothing but a real screen recording, with someone talking over it the way you would showing a friend on a call.",
    productRole:
      "It is the screen. But this is not a tour — it does one thing, start to finish, and shows nothing else.",
    brandEntry: {
      atRatio: 0.5,
      manner: "Visible from the start. Named once, in passing, never introduced.",
    },
    awarenessFit: ["SOLUTION_AWARE", "PRODUCT_AWARE"],
    ctaLevel: 2,
    beats: [
      {
        label: "Mid-task",
        purpose: "Start with the task already underway. No home page, no login.",
        archetype: "FOUND_FOOTAGE",
        durationSeconds: 4,
        direction:
          "Screen recording, cursor already moving. We are in the middle of something, not at the start.",
        line: "{{midActionLine}}",
        lighting: "SCREEN_GLOW",
        ambience: "ROOM_QUIET",
        interrupt: "No introduction at all — we arrive late to whatever is happening.",
      },
      {
        label: "Waiting",
        purpose: "Do not cut the processing time. It is the only proof this is not faked.",
        archetype: "FOUND_FOOTAGE",
        durationSeconds: 5,
        direction:
          "It is processing. Nothing to do. The cursor moves aimlessly. The commentary continues.",
        line: "{{waitingLine}}",
        lighting: "SCREEN_GLOW",
        ambience: "ROOM_QUIET",
      },
      {
        label: "The result",
        purpose: "Show the whole result, without zooming to a flattering detail.",
        archetype: "FOUND_FOOTAGE",
        durationSeconds: 6,
        direction:
          "The result appears. The cursor moves slowly across it. The parts that are not perfect stay visible.",
        line: "{{resultLine}}",
        lighting: "SCREEN_GLOW",
        ambience: "ROOM_QUIET",
      },
    ],
    whyItWorks:
      "Keeping the wait is counter-intuitive and is exactly what makes the demonstration credible. An advertisement cuts the wait; a person showing a friend does not.",
    benchmarks: { retention3s: 0.64, completionRate: 0.46, shareRate: 0.011, saveRate: 0.072 },
    estimatedCostUsd: 0.29,
    forbidden: [
      "Speeding up the processing time",
      "Showing a home or login screen",
      "Touring the features",
      "Hiding the parts that don't work perfectly",
    ],
    editNotes: [
      "The capture must be real. A reconstruction is blocked by quality control.",
      "Software zoom at 1.15x maximum — past that it stops looking like a recording.",
      "Hand-drawn annotation on the result only, never on the interface.",
    ],
  },

  {
    id: "S32",
    name: "Hands",
    slug: "hands-only",
    family: "FACELESS",
    shape: {
      durationMs: [12000, 20000],
      shotCount: [4, 7],
      face: "NONE",
      speech: "NONE",
      overlay: "NONE",
      music: "DRIVES",
      register: "CANDID",
    },
    premise:
      "Only hands, in tight shots, doing a task start to finish. No words, no text. Rhythm and sound do everything.",
    productRole: "One of the gestures in the run. It is not singled out — it sits with the rest.",
    brandEntry: {
      atRatio: 0.6,
      manner: "It appears in one shot like any other object in the sequence.",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The mess",
        purpose: "Establish the starting state, uncommented.",
        archetype: "INSERT",
        durationSeconds: 4,
        direction: "Overhead on a cluttered table. Hands start sorting.",
        lighting: "WINDOW_SIDE",
        ambience: "ROOM_QUIET",
        interrupt: "The sound of objects being handled is very present.",
      },
      {
        label: "The run",
        purpose: "Three or four short rhythmic gestures, no transitions.",
        archetype: "INSERT",
        durationSeconds: 8,
        direction:
          "A run of tight shots: open, place, type, slide. Each under two seconds.",
        lighting: "WINDOW_SIDE",
        ambience: "ROOM_QUIET",
      },
      {
        label: "Order",
        purpose: "The same frame as the start, in a different state.",
        archetype: "INSERT",
        durationSeconds: 4,
        direction: "Back to the exact opening framing. The table is clear. Hands leave frame.",
        lighting: "WINDOW_SIDE",
        ambience: "ROOM_QUIET",
      },
    ],
    whyItWorks:
      "It satisfies a completion reflex: starting a sequence of gestures and not seeing it finish is uncomfortable. People stay for the tidy frame, not for information.",
    benchmarks: { retention3s: 0.7, completionRate: 0.61, shareRate: 0.018, saveRate: 0.039 },
    estimatedCostUsd: 0.83,
    forbidden: [
      "A face, even partly",
      "Text on screen",
      "A voice",
      "Any shot over two seconds in the middle run",
    ],
    editNotes: [
      "Handling sounds are mixed loud. They carry the format.",
      "Every cut lands on a contact — the hand touching the object.",
      "First and last shots identical in framing.",
    ],
  },

  {
    id: "S33",
    name: "Found footage",
    slug: "found-footage",
    family: "FACELESS",
    shape: {
      durationMs: [8000, 14000],
      shotCount: [1, 2],
      face: "NONE",
      speech: "DIEGETIC",
      overlay: "STATIC_HEADLINE",
      music: "NONE",
      register: "FOUND",
    },
    premise:
      "Footage nobody framed: a security camera, a doorbell, a forgotten video call. We watch because we were not supposed to see it.",
    productRole:
      "What happens in frame is made possible by it, but nothing points at it. The headline suggests without saying.",
    brandEntry: {
      atRatio: 0.9,
      manner: "At most a mention in the headline band, never in the picture or the sound.",
    },
    awarenessFit: ["UNAWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The footage",
        purpose: "One fixed shot with something happening in the background.",
        archetype: "FOUND_FOOTAGE",
        durationSeconds: 10,
        direction:
          "Fixed, badly placed camera. The interesting thing happens in the background, half out of frame. Nobody addresses the camera.",
        overlayText: "{{headline}}",
        lighting: "OFFICE_FLUORESCENT",
        ambience: "OFFICE",
        interrupt: "What matters is partly out of frame, so people have to look for it.",
      },
    ],
    whyItWorks:
      "A badly framed image reads as unintentional, and therefore true. The viewer does the work of understanding, and that effort is a commitment nothing produced can buy.",
    benchmarks: { retention3s: 0.73, completionRate: 0.58, shareRate: 0.033, saveRate: 0.027 },
    estimatedCostUsd: 0.74,
    forbidden: [
      "Centred or corrected framing",
      "Fully visible action",
      "Music",
      "A cutaway",
    ],
    editNotes: [
      "Keep the burnt-in timestamp.",
      "Never recrop. The bad framing is the format.",
      "No cuts. One shot, start to finish.",
    ],
  },
];
