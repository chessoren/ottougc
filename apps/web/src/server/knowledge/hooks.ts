import type { HookArchetype } from "./types";

/**
 * Hook library — DOC-001, DOC-013, DOC-014.
 *
 * A hook is not a sentence, it is a three-layer synesthetic interception fired
 * inside the first 4 seconds: visual rupture (0.00-0.80s), vocal attack
 * (0.00-1.20s), textual dissonance (0.00-3.00s). The archetypes below encode the
 * *psychology*; the templates are filled from brand knowledge so the model
 * rewrites real material instead of inventing claims.
 */
export const HOOK_ARCHETYPES: HookArchetype[] = [
  {
    id: "COGNITIVE_DISSONANCE",
    name: "Cognitive dissonance",
    psychology:
      "The text on screen says one thing, the voice says another. The brain cannot process two contradictory signals on autopilot and switches to full attention.",
    templates: [
      "STOP USING {{oldWay}}",
      "DELETE THIS HABIT TODAY",
      "NOBODY SHOULD STILL DO {{task}} BY HAND",
    ],
    visualDirection:
      "Tight on a defeated face, head in hands, then cut to a screen full of red errors.",
    bestFor: ["TALKING_HEAD", "SCREENCAST", "COMPARISON"],
    retentionLift: 0.18,
  },
  {
    id: "LOSS_AVERSION",
    name: "Loss already happening",
    psychology:
      "Losing something hurts roughly twice as much as gaining the same thing feels good. So you do not promise a gain — you name a loss that is already underway.",
    templates: [
      "If you're still doing this by hand, you're losing {{metric}} a week.",
      "You're losing {{metric}} every week without noticing.",
      "You've been paying for nothing for {{duration}}.",
    ],
    visualDirection:
      "Finger jabbed at the lens, a hard snap zoom, a red warning light in frame.",
    bestFor: ["TALKING_HEAD", "COMPARISON", "SCREENCAST"],
    retentionLift: 0.21,
  },
  {
    id: "ILLICIT_LEAK",
    name: "Fuite clandestine",
    psychology:
      "Voyeurism plus the wish for an unfair advantage. The viewer isn't consuming information, they're stealing a secret.",
    templates: [
      "Ce que les agences ne veulent pas que tu saches sur {{task}}.",
      "My boss wasn't supposed to see this",
      "The thing {{profession}} pass around privately.",
    ],
    visualDirection:
      "Very close to the mic, whispering, hand half over the mouth, eyes flicking off to the side.",
    bestFor: ["TALKING_HEAD", "SKIT"],
    retentionLift: 0.24,
  },
  {
    id: "SPEED_SHOCK",
    name: "Speed shock",
    psychology:
      "A speed gap wide enough to trigger disbelief. Disbelief makes people watch to check.",
    templates: [
      "{{oldWayDuration}} de boulot fait en {{newWayDuration}}.",
      "From nothing to {{outcome}} in three clicks?",
      "I finished my week on Tuesday afternoon.",
    ],
    visualDirection:
      "Close on a click triggering a bright green confirmation, timer visible.",
    bestFor: ["SCREENCAST", "COMPARISON"],
    retentionLift: 0.19,
  },
  {
    id: "MYTH_BUSTER",
    name: "Myth break",
    psychology:
      "Attacking something the viewer believes creates a debt: they have to stay to find out whether they were wrong.",
    templates: [
      "Stop believing {{commonBelief}}.",
      "Tout ce qu'on t'a appris sur {{niche}} est faux.",
      "Why most people get {{task}} wrong.",
    ],
    visualDirection: "Straight to camera, motionless, arms folded, nothing moving for 1.5s.",
    bestFor: ["TALKING_HEAD", "CAROUSEL", "SKIT"],
    retentionLift: 0.16,
  },
  {
    id: "PERSONAL_CRISIS",
    name: "Crise personnelle",
    psychology:
      "An immediate human stake suspends the advertising check: nobody is suspicious of someone describing their own disaster.",
    templates: [
      "{{crisisEvent}} last night… and it went completely sideways.",
      "I nearly {{consequence}} because of {{pain}}.",
      "Il est {{time}} et je viens de comprendre que j'avais tout perdu.",
    ],
    visualDirection:
      "Anxious face, walking fast outside at night, handheld, breathing audible.",
    bestFor: ["STORY", "TALKING_HEAD", "CAROUSEL"],
    retentionLift: 0.22,
  },
  {
    id: "FORBIDDEN_LIST",
    name: "Liste transgressive",
    psychology:
      "A list promises an ending, which holds people to the last item. The transgression is what makes it worth sending on.",
    templates: [
      "Three tools so good they feel like cheating.",
      "The {{n}} free tools that replace a {{competitorPrice}} agency.",
      "Save this before it goes paid.",
    ],
    visualDirection: "Full-frame text on a dark background, a 3-2-1 countdown, fast cuts.",
    bestFor: ["SLIDESHOW", "CAROUSEL"],
    retentionLift: 0.14,
  },
  {
    id: "SOCIAL_PROOF_INVERSION",
    name: "Turned objection",
    psychology:
      "Starting from the viewer's own objection makes them feel understood before they feel persuaded.",
    templates: [
      "\"This is a scam, it never works\" — fine, watch.",
      "Four hundred of you told me this was impossible.",
      "The top comment says I'm lying. Let's check.",
    ],
    visualDirection:
      "Comment card at the top, the person below reading it in silence for a second.",
    bestFor: ["TALKING_HEAD", "SCREENCAST"],
    retentionLift: 0.26,
  },
  {
    id: "POV_IMMERSION",
    name: "POV immersif",
    psychology:
      "First person removes the speaker: there is nobody to resist, so there is nothing to argue with.",
    templates: [
      "POV: it's {{time}}, it's due tomorrow, and you haven't started.",
      "POV : ton boss te demande {{task}} pour ce soir.",
    ],
    visualDirection: "First person, hands on a keyboard, blank screen, clock visible.",
    bestFor: ["STORY", "SCREENCAST"],
    retentionLift: 0.15,
  },
  {
    id: "RELATABLE_HUMOR",
    name: "Humour d'identification",
    psychology:
      "Recognition laughter produces the highest share rate: you send it to someone living the same thing.",
    templates: [
      "{{profession}} realising they've done this by hand for three years:",
      "Me explaining to my boss why I finished in twenty minutes:",
    ],
    visualDirection: "Exaggerated expression, straight on, freeze frame on the punchline.",
    bestFor: ["SKIT", "SLIDESHOW"],
    retentionLift: 0.12,
  },
];

export const HOOK_ARCHETYPES_BY_ID = new Map(HOOK_ARCHETYPES.map((h) => [h.id, h]));

/**
 * Hook Efficacy Score (DOC-001).
 *
 *   HES = 0.35·A_vis + 0.30·V_audio + 0.25·D_cog + 0.10·S_safe
 *
 * Any script scoring below 82 is rewritten *before* a single generation credit
 * is spent. That gate is the main cost control of the whole pipeline: rejecting
 * a bad hook costs ~200 tokens, rendering it costs ~$0.45.
 */
export const HES_THRESHOLD = 82;

export interface HesInput {
  /** Aggressiveness of the incoming movement, 0-100. */
  visualAggression: number;
  /** Speech velocity (target 3.8-4.4 syllables/s) + initial SFX peak, 0-100. */
  audioVelocity: number;
  /** Semantic dissonance between on-screen text and narration, 0-100. */
  cognitiveDissonance: number;
  /** Geometric compliance with the platform safe zones, 0-100. */
  safeZoneCompliance: number;
}

export function hookEfficacyScore(input: HesInput): number {
  const score =
    0.35 * input.visualAggression +
    0.3 * input.audioVelocity +
    0.25 * input.cognitiveDissonance +
    0.1 * input.safeZoneCompliance;
  return Math.round(score * 100) / 100;
}

/** Hard rules the first 4 seconds must satisfy. Violations are eliminatory. */
export const HOOK_FORBIDDEN = [
  "A black frame or a fade from black at frame zero",
  "Logo de marque avant la 9e seconde",
  "More than 0.05s of opening silence",
  "Plan fixe sur un personnage statique pendant plus de 1,8 s",
  "A greeting (\"hi everyone\", \"welcome back\")",
  "An opening filler (\"um…\") or a flat delivery",
  "Bandeau textuel de plus de 7 mots",
  "Revealing the whole solution or the product name before five seconds",
  "Explaining abstractly how the product works",
];

/** The 4-second timeline every hook must fill. Given verbatim to the writer. */
export const HOOK_TIMELINE = [
  {
    window: "0.00-0.40s",
    channel: "Visuel + SFX",
    requirement:
      "Motion on entry (an 18% snap punch-in or a whip pan) plus an impact sound with under 20ms of attack at -3dB. Frame zero bright and contrasty.",
  },
  {
    window: "0.40-1.20s",
    channel: "Voix + typographie",
    requirement:
      "First syllable with no audible breath before it. Banner in caps, sans serif, around 80pt, on a contrasting background.",
  },
  {
    window: "1.20-2.40s",
    channel: "Cadre + tension",
    requirement:
      "A 45-degree angle break or a cut to b-roll. Delivery 10% faster. The real chore stated plainly.",
  },
  {
    window: "2.40-4.00s",
    channel: "The bridge",
    requirement:
      "State the bridge (\"but watch what happens when…\") and lock into the demonstration.",
  },
];

/** DOC-014 — visual pattern breakers available at frame 0. */
export const VISUAL_HOOKS = [
  "Whispering close to the mic, hand half over the mouth",
  "A phone slapped down on a table, the camera shaking",
  "A screen swung abruptly toward the viewer",
  "A red system error appearing suddenly",
  "A before/after split, the left half drab, the right half bright",
  "A finger pointed at the lens with a step forward",
  "A sheet of paper torn up, standing for the old way",
  "Zoom macro ultra-rapide sur un chiffre exorbitant",
  "An earphone pulled out sharply while turning to the lens",
  "An object dropped or slammed off-camera, sound before picture",
];
