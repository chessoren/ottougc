import { SectionHeading } from "@/components/ui/primitives";

/**
 * The problem.
 *
 * Three numbers, no argument. The reader has already done this maths on the back
 * of an invoice; seeing it stated plainly does more than any adjective.
 */
export function Problem() {
  return (
    <section className="mx-auto max-w-[1180px] px-5 py-24">
      <SectionHeading
        eyebrow="The maths everyone does"
        title="One video. One shot. Nothing learned."
        description="The problem with short-form isn't the quality of any single video. It's that a marketing budget buys one attempt, and one attempt teaches you nothing."
      />

      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {PANELS.map((p, i) => (
          <div key={p.title} className="card relative overflow-hidden p-7">
            <span className="tnum font-display text-6xl font-bold leading-none tracking-[-0.05em] text-ink-strong">
              {p.figure}
            </span>
            <span className="mt-1 block text-sm font-semibold text-ink-subtle">{p.unit}</span>
            <h3 className="mt-6 text-xl">{p.title}</h3>
            <p className="mt-2.5 text-base leading-relaxed text-ink-muted">{p.body}</p>
            <span
              aria-hidden
              className="pointer-events-none absolute -right-6 -top-6 select-none font-display text-[132px] font-bold leading-none text-ink-strong/[0.028]"
            >
              {i + 1}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-14 rounded-3xl bg-inverse px-8 py-14 text-center md:px-16">
        <p className="mx-auto max-w-[22ch] font-display text-3xl font-semibold leading-[1.2] tracking-[-0.035em] text-on-inverse md:text-4xl">
          Out of a hundred videos, five get almost all the views.
        </p>
        <p className="mx-auto mt-5 max-w-[54ch] text-lg leading-relaxed text-on-inverse-muted">
          Nobody can pick which five in advance. That&rsquo;s the only reason volume beats taste —
          and the only reason this product exists.
        </p>
      </div>
    </section>
  );
}

const PANELS = [
  {
    figure: "$2,000",
    unit: "one creator placement",
    title: "One attempt, full price",
    body: "The creator delivers a video. It works or it doesn't. Either way the budget's gone and there's no second try this month.",
  },
  {
    figure: "3 wks",
    unit: "for ten videos",
    title: "Your time, not theirs",
    body: "Finding, negotiating, briefing, chasing, approving. Three weeks of founder time for ten videos that arrive late and off-message.",
  },
  {
    figure: "0",
    unit: "things learned",
    title: "Nobody watches the drop-off",
    body: "The agency delivers and stops. Nobody knows which second people leave at, so the next video repeats the same mistake.",
  },
];
