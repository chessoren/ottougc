import type { Scenario } from "./types";

/**
 * Situation scenarios — ten to twenty-five seconds, with a turn.
 *
 * Always the same structure: a situation the viewer recognises, something that
 * changes it, a consequence. The product is never the subject of any of the
 * three — it is the mechanism of the second, and it is named once, after the
 * turn has already landed.
 */
export const SITUATION_SCENARIOS: Scenario[] = [
  {
    id: "S10",
    name: "The message",
    slug: "the-message",
    family: "SITUATION",
    shape: {
      durationMs: [12000, 18000],
      shotCount: [4, 6],
      face: "ONE",
      speech: "DIEGETIC",
      overlay: "CHAT",
      music: "BED",
      register: "CANDID",
    },
    premise:
      "Someone gets a message that puts them in trouble. We see the thread, we see their face, we see what they do next.",
    productRole:
      "What they do next goes through it. Their screen is visible for two seconds, unremarked, then we are back in the thread and it resolves.",
    brandEntry: {
      atRatio: 0.65,
      manner: "On screen for two seconds during the action. Named at most once, in the final message.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "The message",
        purpose: "Set the stakes in one received sentence, not an explanation.",
        archetype: "INSERT",
        durationSeconds: 4,
        direction:
          "A phone on a table. A message arrives and appears. A hand enters frame but does not pick it up yet.",
        overlayText: "{{incomingMessage}}",
        lighting: "LAMP_WARM",
        ambience: "ROOM_QUIET",
        interrupt: "The viewer reads the message before the character does.",
      },
      {
        label: "The face",
        purpose: "One reaction, wordless, that says how bad this is.",
        archetype: "SELFIE_REACTION",
        durationSeconds: 3,
        direction:
          "{{persona}} looks up from the phone and stares at nothing. Exhales. Says nothing.",
        lighting: "LAMP_WARM",
        performance: "EXHAUSTED",
        ambience: "ROOM_QUIET",
      },
      {
        label: "Doing it",
        purpose: "Show the actual work, uncommented. This is the only moment the product exists.",
        archetype: "OBSERVER",
        durationSeconds: 5,
        direction:
          "From the side, {{persona}} hunched over the screen, doing {{action}}. We see the screen at an angle, never straight on. It takes a few seconds.",
        lighting: "SCREEN_GLOW",
        performance: "ABSORBED",
        ambience: "ROOM_QUIET",
      },
      {
        label: "The reply",
        purpose: "Resolve through the same channel the problem arrived on.",
        archetype: "INSERT",
        durationSeconds: 4,
        direction:
          "Back to the thread. The reply sends. Typing dots on the other side. Then a short answer that changes the tone of the conversation.",
        overlayText: "{{resolutionMessage}}",
        lighting: "LAMP_WARM",
        ambience: "ROOM_QUIET",
        interrupt: "The typing dots hold a second longer than they should.",
      },
    ],
    whyItWorks:
      "A message thread is something you read, not something you watch — so people stay. And the resolution arrives through the same channel as the problem, which closes the story without anyone explaining anything.",
    benchmarks: { retention3s: 0.72, completionRate: 0.51, shareRate: 0.019, saveRate: 0.038 },
    estimatedCostUsd: 0.94,
    forbidden: [
      "Talking to camera",
      "Showing the interface straight on and in full",
      "A final message thanking the product",
    ],
    editNotes: [
      "Bubbles appear one at a time with real typing delays — never all at once.",
      "The face shot never runs past three seconds or it becomes a talking head.",
      "Music very low, almost inaudible. It exists only to avoid silence.",
    ],
  },

  {
    id: "S11",
    name: "Caught doing it",
    slug: "caught-doing-it",
    family: "SITUATION",
    shape: {
      durationMs: [10000, 15000],
      shotCount: [3, 4],
      face: "TWO_PLUS",
      speech: "DIEGETIC",
      overlay: "SUBTITLES",
      music: "NONE",
      register: "STAGED",
    },
    premise:
      "Someone films a colleague or a flatmate doing something suspiciously fast. The exchange that follows is the content.",
    productRole:
      "What the person being filmed is using. They show it reluctantly, the way you give up a secret you would rather have kept.",
    brandEntry: {
      atRatio: 0.7,
      manner: "Named once, by the person being filmed, irritated. Never by the one holding the camera.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "Filming them",
        purpose: "Establish that we are filming someone who has not agreed to it.",
        archetype: "OBSERVER",
        durationSeconds: 4,
        direction:
          "Camera held low, framing off, mostly a back and a distant screen. The person filming is whispering.",
        line: "Wait, you're done already? It's not even—",
        lighting: "OFFICE_FLUORESCENT",
        performance: "CONSPIRATORIAL",
        ambience: "OFFICE",
        interrupt: "The bad framing immediately signals this was not produced.",
      },
      {
        label: "Caught",
        purpose: "They turn around. The tone changes.",
        archetype: "SCENE_TWO_HANDER",
        durationSeconds: 4,
        direction:
          "The person turns sharply, puts a hand half-heartedly over the lens, sighs.",
        line: "Put that away. Seriously.",
        lighting: "OFFICE_FLUORESCENT",
        performance: "ANNOYED",
        ambience: "OFFICE",
      },
      {
        label: "Giving it up",
        purpose: "Hand over the information reluctantly, which is what makes it credible.",
        archetype: "OBSERVER",
        angleOverride: "OVER_SHOULDER",
        durationSeconds: 5,
        direction:
          "They turn the screen toward the lens for two seconds, showing {{action}}, then turn it straight back.",
        line: "It's {{brand}}. There. Happy?",
        lighting: "OFFICE_FLUORESCENT",
        performance: "DISMISSIVE",
        ambience: "OFFICE",
      },
    ],
    whyItWorks:
      "Information that has to be extracted reads as true. Information that is offered reads as a pitch. The whole mechanism is that difference.",
    benchmarks: { retention3s: 0.77, completionRate: 0.56, shareRate: 0.024, saveRate: 0.031 },
    estimatedCostUsd: 1.12,
    forbidden: [
      "Enthusiasm from the person being filmed",
      "A full walkthrough of the interface",
      "A thank-you or a knowing look at the camera",
    ],
    editNotes: [
      "The framing must correct itself once mid-shot, like a real hand.",
      "Flat subtitles, not kinetic captions — this is footage nobody edited.",
      "No music. Office noise is enough.",
    ],
  },

  {
    id: "S12",
    name: "Wrong about it",
    slug: "wrong-assumption",
    family: "SITUATION",
    shape: {
      durationMs: [12000, 18000],
      shotCount: [3, 5],
      face: "ONE",
      speech: "SYNC",
      overlay: "CAPTIONS",
      music: "BED",
      register: "CANDID",
    },
    premise:
      "Someone states something with total confidence at the start, and the video is watching them be wrong about it.",
    productRole:
      "What contradicts them. It is never defended — it is simply the thing that proves them wrong.",
    brandEntry: {
      atRatio: 0.6,
      manner: "Named at the moment they admit it, grudgingly.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "The claim",
        purpose: "State a certainty plenty of people share.",
        archetype: "SELFIE_TALK",
        durationSeconds: 4,
        direction:
          "{{persona}} is already talking when the shot starts, sure of themselves, walking toward a desk.",
        line: "{{wrongClaim}}. Nobody's changing my mind on that.",
        lighting: "WINDOW_SIDE",
        performance: "MID_SENTENCE",
        ambience: "ROOM_QUIET",
        interrupt: "The claim is sharp enough to provoke immediate disagreement.",
      },
      {
        label: "The test",
        purpose: "Put the claim against reality, without commentary.",
        archetype: "INSERT",
        durationSeconds: 6,
        direction:
          "Insert on the screen. {{action}} plays out. A timer or counter runs in the corner.",
        lighting: "SCREEN_GLOW",
        ambience: "ROOM_QUIET",
      },
      {
        label: "Admitting it",
        purpose: "Concede without turning it into a recommendation.",
        archetype: "SELFIE_TALK",
        durationSeconds: 5,
        direction:
          "{{persona}} looks at the lens, half-smiles, shrugs one shoulder. Does not labour it.",
        line: "Fine. I was wrong. It's {{brand}}, and I'm annoyed about it.",
        lighting: "WINDOW_SIDE",
        performance: "SUPPRESSED_LAUGH",
        ambience: "ROOM_QUIET",
      },
    ],
    whyItWorks:
      "Being wrong in public is the least advertisement-like thing a person can do. It buys credibility no positive claim can buy.",
    benchmarks: { retention3s: 0.75, completionRate: 0.54, shareRate: 0.021, saveRate: 0.043 },
    estimatedCostUsd: 0.96,
    forbidden: [
      "Turning the admission into an enthusiastic recommendation",
      "An opening claim nobody actually holds",
      "A closing 'go try it'",
    ],
    editNotes: [
      "The test shot must be a real screen recording, not a reconstruction.",
      "The punch-in lands on the counter, not the face.",
    ],
  },

  {
    id: "S13",
    name: "Late",
    slug: "late-night",
    family: "SITUATION",
    shape: {
      durationMs: [15000, 22000],
      shotCount: [2, 3],
      face: "ONE",
      speech: "SYNC",
      overlay: "CAPTIONS",
      music: "NONE",
      register: "CANDID",
    },
    premise:
      "Someone talking to their own phone late at night, with no energy, because they have just finished something they should never have had to do.",
    productRole:
      "Mentioned in the last line as the thing they wish they had known about earlier. Never shown.",
    brandEntry: {
      atRatio: 0.8,
      manner: "One mention, in the final line, as regret rather than recommendation.",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The confession",
        purpose:
          "Build intimacy through exhaustion. Nobody makes an advertisement at this hour looking like this.",
        archetype: "SELFIE_TALK",
        durationSeconds: 9,
        direction:
          "{{persona}}, lying down, lit only by their screen, talking quietly so as not to wake anyone. Stops mid-sentence, starts again.",
        line: "{{lateNightConfession}}",
        lighting: "SCREEN_GLOW",
        performance: "EXHAUSTED",
        ambience: "NIGHT",
        interrupt: "Whispering makes people turn the volume up, and turning it up is a commitment.",
      },
      {
        label: "The regret",
        purpose: "Deliver the useful information as regret, never as advice.",
        archetype: "SELFIE_TALK",
        durationSeconds: 7,
        direction:
          "Same position. {{persona}} looks away, shrugs, nearly turns the screen off.",
        line: "Anyway. If I'd known about {{brand}} six months ago I'd have had my Sundays back.",
        lighting: "SCREEN_GLOW",
        performance: "DEFLATING",
        ambience: "NIGHT",
      },
    ],
    whyItWorks:
      "Exhaustion cannot be faked in an advertisement, because an advertisement has to sell energy. A tired face speaking quietly is filed as non-commercial before a word registers.",
    benchmarks: { retention3s: 0.69, completionRate: 0.47, shareRate: 0.017, saveRate: 0.049 },
    estimatedCostUsd: 0.82,
    forbidden: ["Any music", "Flattering light", "Advice in the second person", "Any call to action"],
    editNotes: [
      "Keep the hesitations and restarts. They are the format.",
      "No colour correction — the green cast of a phone sensor in low light is part of the signal.",
      "Never cut on a clean breath. The cuts should be slightly clumsy.",
    ],
  },

  {
    id: "S14",
    name: "The argument",
    slug: "the-argument",
    family: "SITUATION",
    shape: {
      durationMs: [14000, 20000],
      shotCount: [4, 6],
      face: "TWO_PLUS",
      speech: "DIEGETIC",
      overlay: "SUBTITLES",
      music: "PUNCTUATES",
      register: "STAGED",
    },
    premise:
      "Two people disagree about how to do something. The argument is the content; the outcome is the proof.",
    productRole:
      "What one of them uses to end the argument. The proof is in the result, not in the reasoning.",
    brandEntry: {
      atRatio: 0.7,
      manner: "Named by whoever loses the argument, grudgingly, in the last line.",
    },
    awarenessFit: ["PROBLEM_AWARE", "SOLUTION_AWARE"],
    ctaLevel: 1,
    beats: [
      {
        label: "The disagreement",
        purpose: "Two incompatible positions in a few lines.",
        archetype: "SCENE_TWO_HANDER",
        durationSeconds: 5,
        direction:
          "Two people either side of a table, talking over each other. The camera is propped on a shelf, slightly crooked.",
        line: "— You'll be here all night. — I'd rather do it properly.",
        lighting: "KITCHEN_OVERHEAD",
        ambience: "KITCHEN",
        interrupt: "Overlapping voices mark this as unscripted.",
      },
      {
        label: "The bet",
        purpose: "Turn the disagreement into something measurable.",
        archetype: "SCENE_TWO_HANDER",
        durationSeconds: 4,
        direction:
          "One puts a phone between them with a stopwatch running. The other rolls their eyes.",
        line: "Go on then. We're timing it.",
        lighting: "KITCHEN_OVERHEAD",
        performance: "CONSPIRATORIAL",
        ambience: "KITCHEN",
      },
      {
        label: "The run",
        purpose: "Show the real thing, in one take, with no clever editing.",
        archetype: "INSERT",
        durationSeconds: 6,
        direction:
          "Insert on the screen during {{action}}. The timer is visible in the corner. Nothing is sped up.",
        lighting: "SCREEN_GLOW",
        ambience: "KITCHEN",
      },
      {
        label: "Conceding",
        purpose: "Close without gloating.",
        archetype: "SCENE_TWO_HANDER",
        durationSeconds: 4,
        direction:
          "The loser looks at the screen, then at the other person, then leaves muttering the name.",
        line: "…what's it called again. {{brand}}. I hate this.",
        lighting: "KITCHEN_OVERHEAD",
        performance: "ANNOYED",
        ambience: "KITCHEN",
      },
    ],
    whyItWorks:
      "A demonstration won against somebody is worth ten done for a camera. The viewer identifies with the sceptic, and the sceptic is the one who gets convinced on screen.",
    benchmarks: { retention3s: 0.73, completionRate: 0.49, shareRate: 0.023, saveRate: 0.029 },
    estimatedCostUsd: 1.34,
    forbidden: [
      "The winner explaining why it's better",
      "A handshake or a friendly beat at the end",
      "A rigged timer or any speed-up",
    ],
    editNotes: [
      "The camera never moves. It is propped, and that is what makes the scene believable.",
      "The musical sting lands only on the concession, one note.",
    ],
  },
];
