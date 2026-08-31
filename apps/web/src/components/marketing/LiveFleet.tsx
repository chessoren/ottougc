import { Badge, EmptyState, SectionHeading } from "@/components/ui/primitives";

import { VideoCard } from "./VideoCard";
import { getScenario } from "@/server/knowledge/scenarios";

export interface FleetSample {
  id: string;
  hookText: string;
  formatId: string;
  personaName: string | null;
  archetype: string | null;
  videoUrl: string | null;
  durationMs: number | null;
  views: number;
  status: string;
}

/**
 * What the fleet published.
 *
 * Real rows from the database, playing the real rendered MP4s. This section is
 * the whole argument of the page: a claim about autonomous production that has
 * to be taken on faith is worth very little next to nine videos a visitor can
 * scrub through.
 */
export function LiveFleet({ posts }: { posts: FleetSample[] }) {
  return (
    <section id="videos" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[1180px] px-5 py-24">
        <SectionHeading
          eyebrow="Made this week"
          title="Nobody asked for any of these."
          description="Each one was picked, written, shot, cut and checked by the creator that posted it. None of them were touched by hand."
        />

        {posts.length === 0 ? (
          <div className="mt-14">
            <EmptyState
              title="Nothing posted yet"
              description="Start a run from the dashboard and the videos will show up here as they finish rendering."
            />
          </div>
        ) : (
          <div className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {posts.map((p) => (
              <VideoCard
                key={p.id}
                src={p.videoUrl}
                hookText={p.hookText}
                durationMs={p.durationMs}
                persona={p.personaName}
                formatName={getScenario(p.formatId)?.name ?? p.formatId}
              />
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          <Badge tone="accent">Made by the creators</Badge>
          <Badge>Cut automatically</Badge>
          <Badge>Checked before posting</Badge>
        </div>
      </div>
    </section>
  );
}
