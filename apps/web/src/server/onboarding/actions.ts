"use server";

import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { brandKnowledge, brands, channels, personas, users } from "@/server/db/schema";
import { planFleet } from "@/server/agents/manager";
import { runDailyProduction } from "@/server/agents/account";

import { buildBrief, type BriefGap, type CompanyBrief } from "./brief";
import { crawlSite, normaliseUrl } from "./scraper";

/**
 * Onboarding server actions.
 *
 * The order is the funnel, and the funnel is built on one rule: **give something
 * before asking for something.** We read their site, hand back a brief about
 * their own company, design a fleet of creators, and produce a real video — all
 * before asking them to connect an account.
 *
 * Nothing here requires a login. An account is only needed at the point where
 * we need permission to post on their behalf, and by then they have watched a
 * video that already exists.
 */

export interface ScanResult {
  ok: boolean;
  error?: string;
  brief?: CompanyBrief;
  /** Pages actually read, for the "here's what we looked at" line. */
  pagesRead: number;
  deep: boolean;
}

export async function scanSiteAction(rawUrl: string): Promise<ScanResult> {
  const url = normaliseUrl(rawUrl);
  if (!url) {
    return { ok: false, error: "That doesn't look like a web address.", pagesRead: 0, deep: false };
  }

  const crawl = await crawlSite(url);
  if (crawl.pages.length === 0) {
    return {
      ok: false,
      error: crawl.problems[0] ?? "We couldn't reach that site.",
      pagesRead: 0,
      deep: false,
    };
  }

  const brief = await buildBrief(crawl);
  return { ok: true, brief, pagesRead: crawl.pages.length, deep: brief.deep };
}

export interface SaveBriefResult {
  ok: boolean;
  error?: string;
  brandId?: string;
}

/**
 * Persist the confirmed brief.
 *
 * Only confirmed claims make it into the knowledge base, and the knowledge base
 * is the only thing agents may quote. An unconfirmed number on a website is a
 * marketing line; a confirmed one is something the founder has agreed to defend
 * in a comment section.
 */
export async function saveBriefAction(input: {
  url: string;
  brief: CompanyBrief;
  answers: Record<string, string>;
  channelCount: number;
}): Promise<SaveBriefResult> {
  const url = normaliseUrl(input.url);
  const name = input.brief.name.value || "Your brand";
  const slug = slugify(name);

  const [owner] = await db
    .insert(users)
    .values({ email: `owner+${slug}@ottougc.local`, name })
    .onConflictDoUpdate({ target: users.email, set: { name, updatedAt: new Date() } })
    .returning({ id: users.id });

  const value = (key: keyof CompanyBrief, fallback = ""): string => {
    const answered = input.answers[key as string];
    if (answered?.trim()) return answered.trim();
    const field = input.brief[key];
    return typeof field === "object" && field && "value" in field
      ? ((field as { value: string }).value || fallback)
      : fallback;
  };

  const confirmedClaims = input.brief.claims.filter((c) => c.confirmed);

  const brandDna = {
    valueProp: value("whatItDoes"),
    pain: value("chore"),
    task: value("chore"),
    oldWay: value("oldWay"),
    outcome: value("reliefMoment"),
    icp: value("audience"),
    offer: value("offer"),
    metric: confirmedClaims[0]?.text ?? "",
    hookLine: value("chore"),
  };

  const claimsPolicy = {
    allowed: confirmedClaims.map((c) => c.text),
    forbidden: [
      "Stating any number that is not in the allowed list",
      "Naming or showing a competitor",
      "Inventing a customer quote",
      ...input.brief.forbidden,
      ...(input.answers.forbidden ? [input.answers.forbidden] : []),
    ],
    disclaimer: "Results observed, not guaranteed.",
  };

  const existing = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1);

  let brandId: string;
  const payload = {
    name,
    domain: hostOf(url),
    targetUrl: input.answers.targetUrl || url,
    tagline: value("whatItDoes"),
    onboardingAnswers: { ...input.answers, brief: input.brief } as never,
    brandDna: brandDna as never,
    claimsPolicy: claimsPolicy as never,
    onboardingCompletedAt: new Date(),
    channelQuota: input.channelCount,
    primaryLocale: "en-US",
    updatedAt: new Date(),
  };

  if (existing[0]) {
    brandId = existing[0].id;
    await db.update(brands).set(payload).where(eq(brands.id, brandId));
  } else {
    const [row] = await db
      .insert(brands)
      .values({ ownerId: owner!.id, slug, dailyPostTarget: input.channelCount, ...payload })
      .returning({ id: brands.id });
    brandId = row!.id;
  }

  await db.delete(brandKnowledge).where(eq(brandKnowledge.brandId, brandId));
  await db.insert(brandKnowledge).values(knowledgeRows(brandId, input.brief, input.answers, brandDna));

  const current = await db.select({ id: channels.id }).from(channels).where(eq(channels.brandId, brandId));
  if (current.length < input.channelCount) {
    await db.insert(channels).values(
      Array.from({ length: input.channelCount - current.length }, (_, i) => {
        const index = current.length + i;
        return {
          brandId,
          platform: "YOUTUBE" as const,
          title: `${name} · creator ${String(index + 1).padStart(2, "0")}`,
          handle: `${slug}_${String(index + 1).padStart(2, "0")}`,
          status: "PENDING_AUTH" as const,
          slotIndex: index,
          warmingDay: 1,
          dailyPostTarget: 1,
          publishSlots: [index % 3 === 0 ? 12 : index % 3 === 1 ? 18 : 21] as never,
        };
      }),
    );
  }

  return { ok: true, brandId };
}

export interface FleetResult {
  ok: boolean;
  error?: string;
  degraded?: boolean;
  creators?: Array<{
    channelId: string;
    name: string;
    archetype: string;
    awareness: string;
    angle: string;
  }>;
}

export async function designFleetAction(brandId: string): Promise<FleetResult> {
  try {
    const run = await planFleet(brandId);
    const rows = await db
      .select({
        channelId: channels.id,
        name: personas.displayName,
        archetype: personas.archetype,
        awareness: personas.awarenessLevel,
        angle: personas.backstory,
      })
      .from(channels)
      .leftJoin(personas, eq(personas.channelId, channels.id))
      .where(eq(channels.brandId, brandId))
      .orderBy(channels.slotIndex);

    return {
      ok: true,
      degraded: run.degraded,
      creators: rows
        .filter((r) => r.name)
        .map((r) => ({
          channelId: r.channelId,
          name: r.name!,
          archetype: r.archetype!,
          awareness: r.awareness!,
          angle: r.angle ?? "",
        })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface FirstVideoResult {
  ok: boolean;
  error?: string;
  postId?: string;
  videoUrl?: string;
  scenarioName?: string;
  hook?: string;
  durationMs?: number;
  /** True when no video model is configured, so this is a substitute. */
  degraded?: boolean;
}

export async function makeFirstVideoAction(brandId: string): Promise<FirstVideoResult> {
  try {
    const [channel] = await db
      .select({ id: channels.id })
      .from(channels)
      .innerJoin(personas, eq(personas.channelId, channels.id))
      .where(eq(channels.brandId, brandId))
      .orderBy(channels.slotIndex)
      .limit(1);

    if (!channel) return { ok: false, error: "No creator has been designed yet." };

    const run = await runDailyProduction(channel.id);
    const output = run.output as
      | { postId?: string; scenarioName?: string; hook?: string; durationMs?: number; degraded?: boolean }
      | null;

    if (!output?.postId) return { ok: false, error: run.summary };

    const { posts } = await import("@/server/db/schema");
    const [post] = await db
      .select({ url: posts.renderedVideoUrl })
      .from(posts)
      .where(eq(posts.id, output.postId))
      .limit(1);

    return {
      ok: true,
      postId: output.postId,
      videoUrl: post?.url ?? undefined,
      scenarioName: output.scenarioName,
      hook: output.hook,
      durationMs: output.durationMs,
      degraded: output.degraded,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Channels waiting to be connected, for the final step. */
export async function listChannelSlotsAction(brandId: string) {
  const rows = await db
    .select({
      id: channels.id,
      slotIndex: channels.slotIndex,
      externalId: channels.externalId,
      title: channels.title,
      thumbnailUrl: channels.thumbnailUrl,
      subscriberCount: channels.subscriberCount,
      personaName: personas.displayName,
      archetype: personas.archetype,
    })
    .from(channels)
    .leftJoin(personas, eq(personas.channelId, channels.id))
    .where(eq(channels.brandId, brandId))
    .orderBy(channels.slotIndex);
  return rows;
}

/* ========================================================================== */

function knowledgeRows(
  brandId: string,
  brief: CompanyBrief,
  answers: Record<string, string>,
  dna: Record<string, string>,
) {
  const rows: Array<{
    brandId: string;
    kind: string;
    title: string;
    body: string;
    source: string;
    weight: number;
  }> = [];

  const add = (kind: string, title: string, body: string, weight = 1) => {
    if (body?.trim()) rows.push({ brandId, kind, title, body: body.trim(), source: "ONBOARDING", weight });
  };

  add("PAIN", "The chore", dna.pain, 1.5);
  add("PAIN", "The old way", dna.oldWay, 1.2);
  add("PROOF", "The moment of relief", dna.outcome, 1.4);
  add("ICP", "Who uses it", dna.icp, 1.3);
  add("FEATURE", "What it does", dna.valueProp, 1.2);
  if (dna.offer) add("FEATURE", "Welcome offer", dna.offer, 1.1);

  // Only confirmed claims. This list is the entire universe of numbers the
  // agents are permitted to state.
  for (const [i, claim] of brief.claims.filter((c) => c.confirmed).entries()) {
    add("PROOF", `Confirmed claim ${i + 1}`, `${claim.text} (from their site: "${claim.quote}")`, 1.6);
  }
  for (const [i, objection] of brief.objections.entries()) {
    add("OBJECTION", `Objection ${i + 1}`, objection, 1.3);
  }
  if (answers.objection) add("OBJECTION", "Stated objection", answers.objection, 1.4);
  for (const [i, word] of brief.vocabulary.entries()) {
    add("JARGON", `Term ${i + 1}`, word, 0.8);
  }
  for (const [i, f] of brief.forbidden.entries()) {
    add("FORBIDDEN", `Never say ${i + 1}`, f, 2);
  }
  if (answers.forbidden) add("FORBIDDEN", "Stated restriction", answers.forbidden, 2);

  return rows;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "brand"
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type { BriefGap, CompanyBrief };
