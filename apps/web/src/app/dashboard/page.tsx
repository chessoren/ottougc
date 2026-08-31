import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Radio } from "lucide-react";

import { ProductionChart } from "@/components/dashboard/ProductionChart";
import { RunAction } from "@/components/dashboard/RunAction";
import { PageHeader } from "@/components/dashboard/Shell";
import { Badge, ButtonLink, Card, EmptyState, Stat, StatusDot } from "@/components/ui/primitives";
import { capabilitySnapshot } from "@/lib/env";
import { getFormat } from "@/server/knowledge";
import {
  ingestNow,
  planFleetNow,
  produceNow,
  publishNow,
  reviewNow,
} from "@/server/dashboard/actions";
import {
  getAgentRuns,
  getDailySeries,
  getLatestReview,
  getOverview,
  getPosts,
  getPrimaryBrand,
} from "@/server/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const [overview, series, runs, posts, review] = await Promise.all([
    getOverview(brand.id),
    getDailySeries(brand.id),
    getAgentRuns(brand.id, 8),
    getPosts(brand.id, { limit: 6 }),
    getLatestReview(brand.id),
  ]);

  const caps = capabilitySnapshot();
  const t = overview.totals;
  const outlierRate = t && t.published > 0 ? t.outliers / t.published : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${brand.name} — what your creators made, posted and decided.`}
        actions={
          <>
            <RunAction
              action={produceNow.bind(null, brand.id, 3)}
              label="Make videos now"
              running="Making…"
              variant="primary"
              size="md"
            />
            <RunAction
              action={ingestNow.bind(null, brand.id)}
              label="Pull numbers"
              running="Pulling…"
              size="md"
            />
          </>
        }
      />

      {/* Blocking conditions first: an operator should not have to hunt for the
          reason nothing is publishing. */}
      <Alerts
        pendingAuth={overview.fleet?.pending ?? 0}
        failedRenders={overview.renders.failed}
        rejected={t?.rejected ?? 0}
        dryRun={caps.dryRunPublishing}
        noPersonas={(overview.fleet?.total ?? 0) > 0 && runs.length === 0}
        brandId={brand.id}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat
            value={(t?.total ?? 0).toLocaleString("en-US")}
            label="videos made"
            sub={`${overview.todayCount} in the last 24h`}
          />
        </Card>
        <Card>
          <Stat
            value={(t?.published ?? 0).toLocaleString("en-US")}
            label="posted"
            sub={`${t?.ready ?? 0} ready · ${t?.inFlight ?? 0} in flight`}
          />
        </Card>
        <Card>
          <Stat
            value={(t?.views ?? 0).toLocaleString("en-US")}
            label="total views"
            sub={`${overview.week.views.toLocaleString("en-US")} this week`}
          />
        </Card>
        <Card>
          <Stat
            value={`${(outlierRate * 100).toFixed(1)} %`}
            label="outlier rate"
            sub={`${t?.outliers ?? 0} doubled down · ${t?.killed ?? 0} dropped`}
            tone={outlierRate >= 0.05 ? "win" : undefined}
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl">Last 21 days</h2>
              <p className="mt-1 text-sm text-ink-subtle">
                The gap between made and posted is the thing to watch.
              </p>
            </div>
            <div className="flex shrink-0 gap-3 pt-1">
              <StatusDot tone="accent" label="made" />
              <StatusDot tone="win" label="posted" />
            </div>
          </div>
          <ProductionChart data={series} />
        </Card>

        <Card className="p-6">
          <h2 className="text-xl">Channel health</h2>
          <div className="mt-5 space-y-3">
            <FleetLine label="Active" value={overview.fleet?.active ?? 0} tone="win" />
            <FleetLine label="Warming up" value={overview.fleet?.warming ?? 0} tone="accent" />
            <FleetLine label="Not connected" value={overview.fleet?.pending ?? 0} tone="warn" />
            <FleetLine label="Paused or flagged" value={overview.fleet?.paused ?? 0} tone="kill" />
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <div className="flex items-baseline justify-between">
              <span className="text-base text-ink-muted">Clicks to your site</span>
              <span className="tnum font-display text-2xl font-semibold text-ink-strong">
                {(t?.clicks ?? 0).toLocaleString("en-US")}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-base text-ink-muted">Signups attributed</span>
              <span className="tnum font-display text-2xl font-semibold text-ink-strong">
                {(t?.signups ?? 0).toLocaleString("en-US")}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <RunAction
              action={planFleetNow.bind(null, brand.id)}
              label="Re-cast creators"
              running="Casting…"
            />
            <RunAction
              action={reviewNow.bind(null, brand.id)}
              label="Weekly review"
              running="Reviewing…"
            />
            <RunAction
              action={publishNow.bind(null, brand.id)}
              label="Post what's ready"
              running="Posting…"
            />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl">Latest videos</h2>
            <Link
              href="/dashboard/posts"
              className="flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              See all <ArrowUpRight size={14} strokeWidth={2.4} />
            </Link>
          </div>

          {posts.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="Start a run and each creator will pick a scenario, write it, shoot it and cut it."
            />
          ) : (
            <ul className="space-y-2.5">
              {posts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                  <div className="h-14 w-9 shrink-0 overflow-hidden rounded-md bg-inverse">
                    {p.videoUrl ? (
                      <video src={p.videoUrl} muted preload="metadata" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-ink">{p.hookText}</p>
                    <p className="truncate text-2xs text-ink-subtle">
                      {p.personaName ?? p.handle} · {getFormat(p.formatId)?.name ?? p.formatId}
                    </p>
                  </div>
                  <PostStatus status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl">Creator activity</h2>
            <Link
              href="/dashboard/agents"
              className="flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              See all <ArrowUpRight size={14} strokeWidth={2.4} />
            </Link>
          </div>

          {runs.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="Your creators haven't started working on this brand."
            />
          ) : (
            <ul className="space-y-3">
              {runs.map((r) => (
                <li key={r.id} className="flex gap-3">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      r.status === "SUCCEEDED"
                        ? "bg-win"
                        : r.status === "FAILED"
                          ? "bg-kill"
                          : "bg-accent pulse-live"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-base leading-snug text-ink">{r.label}</p>
                    {r.summary ? (
                      <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-ink-subtle">
                        {r.summary}
                      </p>
                    ) : null}
                    <p className="mt-1 text-2xs text-ink-faint">
                      {r.kind} · {r.steps} steps ·{" "}
                      {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "running"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {review ? (
        <Card className="mt-4 p-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl">Last weekly review</h2>
            <Badge>
              {new Date(review.review.periodStart).toLocaleDateString("en-US")} →{" "}
              {new Date(review.review.periodEnd).toLocaleDateString("en-US")}
            </Badge>
          </div>
          {review.review.narrative ? (
            <p className="mt-3 max-w-[80ch] text-base leading-relaxed text-ink-muted">
              {review.review.narrative}
            </p>
          ) : null}
          <div className="mt-5 grid gap-2 md:grid-cols-2">
            {review.decisions.map((d) => (
              <div key={d.handle} className="rounded-xl bg-surface-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-base font-medium text-ink">
                    {d.personaName ?? d.handle}
                  </span>
                  <Badge tone={actionTone(d.action)}>{d.action}</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-subtle">{d.rationale}</p>
                {d.quotaBefore !== d.quotaAfter ? (
                  <p className="tnum mt-2 text-2xs text-ink-faint">
                    {d.quotaBefore} → {d.quotaAfter} per day
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function FleetLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "win" | "accent" | "warn" | "kill";
}) {
  const color =
    tone === "win" ? "bg-win" : tone === "accent" ? "bg-accent" : tone === "warn" ? "bg-warn" : "bg-kill";
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-base text-ink-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        {label}
      </span>
      <span className="tnum text-base font-semibold text-ink">{value}</span>
    </div>
  );
}

function PostStatus({ status }: { status: string }) {
  const map: Record<string, { tone: "win" | "warn" | "kill" | "accent" | "neutral"; label: string }> = {
    PUBLISHED: { tone: "win", label: "posted" },
    READY: { tone: "accent", label: "ready" },
    RENDERING: { tone: "warn", label: "rendering" },
    QA_PENDING: { tone: "warn", label: "checking" },
    QA_REJECTED: { tone: "kill", label: "blocked" },
    FAILED: { tone: "kill", label: "failed" },
  };
  const s = map[status] ?? { tone: "neutral" as const, label: status.toLowerCase() };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function actionTone(action: string) {
  if (action === "DOUBLE_DOWN" || action === "REVIVE") return "win" as const;
  if (action === "KILL") return "kill" as const;
  if (action === "THROTTLE" || action === "REPOSITION") return "warn" as const;
  return "neutral" as const;
}

function Alerts({
  pendingAuth,
  failedRenders,
  rejected,
  dryRun,
  noPersonas,
  brandId,
}: {
  pendingAuth: number;
  failedRenders: number;
  rejected: number;
  dryRun: boolean;
  noPersonas: boolean;
  brandId: string;
}) {
  const items: Array<{ tone: "warn" | "kill"; title: string; body: string; action?: React.ReactNode }> = [];

  if (pendingAuth > 0) {
    items.push({
      tone: "warn",
      title: `${pendingAuth} channel${pendingAuth > 1 ? "s" : ""} not connected`,
      body: "Your creators are making videos but can't post until you connect the channels.",
      action: (
        <ButtonLink href="/dashboard/channels" size="sm">
          <Radio size={14} strokeWidth={2.3} />
          Connect
        </ButtonLink>
      ),
    });
  }
  if (noPersonas) {
    items.push({
      tone: "warn",
      title: "No creators cast yet",
      body: "None of your channels has a character or a strategy yet.",
      action: (
        <RunAction
          action={planFleetNow.bind(null, brandId)}
          label="Cast my creators"
          running="Casting…"
          variant="primary"
        />
      ),
    });
  }
  if (failedRenders > 0) {
    items.push({
      tone: "kill",
      title: `${failedRenders} render${failedRenders > 1 ? "s" : ""} failed`,
      body: "A video that doesn't render costs nothing, but earns nothing either. Details are on each video.",
    });
  }
  if (rejected > 0) {
    items.push({
      tone: "warn",
      title: `${rejected} video${rejected > 1 ? "s" : ""} blocked by quality control`,
      body: "These won't be posted. The reason is on each one.",
    });
  }
  if (dryRun) {
    items.push({
      tone: "warn",
      title: "Dry run is on",
      body: "Nothing is sent to YouTube. Set DRY_RUN_PUBLISHING to false once your channels are connected.",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-6 grid gap-2.5">
      {items.map((item) => (
        <div
          key={item.title}
          className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
            item.tone === "kill" ? "border-kill/20 bg-kill-soft" : "border-warn/20 bg-warn-soft"
          }`}
        >
          <div className="flex gap-3">
            <AlertTriangle
              size={17}
              strokeWidth={2.2}
              className={`mt-0.5 shrink-0 ${item.tone === "kill" ? "text-kill" : "text-warn"}`}
            />
            <div>
              <p className="text-base font-semibold tracking-[-0.02em] text-ink-strong">{item.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          </div>
          {item.action ? <div className="shrink-0">{item.action}</div> : null}
        </div>
      ))}
    </div>
  );
}
