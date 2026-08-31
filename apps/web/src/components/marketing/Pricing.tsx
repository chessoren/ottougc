"use client";

import { useMemo, useState } from "react";
import { Check, Minus } from "lucide-react";

import { Badge, ButtonLink, SectionHeading } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const PRICE_PER_VIDEO = 5;
const PRICE_PER_CPM = 1;

/**
 * Pricing.
 *
 * Two decisions worth noting:
 *
 *  - The comparison names *market ranges*, not competitors. Naming a competitor
 *    on a pricing page invites a rebuttal and dates instantly; a range the reader
 *    can verify from their own quotes does neither. It is also the rule the
 *    product's own claims policy imposes on its agents, and a landing page that
 *    breaks its own rules is not a good advertisement for them.
 *  - The calculator is honest about the second line. Usage pricing looks cheap
 *    until a video works; showing the CPM component grow with reach is what makes
 *    the number trustworthy.
 */
export function Pricing() {
  const [videos, setVideos] = useState(450);
  const [avgViews, setAvgViews] = useState(4000);

  const model = useMemo(() => {
    const production = videos * PRICE_PER_VIDEO;
    const totalViews = videos * avgViews;
    const delivery = (totalViews / 1000) * PRICE_PER_CPM;
    return {
      production,
      delivery,
      total: production + delivery,
      totalViews,
      perVideo: (production + delivery) / Math.max(videos, 1),
      cpm: ((production + delivery) / Math.max(totalViews, 1)) * 1000,
    };
  }, [videos, avgViews]);

  return (
    <section id="pricing" className="mx-auto max-w-[1180px] px-5 py-24">
      <SectionHeading
        eyebrow="Pricing"
        title={<>$5 a video. $1 per thousand views.</>}
        description="No subscription, no tiers, no contract. You pay for what gets made, then for what actually gets watched. A video nobody sees only costs you what it cost to make."
      />

      {/* -- Calculator ------------------------------------------------------ */}
      <div className="mt-14 grid gap-5 lg:grid-cols-[1fr_minmax(0,420px)]">
        <div className="card p-8">
          <h3 className="text-xl">Your month</h3>

          <div className="mt-8 space-y-8">
            <Slider
              label="Videos made per month"
              value={videos}
              min={30}
              max={1500}
              step={10}
              onChange={setVideos}
              format={(v) => v.toLocaleString("en-US")}
              hint="Ten channels posting once a day is about 300."
            />
            <Slider
              label="Average views per video"
              value={avgViews}
              min={500}
              max={40000}
              step={500}
              onChange={setAvgViews}
              format={(v) => v.toLocaleString("en-US")}
              hint="The median barely matters — a handful of outliers carry the total."
            />
          </div>

          <div className="mt-9 space-y-2.5 border-t border-line pt-7">
            <Line
              label={`Production — ${videos.toLocaleString("en-US")} × $5`}
              value={model.production}
            />
            <Line
              label={`Delivery — ${(model.totalViews / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })} × $1 per thousand`}
              value={model.delivery}
            />
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-lg font-semibold tracking-[-0.02em] text-ink-strong">
                Total this month
              </span>
              <span className="tnum font-display text-4xl font-semibold tracking-[-0.04em] text-ink-strong">
                ${Math.round(model.total).toLocaleString("en-US")}
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
            <Cell
              value={`$${model.perVideo.toFixed(2)}`}
              label="per video"
            />
            <Cell
              value={`$${model.cpm.toFixed(2)}`}
              label="all-in CPM"
            />
            <Cell
              value={(model.totalViews / 1_000_000).toFixed(2) + "M"}
              label="views targeted"
            />
          </div>
        </div>

        {/* -- Comparison --------------------------------------------------- */}
        <div className="card flex flex-col p-8">
          <div className="flex items-center justify-between">
            <h3 className="text-xl">What this costs elsewhere</h3>
            <Badge>market ranges</Badge>
          </div>

          <div className="mt-7 space-y-3">
            {ALTERNATIVES.map((alt) => {
              const cost = alt.monthlyFor(videos);
              const ratio = cost / Math.max(model.total, 1);
              return (
                <div key={alt.label} className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-semibold tracking-[-0.02em] text-ink-strong">
                      {alt.label}
                    </span>
                    <span className="tnum shrink-0 text-base font-semibold text-ink">
                      {formatMoney(cost)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-subtle">{alt.note}</p>
                  {ratio > 1.2 ? (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-4">
                        <div
                          className="h-full rounded-full bg-kill/70"
                          style={{ width: `${Math.min(100, (1 / ratio) * 100)}%` }}
                        />
                      </div>
                      <span className="tnum text-2xs font-semibold text-kill">
                        ×{ratio < 100 ? ratio.toFixed(1) : Math.round(ratio)}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-accent-line bg-accent-soft p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-semibold tracking-[-0.02em] text-ink-strong">
                OttoUGC
              </span>
              <span className="tnum shrink-0 font-display text-xl font-semibold text-accent">
                {formatMoney(model.total)}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              Posting, editing, measurement and decisions included.
            </p>
          </div>

          <p className="mt-5 text-2xs leading-relaxed text-ink-faint">
            Ranges observed in 2026 for comparable volume. They vary a lot by niche and by how big the creator is.
          </p>
        </div>
      </div>

      {/* -- Feature comparison -------------------------------------------- */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="px-6 py-4 text-sm font-semibold text-ink-subtle">What's included</th>
                <th className="px-4 py-4 text-sm font-semibold text-ink-subtle">UGC creator</th>
                <th className="px-4 py-4 text-sm font-semibold text-ink-subtle">Agency</th>
                <th className="px-4 py-4 text-sm font-semibold text-ink-subtle">AI generator</th>
                <th className="bg-accent-soft px-4 py-4 text-sm font-semibold text-accent">OttoUGC</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr key={row.feature} className="border-b border-line last:border-0">
                  <td className="px-6 py-3.5 text-base text-ink">{row.feature}</td>
                  <Yes on={row.creator} />
                  <Yes on={row.agency} />
                  <Yes on={row.aiTool} />
                  <Yes on={row.otto} highlight />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        <ButtonLink href="/onboarding" size="lg">
          Start free
        </ButtonLink>
        <p className="text-sm text-ink-subtle">
          You&rsquo;ll watch a finished video before you connect anything.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-base font-medium text-ink">{label}</label>
        <span className="tnum font-display text-2xl font-semibold tracking-[-0.03em] text-ink-strong">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-4 accent-[var(--color-accent)]"
      />
      {hint ? <p className="mt-2 text-sm text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-base text-ink-muted">{label}</span>
      <span className="tnum text-base font-semibold text-ink">
        ${Math.round(value).toLocaleString("en-US")}
      </span>
    </div>
  );
}

function Cell({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-surface px-4 py-4 text-center">
      <div className="tnum font-display text-xl font-semibold tracking-[-0.03em] text-ink-strong">
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-ink-subtle">{label}</div>
    </div>
  );
}

function Yes({ on, highlight }: { on: boolean; highlight?: boolean }) {
  return (
    <td className={cn("px-4 py-3.5", highlight && "bg-accent-soft/50")}>
      {on ? (
        <Check size={17} strokeWidth={2.6} className={highlight ? "text-accent" : "text-win"} />
      ) : (
        <Minus size={17} strokeWidth={2.4} className="text-ink-faint" />
      )}
    </td>
  );
}

function formatMoney(v: number): string {
  if (v >= 1000) return `$${Math.round(v / 100) / 10}k`;
  return `$${Math.round(v)}`;
}

const ALTERNATIVES = [
  {
    label: "UGC creator on a marketplace",
    note: "$75–250 a video, delivered in 1–2 weeks, ad rights usually extra.",
    monthlyFor: (videos: number) => videos * 140,
  },
  {
    label: "Micro-influencer placement",
    note: "$500–2,000 a placement. A borrowed audience, not one you built.",
    monthlyFor: (videos: number) => videos * 900,
  },
  {
    label: "UGC agency retainer",
    note: "$2,000–8,000 a month for 15–40 videos. Past that, it scales badly.",
    monthlyFor: (videos: number) => 2000 + Math.max(0, videos - 20) * 180,
  },
  {
    label: "AI generator subscription",
    note: "$110–500 a month, capped. No posting, no measurement, no decisions.",
    monthlyFor: (videos: number) => 110 + Math.ceil(videos / 50) * 90,
  },
];

const MATRIX = [
  { feature: "Writes the script", creator: true, agency: true, aiTool: true, otto: true },
  { feature: "Generates the footage", creator: false, agency: false, aiTool: true, otto: true },
  { feature: "Actually edits it", creator: true, agency: true, aiTool: false, otto: true },
  { feature: "Records your real product", creator: false, agency: true, aiTool: false, otto: true },
  { feature: "Consistent, distinct characters", creator: false, agency: false, aiTool: false, otto: true },
  { feature: "Posts to your channels", creator: false, agency: false, aiTool: false, otto: true },
  { feature: "Replies to comments", creator: false, agency: true, aiTool: false, otto: true },
  { feature: "Reads the drop-off curve", creator: false, agency: false, aiTool: false, otto: true },
  { feature: "Stops what isn't working", creator: false, agency: false, aiTool: false, otto: true },
  { feature: "Volume at marginal cost", creator: false, agency: false, aiTool: true, otto: true },
];
