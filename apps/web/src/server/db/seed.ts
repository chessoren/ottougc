import { eq } from "drizzle-orm";

import { db } from "./index";
import {
  apiProjects,
  brandAssets,
  brandKnowledge,
  brands,
  channels,
  competitorInsights,
  competitors,
  users,
} from "./schema";
import { migrate } from "./migrate";

/**
 * Seed.
 *
 * The first brand in the database is OttoUGC itself. That is not a demo
 * convenience: the product's thesis is that it can grow itself, so the fleet
 * that sells OttoUGC has to be a real tenant with a real brand DNA, running the
 * same code path as any customer. If it does not work here, it does not work.
 */

const OTTO_DNA = {
  valueProp: "creators who post about your app every day, without you filming anything",
  pain: "paying $2,000 for one video that gets 4,000 views",
  oldWay: "briefing creators one at a time over DMs",
  oldWayDuration: "three weeks of negotiation",
  newWayDuration: "overnight",
  metric: "450 videos a month for the price of one placement",
  outcome: "signups arriving while you sleep",
  task: "making short-form content every day",
  competitorPrice: "$2,000 a video",
  profession: "app founders",
  niche: "short-form acquisition",
  commonBelief: "you need a big creator to break through",
  hookLine: "$2,000 a video. 4,000 views.",
  thesis:
    "Out of a hundred videos posted, five get 95% of the views. The problem isn't the quality of any one video, it's how many attempts you get.",
};

const OTTO_CLAIMS = {
  allowed: [
    "Showing a workflow actually run and actually timed",
    "Quoting metrics observed on our own channels, said to be ours",
    "Comparing a production cost against a published market rate",
  ],
  forbidden: [
    "Promising a number of views or signups",
    "Promising revenue",
    "Presenting our own results as a customer's",
    "Naming a competitor",
    "Stating a success rate with no sample behind it",
  ],
  disclaimer: "Numbers observed on our own channels, not a guarantee.",
};

const OTTO_KNOWLEDGE: Array<{ kind: string; title: string; body: string }> = [
  {
    kind: "PAIN",
    title: "The $2,000 placement",
    body: "A founder pays $2,000 for one creator video. It gets 4,000 views, they have no right to reuse it in ads, and no way to know why it didn't work. They can't try again — the budget is gone.",
  },
  {
    kind: "PAIN",
    title: "The month spent briefing",
    body: "Finding ten creators, negotiating, briefing, chasing, approving: three weeks of founder time for ten videos that arrive late and off-message.",
  },
  {
    kind: "PAIN",
    title: "Nothing is learned",
    body: "An agency delivers and stops. Nobody looks at the drop-off curve, nobody knows which second people leave at, so the next video repeats the same mistake.",
  },
  {
    kind: "PROOF",
    title: "The economics of volume",
    body: "Our marginal cost per video runs from $0.29 for a screen-only clip to $3.80 for a full drama. A traditional placement costs $500 to $5,000. For the same budget you go from one attempt to several hundred.",
  },
  {
    kind: "PROOF",
    title: "How outliers distribute",
    body: "Out of a hundred videos, five to ten carry 80 to 95% of the views. That's why volume beats taste: nobody can predict which ones, only that you need a lot of them.",
  },
  {
    kind: "PROOF",
    title: "The decision loop",
    body: "Every video is judged at two hours on how many held past three seconds, at a day on completion and shares, and at three days on clicks. Three consecutive failures for a scenario and it's dropped. One outlier and it's made five more ways.",
  },
  {
    kind: "OBJECTION",
    title: "\"It's AI, people will tell\"",
    body: "What people spot isn't the AI, it's the lack of editing. One static shot for fifteen seconds with a voice on top is obvious immediately. An edit with fifteen cuts, punch-ins on the numbers and cuts landing on the breath is not.",
  },
  {
    kind: "OBJECTION",
    title: "\"I could do this with ChatGPT\"",
    body: "Write a script, yes. Generate the shots with one consistent face, record the voice, align captions to the word, cut on the breaths, post to ten channels, read the drop-off curve second by second and decide what to remake tomorrow: no.",
  },
  {
    kind: "OBJECTION",
    title: "\"How long before I see anything?\"",
    body: "You watch a finished video during setup, before connecting anything. Real signal takes about 72 hours. The learning loop starts being useful in week three, once each shape has been tried enough times to judge.",
  },
  {
    kind: "ICP",
    title: "The founder between 0 and 10,000 users",
    body: "They have a product that works for everyone who tries it and no acquisition channel. They tried ads and the cost per customer was too high. They know short-form works but have neither the time nor the wish to film themselves.",
  },
  {
    kind: "JARGON",
    title: "How this audience talks",
    body: "CAC, LTV, hook rate, watch time, outlier, spark ads, whitelisting, FYP, product-market fit, churn, activation.",
  },
  {
    kind: "STORY",
    title: "Where this came from",
    body: "A founder paid $2,400 for one UGC video. It got 4,000 views and twelve signups — $200 a signup. That same month an anonymous account in their niche got 900,000 views on a video shot on a phone in a kitchen.",
  },
  {
    kind: "FEATURE",
    title: "The creator does the editing",
    body: "It isn't filling a template. It lays down an assembly, moves its cuts onto the ends of breath groups, punches in on every number, annotates the screen recordings, ducks the music under the voice, and checks the safe areas before rendering.",
  },
  {
    kind: "FORBIDDEN",
    title: "What we never promise",
    body: "No number of views, no number of signups, no revenue. We promise volume, measurement and a learning loop. The rest depends on the customer's product.",
  },
];

const OTTO_INSIGHTS: Array<{ kind: string; body: string; frequency: number }> = [
  { kind: "CONTENT_GAP", body: "\"How do you make it look natural?\" — asked under every AI UGC video, never actually answered with a demonstration.", frequency: 47 },
  { kind: "PAIN_INVERSION", body: "\"I've tried three AI UGC tools and they all output the same video with a frozen avatar and a robot voice.\" — the constant criticism is the absence of editing.", frequency: 38 },
  { kind: "FEATURE_DEMAND", body: "\"Does it post by itself or do I still upload manually?\" — automatic posting is the most requested feature in the comments.", frequency: 31 },
  { kind: "OBJECTION", body: "\"This will get banned in two weeks\" — a recurring fear, best answered head-on: we post to the user's own channels through the official API.", frequency: 26 },
  { kind: "HOOK", body: "\"I paid X for a video that got Y views\" — the best-performing hook structure in this niche, holding over 70%.", frequency: 19 },
];

export async function seed() {
  const migration = await migrate();
  console.log(`Migrations: ${migration.applied.length} applied, ${migration.skipped.length} already up to date.`);

  const [user] = await db
    .insert(users)
    .values({
      email: "oren92300@gmail.com",
      name: "Oren",
      isAdmin: true,
    })
    .onConflictDoUpdate({ target: users.email, set: { isAdmin: true } })
    .returning({ id: users.id });

  const ownerId = user!.id;

  const existing = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, "ottougc")).limit(1);

  let brandId: string;
  if (existing[0]) {
    brandId = existing[0].id;
    await db
      .update(brands)
      .set({ brandDna: OTTO_DNA as never, claimsPolicy: OTTO_CLAIMS as never, updatedAt: new Date() })
      .where(eq(brands.id, brandId));
  } else {
    const [brand] = await db
      .insert(brands)
      .values({
        ownerId,
        name: "OttoUGC",
        slug: "ottougc",
        domain: "ottougc.com",
        targetUrl: "https://ottougc.com",
        tagline: "Ten creators who post about your app every day.",
        brandDna: OTTO_DNA as never,
        claimsPolicy: OTTO_CLAIMS as never,
        onboardingCompletedAt: new Date(),
        channelQuota: 10,
        dailyPostTarget: 10,
        timezone: "Europe/Paris",
        primaryLocale: "en-US",
      })
      .returning({ id: brands.id });
    brandId = brand!.id;
  }

  // Knowledge base
  await db.delete(brandKnowledge).where(eq(brandKnowledge.brandId, brandId));
  await db.insert(brandKnowledge).values(
    OTTO_KNOWLEDGE.map((k) => ({
      brandId,
      kind: k.kind,
      title: k.title,
      body: k.body,
      source: "ONBOARDING",
      weight: 1,
    })),
  );

  // Sonar intelligence
  await db.delete(competitorInsights).where(eq(competitorInsights.brandId, brandId));
  await db.insert(competitorInsights).values(
    OTTO_INSIGHTS.map((i) => ({
      brandId,
      kind: i.kind,
      body: i.body,
      frequency: i.frequency,
      sentiment: i.kind === "PAIN_INVERSION" || i.kind === "OBJECTION" ? -0.6 : 0.1,
    })),
  );

  // Channels. Without OAuth they sit in PENDING_AUTH but are fully plannable —
  // the fleet can be designed, briefed and produced before a single connection.
  const existingChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.brandId, brandId));

  if (existingChannels.length === 0) {
    await db.insert(channels).values(
      Array.from({ length: 10 }, (_, i) => ({
        brandId,
        platform: "YOUTUBE" as const,
        title: `OttoUGC · creator ${String(i + 1).padStart(2, "0")}`,
        handle: `ottougc_${String(i + 1).padStart(2, "0")}`,
        status: "WARMING" as const,
        slotIndex: i,
        warmingDay: 8,
        dailyPostTarget: 1,
        publishSlots: [i % 3 === 0 ? 12 : i % 3 === 1 ? 18 : 21] as never,
      })),
    );
  }

  const fleet = await db.select().from(channels).where(eq(channels.brandId, brandId));

  console.log(`\nBrand: OttoUGC (${brandId})`);
  console.log(`Knowledge base: ${OTTO_KNOWLEDGE.length} entries`);
  console.log(`Competitive insights: ${OTTO_INSIGHTS.length}`);
  console.log(`Channels: ${fleet.length}`);
  console.log(`\nNext: pnpm agent plan  (gives every channel a character and a strategy)`);

  return { brandId, ownerId, channels: fleet.map((c) => c.id) };
}

if (process.argv[1]?.includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
