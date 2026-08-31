import { desc, eq, sql } from "drizzle-orm";

import { Faq } from "@/components/marketing/Faq";
import { Footer } from "@/components/marketing/Footer";
import { Formats } from "@/components/marketing/Formats";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { LiveFleet, type FleetSample } from "@/components/marketing/LiveFleet";
import { Loop } from "@/components/marketing/Loop";
import { Nav } from "@/components/marketing/Nav";
import { Pricing } from "@/components/marketing/Pricing";
import { Problem } from "@/components/marketing/Problem";
import { ButtonLink } from "@/components/ui/primitives";
import { db } from "@/server/db";
import { channels, personas, posts } from "@/server/db/schema";
import { ALL_SCENARIOS } from "@/server/knowledge/scenarios";

// Reads live output, so it must not be statically cached.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const { stats, samples } = await loadShowcase();

  return (
    <>
      <Nav />
      <main>
        <Hero stats={stats} />
        <Problem />
        <LiveFleet posts={samples} />
        <HowItWorks />
        <Formats />
        <Loop />
        <Pricing />
        <Faq />

        <section className="mx-auto max-w-[1180px] px-5 pb-28">
          <div className="grain relative overflow-hidden rounded-3xl bg-inverse px-8 py-20 text-center md:px-16">
            <h2 className="mx-auto max-w-[18ch] text-4xl text-on-inverse md:text-5xl">
              We use OttoUGC to sell OttoUGC.
            </h2>
            <p className="mx-auto mt-5 max-w-[50ch] text-lg leading-relaxed text-on-inverse-muted">
              The videos above came from our own channels. If it didn&rsquo;t work, this page would
              have nothing to show.
            </p>
            <div className="mt-9 flex justify-center">
              <ButtonLink href="/onboarding" size="lg">
                Start free
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

/**
 * Showcase data.
 *
 * Wrapped in a try/catch on purpose: the marketing page must render on a machine
 * whose database was never migrated. A landing page that 500s because a table is
 * missing is worse than one showing an empty state.
 */
async function loadShowcase() {
  const fallback = {
    stats: { videos: "0", channels: "0", formats: String(ALL_SCENARIOS.length), decisions: "0" },
    samples: [] as FleetSample[],
  };

  try {
    const [counts] = await db
      .select({
        videos: sql<number>`count(*) filter (where ${posts.renderedVideoUrl} is not null)::int`,
        decisions: sql<number>`count(*) filter (where ${posts.darwinianAction} <> 'PENDING')::int`,
      })
      .from(posts);

    const [channelCount] = await db.select({ n: sql<number>`count(*)::int` }).from(channels);

    const rows = await db
      .select({
        id: posts.id,
        hookText: posts.hookText,
        formatId: posts.formatId,
        videoUrl: posts.renderedVideoUrl,
        durationMs: posts.durationMs,
        views: posts.views,
        status: posts.status,
        personaName: personas.displayName,
        archetype: personas.archetype,
      })
      .from(posts)
      .leftJoin(personas, eq(personas.channelId, posts.channelId))
      .where(sql`${posts.renderedVideoUrl} is not null`)
      .orderBy(desc(posts.createdAt))
      .limit(8);

    return {
      stats: {
        videos: (counts?.videos ?? 0).toLocaleString("en-US"),
        channels: String(channelCount?.n ?? 0),
        formats: String(ALL_SCENARIOS.length),
        decisions: (counts?.decisions ?? 0).toLocaleString("en-US"),
      },
      samples: rows,
    };
  } catch {
    return fallback;
  }
}
