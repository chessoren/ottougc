import { Target, Users } from "lucide-react";

import { RunAction } from "@/components/dashboard/RunAction";
import { PageHeader } from "@/components/dashboard/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { planFleetNow, reviewNow } from "@/server/dashboard/actions";
import { getFleet, getPrimaryBrand, type FleetChannel } from "@/server/dashboard/queries";
import { getScenario } from "@/server/knowledge/scenarios";

export const dynamic = "force-dynamic";

const AWARENESS: Record<string, string> = {
  UNAWARE: "cold audience",
  PROBLEM_AWARE: "knows the problem",
  SOLUTION_AWARE: "shopping for a fix",
  PRODUCT_AWARE: "knows you exist",
  MOST_AWARE: "ready to act",
};

const STATUS: Record<string, { tone: "win" | "warn" | "kill" | "accent" | "neutral"; label: string }> = {
  ACTIVE: { tone: "win", label: "active" },
  WARMING: { tone: "accent", label: "warming up" },
  PENDING_AUTH: { tone: "warn", label: "not connected" },
  COOLDOWN: { tone: "warn", label: "slowed down" },
  PAUSED: { tone: "kill", label: "paused" },
  FLAGGED: { tone: "kill", label: "flagged" },
  TOKEN_EXPIRED: { tone: "kill", label: "needs re-auth" },
};

export default async function FleetPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const fleet = await getFleet(brand.id);

  return (
    <>
      <PageHeader
        title="Creators"
        description="Each one has its own character, its own angle, its own rule about when your product can appear, and its own targets this week."
        actions={
          <>
            <RunAction
              action={planFleetNow.bind(null, brand.id)}
              label="Re-cast"
              running="Casting…"
              size="md"
            />
            <RunAction
              action={reviewNow.bind(null, brand.id)}
              label="Weekly review"
              running="Reviewing…"
              variant="primary"
              size="md"
            />
          </>
        }
      />

      {fleet.length === 0 ? (
        <EmptyState
          title="No channels"
          description="Finish setup to create your channels."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {fleet.map((c) => (
            <ChannelCard key={c.id} channel={c} />
          ))}
        </div>
      )}
    </>
  );
}

function ChannelCard({ channel: c }: { channel: FleetChannel }) {
  const status = STATUS[c.status] ?? { tone: "neutral" as const, label: c.status };
  const mix = (c.formatMix as Record<string, number> | null) ?? {};
  const topFormats = Object.entries(mix)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl">{c.personaName ?? c.title ?? "No character yet"}</h2>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-ink-subtle">
            @{c.handle}
            {c.archetype ? ` · ${c.archetype}` : ""}
            {c.awareness ? ` · ${AWARENESS[c.awareness] ?? c.awareness}` : ""}
          </p>
        </div>
        <Users size={17} strokeWidth={2.2} className="mt-1 shrink-0 text-ink-faint" />
      </div>

      {c.thesis ? (
        <p className="mt-4 text-base leading-relaxed text-ink-muted">{c.thesis}</p>
      ) : (
        <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink-muted">
          No active strategy. Run a re-cast.
        </p>
      )}

      {c.brandRule ? (
        <div className="mt-4 rounded-xl bg-surface-2 p-3.5">
          <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
            When your product can appear
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{c.brandRule}</p>
          {c.brandDensity !== null ? (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-4">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(c.brandDensity ?? 0) * 100}%` }}
                />
              </div>
              <span className="tnum text-2xs text-ink-faint">
                {((c.brandDensity ?? 0) * 100).toFixed(0)}% brand presence
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-line bg-line">
        <MiniStat value={c.stats?.total ?? 0} label="made" />
        <MiniStat value={c.stats?.published ?? 0} label="posted" />
        <MiniStat value={(c.stats?.views ?? 0).toLocaleString("en-US")} label="views" />
        <MiniStat value={c.stats?.outliers ?? 0} label="outliers" tone={(c.stats?.outliers ?? 0) > 0 ? "win" : undefined} />
      </div>

      {c.objectives.length > 0 ? (
        <div className="mt-5">
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
            <Target size={12} strokeWidth={2.4} />
            This week
          </p>
          <ul className="mt-2.5 space-y-2">
            {c.objectives.map((o) => {
              const ratio = o.target > 0 ? Math.min(1, o.current / o.target) : 0;
              const met = o.comparator.startsWith(">") ? o.current >= o.target : o.current <= o.target;
              return (
                <li key={o.statement}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-ink-muted">{o.statement}</span>
                    <span
                      className={`tnum shrink-0 text-2xs font-semibold ${met ? "text-win" : "text-ink-faint"}`}
                    >
                      {formatMetric(o.metric, o.current)} / {formatMetric(o.metric, o.target)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-4">
                    <div
                      className={`h-full rounded-full ${met ? "bg-win" : "bg-accent"}`}
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {topFormats.length > 0 ? (
        <div className="mt-5">
          <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
            Scenario mix
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topFormats.map(([id, weight]) => (
              <span
                key={id}
                className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 text-2xs text-ink-muted"
              >
                {getScenario(id)?.name ?? id}
                <span className="tnum ml-1.5 opacity-60">{(weight * 100).toFixed(0)} %</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {c.appearance ? (
        <details className="mt-5 group">
          <summary className="cursor-pointer text-sm font-medium text-ink-subtle hover:text-ink">
            Character anchor
          </summary>
          <p className="mt-2 rounded-lg bg-surface-2 p-3 font-mono text-2xs leading-relaxed text-ink-muted">
            {c.appearance}
          </p>
        </details>
      ) : null}
    </Card>
  );
}

function MiniStat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: "win";
}) {
  return (
    <div className="bg-surface px-3 py-3 text-center">
      <div
        className={`tnum font-display text-lg font-semibold ${tone === "win" ? "text-win" : "text-ink-strong"}`}
      >
        {value}
      </div>
      <div className="text-2xs text-ink-subtle">{label}</div>
    </div>
  );
}

/** Rate metrics read as percentages; counts read as counts. */
function formatMetric(metric: string, value: number): string {
  const rates = ["retention3s", "completionRate", "shareRate", "saveRate", "linkClickRate"];
  return rates.includes(metric) ? `${(value * 100).toFixed(1)} %` : String(Math.round(value));
}

