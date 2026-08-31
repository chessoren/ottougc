import { ALL_SCENARIOS, shapeSignature } from "@/server/knowledge/scenarios";
import { Badge, SectionHeading } from "@/components/ui/primitives";

/**
 * The catalogue.
 *
 * Rendered from the scenarios the agents actually use, so the page cannot drift
 * from the product. Grouped by shape rather than by topic, because the shape is
 * the thing a viewer notices — and the thing that stops a feed getting stale.
 */
export function Formats() {
  const shapes = new Set(ALL_SCENARIOS.map((s) => shapeSignature(s.shape)));
  const featured = [...ALL_SCENARIOS]
    .sort((a, b) => a.shape.durationMs[0] - b.shape.durationMs[0])
    .slice(0, 8);

  return (
    <section id="formats" className="mx-auto max-w-[1180px] px-5 py-24">
      <SectionHeading
        eyebrow={`${ALL_SCENARIOS.length} scenarios · ${shapes.size} different shapes`}
        title="Every video looks like a different account."
        description="A four-second reaction with one line of text is not the same object as a thirty-second drama. If ten channels all posted the same shape, they'd read as one brand posting ten times."
      />

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        {featured.map((s) => (
          <article key={s.id} className="card p-6 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.brandEntry.atRatio >= 0.99 ? "neutral" : s.brandEntry.atRatio >= 0.7 ? "accent" : "warn"}>
                    {brandLabel(s.brandEntry.atRatio)}
                  </Badge>
                  <span className="tnum text-2xs text-ink-faint">
                    {s.shape.durationMs[0] / 1000}–{s.shape.durationMs[1] / 1000}s ·{" "}
                    {s.shape.shotCount[0]}
                    {s.shape.shotCount[0] === s.shape.shotCount[1] ? "" : `–${s.shape.shotCount[1]}`} shot
                    {s.shape.shotCount[1] > 1 ? "s" : ""}
                  </span>
                </div>
                <h3 className="mt-2.5 text-xl leading-snug">{s.name}</h3>
              </div>
              <span className="tnum shrink-0 rounded-pill border border-line bg-surface-2 px-2.5 py-1 text-2xs font-semibold text-ink-muted">
                ${s.estimatedCostUsd.toFixed(2)}
              </span>
            </div>

            <p className="mt-3 text-base leading-relaxed text-ink-muted">{s.premise}</p>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {[
                s.shape.face === "NONE" ? "no face" : s.shape.face === "ONE" ? "one person" : "two people",
                s.shape.speech === "NONE" ? "silent" : s.shape.speech === "SYNC" ? "talking" : s.shape.speech === "VOICEOVER" ? "narrated" : "overheard",
                OVERLAY_LABEL[s.shape.overlay] ?? "",
                s.shape.music === "DRIVES" ? "music-led" : s.shape.music === "NONE" ? "no music" : "",
              ]
                .filter(Boolean)
                .map((tag) => (
                  <span key={tag} className="rounded-md bg-surface-3 px-2 py-1 text-2xs font-medium text-ink-subtle">
                    {tag}
                  </span>
                ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function brandLabel(atRatio: number): string {
  if (atRatio >= 0.99) return "brand never appears";
  if (atRatio >= 0.8) return "brand appears at the very end";
  if (atRatio >= 0.6) return "brand appears late";
  return "brand appears early";
}

const OVERLAY_LABEL: Record<string, string> = {
  POV_LINE: "one line of text",
  STORY_CARDS: "text cards",
  CAPTIONS: "captions",
  SUBTITLES: "subtitles",
  CHAT: "chat thread",
  MEME_BANDS: "meme bands",
  STATIC_HEADLINE: "fixed headline",
  NONE: "no text",
};
