import type { Scenario } from "./types";

/**
 * Reactive, evidence and serial scenarios.
 *
 * Reactive videos respond to something outside themselves — a comment, a claim,
 * a habit. They are the cheapest content there is, because the audience supplies
 * the premise, and the most credible, because the objection is quoted rather
 * than invented.
 *
 * Evidence videos show a real thing happening on a real screen. They convert
 * hardest and travel least, which is why a mix needs both.
 */
export const REACTIVE_SCENARIOS: Scenario[] = [
  {
    id: "S40",
    name: "Replying to a comment",
    slug: "comment-reply",
    family: "REACTIVE",
    shape: {
      durationMs: [10000, 18000],
      shotCount: [2, 4],
      face: "ONE",
      speech: "SYNC",
      overlay: "CAPTIONS",
      music: "NONE",
      register: "CANDID",
    },
    premise:
      "A hostile comment is on screen. The creator does not defend anything — they do the thing on camera and let the result answer.",
    productRole: "The tool in the demonstration. The viewer already knows it, so it needs no introduction.",
    brandEntry: { atRatio: 0.4, manner: "Already on screen. Named only if the comment names it." },
    awarenessFit: ["SOLUTION_AWARE", "PRODUCT_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "The comment",
        purpose: "Show the objection exactly as written, unsoftened.",
        archetype: "SELFIE_REACTION",
        durationSeconds: 3,
        direction:
          "{{persona}} reads the comment on screen, raises an eyebrow, says nothing for a second.",
        overlayText: "{{comment}}",
        lighting: "WINDOW_SIDE",
        performance: "DEADPAN",
        ambience: "ROOM_QUIET",
        interrupt: "The reading silence runs longer than expected.",
      },
      {
        label: "Answering by doing",
        purpose: "Do not argue. Execute.",
        archetype: "FOUND_FOOTAGE",
        durationSeconds: 7,
        direction:
          "Cut to the screen recording. {{action}} runs in real time, with no cuts.",
        line: "{{doingLine}}",
        lighting: "SCREEN_GLOW",
        performance: "ABSORBED",
        ambience: "ROOM_QUIET",
      },
      {
        label: "Back",
        purpose: "Close without gloating and without a hook into another video.",
        archetype: "SELFIE_TALK",
        durationSeconds: 4,
        direction:
          "Back to the face. {{persona}} shrugs and reaches for the lens to stop the recording.",
        line: "That's all I've got.",
        lighting: "WINDOW_SIDE",
        performance: "DISMISSIVE",
        ambience: "ROOM_QUIET",
      },
    ],
    whyItWorks:
      "An objection raised by somebody else is more credible than any claim the brand makes, and answering it with action rather than argument keeps it from reading as marketing.",
    benchmarks: { retention3s: 0.78, completionRate: 0.55, shareRate: 0.02, saveRate: 0.045 },
    estimatedCostUsd: 0.88,
    forbidden: [
      "Mocking the commenter",
      "Arguing for more than ten words",
      "An invented comment",
      "A triumphant ending",
    ],
    editNotes: [
      "Show the comment with its original typo, if it has one.",
      "No cuts during the demonstration. Continuity is the proof.",
    ],
  },

  {
    id: "S41",
    name: "The rant",
    slug: "the-rant",
    family: "REACTIVE",
    shape: {
      durationMs: [15000, 25000],
      shotCount: [1, 2],
      face: "ONE",
      speech: "SYNC",
      overlay: "CAPTIONS",
      music: "NONE",
      register: "CANDID",
    },
    premise:
      "Anger at a habit of the industry, never at a company. One shot, no cuts, fast delivery, real irritation.",
    productRole:
      "What they use so they no longer have to put up with the thing they are ranting about. Half a sentence, at the end, without changing tone.",
    brandEntry: {
      atRatio: 0.85,
      manner: "Half a sentence, in the same breath as the rest, without slowing down.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "The rant",
        purpose:
          "One shot, no cuts, anger building. The continuity is what makes the anger credible.",
        archetype: "WALK_AND_TALK",
        durationSeconds: 18,
        direction:
          "{{persona}} walking and talking, getting progressively more wound up, gesturing with one hand. Loses the thread once and picks it up again.",
        line: "{{rant}}",
        lighting: "STREET_NIGHT",
        performance: "BUILDING",
        ambience: "STREET",
        interrupt: "The accelerating delivery and the lost thread, neither of which can be written.",
      },
    ],
    whyItWorks:
      "Continuous anger with no cuts cannot have been assembled. The viewer knows that, and it buys twenty seconds of attention.",
    benchmarks: { retention3s: 0.71, completionRate: 0.44, shareRate: 0.037, saveRate: 0.026 },
    estimatedCostUsd: 1.42,
    forbidden: [
      "Naming a competitor",
      "Cutting the shot",
      "Slowing down to place the product",
      "A calm, reasonable conclusion",
    ],
    editNotes: [
      "No cuts. If the shot must be assembled, hide the joins on the walking motion.",
      "Captions keep up with the delivery even if they get dense.",
      "No music — it would turn anger into performance.",
    ],
  },

  {
    id: "S42",
    name: "On the clock",
    slug: "the-speedrun",
    family: "EVIDENCE",
    shape: {
      durationMs: [12000, 20000],
      shotCount: [3, 5],
      face: "ONE",
      speech: "SYNC",
      overlay: "STATIC_HEADLINE",
      music: "BED",
      register: "CANDID",
    },
    premise:
      "A task is timed start to finish, in real time, with nothing sped up. The timer is visible throughout.",
    productRole: "The tool on the clock. The result is the only argument.",
    brandEntry: { atRatio: 0.3, manner: "Visible from the start, named once when the timer starts." },
    awarenessFit: ["SOLUTION_AWARE", "PRODUCT_AWARE"],
    ctaLevel: 2,
    beats: [
      {
        label: "The bet",
        purpose: "State the task and start the clock.",
        archetype: "SELFIE_TALK",
        durationSeconds: 3,
        direction: "{{persona}} states the task in one sentence and hits the timer.",
        line: "{{task}}, from nothing. Go.",
        overlayText: "{{taskHeadline}}",
        lighting: "WINDOW_SIDE",
        performance: "MID_SENTENCE",
        ambience: "ROOM_QUIET",
      },
      {
        label: "The run",
        purpose: "Real time, no cuts, hesitations left in.",
        archetype: "FOUND_FOOTAGE",
        durationSeconds: 10,
        direction:
          "Screen recording. {{action}}. One hesitation, one correction. The timer runs in the corner.",
        lighting: "SCREEN_GLOW",
        performance: "ABSORBED",
        ambience: "ROOM_QUIET",
      },
      {
        label: "The number",
        purpose: "Stop the clock and say nothing.",
        archetype: "SELFIE_REACTION",
        durationSeconds: 4,
        direction:
          "{{persona}} stops the timer, looks at the number, looks at the lens. No comment.",
        overlayText: "{{finalTime}}",
        lighting: "WINDOW_SIDE",
        performance: "DEADPAN",
        ambience: "ROOM_QUIET",
        interrupt: "Refusing to comment on the number.",
      },
    ],
    whyItWorks:
      "A timer running with no cuts is checkable proof, and the hesitations left in are what show the demonstration was not rehearsed.",
    benchmarks: { retention3s: 0.76, completionRate: 0.5, shareRate: 0.016, saveRate: 0.068 },
    estimatedCostUsd: 0.71,
    forbidden: [
      "Speeding up any part of the run",
      "Cutting a hesitation",
      "Commenting on the final number",
      "A timer added in the edit",
    ],
    editNotes: [
      "The timer must be filmed, not overlaid afterwards.",
      "One punch-in on the final number, 220ms.",
    ],
  },

  {
    id: "S43",
    name: "Day N",
    slug: "day-n",
    family: "SERIAL",
    shape: {
      durationMs: [10000, 18000],
      shotCount: [2, 4],
      face: "ONE",
      speech: "SYNC",
      overlay: "STATIC_HEADLINE",
      music: "BED",
      register: "CANDID",
    },
    premise:
      "One episode of a running series. It starts with no recap, which is what sends people to the earlier ones.",
    productRole: "The tool in the ongoing experiment. Not introduced since episode one.",
    brandEntry: {
      atRatio: 0.2,
      manner: "Already familiar to regulars. Named once, like a piece of furniture.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE", "PRODUCT_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "Straight in",
        purpose: "No recap. The episode number is the entire context.",
        archetype: "SELFIE_TALK",
        durationSeconds: 4,
        direction:
          "{{persona}} starts mid-thought, as if continuing yesterday's conversation.",
        line: "Day {{dayNumber}}. Right, that didn't go how I expected.",
        overlayText: "DAY {{dayNumber}}",
        lighting: "KITCHEN_OVERHEAD",
        performance: "MID_SENTENCE",
        ambience: "KITCHEN",
        interrupt: "The total absence of a recap pushes people to look for the earlier episodes.",
      },
      {
        label: "Today's number",
        purpose: "One fact, with a number, no staging.",
        archetype: "INSERT",
        durationSeconds: 5,
        direction: "Insert on a screen or a notebook. {{dailyResult}}.",
        lighting: "SCREEN_GLOW",
        ambience: "KITCHEN",
      },
      {
        label: "Tomorrow",
        purpose: "Open onto tomorrow without promising anything.",
        archetype: "SELFIE_TALK",
        durationSeconds: 4,
        direction: "{{persona}} shrugs and says what they'll try next.",
        line: "Tomorrow I'm trying {{nextAttempt}}. We'll see.",
        lighting: "KITCHEN_OVERHEAD",
        performance: "DISMISSIVE",
        ambience: "KITCHEN",
      },
    ],
    whyItWorks:
      "A series gives people a reason to follow that standalone videos do not. And the missing recap pushes them to the profile, which is the only place the link lives.",
    benchmarks: { retention3s: 0.72, completionRate: 0.57, shareRate: 0.013, saveRate: 0.051 },
    estimatedCostUsd: 0.79,
    forbidden: [
      "Recapping earlier episodes",
      "A good result every single day",
      "Promising what the next one will show",
    ],
    editNotes: [
      "The DAY N band is identical every episode — same position, same type.",
      "One day in three has to be a failure or the series isn't believable.",
    ],
  },

  {
    id: "S44",
    name: "Asking strangers",
    slug: "street-interview",
    family: "REACTIVE",
    shape: {
      durationMs: [15000, 25000],
      shotCount: [4, 7],
      face: "TWO_PLUS",
      speech: "DIEGETIC",
      overlay: "SUBTITLES",
      music: "NONE",
      register: "STAGED",
    },
    premise:
      "A question put to strangers in the street. The answers are poor, awkward and honest. The last person shows something different.",
    productRole: "What the last person has on their phone. The others have never heard of it.",
    brandEntry: {
      atRatio: 0.8,
      manner: "Shown by the last interviewee and named by them, never by the interviewer.",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "The question",
        purpose: "Ask something mildly uncomfortable.",
        archetype: "OBSERVER",
        durationSeconds: 4,
        direction:
          "Handheld camera, a microphone enters frame. A passer-by stops reluctantly.",
        line: "{{streetQuestion}}",
        lighting: "STREET_NIGHT",
        ambience: "STREET",
        interrupt: "The visible awkwardness of the person answering.",
      },
      {
        label: "The answers",
        purpose: "Three short answers, poor and sincere.",
        archetype: "OBSERVER",
        durationSeconds: 9,
        direction:
          "Tight cut between three different people. Each hesitates, laughs nervously, gives a low number.",
        line: "{{streetAnswers}}",
        lighting: "STREET_NIGHT",
        performance: "SUPPRESSED_LAUGH",
        ambience: "STREET",
      },
      {
        label: "The last one",
        purpose: "An answer that breaks the pattern, shown rather than described.",
        archetype: "OBSERVER",
        durationSeconds: 7,
        direction:
          "A final passer-by takes out their phone and holds it toward the lens. We see the screen for a few seconds, badly framed.",
        line: "{{lastAnswer}}",
        lighting: "STREET_NIGHT",
        performance: "CONSPIRATORIAL",
        ambience: "STREET",
      },
    ],
    whyItWorks:
      "The three poor answers establish a norm. The fourth breaks it. The viewer recognises themselves in the first three, so the fourth is about them.",
    benchmarks: { retention3s: 0.74, completionRate: 0.48, shareRate: 0.027, saveRate: 0.033 },
    estimatedCostUsd: 1.86,
    forbidden: [
      "Answers that are too good from the first three",
      "An interviewer who comments or leads",
      "Clean, stable framing",
    ],
    editNotes: [
      "Each interviewee needs a different street background or the staging shows.",
      "Keep the hesitations and the ums.",
      "The last shot is the longest of the four.",
    ],
  },
];
