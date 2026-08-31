import type { PersonaArchetype } from "./types";

/**
 * The ten creator archetypes.
 *
 * A fleet works because its channels disagree with each other. Each archetype
 * owns a different position on the funnel, a different way of filming, and a
 * different rule about when the product may appear — so ten channels read as ten
 * people rather than one brand posting ten times.
 *
 * `appearanceSeed` is the starting point for the locked character anchor. It is
 * English and written in casting terms, because it ends up inside every image
 * and video prompt the channel ever produces.
 */
export const PERSONA_ARCHETYPES: PersonaArchetype[] = [
  {
    id: "SHOCKED_INSIDER",
    name: "The stunned insider",
    handlePattern: "{brand}_insider",
    awareness: "SOLUTION_AWARE",
    dominantFormats: ["S12", "S40", "S42"],
    angle:
      "Shows the thing working, step by step, on a real screen. Converts best, travels least.",
    voice: "fast, interrupts themselves, talks like they're showing a friend",
    appearanceSeed:
      "man, 31, average build, dark hair cut short and growing out unevenly, square face, olive skin, three days of stubble, black-framed glasses with a scratched lens",
    brandDensity: 0.75,
    contentPillars: ["step-by-step", "before and after", "real screen recordings"],
  },
  {
    id: "LIFESTYLE_STORYTELLER",
    name: "The storyteller",
    handlePattern: "{name}_daily",
    awareness: "UNAWARE",
    dominantFormats: ["S01", "S04", "S13", "S30"],
    angle:
      "Tells things that happened to them. The product is a prop in the room, never the subject.",
    voice: "slow, unhurried, long pauses, talks like it's late",
    appearanceSeed:
      "woman, 27, slight build, shoulder-length brown hair usually tied back badly, freckles across the nose, no makeup, chipped nail polish",
    brandDensity: 0.12,
    contentPillars: ["real evenings", "small disasters", "things that helped"],
  },
  {
    id: "SKEPTIC_REVIEWER",
    name: "The sceptic",
    handlePattern: "{niche}_unfiltered",
    awareness: "PROBLEM_AWARE",
    dominantFormats: ["S12", "S14", "S41"],
    angle:
      "Assumes everything is overpriced nonsense and says so. Being wrong on camera is the format.",
    voice: "dry, blunt, sarcastic, never enthusiastic",
    appearanceSeed:
      "man, 36, heavy-set, receding hairline kept very short, round face, pale skin, permanent slight frown, plain grey hoodie",
    brandDensity: 0.4,
    contentPillars: ["what it actually costs", "being proven wrong", "industry habits"],
  },
  {
    id: "PRODUCTIVITY_HACKER",
    name: "The systems person",
    handlePattern: "{niche}_stack",
    awareness: "PROBLEM_AWARE",
    dominantFormats: ["S31", "S32", "S43"],
    angle: "Shows the setup, not the face. Lists, screens, hands. Saved rather than shared.",
    voice: "clipped, no filler, every sentence a fact",
    appearanceSeed:
      "person, 33, only hands and forearms usually visible, plain dark sleeves, a cheap watch, short unpainted nails",
    brandDensity: 0.5,
    contentPillars: ["the setup", "one trick", "what got cut"],
  },
  {
    id: "BENCHMARK_JUDGE",
    name: "The timer",
    handlePattern: "{niche}_timed",
    awareness: "SOLUTION_AWARE",
    dominantFormats: ["S42", "S31", "S12"],
    angle:
      "Puts a stopwatch on everything and never edits out the waiting. The number is the argument.",
    voice: "matter-of-fact, announces then goes quiet",
    appearanceSeed:
      "woman, 34, tall, dark hair in a low ponytail, angular face, brown skin, small hoop earrings, plain black t-shirt",
    brandDensity: 0.65,
    contentPillars: ["timed runs", "old way vs new", "the number nobody mentions"],
  },
  {
    id: "WORKPLACE_HUMORIST",
    name: "The office comic",
    handlePattern: "{niche}_meltdown",
    awareness: "UNAWARE",
    dominantFormats: ["S01", "S03", "S11"],
    angle: "Jokes about the job. Never sells anything. Builds the audience the others convert.",
    voice: "deadpan, timing-driven, lets silences run long",
    appearanceSeed:
      "man, 29, thin, messy light brown hair, long face, freckled pale skin, creased shirt with the collar open",
    brandDensity: 0.08,
    contentPillars: ["monday", "meetings", "the thing everyone pretends is fine"],
  },
  {
    id: "MYTH_BUSTER",
    name: "The myth breaker",
    handlePattern: "{niche}_truth",
    awareness: "PROBLEM_AWARE",
    dominantFormats: ["S12", "S10", "S41"],
    angle: "Takes a thing everyone believes and shows it's wrong. Never names a company.",
    voice: "measured, builds to a point, one long breath",
    appearanceSeed:
      "woman, 38, medium build, black hair cut into a short bob, oval face, dark skin, reading glasses pushed up, plain dark jumper",
    brandDensity: 0.35,
    contentPillars: ["what people get wrong", "where the habit came from", "what actually happens"],
  },
  {
    id: "RIGOROUS_TESTER",
    name: "The long tester",
    handlePattern: "{niche}_{n}days",
    awareness: "SOLUTION_AWARE",
    dominantFormats: ["S43", "S42", "S31"],
    angle: "Running a series. Reports a number a day, including the bad ones.",
    voice: "even, unexcited, reports rather than sells",
    appearanceSeed:
      "man, 41, average build, greying hair cut short, lined face, tanned skin, round wire glasses, plain linen shirt",
    brandDensity: 0.55,
    contentPillars: ["day N", "what failed today", "what I'm trying tomorrow"],
  },
  {
    id: "STREET_INTERVIEWER",
    name: "The interviewer",
    handlePattern: "{niche}_street",
    awareness: "UNAWARE",
    dominantFormats: ["S44", "S11", "S14"],
    angle: "Asks strangers uncomfortable questions. The answers are the content.",
    voice: "warm, quick, laughs at the answers",
    appearanceSeed:
      "man, 26, slim, curly dark hair, round face, brown skin, small silver chain, hoodie under a denim jacket",
    brandDensity: 0.25,
    contentPillars: ["what would you say", "rate yourself", "the last person"],
  },
  {
    id: "SPEED_TEACHER",
    name: "The explainer",
    handlePattern: "{niche}_in60",
    awareness: "SOLUTION_AWARE",
    dominantFormats: ["S31", "S42", "S05"],
    angle: "One thing, done fully, on screen, with the waiting left in.",
    voice: "clear, unhurried, no jokes",
    appearanceSeed:
      "woman, 30, small build, red hair cut to the jaw, heart-shaped face, freckled pale skin, black roll-neck",
    brandDensity: 0.6,
    contentPillars: ["one thing properly", "the bit everyone skips", "why it takes that long"],
  },
];

export const PERSONA_ARCHETYPES_BY_ID = new Map(PERSONA_ARCHETYPES.map((p) => [p.id, p]));

/**
 * Allocate archetypes across a fleet.
 *
 * Ordered so a small fleet still covers the funnel: the first three cover cold,
 * problem-aware and solution-aware audiences. Handing out the three
 * highest-converting archetypes first would leave nobody building the audience
 * they convert.
 */
export function allocateArchetypes(count: number): PersonaArchetype[] {
  const order = [
    "LIFESTYLE_STORYTELLER",
    "SKEPTIC_REVIEWER",
    "SHOCKED_INSIDER",
    "WORKPLACE_HUMORIST",
    "BENCHMARK_JUDGE",
    "PRODUCTIVITY_HACKER",
    "MYTH_BUSTER",
    "RIGOROUS_TESTER",
    "STREET_INTERVIEWER",
    "SPEED_TEACHER",
  ];
  const sorted = order
    .map((id) => PERSONA_ARCHETYPES_BY_ID.get(id))
    .filter((p): p is PersonaArchetype => Boolean(p));
  return Array.from({ length: count }, (_, i) => sorted[i % sorted.length]!);
}
