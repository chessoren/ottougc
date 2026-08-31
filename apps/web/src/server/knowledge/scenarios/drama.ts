import type { Scenario } from "./types";

/**
 * Drama scenarios — performed fiction, twenty to forty-five seconds.
 *
 * The only family where production value is allowed, because the audience knows
 * it is fiction from the first frame. Nobody is pretending this was filmed by
 * accident.
 *
 * What makes them work is structural: the product is not mentioned in the story,
 * the product **is** the story's pivot. Remove it and the plot does not resolve.
 * That is the difference between a drama that carries a brand and a sketch with
 * an advertisement stapled to the end.
 */
export const DRAMA_SCENARIOS: Scenario[] = [
  {
    id: "S20",
    name: "The pivot",
    slug: "micro-drama-pivot",
    family: "DRAMA",
    shape: {
      durationMs: [25000, 40000],
      shotCount: [6, 10],
      face: "TWO_PLUS",
      speech: "DIEGETIC",
      overlay: "SUBTITLES",
      music: "DRIVES",
      register: "FICTION",
    },
    premise:
      "Someone is cornered by a situation with real stakes — a deadline, an accusation, a promise they cannot keep. They have very little time.",
    productRole:
      "The only way out. It is never introduced or explained: we watch it work and the plot resolves. Take it away and the story has no ending.",
    brandEntry: {
      atRatio: 0.75,
      manner:
        "The name may be said once, by a secondary character, as a question: 'what did you use?'",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The demand",
        purpose: "Open on a conflict already underway. No exposition.",
        archetype: "DRAMA",
        durationSeconds: 5,
        direction:
          "Someone walks in and puts a demand to {{persona}}. The tone is already tense. We do not know what came before.",
        line: "{{demand}}",
        lighting: "OFFICE_FLUORESCENT",
        performance: "ANNOYED",
        ambience: "OFFICE",
        interrupt: "We arrive in the middle of an argument with no idea what it is about.",
      },
      {
        label: "Impossible",
        purpose: "Make the demand visibly undoable.",
        archetype: "DRAMA",
        durationSeconds: 5,
        direction:
          "Close on {{persona}}. They check the time, then the size of what is being asked. They do not answer.",
        overlayText: "{{deadline}}",
        lighting: "OFFICE_FLUORESCENT",
        performance: "STUNNED",
        ambience: "OFFICE",
      },
      {
        label: "The decision",
        purpose: "A silent turn. They have an idea.",
        archetype: "DRAMA",
        durationSeconds: 4,
        direction:
          "{{persona}} sits down slowly and opens a laptop. The face changes: this is no longer panic, it is calculation.",
        lighting: "SCREEN_GLOW",
        performance: "ABSORBED",
        ambience: "NIGHT",
      },
      {
        label: "Doing it",
        purpose:
          "Show the product doing the thing, with no word of explanation. This is the pivot.",
        archetype: "INSERT",
        durationSeconds: 6,
        direction:
          "Tight insert on the screen. {{action}} plays out. No commentary, no voice. Only breathing and the music rising.",
        lighting: "SCREEN_GLOW",
        ambience: "NONE",
        interrupt: "Silence after fifteen seconds of dialogue.",
      },
      {
        label: "They come back",
        purpose: "Return the antagonist and flip the power.",
        archetype: "DRAMA",
        durationSeconds: 5,
        direction:
          "The other character returns ready to complain. {{persona}} hands them the screen without a word.",
        lighting: "OFFICE_FLUORESCENT",
        performance: "DEADPAN",
        ambience: "OFFICE",
      },
      {
        label: "The question",
        purpose:
          "Prompt the one question that lets the brand name exist inside the fiction at all.",
        archetype: "DRAMA",
        durationSeconds: 4,
        direction:
          "The antagonist reads the screen and looks up. Tight frame. They do not congratulate. They ask.",
        line: "…what did you make this with?",
        lighting: "OFFICE_FLUORESCENT",
        performance: "STUNNED",
        ambience: "OFFICE",
        interrupt: "The video ends on the question, not the answer.",
      },
    ],
    whyItWorks:
      "The viewer is watching a story, not a pitch. Their advertising guard never goes up because there is no commercial turn to detect: the only possible mention of the product is a question asked by a character, inside the fiction.",
    benchmarks: { retention3s: 0.68, completionRate: 0.42, shareRate: 0.034, saveRate: 0.036 },
    estimatedCostUsd: 2.9,
    forbidden: [
      "The lead explaining what they used",
      "A readable, front-on interface shot",
      "An explicit happy ending — it stops on the question",
      "Any voiceover",
    ],
    editNotes: [
      "Music only enters at the decision, never before.",
      "The 'doing it' shot is the only long one. Everything else is cut tight.",
      "Flat subtitles at the bottom, fiction convention — never kinetic captions.",
      "Cut to black half a second after the question, with no answer.",
    ],
  },

  {
    id: "S21",
    name: "The thing they made",
    slug: "kdrama-object",
    family: "DRAMA",
    shape: {
      durationMs: [30000, 45000],
      shotCount: [8, 12],
      face: "TWO_PLUS",
      speech: "DIEGETIC",
      overlay: "SUBTITLES",
      music: "DRIVES",
      register: "FICTION",
    },
    premise:
      "Full melodrama, played straight: two people, a misunderstanding, a revelation. Slow pace, long looks, the music carrying everything. The viewer knows it is a pastiche and plays along.",
    productRole:
      "The object of fate. What the character makes with it is what reveals the truth to the other person. It doesn't rescue a task — it reveals a feeling.",
    brandEntry: {
      atRatio: 0.85,
      manner:
        "The name appears only as a subtitle, for a fraction of a second, when a character looks at a screen. Never spoken.",
    },
    awarenessFit: ["UNAWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "The misunderstanding",
        purpose: "Open on a rupture that looks final.",
        archetype: "DRAMA",
        durationSeconds: 5,
        direction:
          "Two people in a corridor, far apart. One walks away. The other does not follow. End-of-day light.",
        line: "{{misunderstanding}}",
        lighting: "GOLDEN_WINDOW",
        performance: "DEFLATING",
        ambience: "ROOM_QUIET",
        interrupt: "The slow pace is radically unlike everything else in the feed.",
      },
      {
        label: "Alone",
        purpose: "Let it sit. The emptiness is the format.",
        archetype: "DRAMA",
        durationSeconds: 4,
        direction:
          "{{persona}} alone, sitting, looking out of a window. Does nothing for several seconds.",
        lighting: "GOLDEN_WINDOW",
        performance: "EXHAUSTED",
        ambience: "ROOM_QUIET",
      },
      {
        label: "Making it",
        purpose:
          "They build something. The only moment the product exists, filmed as an intimate act.",
        archetype: "INSERT",
        durationSeconds: 6,
        direction:
          "Hands on a keyboard, low light. {{action}}. We cannot read what is on the screen, only that something is being built.",
        lighting: "LAMP_WARM",
        ambience: "NIGHT",
      },
      {
        label: "Sending it",
        purpose: "One irreversible act, wordless.",
        archetype: "INSERT",
        durationSeconds: 3,
        direction: "A finger hesitates over the screen, then presses. Immediate cut to black.",
        lighting: "SCREEN_GLOW",
        ambience: "NONE",
        interrupt: "A cut to black in the middle of the video.",
      },
      {
        label: "Receiving it",
        purpose: "The other character receives it and understands.",
        archetype: "DRAMA",
        durationSeconds: 6,
        direction:
          "The other character, elsewhere, looking at their phone. The face slowly falls. A hand goes to the mouth.",
        lighting: "STREET_NIGHT",
        performance: "STUNNED",
        ambience: "STREET",
      },
      {
        label: "The reveal",
        purpose:
          "The only moment the name can exist: read on a screen, never spoken, for a fraction of a second.",
        archetype: "INSERT",
        durationSeconds: 3,
        direction:
          "Very brief insert on the phone. We see what was made. The product name passes along the bottom, tiny.",
        lighting: "SCREEN_GLOW",
        ambience: "STREET",
      },
      {
        label: "Running",
        purpose: "End on movement, never on the reunion.",
        archetype: "DRAMA",
        durationSeconds: 5,
        direction:
          "The character starts running. Shot from behind, at night. The video ends before they arrive.",
        lighting: "STREET_NIGHT",
        performance: "BUILDING",
        ambience: "STREET",
        interrupt: "The ending is withheld — we never see them meet.",
      },
    ],
    whyItWorks:
      "A melodrama pastiche is an explicit contract with the viewer, and an explicit contract disarms suspicion better than fake naturalism does. The slowness is itself the pattern interrupt: in a feed of fast videos, a shot that holds is an anomaly people watch.",
    benchmarks: { retention3s: 0.62, completionRate: 0.38, shareRate: 0.041, saveRate: 0.044 },
    estimatedCostUsd: 3.8,
    forbidden: [
      "Saying the product name out loud",
      "Showing the reunion",
      "A readable, front-on interface shot",
      "Winking at the genre — the pastiche is played straight",
    ],
    editNotes: [
      "No shot under 2.5s. This inverts every other editing rule in the system, deliberately.",
      "Music starts on the first frame and only breaks at the cut to black.",
      "White subtitles, low, with a drop shadow: the exact convention of the genre.",
      "Warm grade in the first half, cool in the second.",
    ],
  },

  {
    id: "S22",
    name: "What happened",
    slug: "reconstruction",
    family: "DRAMA",
    shape: {
      durationMs: [20000, 30000],
      shotCount: [5, 8],
      face: "ONE",
      speech: "VOICEOVER",
      overlay: "STORY_CARDS",
      music: "BED",
      register: "FICTION",
    },
    premise:
      "Someone narrates what happened to them while we watch it played back. The gap between how calmly it is told and how bad it looks does all the work.",
    productRole:
      "The moment the story turns. The voice does not comment on it — it keeps narrating, and we see on screen what changed.",
    brandEntry: {
      atRatio: 0.7,
      manner: "One mention in the voiceover, past tense, buried inside a longer sentence.",
    },
    awarenessFit: ["UNAWARE", "PROBLEM_AWARE"],
    ctaLevel: 0,
    beats: [
      {
        label: "Opening",
        purpose: "A first line that promises a story, not a lesson.",
        archetype: "OBSERVER",
        durationSeconds: 4,
        direction:
          "Wide shot of an empty room at first light. A chair knocked over, things on the floor.",
        line: "{{openingLine}}",
        overlayText: "{{timestamp}}",
        lighting: "WINDOW_BACK",
        ambience: "ROOM_QUIET",
        interrupt: "A room that poses a question before any information is given.",
      },
      {
        label: "Escalating",
        purpose: "Three short shots that stack the pressure.",
        archetype: "INSERT",
        durationSeconds: 5,
        direction:
          "A run of inserts: a clock, a screen, hands shaking slightly on a keyboard.",
        line: "{{escalation}}",
        lighting: "LAMP_WARM",
        ambience: "NIGHT",
      },
      {
        label: "The low point",
        purpose: "The moment they nearly gave up.",
        archetype: "DRAMA",
        durationSeconds: 5,
        direction: "{{persona}} from behind, motionless in front of the screen, head down.",
        line: "{{lowPoint}}",
        lighting: "SCREEN_GLOW",
        performance: "EXHAUSTED",
        ambience: "NIGHT",
      },
      {
        label: "The turn",
        purpose: "What changed, shown rather than explained.",
        archetype: "INSERT",
        durationSeconds: 5,
        direction: "Insert on the screen, {{action}}. The cutting rhythm speeds up sharply.",
        line: "{{pivotLine}}",
        lighting: "SCREEN_GLOW",
        ambience: "NONE",
      },
      {
        label: "After",
        purpose: "Come back down. One calm last image, no moral.",
        archetype: "OBSERVER",
        durationSeconds: 4,
        direction:
          "Back to the opening wide shot, but the light is different and the room is tidy.",
        line: "{{closingLine}}",
        lighting: "GOLDEN_WINDOW",
        ambience: "ROOM_QUIET",
      },
    ],
    whyItWorks:
      "The first and last shots are the same frame in two states. The viewer understands the story without anyone summarising it, and that silent understanding is what produces the share.",
    benchmarks: { retention3s: 0.66, completionRate: 0.44, shareRate: 0.029, saveRate: 0.057 },
    estimatedCostUsd: 2.1,
    forbidden: [
      "A moral at the end",
      "Addressing the viewer as 'you'",
      "A smiling face",
      "A performance number on screen",
    ],
    editNotes: [
      "The last shot must match the first framing exactly. That is the whole construction.",
      "The voiceover never describes what is on screen — it runs in parallel.",
      "The cutting only accelerates at the turn, then drops back sharply.",
    ],
  },
];
