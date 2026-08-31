import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { brands, channels, personas } from "@/server/db/schema";
import { getBrain, DEGRADED_MARKER } from "@/server/llm/client";
import { getMediaProvider } from "@/server/media";
import {
  CHARACTER_SHEET_SCHEMA,
  ICP_SCHEMA,
  REFERENCE_PLAN,
  compileReferencePrompt,
  critiqueCharacterSheet,
  type CharacterReference,
  type CharacterSheet,
  type Icp,
} from "@/server/knowledge/prompting/character";

/**
 * Character construction.
 *
 * Runs once per channel, before any video is produced, and is a hard
 * precondition of production. Two things come out of it:
 *
 *  1. The **ICP** — who this specific account talks to. Ten channels with ten
 *     ICPs sound like ten people; ten channels sharing one ICP sound like one
 *     brand posting ten times.
 *  2. The **character sheet** — a locked physical anchor plus a set of reference
 *     images of the same face. Those images are passed into every subsequent
 *     generation, and they are the only reliable way to keep one recognisable
 *     person across a hundred clips.
 *
 * The order matters. Generating video before the sheet exists produces a
 * different face in every shot, which is the single most obvious tell that an
 * account is synthetic.
 */

export interface BuiltCharacter {
  icp: Icp;
  sheet: CharacterSheet;
  referencesGenerated: number;
  referencesFailed: number;
  costUsd: number;
  degraded: boolean;
}

const ICP_SYSTEM = `
You define the one person a channel talks to. One person, not a segment.

RULES
- Write in English, spoken register.
- Nothing demographic and vague. "Men 25-34, higher income" is useless. "Solo dev
  who shipped three projects and monetised none of them" is useful.
- The pain has to be a specific moment, not a category. Not "short on time" but
  "it's 11pm on Sunday and they haven't started".
- "stoppingThought" is the exact sentence that would stop this person scrolling.
  One sentence, second person, no exclamation mark.
- "turnOffs" lists what would make them scroll instantly. Be specific and unkind.
`.trim();

const CHARACTER_SYSTEM = `
You build a believable character for a content channel. This character will be
generated on video hundreds of times, so the description has to be precise enough
that a stranger could pick them out in a corridor.

HARD RULES
- "anchor" is in ENGLISH, in casting terms, 30 words minimum. Age, build, exact
  hair with length and texture, face shape, skin tone, facial hair, glasses or not.
- The character must be ORDINARY. Not attractive, not ugly: unremarkable and
  specific. A model's face destroys credibility instantly.
- "distinguishingFeatures": two to four everyday imperfections. An overlapping
  tooth, dark circles, a bad tattoo, a scarred eyebrow.
- "wardrobe": worn clothes, never new, never coordinated.
- "locations": the rooms this person films in, with the actual clutter in them.
  Name specific objects.
- "voice": pace, verbal tics, what this person would never say.

NEVER
- Any adjective about beauty.
- Any description that could apply to somebody else.
- A tidy or decorated room.
`.trim();

export async function buildCharacter(channelId: string): Promise<BuiltCharacter> {
  const [row] = await db
    .select({ channel: channels, persona: personas, brand: brands })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!row) throw new Error("Channel not found.");
  if (!row.persona) {
    throw new Error("This channel has no character yet. Cast the creators first.");
  }

  const brain = getBrain();
  const dna = (row.brand.brandDna ?? {}) as Record<string, string>;
  let degraded = brain.kind !== "gemini";

  /* 1. The ICP ---------------------------------------------------------- */
  const icp = await buildIcp(row.persona, row.brand, dna, brain);

  /* 2. The character sheet ---------------------------------------------- */
  const sheet = await buildSheet(row.persona, icp, brain);
  const problems = critiqueCharacterSheet(sheet);
  if (problems.length > 0 && !degraded) {
    // One repair pass. A sheet that still fails after that is used as-is with
    // the problems recorded — blocking the channel entirely would be worse.
    const repaired = await buildSheet(row.persona, icp, brain, problems);
    if (critiqueCharacterSheet(repaired).length < problems.length) {
      Object.assign(sheet, repaired);
    }
  }

  /* 3. The reference images --------------------------------------------- */
  const media = getMediaProvider();
  const references: CharacterReference[] = [];
  let costUsd = 0;
  let failed = 0;

  for (const plan of REFERENCE_PLAN) {
    const { prompt, negativePrompt } = compileReferencePrompt(sheet, plan);
    try {
      const [asset] = await media.generateImages({
        prompt,
        aspectRatio: "9:16",
        count: 1,
        hiFi: plan.required,
        // A stable seed per channel keeps the whole set looking like one shoot
        // on one device rather than seven unrelated photographs.
        seed: seedOf(channelId + plan.purpose),
        referenceImageUrls: references.slice(0, 3).map((r) => r.url!).filter(Boolean),
      });

      if (asset?.url) {
        references.push({
          id: plan.purpose.toLowerCase(),
          purpose: plan.purpose,
          prompt,
          url: asset.url,
        });
        costUsd += asset.costUsd;
        if ((asset.meta as { isPlaceholder?: boolean } | undefined)?.isPlaceholder) {
          degraded = true;
        }
      } else {
        failed++;
      }
    } catch {
      // A missing optional reference is survivable; a missing required one is
      // reported but does not abort — five good references still hold a face.
      failed++;
      if (plan.required) degraded = true;
    }
    void negativePrompt;
  }

  sheet.referenceImages = references;

  /* 4. Persist ----------------------------------------------------------- */
  await db
    .update(personas)
    .set({
      icp: icp as never,
      characterSheet: sheet as never,
      appearancePrompt: sheet.anchor,
      referenceImageUrls: references.map((r) => r.url).filter(Boolean) as never,
      voiceProfile: sheet.voice as never,
      updatedAt: new Date(),
    })
    .where(eq(personas.id, row.persona.id));

  return {
    icp,
    sheet,
    referencesGenerated: references.length,
    referencesFailed: failed,
    costUsd,
    degraded,
  };
}

/** Whether a channel is ready to produce video. */
export async function hasCharacter(channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ sheet: personas.characterSheet, refs: personas.referenceImageUrls })
    .from(personas)
    .where(eq(personas.channelId, channelId))
    .limit(1);
  if (!row?.sheet) return false;
  return Array.isArray(row.refs) && (row.refs as string[]).length >= 3;
}

export async function getCharacter(
  channelId: string,
): Promise<{ icp: Icp | null; sheet: CharacterSheet | null }> {
  const [row] = await db
    .select({ icp: personas.icp, sheet: personas.characterSheet })
    .from(personas)
    .where(eq(personas.channelId, channelId))
    .limit(1);
  return {
    icp: (row?.icp as Icp) ?? null,
    sheet: (row?.sheet as CharacterSheet) ?? null,
  };
}

/* ========================================================================== */

async function buildIcp(
  persona: typeof personas.$inferSelect,
  brand: typeof brands.$inferSelect,
  dna: Record<string, string>,
  brain: ReturnType<typeof getBrain>,
): Promise<Icp> {
  if (brain.kind === "gemini") {
    try {
      const res = await brain.generate({
        system: ICP_SYSTEM,
        temperature: 0.8,
        responseSchema: ICP_SCHEMA as unknown as Record<string, unknown>,
        messages: [
          {
            role: "user",
            text: `Brand: ${brand.name}
What it removes: ${dna.pain ?? dna.valueProp ?? "not recorded"}
Broad audience: ${dna.icp ?? "not recorded"}

This particular channel is run by "${persona.displayName}", archetype ${persona.archetype},
speaking to a ${persona.awarenessLevel} audience.

Define the ICP for THIS channel specifically — a distinct slice of the broad
audience, consistent with this character and this awareness level.`,
          },
        ],
      });
      if (res.text && res.text !== DEGRADED_MARKER) {
        return JSON.parse(res.text) as Icp;
      }
    } catch {
      // fall through
    }
  }
  return fallbackIcp(persona, dna);
}

async function buildSheet(
  persona: typeof personas.$inferSelect,
  icp: Icp,
  brain: ReturnType<typeof getBrain>,
  repairNotes?: string[],
): Promise<CharacterSheet> {
  if (brain.kind === "gemini") {
    try {
      const res = await brain.generate({
        system: CHARACTER_SYSTEM,
        temperature: 0.9,
        responseSchema: CHARACTER_SHEET_SCHEMA as unknown as Record<string, unknown>,
        messages: [
          {
            role: "user",
            text: `Character: ${persona.displayName}, archetype ${persona.archetype}.
${persona.occupation ? `Job: ${persona.occupation}.` : ""}
${persona.city ? `City: ${persona.city}.` : ""}
${persona.backstory ? `Background: ${persona.backstory}` : ""}

They are talking to: ${icp.selfDescription} (${icp.ageRange}, ${icp.occupation}).
They should look like they belong to the same world without being a clone of it.

${repairNotes?.length ? `\nFIX THESE from your previous version:\n${repairNotes.map((p) => `- ${p}`).join("\n")}` : ""}

Build their character sheet.`,
          },
        ],
      });
      if (res.text && res.text !== DEGRADED_MARKER) {
        const parsed = JSON.parse(res.text) as Partial<CharacterSheet>;
        return { ...fallbackSheet(persona), ...parsed, referenceImages: [] } as CharacterSheet;
      }
    } catch {
      // fall through
    }
  }
  return fallbackSheet(persona);
}

/* ── Deterministic fallbacks ─────────────────────────────────────────────── */

function fallbackIcp(persona: typeof personas.$inferSelect, dna: Record<string, string>): Icp {
  return {
    selfDescription: dna.icp ?? `Someone stuck with ${dna.pain ?? "this chore"} every week`,
    ageRange: "25-38",
    occupation: dna.profession ?? persona.occupation ?? "self-employed",
    context: persona.city ?? "a large city",
    visceralPain: dna.pain ?? "the same repetitive task, every week, in the evening",
    failedAttempts: [dna.oldWay ?? "a spreadsheet", "delegating it and checking all of it again"],
    vocabulary: [],
    watches: [],
    turnOffs: ["a video that opens with 'hey guys'", "a salesy tone", "an unverifiable number"],
    stoppingThought: dna.hookLine ?? `You're still doing ${dna.task ?? "this"} by hand?`,
  };
}

/**
 * A usable sheet with no model available.
 *
 * Deliberately generic and flagged as such: it keeps the pipeline runnable, but
 * a fleet whose ten personas share this structure will read as ten variations of
 * one person. The dashboard says so.
 */
function fallbackSheet(persona: typeof personas.$inferSelect): CharacterSheet {
  // The archetype seed is a sketch, not a casting description. It is padded to
  // the length the critique demands — but only with details it does not already
  // specify, because a seed saying "blonde, shoulder-length" followed by a
  // generic "hair cut short" gives the model two incompatible faces.
  const seed = (persona.appearancePrompt ?? "").trim();
  const anchor =
    seed.split(/\s+/).length >= 25 ? seed : [seed, ...missingDetails(seed)].filter(Boolean).join(", ");

  return {
    anchor,
    distinguishingFeatures: ["marked shadows under the eyes", "one slightly crooked front tooth"],
    wardrobe: [
      "a washed-out grey sweatshirt with a stretched collar",
      "a plain navy t-shirt, creased",
    ],
    locations: [
      "a small living room with a cluttered coffee table, a charging cable across the sofa, an unwashed mug",
      "a narrow kitchen with a full drying rack and papers stacked on the counter",
    ],
    voice: {
      pace: "fast, short sentences, often cuts themselves off",
      fillers: ["so", "like", "anyway"],
      tics: ["often opens with 'honestly'"],
      neverSays: ["revolutionary", "game-changer", "don't wait"],
    },
    referenceImages: [],
  };
}

/**
 * Neutral additions that do not contradict what the seed already fixes.
 *
 * Each candidate declares the topic it covers; if the seed already mentions that
 * topic, the addition is skipped. Contradicting the seed is worse than a short
 * anchor, because the model resolves the conflict differently in every shot.
 */
function missingDetails(seed: string): string[] {
  const lower = seed.toLowerCase();
  const candidates: Array<{ covers: RegExp; text: string }> = [
    { covers: /build|corpulen|silhouette|mince|stocky|slim/, text: "average build" },
    {
      covers: /peau|skin|teint/,
      text: "skin with visible pores and a few small blemishes",
    },
    { covers: /yeux|eyes|regard/, text: "tired eyes with faint shadows underneath" },
    { covers: /maquill|makeup/, text: "no makeup" },
    {
      covers: /v[êe]tement|clothes|porte|wearing|chemise|shirt|pull|sweat/,
      text: "everyday clothes that have been washed many times",
    },
    {
      covers: /ordinaire|quelconque|plain|unremarkable|banal/,
      text: "plain unremarkable features, the kind of face you would pass in a corridor",
    },
  ];
  return candidates.filter((c) => !c.covers.test(lower)).map((c) => c.text);
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2_147_483_647;
}
