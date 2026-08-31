import {
  AMBIENCE,
  ANGLES,
  CAMERA_MOTION,
  LIGHTING,
  NEGATIVE_SETS,
  PERFORMANCE,
  SHOT_SIZES,
  TEXTURE,
  type Ambience,
  type Angle,
  type CameraMotion,
  type Lighting,
  type NegativeSet,
  type Performance,
  type ShotSize,
  type Texture,
} from "./vocabulary";

/**
 * Shot specification and its compiler.
 *
 * The agent describes a shot as a typed object and this module turns it into the
 * prompt string. That split is deliberate and is the fix for the single biggest
 * quality problem in AI video: a model asked for "a prompt" produces a vague
 * sentence, and a vague sentence produces a generic clip.
 *
 * Here the model only supplies what genuinely requires judgement — who is in the
 * shot, what they do, what they say — and the craft layer supplies everything a
 * cinematographer would: framing, motion, motivated light, sensor texture, room
 * tone, and the negatives that keep the result from drifting into a commercial.
 */

/* ── Shot archetypes ─────────────────────────────────────────────────────── */

/**
 * Each archetype is a different *shape* of shot, not a different subject. This
 * is what stops a fleet from producing ten variations of the same talking head:
 * a POV shot, a security-camera shot and a two-hander scene are structurally
 * different objects, and the taxonomy forces the agent to choose between them.
 */
export const SHOT_ARCHETYPES = {
  SELFIE_TALK: {
    label: "Selfie, talking to camera",
    defaults: {
      size: "MCU" as ShotSize,
      angle: "SELFIE_HIGH" as Angle,
      motion: "HANDHELD_DRIFT" as CameraMotion,
      texture: "IPHONE_FRONT" as Texture,
    },
    frame:
      "The subject is holding the phone themselves at arm's length. The top of the head is slightly cropped. Their arm is just visible at the edge of frame.",
  },
  SELFIE_REACTION: {
    label: "Selfie, silent reaction",
    defaults: {
      size: "CU" as ShotSize,
      angle: "SELFIE_HIGH" as Angle,
      motion: "HANDHELD_STATIC" as CameraMotion,
      texture: "IPHONE_FRONT" as Texture,
    },
    frame:
      "The subject is not speaking. The entire shot is the face reacting. They are close to the lens, filling most of the frame.",
  },
  MIRROR: {
    label: "Filmed in a mirror",
    defaults: {
      size: "MS" as ShotSize,
      angle: "EYE" as Angle,
      motion: "HANDHELD_STATIC" as CameraMotion,
      texture: "IPHONE_BACK" as Texture,
    },
    frame:
      "Filmed into a mirror. The phone is visible in the subject's hand, partly covering their face. The mirror has marks on it.",
  },
  POV: {
    label: "First person",
    defaults: {
      size: "MWS" as ShotSize,
      angle: "EYE" as Angle,
      motion: "WALK" as CameraMotion,
      texture: "IPHONE_BACK" as Texture,
    },
    frame:
      "First person. The camera is the subject's eyes. Their own hands enter frame from the bottom. Nobody addresses the camera.",
  },
  OBSERVER: {
    label: "Somebody filming the scene",
    defaults: {
      size: "MWS" as ShotSize,
      angle: "HIP" as Angle,
      motion: "HANDHELD_DRIFT" as CameraMotion,
      texture: "IPHONE_BACK" as Texture,
    },
    frame:
      "Someone off-camera is filming this, half-hidden, not supposed to be. The framing is imperfect and readjusts once.",
  },
  INSERT: {
    label: "Insert on hands or object",
    defaults: {
      size: "INSERT" as ShotSize,
      angle: "OVERHEAD" as Angle,
      motion: "HANDHELD_STATIC" as CameraMotion,
      texture: "IPHONE_BACK" as Texture,
    },
    frame: "Only hands and the object. No face. Shot close, from above.",
  },
  SCENE_TWO_HANDER: {
    label: "Two-hander scene",
    defaults: {
      size: "MS" as ShotSize,
      angle: "EYE" as Angle,
      motion: "HANDHELD_DRIFT" as CameraMotion,
      texture: "CLEAN_DIGITAL" as Texture,
    },
    frame:
      "Two people in the frame playing a scene to each other, not to the camera. The camera is an unacknowledged observer.",
  },
  DRAMA: {
    label: "Openly staged fiction",
    defaults: {
      size: "MCU" as ShotSize,
      angle: "EYE" as Angle,
      motion: "PUSH_IN" as CameraMotion,
      texture: "FILM_DRAMA" as Texture,
    },
    frame:
      "A properly staged dramatic scene. Composed, deliberate, performed. This is the one archetype where production value is the point.",
  },
  FOUND_FOOTAGE: {
    label: "Found footage",
    defaults: {
      size: "MWS" as ShotSize,
      angle: "EYE" as Angle,
      motion: "LOCKED_PROP" as CameraMotion,
      texture: "SECURITY_CAM" as Texture,
    },
    frame:
      "Footage that was not composed by anyone: a fixed camera, a video call, a screen being filmed. Nobody framed this.",
  },
  WALK_AND_TALK: {
    label: "Walking and talking",
    defaults: {
      size: "MCU" as ShotSize,
      angle: "SELFIE_HIGH" as Angle,
      motion: "WALK" as CameraMotion,
      texture: "IPHONE_FRONT" as Texture,
    },
    frame:
      "Walking while filming themselves, out of breath at the edges of sentences, the background moving past.",
  },
} as const;
export type ShotArchetype = keyof typeof SHOT_ARCHETYPES;

/* ── The spec ────────────────────────────────────────────────────────────── */

export interface ShotSpec {
  archetype: ShotArchetype;

  /**
   * Who is in frame, in casting terms. Comes from the persona's locked character
   * sheet, never invented per shot — this is the anchor that makes the same face
   * appear across a hundred videos.
   */
  subject: string;

  /** What physically happens. Present tense, one or two beats, concrete. */
  action: string;

  /**
   * The line, if any. Omni generates audio with the picture, so this is spoken
   * in the clip rather than dubbed on afterwards.
   */
  speech?: string;

  /** How the line is delivered, and how the face behaves. */
  performance?: Performance;

  /** Where this happens. Specific and lived-in beats generic and tidy. */
  environment: string;

  size?: ShotSize;
  angle?: Angle;
  motion?: CameraMotion;
  lighting: Lighting;
  texture?: Texture;
  ambience?: Ambience;

  /** Anything that must not appear, beyond the standard negative sets. */
  avoid?: string[];

  /** Extra negative sets on top of the defaults for the archetype. */
  negativeSets?: NegativeSet[];

  durationSeconds: number;
}

/* ── Compiler ────────────────────────────────────────────────────────────── */

export interface CompiledPrompt {
  prompt: string;
  negativePrompt: string;
  durationSeconds: number;
  aspectRatio: "9:16";
  /** Kept for the trace, so a bad clip can be traced back to its inputs. */
  spec: ShotSpec;
}

/**
 * Turn a spec into the text Omni actually receives.
 *
 * The ordering is not cosmetic. Video models weight the opening of a prompt most
 * heavily, so the format declaration and the subject anchor come first: what
 * matters most is that it is a vertical phone video of *this specific person*.
 * Everything a viewer would never consciously notice — sensor grain, room tone —
 * comes last, where it modulates rather than dominates.
 */
export function compileShot(spec: ShotSpec): CompiledPrompt {
  const archetype = SHOT_ARCHETYPES[spec.archetype];
  const size = SHOT_SIZES[spec.size ?? archetype.defaults.size];
  const angle = ANGLES[spec.angle ?? archetype.defaults.angle];
  const motion = CAMERA_MOTION[spec.motion ?? archetype.defaults.motion];
  const texture = TEXTURE[spec.texture ?? archetype.defaults.texture];
  const lighting = LIGHTING[spec.lighting];
  const ambience = AMBIENCE[spec.ambience ?? "ROOM_QUIET"];

  const parts: string[] = [];

  // 1. Format and medium, first — this frames everything that follows.
  //
  // The declaration has to match the archetype: telling the model "filmed on a
  // phone" and then asking for a staged dramatic scene on a cinema camera gives
  // it two incompatible instructions, and it will split the difference badly.
  parts.push(`${openingDeclaration(spec.archetype)} Vertical 9:16, ${spec.durationSeconds} seconds.`);

  // 2. Who. The locked anchor.
  parts.push(`SUBJECT: ${spec.subject}`);

  // 3. What happens.
  parts.push(`ACTION: ${spec.action}`);

  if (spec.speech) {
    const delivery = spec.performance ? PERFORMANCE[spec.performance] : "natural, unrehearsed";
    parts.push(
      `SPEECH: they say, out loud, in the clip: "${spec.speech}" — delivered ${delivery}. Conversational, with the small hesitations of real speech. Never announced or performed for an audience.`,
    );
  } else if (spec.performance) {
    parts.push(`PERFORMANCE: ${PERFORMANCE[spec.performance]}`);
  }

  // 4. Where.
  parts.push(`SETTING: ${spec.environment}`);

  // 5. How it is filmed.
  parts.push(`FRAMING: ${size}, ${angle}. ${archetype.frame}`);
  parts.push(`CAMERA: ${motion}`);
  parts.push(`LIGHT: ${lighting}`);
  parts.push(`LOOK: ${texture}`);
  parts.push(`SOUND: ${ambience}`);

  const negatives = new Set<string>();
  for (const set of defaultNegativesFor(spec.archetype)) {
    for (const n of NEGATIVE_SETS[set]) negatives.add(n);
  }
  for (const set of spec.negativeSets ?? []) {
    for (const n of NEGATIVE_SETS[set]) negatives.add(n);
  }
  for (const n of spec.avoid ?? []) negatives.add(n);

  return {
    prompt: parts.join("\n"),
    negativePrompt: [...negatives].join(", "),
    durationSeconds: spec.durationSeconds,
    aspectRatio: "9:16",
    spec,
  };
}

/**
 * How the clip declares itself in its opening line.
 *
 * Video models weight the first sentence most heavily, so this is where the
 * register is set — and getting it wrong here cannot be recovered by anything
 * further down the prompt.
 */
function openingDeclaration(archetype: ShotArchetype): string {
  switch (archetype) {
    case "DRAMA":
      return "A scene from a short dramatic film. Performed, composed, deliberately shot.";
    case "SCENE_TWO_HANDER":
      return "A scene between two people, filmed by someone standing nearby. Not addressed to the camera.";
    case "FOUND_FOOTAGE":
      return "Footage nobody composed: a fixed camera, a call, or a screen being filmed. Not made for an audience.";
    case "POV":
      return "First-person footage from someone's own eyes as they move through a moment.";
    case "INSERT":
      return "A close shot of hands and an object, filmed one-handed on a phone.";
    default:
      return "A clip somebody filmed on their own phone and posted. Not an advertisement.";
  }
}

/**
 * Baseline negatives per archetype.
 *
 * A deliberately staged drama scene must not carry the anti-cinema negatives —
 * suppressing composition there would defeat the format. Everything else does.
 */
function defaultNegativesFor(archetype: ShotArchetype): NegativeSet[] {
  if (archetype === "DRAMA") {
    return ["ANTI_COMMERCIAL", "ANTI_PLASTIC", "ANTI_TEXT"];
  }
  if (archetype === "SCENE_TWO_HANDER") {
    return ["ANTI_COMMERCIAL", "ANTI_PLASTIC", "ANTI_STAGED", "ANTI_TEXT"];
  }
  return ["ANTI_COMMERCIAL", "ANTI_PLASTIC", "ANTI_CINEMA", "ANTI_STAGED", "ANTI_TEXT"];
}

/**
 * Score a spec for the failure modes that actually ruin UGC clips.
 *
 * Returns problems, not a number: a note an agent can act on beats a score it
 * can only stare at.
 */
export function critiqueShot(spec: ShotSpec): string[] {
  const problems: string[] = [];

  if (spec.subject.trim().split(/\s+/).length < 10) {
    problems.push(
      "The subject anchor is too short. Without age, hair, clothes and build, the face changes between shots.",
    );
  }
  if (/beautiful|gorgeous|stunning|perfect|model|attractive/i.test(spec.subject)) {
    problems.push(
      "The subject is described in terms of beauty. A model's face destroys credibility — describe a person, not an ideal.",
    );
  }
  if (spec.action.trim().split(/\s+/).length < 5) {
    problems.push("The action is too vague to perform. Say what physically happens.");
  }
  if (/cinematic|epic|beautiful|stunning|4k|8k|high quality|masterpiece/i.test(spec.action + spec.environment)) {
    problems.push(
      "Generic render vocabulary found ('cinematic', '4k'). Those words push the model toward the glossy commercial look.",
    );
  }
  if (spec.environment.trim().split(/\s+/).length < 5) {
    problems.push(
      "The setting is too vague. A generic place produces a studio backdrop — name objects that are lying around.",
    );
  }
  if (spec.speech && spec.speech.split(/\s+/).length > spec.durationSeconds * 3.2) {
    problems.push(
      `The line is ${spec.speech.split(/\s+/).length} words for ${spec.durationSeconds}s. Past about three words a second the delivery stops sounding human.`,
    );
  }
  if (spec.speech && /^(hey guys|hi everyone|hello everyone|what's up guys)/i.test(spec.speech.trim())) {
    problems.push(
      "The line opens with a greeting. That is disqualifying — you always enter mid-sentence.",
    );
  }
  if (spec.durationSeconds < 3 || spec.durationSeconds > 10) {
    problems.push(`Duration of ${spec.durationSeconds}s is outside the model's range (3 to 10s).`);
  }

  return problems;
}
