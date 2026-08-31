import {
  AMBIENCE,
  ANGLES,
  CAMERA_MOTION,
  LIGHTING,
  NEGATIVE_SETS,
  SHOT_SIZES,
  TEXTURE,
} from "./vocabulary";
import { SHOT_ARCHETYPES, type ShotSpec } from "./shot";

/**
 * The storyboard panel — one still frame per shot, generated before any video.
 *
 * This layer exists because of a measured asymmetry: the image model is far
 * better than the video model at composition, at detail, and above all at
 * holding a face. Asking the video model to invent the framing *and* animate it
 * gets both jobs done at the quality of the weaker one.
 *
 * So the frame is decided in images. The panel is generated from the character's
 * own photographs and from the previous panel, then the video model is asked to
 * animate a picture that is already right rather than to imagine one. The panel
 * is not documentation of the shot — it is the shot's primary specification, and
 * the prose below is what surrounds it.
 *
 * The economics matter as much as the quality. A panel costs about $0.13 and
 * three seconds; a clip costs about $0.60 and forty. Every rejection that can be
 * moved from the second stage to the first is a rejection that costs almost
 * nothing, which is what makes it affordable to be strict.
 */

export interface PanelSpec {
  /** Which beat of the scenario this panel freezes. */
  beatIndex: number;
  shot: ShotSpec;
  /**
   * The instant to freeze, in the shot's own timeline.
   *
   * A shot has a shape — someone starts talking, stops, reacts. Freezing the
   * wrong moment gives a panel that is technically correct and dramatically
   * inert, and the clip inherits that.
   */
  moment: "OPENING" | "TURN" | "LANDING";
}

export interface CompiledPanel {
  prompt: string;
  negativePrompt: string;
  aspectRatio: "9:16";
  spec: PanelSpec;
}

/**
 * Which instant of the shot the panel should freeze.
 *
 * The default is the turn — the moment the shot exists for. An opening frame is
 * used when the clip has to start on a face already in motion, and a landing
 * frame when what matters is the reaction after the line.
 */
export function momentFor(shot: ShotSpec, isFirst: boolean): PanelSpec["moment"] {
  if (isFirst) return "OPENING";
  if (!shot.speech) return "LANDING";
  return "TURN";
}

const MOMENT_DIRECTION: Record<PanelSpec["moment"], string> = {
  OPENING:
    "Freeze the very first instant of the shot, when it is already under way — the person is mid-movement or mid-word, never waiting for a cue.",
  TURN:
    "Freeze the pivot of the shot: the exact instant the expression changes and the shot becomes worth watching.",
  LANDING:
    "Freeze the moment just after the important thing has happened, while it is still landing on their face.",
};

/**
 * Compile a panel prompt.
 *
 * Deliberately close to `compileShot` in vocabulary and ordering, because the
 * panel and the clip must describe the same object. Where they differ is that
 * this one asks for a photograph rather than an action: no motion verbs, no
 * duration, no speech — a still cannot render a sentence, and asking it to
 * produces a mouth caught in an ugly shape.
 */
export function compilePanel(spec: PanelSpec, continuity?: string): CompiledPanel {
  const { shot } = spec;
  const archetype = SHOT_ARCHETYPES[shot.archetype];
  const size = SHOT_SIZES[shot.size ?? archetype.defaults.size];
  const angle = ANGLES[shot.angle ?? archetype.defaults.angle];
  const motion = CAMERA_MOTION[shot.motion ?? archetype.defaults.motion];
  const texture = TEXTURE[shot.texture ?? archetype.defaults.texture];
  const lighting = LIGHTING[shot.lighting];

  const parts: string[] = [
    "A single frame lifted out of a video somebody filmed on their phone. A photograph of a real moment, not a composed picture.",
    "",
    `PERSON: ${shot.subject}`,
    `WHERE: ${shot.environment}`,
    "",
    `WHAT IS HAPPENING: ${shot.action}`,
    MOMENT_DIRECTION[spec.moment],
  ];

  // A still cannot say a line, but the line governs the mouth and the eyes, so
  // it is given as direction rather than as dialogue.
  if (shot.speech) {
    parts.push(
      `They are in the middle of saying "${shot.speech}" — the mouth and eyes should be caught mid-phrase, not posed between sentences.`,
    );
  }

  parts.push(
    "",
    `FRAMING: ${size}, ${angle}. ${archetype.frame}`,
    `THE CAMERA: ${motion}. This frame is what that camera saw.`,
    `LIGHT: ${lighting}`,
    `LOOK: ${texture}`,
  );

  if (shot.archetype !== "MIRROR" && shot.archetype !== "FOUND_FOOTAGE") {
    parts.push(
      "The camera is the phone itself. No phone, no screen and no camera interface appear anywhere in the picture.",
    );
  }

  if (continuity) {
    parts.push("", `CONTINUITY: ${continuity}`);
  }

  parts.push(
    "",
    "Vertical 9:16. The skin has pores, texture and small blemishes. The room has its real clutter in it. Nothing has been tidied, lit or arranged for the picture.",
  );

  const negatives = new Set<string>();
  for (const set of ["ANTI_COMMERCIAL", "ANTI_PLASTIC", "ANTI_STAGED", "ANTI_TEXT"] as const) {
    for (const n of NEGATIVE_SETS[set]) negatives.add(n);
  }
  if (shot.archetype !== "MIRROR" && shot.archetype !== "FOUND_FOOTAGE") {
    for (const n of NEGATIVE_SETS.ANTI_UI) negatives.add(n);
  }
  if (shot.archetype !== "DRAMA") {
    for (const n of NEGATIVE_SETS.ANTI_CINEMA) negatives.add(n);
  }
  for (const n of shot.avoid ?? []) negatives.add(n);

  return {
    prompt: parts.filter((p) => p !== undefined).join("\n"),
    negativePrompt: [...negatives].join(", "),
    aspectRatio: "9:16",
    spec,
  };
}

/**
 * The continuity note carried from one panel to the next.
 *
 * Written as a set of facts that must not change rather than as an instruction
 * to "keep it consistent", which a model reads as a suggestion. The previous
 * panel is also attached as an image, and the two together are what make a
 * sequence look like one afternoon rather than five unrelated photographs.
 */
export function continuityFrom(previous: ShotSpec, next: ShotSpec): string | undefined {
  const facts: string[] = [];

  if (previous.environment === next.environment) {
    facts.push("the same room, from a different position — the same objects are still where they were");
  }
  facts.push("the same clothes, the same hair, the same day");
  facts.push("the same light, from the same source, at the same time of day");

  const attached =
    "The attached photograph is the previous frame of this same video: same person, same place, moments earlier.";

  return `${attached} Keep ${facts.join("; ")}.`;
}

/**
 * What has to be true of a panel before it is worth animating.
 *
 * Returned as questions for a vision model rather than as a score, so a failure
 * can name what is wrong and the regeneration can address it.
 */
export const PANEL_CHECKS = [
  {
    id: "IDENTITY",
    question:
      "Is the person in this image the same individual as in the reference photographs — same face, same age, same hair, same build?",
  },
  {
    id: "INTERFACE",
    question:
      "Does the image contain any phone screen, camera app interface, shutter button, on-screen control, or device frame?",
  },
  {
    id: "TEXT",
    question:
      "Is there any readable or unreadable text, watermark, caption or logo burnt into the image?",
  },
  {
    id: "ANATOMY",
    question:
      "Are the hands, fingers, eyes and teeth anatomically correct, with the right number of fingers?",
  },
  {
    id: "REGISTER",
    question:
      "Does this look like a frame from a phone video somebody actually posted, rather than a studio photograph, a stock image or an advertisement?",
  },
] as const;

export type PanelCheckId = (typeof PANEL_CHECKS)[number]["id"];

export const PANEL_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    identityMatches: { type: "boolean" },
    hasInterface: { type: "boolean" },
    hasText: { type: "boolean" },
    anatomyCorrect: { type: "boolean" },
    readsAsPhoneVideo: { type: "boolean" },
    /** What to change in the prompt if this panel is rejected. */
    fix: { type: "string" },
    notes: { type: "string" },
  },
  required: [
    "identityMatches",
    "hasInterface",
    "hasText",
    "anatomyCorrect",
    "readsAsPhoneVideo",
  ],
} as const;

export interface PanelVerdict {
  identityMatches: boolean;
  hasInterface: boolean;
  hasText: boolean;
  anatomyCorrect: boolean;
  readsAsPhoneVideo: boolean;
  fix?: string;
  notes?: string;
}

/** A panel passes only if every check passes. There is no partial credit here. */
export function panelPasses(v: PanelVerdict): boolean {
  return (
    v.identityMatches &&
    !v.hasInterface &&
    !v.hasText &&
    v.anatomyCorrect &&
    v.readsAsPhoneVideo
  );
}

export function panelFailures(v: PanelVerdict): string[] {
  const out: string[] = [];
  if (!v.identityMatches) out.push("not the same person as the character sheet");
  if (v.hasInterface) out.push("a phone or camera interface is visible in the frame");
  if (v.hasText) out.push("text or a watermark is burnt into the image");
  if (!v.anatomyCorrect) out.push("hands, eyes or teeth are wrong");
  if (!v.readsAsPhoneVideo) out.push("it reads as a studio photograph rather than a phone video");
  return out;
}
