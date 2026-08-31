import { NEGATIVE_SETS } from "./vocabulary";

/**
 * Character construction.
 *
 * Before an account agent generates a single second of video it must build two
 * things: the **ICP** it is speaking to, and a **character sheet** — a locked
 * physical description plus a set of reference images of the same face.
 *
 * The reference images are the load-bearing part. Gemini Omni Flash accepts up
 * to seven of them, and passing the same set into every generation is the only
 * reliable way to get one recognisable person across a hundred clips. A text
 * description alone drifts: same words, different face, and an audience spots
 * that faster than any other tell.
 */

/* ── ICP ─────────────────────────────────────────────────────────────────── */

export interface Icp {
  /** How they would describe themselves, in their own words. */
  selfDescription: string;
  ageRange: string;
  occupation: string;
  /** Where they are, because it changes the references and the slang. */
  context: string;
  /** The thing that actually keeps them up. Specific, not a category. */
  visceralPain: string;
  /** What they have already tried and abandoned. */
  failedAttempts: string[];
  /** Words they use that outsiders would not. */
  vocabulary: string[];
  /** Accounts and creators they already watch — sets the register. */
  watches: string[];
  /** What would make them scroll past instantly. */
  turnOffs: string[];
  /** The exact sentence that would stop them. */
  stoppingThought: string;
}

export const ICP_SCHEMA = {
  type: "object",
  properties: {
    selfDescription: { type: "string" },
    ageRange: { type: "string" },
    occupation: { type: "string" },
    context: { type: "string" },
    visceralPain: { type: "string" },
    failedAttempts: { type: "array", items: { type: "string" } },
    vocabulary: { type: "array", items: { type: "string" } },
    watches: { type: "array", items: { type: "string" } },
    turnOffs: { type: "array", items: { type: "string" } },
    stoppingThought: { type: "string" },
  },
  required: ["selfDescription", "ageRange", "occupation", "visceralPain", "stoppingThought"],
} as const;

/* ── Character sheet ─────────────────────────────────────────────────────── */

export interface CharacterSheet {
  /**
   * The locked anchor, in English, in casting terms. Injected verbatim into
   * every shot prompt and every reference image. Once set it must not change:
   * this string is the character's identity.
   */
  anchor: string;

  /** Ordinary, specific, unglamorous. A memorable face is not a pretty face. */
  distinguishingFeatures: string[];

  /** Their default clothes. Recurring wardrobe reads as one continuous person. */
  wardrobe: string[];

  /** The two or three rooms they film in, described down to the clutter. */
  locations: string[];

  /** How they speak: pace, fillers, verbal tics, what they never say. */
  voice: {
    pace: string;
    fillers: string[];
    tics: string[];
    neverSays: string[];
  };

  /** References produced from the anchor, passed to every generation. */
  referenceImages: CharacterReference[];
}

export interface CharacterReference {
  id: string;
  /** Why this angle exists in the set. */
  purpose: ReferencePurpose;
  prompt: string;
  url?: string;
}

export type ReferencePurpose =
  | "FRONT_NEUTRAL"
  | "THREE_QUARTER"
  | "EXPRESSION_SURPRISE"
  | "EXPRESSION_TIRED"
  | "WARDROBE_ALT"
  | "LOCATION_HOME"
  | "FULL_BODY";

/**
 * The seven-image set.
 *
 * Chosen to cover exactly what Omni needs to hold a face steady: the front and
 * three-quarter views fix the geometry, two expressions fix how the face moves,
 * a second outfit and a room fix the world, and a full body fixes the build.
 * More angles of the same neutral face would add nothing.
 */
export const REFERENCE_PLAN: Array<{
  purpose: ReferencePurpose;
  instruction: string;
  required: boolean;
}> = [
  {
    purpose: "FRONT_NEUTRAL",
    instruction:
      "Front-facing, neutral expression, looking straight into a phone's front camera at arm's length. Even indoor light. This is the master reference.",
    required: true,
  },
  {
    purpose: "THREE_QUARTER",
    instruction:
      "Turned about thirty degrees away, looking off to the side, not at the camera. Same room, same light.",
    required: true,
  },
  {
    purpose: "EXPRESSION_SURPRISE",
    instruction:
      "Mid-reaction: eyebrows up, mouth slightly open, caught genuinely off guard. Same face, same hair, same clothes.",
    required: true,
  },
  {
    purpose: "EXPRESSION_TIRED",
    instruction:
      "Tired, late in the day, eyes heavy, no energy for the camera. Same face, same hair.",
    required: false,
  },
  {
    purpose: "WARDROBE_ALT",
    instruction:
      "Same person, different everyday outfit from their wardrobe, different day. Face and hair unchanged.",
    required: true,
  },
  {
    purpose: "LOCATION_HOME",
    instruction:
      "Same person in their main room, medium shot, the room clearly visible behind them with its actual clutter.",
    required: true,
  },
  {
    purpose: "FULL_BODY",
    instruction:
      "Full body, standing, ordinary posture, so their build and height are unambiguous.",
    required: false,
  },
];

/**
 * Build the image prompt for one reference.
 *
 * Prompts a *photograph*, never a portrait: the moment the model thinks it is
 * making a portrait it produces studio light and a symmetrical face, and the
 * character stops being believable as a person who posts on their phone.
 */
export function compileReferencePrompt(
  sheet: Pick<CharacterSheet, "anchor" | "distinguishingFeatures" | "wardrobe" | "locations">,
  plan: (typeof REFERENCE_PLAN)[number],
): { prompt: string; negativePrompt: string } {
  const prompt = [
    "A candid photograph taken on a phone. Not a portrait, not a headshot — a picture somebody took of themselves in an ordinary moment.",
    "",
    `PERSON: ${sheet.anchor}`,
    sheet.distinguishingFeatures.length
      ? `DISTINGUISHING: ${sheet.distinguishingFeatures.join("; ")}`
      : "",
    `WEARING: ${sheet.wardrobe[0] ?? "ordinary everyday clothes, slightly worn"}`,
    `WHERE: ${sheet.locations[0] ?? "an ordinary lived-in room with real clutter"}`,
    "",
    `SHOT: ${plan.instruction}`,
    "",
    "Vertical 9:16. Phone front camera: mild lens distortion, visible skin texture with pores and small blemishes, uneven indoor light, no colour grade, slight sensor noise in the shadows.",
    "The face must be ordinary and specific rather than attractive — this person should look like someone you would pass in a corridor.",
  ]
    .filter(Boolean)
    .join("\n");

  const negativePrompt = [
    "studio lighting",
    "professional headshot",
    "beauty retouching",
    "airbrushed skin",
    "flawless complexion",
    "model",
    "fashion photography",
    "symmetrical face",
    "perfect teeth",
    "heavy makeup",
    "stock photo",
    "plain white background",
    "commercial",
    "watermark",
    "text",
    // The reference set is what every later generation is conditioned on, so an
    // interface that creeps into a reference propagates into every clip that
    // channel ever makes. One surprised-expression reference came back with a
    // phone held up in shot; nothing had asked for it.
    ...NEGATIVE_SETS.ANTI_UI,
  ].join(", ");

  return { prompt, negativePrompt };
}

export const CHARACTER_SHEET_SCHEMA = {
  type: "object",
  properties: {
    anchor: {
      type: "string",
      description:
        "In English, in casting terms. Age, build, exact hair, facial features, skin tone. Thirty words minimum. This is the character's locked identity.",
    },
    distinguishingFeatures: {
      type: "array",
      items: { type: "string" },
      description:
        "Two to four ordinary, specific details: a crooked tooth, dark circles, a bad tattoo, scratched glasses.",
    },
    wardrobe: {
      type: "array",
      items: { type: "string" },
      description: "Two or three everyday outfits, worn, never new.",
    },
    locations: {
      type: "array",
      items: { type: "string" },
      description:
        "Two or three rooms this person films in, described with the actual clutter in them.",
    },
    voice: {
      type: "object",
      properties: {
        pace: { type: "string" },
        fillers: { type: "array", items: { type: "string" } },
        tics: { type: "array", items: { type: "string" } },
        neverSays: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["anchor", "distinguishingFeatures", "wardrobe", "locations", "voice"],
} as const;

/** Reject a character sheet that will not hold up across a hundred clips. */
export function critiqueCharacterSheet(sheet: Partial<CharacterSheet>): string[] {
  const problems: string[] = [];
  const anchor = sheet.anchor ?? "";

  if (anchor.trim().split(/\s+/).length < 25) {
    problems.push(
      "The anchor is under 25 words. It has to fix age, build, exact hair, features and skin tone, or the face drifts between shots.",
    );
  }
  if (/beautiful|gorgeous|stunning|handsome|attractive|perfect/i.test(anchor)) {
    problems.push(
      "The anchor describes an ideal. A model's face cancels credibility — describe someone ordinary and specific.",
    );
  }
  if (!sheet.distinguishingFeatures?.length) {
    problems.push(
      "No distinguishing features. Ordinary imperfections are what make a face recognisable and human.",
    );
  }
  if ((sheet.locations?.length ?? 0) < 2) {
    problems.push(
      "Fewer than two locations. An account always filmed in the exact same corner looks constructed.",
    );
  }
  if (!sheet.voice?.fillers?.length) {
    problems.push(
      "No verbal tics. A voice with no hesitation or repetition sounds written, which means it sounds like an ad.",
    );
  }
  return problems;
}
