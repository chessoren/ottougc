import type { Scenario } from "./types";

/**
 * Micro scenarios — four to nine seconds.
 *
 * These exist because a fleet that only publishes fifteen-second talking heads
 * has one shape, and one shape exhausts itself on a recommendation feed within
 * days. A four-second clip with a single reaction, one line of text and a piece
 * of music is a structurally different object: it loops, it costs almost
 * nothing, and it is watched to completion by definition.
 *
 * None of them explain anything. That is the point.
 */
export const MICRO_SCENARIOS: Scenario[] = [
  {
    id: "S01",
    name: "POV — the four-second reaction",
    slug: "pov-reaction",
    family: "MICRO",
    shape: {
      durationMs: [4000, 5000],
      shotCount: [1, 1],
      face: "ONE",
      speech: "NONE",
      overlay: "POV_LINE",
      music: "DRIVES",
      register: "CANDID",
    },
    premise:
      "One line of text names a situation your customer lives every week. A face reacts to it, without a word. That is the whole video.",
    productRole:
      "It does not appear. This one exists to make someone think 'that is literally me' and follow the account.",
    brandEntry: { atRatio: 1, manner: "Never. Not in the shot, not in the text." },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The reaction",
        purpose:
          "Land one exact expression against one exact situation. Nothing else happens.",
        archetype: "SELFIE_REACTION",
        durationSeconds: 4,
        direction:
          "{{persona}} looks into the lens, still for a second, then the face slowly falls as what the situation means lands. No speech, no big gestures.",
        overlayText: "POV: {{situation}}",
        lighting: "LAMP_WARM",
        performance: "DEFLATING",
        ambience: "NONE",
        interrupt: "The gap between how still the shot is and how heavy the line is.",
      },
    ],
    whyItWorks:
      "Four seconds is shorter than the time it takes to decide to scroll. It loops before the decision is made, which raises retention and views-per-viewer mechanically rather than persuasively.",
    benchmarks: { retention3s: 0.88, completionRate: 0.72, shareRate: 0.031, saveRate: 0.048 },
    estimatedCostUsd: 0.46,
    forbidden: [
      "Any speech",
      "Any mention of the product",
      "More than twelve words of text",
      "An exaggerated thumbnail expression",
    ],
    editNotes: [
      "Hard cut, no fade — the loop has to be invisible.",
      "Text appears at 0.15s, not 0s: the eye should land on the face first.",
      "Music enters mid-bar, never on a downbeat.",
    ],
  },

  {
    id: "S02",
    name: "The silent stare",
    slug: "silent-stare",
    family: "MICRO",
    shape: {
      durationMs: [5000, 7000],
      shotCount: [1, 1],
      face: "ONE",
      speech: "NONE",
      overlay: "STORY_CARDS",
      music: "DRIVES",
      register: "CANDID",
    },
    premise:
      "The face does not move. The text does — line by line above it, each one making the last one worse.",
    productRole:
      "The last card can be the product name, small, with no comment. Or nothing at all.",
    brandEntry: {
      atRatio: 0.85,
      manner: "At most the name alone on the final card, small, with no verb. Never a logo.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The stare",
        purpose:
          "Hold a still frame while the text does the work. The lack of reaction is the reaction.",
        archetype: "SELFIE_REACTION",
        durationSeconds: 6,
        direction:
          "{{persona}} stares into the lens without moving, blinks twice. A small movement of the jaw at the end, nothing more.",
        overlayText: "{{escalation}}",
        lighting: "SCREEN_GLOW",
        performance: "DEADPAN",
        ambience: "ROOM_QUIET",
        interrupt: "Held stillness becomes uncomfortable, and discomfort holds attention.",
      },
    ],
    whyItWorks:
      "A face that will not react forces the viewer to read to understand. Reading is active, and it lasts until the final card.",
    benchmarks: { retention3s: 0.81, completionRate: 0.64, shareRate: 0.026, saveRate: 0.052 },
    estimatedCostUsd: 0.64,
    forbidden: [
      "Smiling at the camera",
      "More than four cards",
      "A card longer than eight words",
      "An exclamation mark",
    ],
    editNotes: [
      "Cards fade in over 180ms, never pop.",
      "Each card holds at least 1.2s or it will not be read.",
      "Music lifts one step on the last card.",
    ],
  },

  {
    id: "S03",
    name: "Setup and punchline",
    slug: "gesture-punchline",
    family: "MICRO",
    shape: {
      durationMs: [5000, 8000],
      shotCount: [2, 2],
      face: "ONE",
      speech: "SYNC",
      overlay: "MEME_BANDS",
      music: "PUNCTUATES",
      register: "STAGED",
    },
    premise:
      "A band at the top states a situation, a band at the bottom states the expected answer. The person does the opposite.",
    productRole:
      "It is what makes the opposite possible. On screen for half a second, never said out loud.",
    brandEntry: { atRatio: 0.7, manner: "Half a second on screen, unremarked." },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The setup",
        purpose: "State an expectation everybody shares.",
        archetype: "SELFIE_TALK",
        durationSeconds: 3,
        direction:
          "{{persona}} starts explaining {{task}} as if it were obvious, hand already moving.",
        line: "Normally {{task}} eats your whole evening, so—",
        overlayText: "{{setup}}",
        lighting: "KITCHEN_OVERHEAD",
        performance: "MID_SENTENCE",
        ambience: "KITCHEN",
      },
      {
        label: "The punchline",
        purpose: "Break the expectation in one shot, without explaining.",
        archetype: "INSERT",
        durationSeconds: 3,
        direction:
          "Hard cut to hands and a screen. It is already done. A number is visible.",
        overlayText: "{{payoff}}",
        lighting: "SCREEN_GLOW",
        ambience: "NONE",
        interrupt: "The cut lands before the sentence finishes — the expectation is severed, not resolved.",
      },
    ],
    whyItWorks:
      "Setup and break is the oldest structure in short-form. It works because the viewer finishes the severed sentence themselves, and a sentence you finish yourself is one you remember.",
    benchmarks: { retention3s: 0.79, completionRate: 0.68, shareRate: 0.022, saveRate: 0.041 },
    estimatedCostUsd: 0.72,
    forbidden: [
      "Finishing the first sentence",
      "Explaining the punchline",
      "Saying the product name out loud",
    ],
    editNotes: [
      "The cut lands mid-word, not at the end of one.",
      "The impact sound sits on the first frame of the second shot, not before it.",
      "Meme bands never move. They are placed, not animated.",
    ],
  },

  {
    id: "S04",
    name: "The morning after",
    slug: "the-morning-after",
    family: "MICRO",
    shape: {
      durationMs: [6000, 8000],
      shotCount: [2, 3],
      face: "ONE",
      speech: "NONE",
      overlay: "POV_LINE",
      music: "DRIVES",
      register: "CANDID",
    },
    premise:
      "The event is never shown. Only somebody's state immediately afterwards, with the text saying what just happened.",
    productRole:
      "The text names it as the cause of that state — once, in passing, without showing it.",
    brandEntry: {
      atRatio: 0.6,
      manner: "Named in the text as a detail of the story, never shown on screen.",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The state",
        purpose: "Show a consequence and never its cause.",
        archetype: "SELFIE_REACTION",
        durationSeconds: 4,
        direction:
          "{{persona}} is sitting on the floor against a wall, wrung out but relieved. Looking past the lens, not into it.",
        overlayText: "POV: {{aftermath}}",
        lighting: "WINDOW_BACK",
        performance: "RELIEVED",
        ambience: "ROOM_QUIET",
      },
      {
        label: "The detail",
        purpose: "One object that tells the story better than a shot of the event would.",
        archetype: "INSERT",
        durationSeconds: 3,
        direction:
          "Insert on something lying around that proves what happened: a scribbled-out notebook, a cold mug, a screen still on.",
        lighting: "WINDOW_SIDE",
        ambience: "ROOM_QUIET",
        interrupt: "The viewer reconstructs the story from one object.",
      },
    ],
    whyItWorks:
      "Showing the aftermath instead of the event forces the viewer to imagine the event. What they imagine is always stronger than what could have been filmed.",
    benchmarks: { retention3s: 0.76, completionRate: 0.7, shareRate: 0.028, saveRate: 0.055 },
    estimatedCostUsd: 0.68,
    forbidden: [
      "Showing the event itself",
      "A happy face",
      "Any product demonstration",
    ],
    editNotes: [
      "Do not cut on the beat. Land it slightly early — that is where the useful discomfort comes from.",
      "The second shot is shorter than the first.",
    ],
  },

  {
    id: "S05",
    name: "The question",
    slug: "direct-question",
    family: "MICRO",
    shape: {
      durationMs: [5000, 7000],
      shotCount: [1, 1],
      face: "ONE",
      speech: "SYNC",
      overlay: "CAPTIONS",
      music: "NONE",
      register: "CANDID",
    },
    premise:
      "One question asked straight into the lens, with no context and no answer. This one exists for the comments.",
    productRole:
      "None. This sells nothing — it collects the real objections the other videos will answer.",
    brandEntry: { atRatio: 1, manner: "Never." },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 2,
    beats: [
      {
        label: "The question",
        purpose: "Ask one divisive either-or question and then stop talking.",
        archetype: "SELFIE_TALK",
        durationSeconds: 6,
        direction:
          "{{persona}} asks it, then says nothing and keeps looking into the lens two seconds too long.",
        line: "{{question}}",
        overlayText: undefined,
        lighting: "WINDOW_SIDE",
        performance: "DEADPAN",
        ambience: "ROOM_QUIET",
        interrupt: "The silence after the question runs longer than is comfortable.",
      },
    ],
    whyItWorks:
      "An unanswered question creates a tension only a comment resolves. Comment volume is the heaviest early signal there is.",
    benchmarks: { retention3s: 0.74, completionRate: 0.66, shareRate: 0.014, saveRate: 0.022 },
    estimatedCostUsd: 0.58,
    forbidden: [
      "Answering your own question",
      "A rhetorical question with an obvious answer",
      "Any mention of the product",
    ],
    editNotes: [
      "Do not trim the final silence. That is what produces the comment.",
      "No music — it would make this feel produced.",
    ],
  },
];
