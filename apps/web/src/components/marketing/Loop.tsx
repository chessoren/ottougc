import { CHECKPOINT_THRESHOLDS } from "@/server/darwin/engine";
import { SectionHeading } from "@/components/ui/primitives";

/**
 * The feedback loop.
 *
 * Thresholds come straight from the engine rather than being written by hand, so
 * the page cannot claim a bar the product does not enforce.
 */
export function Loop() {
  return (
    <section id="loop" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[1180px] px-5 py-24">
        <SectionHeading
          eyebrow="The part nobody else does"
          title="They stop making what doesn't work."
          description="Every video gets checked three times against thresholds set in advance. A decision always names the number that caused it."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {CHECKPOINTS.map((c) => {
            const config = CHECKPOINT_THRESHOLDS[c.key as keyof typeof CHECKPOINT_THRESHOLDS];
            return (
              <div key={c.key} className="card p-7">
                <span className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink-strong">
                  {c.label}
                </span>
                <p className="mt-3 text-base leading-relaxed text-ink-muted">{c.body}</p>

                <div className="mt-6 space-y-2.5">
                  <Row tone="kill" label="Drop it" value={`under ${pct(config.thresholds.kill)}`} />
                  <Row
                    tone="warn"
                    label="Keep going"
                    value={`${pct(config.thresholds.maintainLow)}–${pct(config.thresholds.maintainHigh)}`}
                  />
                  <Row tone="win" label="Make five more" value={`over ${pct(config.thresholds.superstar)}`} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface-2 p-7">
            <h3 className="text-xl">One in five is a gamble on purpose</h3>
            <p className="mt-2.5 max-w-[62ch] text-base leading-relaxed text-ink-muted">
              Four videos out of five use whatever&rsquo;s been working. The fifth deliberately tries
              something barely tested. A channel that stops experimenting stops finding the outliers
              that produce all the results.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-7">
            <h3 className="text-xl">Once a week, a bigger call</h3>
            <p className="mt-2.5 max-w-[62ch] text-base leading-relaxed text-ink-muted">
              Every channel gets reviewed: double down, leave alone, change its angle, slow it down,
              or stop it. Nothing gets stopped before three weeks — cold-audience accounts take
              longest to start and are the easiest to kill by mistake.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ tone, label, value }: { tone: "kill" | "warn" | "win"; label: string; value: string }) {
  const color = tone === "kill" ? "bg-kill" : tone === "warn" ? "bg-warn" : "bg-win";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-2.5">
      <span className="flex items-center gap-2 text-sm font-medium text-ink-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        {label}
      </span>
      <span className="tnum text-sm font-semibold text-ink-strong">{value}</span>
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(v < 0.05 ? 1 : 0)}%`;
}

const CHECKPOINTS = [
  {
    key: "T2H",
    label: "After 2 hours",
    body: "Did people stay past the first three seconds? Below the bar, the video never gets shown widely, whatever else is in it.",
  },
  {
    key: "T24H",
    label: "After a day",
    body: "Did they watch it through, and did anyone send it to someone? A share counts about ten times what a like does.",
  },
  {
    key: "T72H",
    label: "After three days",
    body: "Did any of that attention turn into a visit to your site? The only number that really matters, and the last one to arrive.",
  },
];
