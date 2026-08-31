/**
 * Shared vocabulary for the creative knowledge base.
 *
 * These types are the contract between three consumers:
 *   1. the scriptwriter agent, which reads a format and fills its beats,
 *   2. the visual director, which turns beats into Veo / Imagen prompts,
 *   3. the Remotion compositions, which lay the resulting assets on a timeline.
 */

export type AwarenessLevel =
  | "UNAWARE"
  | "PROBLEM_AWARE"
  | "SOLUTION_AWARE"
  | "PRODUCT_AWARE"
  | "MOST_AWARE";

export type MediaNeed =
  | "AVATAR_CLIP"
  | "BROLL_CLIP"
  | "SCREENCAST"
  | "STILL"
  | "CAROUSEL_SLIDE"
  | "VOICEOVER"
  | "MUSIC"
  | "SFX"
  | "CAPTIONS";

export type FormatFamily =
  | "CAROUSEL"
  | "TALKING_HEAD"
  | "SCREENCAST"
  | "STORY"
  | "COMPARISON"
  | "SKIT"
  | "SLIDESHOW";

/**
 * CTA ladder (DOC-009). The fleet-wide mix is enforced by the manager agent:
 * 70% level 0-1, 20% level 2, 10% level 3. Hammering level 3 on every video is
 * the fastest way to train an audience to scroll past the account.
 */
export type CtaLevel = 0 | 1 | 2 | 3;

export interface FormatBeat {
  /** Short label shown in the storyboard UI. */
  label: string;
  startMs: number;
  endMs: number;
  /** What this beat must accomplish. Given verbatim to the scriptwriter. */
  purpose: string;
  /** Direction for the visual director; becomes part of the Veo/Imagen prompt. */
  visual: string;
  /** Example narration. `{{brand}}`, `{{pain}}`, `{{metric}}` are interpolated. */
  narration?: string;
  onScreenText?: string;
  sfx?: string[];
  /** Which pattern-interrupt technique fires here (DOC-003). */
  patternInterrupt?: string;
}

export interface UgcFormat {
  id: string;
  name: string;
  slug: string;
  family: FormatFamily;
  /** Remotion composition that renders this format. */
  composition: string;
  /** Audience temperature this format is designed for. */
  awarenessFit: AwarenessLevel[];
  /** 0 = brand never named, 1 = brand is the subject. Trojan-horse formats sit low. */
  brandDensity: number;
  /** Prose rule for *when* the brand may appear. */
  brandPlacement: string;
  durationMs: [number, number];
  slideCount?: [number, number];
  premise: string;
  whyItWorks: string;
  beats: FormatBeat[];
  mediaNeeds: MediaNeed[];
  ctaLevel: CtaLevel;
  benchmarks: {
    retention3s?: number;
    completionRate?: number;
    saveRate?: number;
    shareRate?: number;
  };
  /** Our marginal cost to produce one, in USD, at current model prices. */
  estimatedCostUsd: number;
  productionNotes: string[];
  forbidden: string[];
}

export interface HookArchetype {
  id: string;
  name: string;
  psychology: string;
  /** Template with `{{...}}` slots the scriptwriter fills from brand knowledge. */
  templates: string[];
  visualDirection: string;
  bestFor: FormatFamily[];
  /** Observed 3s retention lift vs. the account baseline. */
  retentionLift: number;
}

export interface PersonaArchetype {
  id: string;
  name: string;
  handlePattern: string;
  awareness: AwarenessLevel;
  dominantFormats: string[];
  angle: string;
  voice: string;
  /** Physical/wardrobe anchor so the same face renders across every clip. */
  appearanceSeed: string;
  brandDensity: number;
  contentPillars: string[];
}
