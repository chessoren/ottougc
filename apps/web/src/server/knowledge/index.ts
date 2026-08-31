/**
 * The creative knowledge base.
 *
 * Scenarios are the catalogue; the older "format" taxonomy has been removed. A
 * thin adapter keeps `getFormat` working for the call sites that only need a
 * name, a cost and a set of things a scenario forbids.
 */
export * from "./types";
export * from "./hooks";
export * from "./retention";
export * from "./personas";
export * from "./text";

import { ALL_SCENARIOS, defaultMixFor, getScenario } from "./scenarios";
import type { UgcFormat } from "./types";

/** Every scenario, presented in the shape older call sites expect. */
export const ALL_FORMATS: UgcFormat[] = ALL_SCENARIOS.map(toFormat);

export const ALL_FORMATS_BY_ID = new Map(ALL_FORMATS.map((f) => [f.id, f]));

export function getFormat(id: string): UgcFormat | undefined {
  const scenario = getScenario(id);
  return scenario ? toFormat(scenario) : undefined;
}

export function formatsForAwareness(level: string): UgcFormat[] {
  return ALL_FORMATS.filter((f) => f.awarenessFit.includes(level as never));
}

export function cheapFormats(maxUsd = 1): UgcFormat[] {
  return ALL_FORMATS.filter((f) => f.estimatedCostUsd <= maxUsd);
}

/** Starting mix for a channel with no history. */
export const FORMAT_MIX_DEFAULT = defaultMixFor("PROBLEM_AWARE");

function toFormat(s: (typeof ALL_SCENARIOS)[number]): UgcFormat {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    family: familyOf(s.family),
    composition: "TimelineRenderer",
    awarenessFit: s.awarenessFit,
    brandDensity: 1 - s.brandEntry.atRatio,
    brandPlacement: s.brandEntry.manner,
    durationMs: s.shape.durationMs,
    premise: s.premise,
    whyItWorks: s.whyItWorks,
    beats: s.beats.map((b) => ({
      label: b.label,
      startMs: 0,
      endMs: b.durationSeconds * 1000,
      purpose: b.purpose,
      visual: b.direction,
      narration: b.line,
      onScreenText: b.overlayText,
      patternInterrupt: b.interrupt,
    })),
    mediaNeeds: mediaNeedsOf(s),
    ctaLevel: s.ctaLevel,
    benchmarks: s.benchmarks,
    estimatedCostUsd: s.estimatedCostUsd,
    productionNotes: s.editNotes,
    forbidden: s.forbidden,
  };
}

function familyOf(family: string): UgcFormat["family"] {
  switch (family) {
    case "DRAMA":
      return "SKIT";
    case "FACELESS":
      return "SLIDESHOW";
    case "EVIDENCE":
      return "SCREENCAST";
    case "SITUATION":
      return "STORY";
    case "REACTIVE":
      return "TALKING_HEAD";
    default:
      return "STORY";
  }
}

function mediaNeedsOf(s: (typeof ALL_SCENARIOS)[number]): UgcFormat["mediaNeeds"] {
  const needs: UgcFormat["mediaNeeds"] = [];
  if (s.shape.face !== "NONE") needs.push("AVATAR_CLIP");
  needs.push("BROLL_CLIP");
  if (s.shape.speech === "VOICEOVER") needs.push("VOICEOVER");
  if (s.shape.music !== "NONE") needs.push("MUSIC");
  if (s.shape.overlay === "CAPTIONS") needs.push("CAPTIONS");
  if (s.family === "EVIDENCE" || s.slug === "screen-only") needs.push("SCREENCAST");
  return needs;
}
