import { DRAMA_SCENARIOS } from "./drama";
import { FACELESS_SCENARIOS } from "./faceless";
import { MICRO_SCENARIOS } from "./micro";
import { REACTIVE_SCENARIOS } from "./reactive";
import { SITUATION_SCENARIOS } from "./situation";
import { shapeSignature, type Scenario, type ScenarioFamily } from "./types";

export * from "./types";

export const ALL_SCENARIOS: Scenario[] = [
  ...MICRO_SCENARIOS,
  ...SITUATION_SCENARIOS,
  ...DRAMA_SCENARIOS,
  ...FACELESS_SCENARIOS,
  ...REACTIVE_SCENARIOS,
];

export const SCENARIOS_BY_ID = new Map(ALL_SCENARIOS.map((s) => [s.id, s]));

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS_BY_ID.get(id);
}

export function scenariosForAwareness(level: string): Scenario[] {
  return ALL_SCENARIOS.filter((s) => s.awarenessFit.includes(level as never));
}

export function scenariosByFamily(family: ScenarioFamily): Scenario[] {
  return ALL_SCENARIOS.filter((s) => s.family === family);
}

/**
 * Distinct shapes in the catalogue.
 *
 * Used by the allocator to guarantee variety of *form* rather than variety of
 * subject. A channel that publishes five scenarios sharing one signature has
 * published the same video five times, whatever its scripts said.
 */
export const SHAPE_SIGNATURES = [
  ...new Set(ALL_SCENARIOS.map((s) => shapeSignature(s.shape))),
];

/** Group scenarios by shape so an allocator can spread across shapes. */
export function byShape(): Map<string, Scenario[]> {
  const map = new Map<string, Scenario[]>();
  for (const s of ALL_SCENARIOS) {
    const key = shapeSignature(s.shape);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return map;
}

/**
 * A starting mix for a channel.
 *
 * Weighted toward micro and faceless scenarios because they are cheap and
 * distinct, with one drama slot: dramas are expensive and travel furthest, so a
 * channel wants some but cannot live on them.
 */
export function defaultMixFor(awareness: string): Record<string, number> {
  const eligible = scenariosForAwareness(awareness);
  if (eligible.length === 0) {
    return Object.fromEntries(ALL_SCENARIOS.slice(0, 6).map((s) => [s.id, 1 / 6]));
  }

  const weightFor = (s: Scenario): number => {
    switch (s.family) {
      case "MICRO":
        return 3;
      case "FACELESS":
        return 2.5;
      case "SITUATION":
        return 2;
      case "REACTIVE":
        return 1.5;
      case "EVIDENCE":
        return 1.2;
      case "SERIAL":
        return 1;
      case "DRAMA":
        return 0.8;
      default:
        return 1;
    }
  };

  const total = eligible.reduce((sum, s) => sum + weightFor(s), 0);
  const mix: Record<string, number> = {};
  for (const s of eligible) mix[s.id] = Number((weightFor(s) / total).toFixed(4));

  // Absorb rounding drift into the largest slice so the mix sums to exactly 1.
  const drift = 1 - Object.values(mix).reduce((a, b) => a + b, 0);
  const biggest = Object.entries(mix).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (biggest) mix[biggest] = Number((mix[biggest]! + drift).toFixed(4));
  return mix;
}
