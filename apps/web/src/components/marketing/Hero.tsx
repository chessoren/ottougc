import { ArrowRight, Play } from "lucide-react";

import { ButtonLink, Eyebrow } from "@/components/ui/primitives";

/**
 * Hero.
 *
 * States the outcome and the price, and nothing else. The earlier version tried
 * to explain the architecture in the first screen — multi-agent, darwinian
 * arbitration — which is the writer's mental model, not the reader's. A founder
 * landing here has one question: what do I get and what does it cost.
 */
export function Hero({ stats }: { stats: HeroStats }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-320px] h-[720px] opacity-[0.55]"
        style={{
          background: "radial-gradient(720px 420px at 50% 40%, rgba(0,132,254,0.14), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[1180px] px-5 pb-20 pt-16 md:pt-24">
        <div className="flex flex-col items-center text-center">
          <Eyebrow className="animate-in-up">
            <span className="h-1.5 w-1.5 rounded-full bg-live pulse-live" />
            Posting right now
          </Eyebrow>

          <h1
            className="animate-in-up mt-6 max-w-[15ch] text-5xl leading-[1.04] md:text-7xl"
            style={{ animationDelay: "60ms" }}
          >
            Ten creators who post about you every day.
          </h1>

          <p
            className="animate-in-up mt-6 max-w-[52ch] text-lg leading-relaxed text-ink-muted md:text-xl"
            style={{ animationDelay: "120ms" }}
          >
            They aren&rsquo;t real people. They write, film, edit and post to your own YouTube
            channels — then work out what to make next from what actually worked.
          </p>

          <div
            className="animate-in-up mt-9 flex flex-col items-center gap-3 sm:flex-row"
            style={{ animationDelay: "180ms" }}
          >
            <ButtonLink href="/onboarding" size="lg">
              Start free
              <ArrowRight size={17} strokeWidth={2.4} />
            </ButtonLink>
            <ButtonLink href="#videos" variant="secondary" size="lg">
              <Play size={15} strokeWidth={2.4} />
              See what they made
            </ButtonLink>
          </div>

          <p
            className="animate-in-up mt-4 text-sm text-ink-subtle"
            style={{ animationDelay: "220ms" }}
          >
            $5 a video · $1 per thousand views · no subscription
          </p>
        </div>

        {/* Our own numbers, labelled as ours. Presenting them as a customer's
            would be exactly the dishonesty the product forbids its agents. */}
        <div
          className="animate-in-up mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4"
          style={{ animationDelay: "260ms" }}
        >
          {[
            { value: stats.videos, label: "videos made" },
            { value: stats.channels, label: "channels running" },
            { value: stats.formats, label: "video shapes" },
            { value: stats.decisions, label: "calls made" },
          ].map((s) => (
            <div key={s.label} className="bg-surface px-6 py-7 text-center">
              <div className="tnum font-display text-4xl font-semibold tracking-[-0.04em] text-ink-strong">
                {s.value}
              </div>
              <div className="mt-1.5 text-sm text-ink-subtle">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-2xs text-ink-faint">
          Our own numbers. We use OttoUGC to sell OttoUGC.
        </p>
      </div>
    </section>
  );
}

export interface HeroStats {
  videos: string;
  channels: string;
  formats: string;
  decisions: string;
}
