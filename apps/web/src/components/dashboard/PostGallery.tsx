"use client";

import { useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Play,
  Scissors,
  Share2,
  ShieldAlert,
  X,
} from "lucide-react";

import { Badge, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { DashboardPost } from "@/server/dashboard/queries";

/**
 * The video wall.
 *
 * Every card is the real rendered file, and clicking one opens the full record:
 * the hook, the format, the metrics, the darwinian verdict and — most usefully —
 * the QA reasoning. An operator's first question about an automated system is
 * always "why did it do that", so the answer is one click from the video rather
 * than buried in a log.
 */

const FILTERS = [
  { id: "all", label: "All" },
  { id: "PUBLISHED", label: "Posted" },
  { id: "READY", label: "Ready" },
  { id: "QA_REJECTED", label: "Blocked" },
  { id: "FAILED", label: "Failed" },
] as const;

export function PostGallery({
  posts,
  formatNames,
}: {
  posts: DashboardPost[];
  formatNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<DashboardPost | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: posts.length };
    for (const p of posts) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posts]);

  const visible = filter === "all" ? posts : posts.filter((p) => p.status === filter);

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-pill border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === f.id
                ? "border-inverse bg-inverse text-on-inverse"
                : "border-line bg-surface text-ink-muted hover:border-line-strong",
            )}
          >
            {f.label}
            <span className="tnum ml-1.5 text-2xs opacity-60">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Try another filter, or start a run from the overview."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              formatName={formatNames[p.formatId] ?? p.formatId}
              onOpen={() => setSelected(p)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <PostDetail
          post={selected}
          formatName={formatNames[selected.formatId] ?? selected.formatId}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function PostCard({
  post,
  formatName,
  onOpen,
}: {
  post: DashboardPost;
  formatName: string;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <button onClick={onOpen} className="group text-left">
      <div
        className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-inverse transition-shadow group-hover:shadow-md"
        onMouseEnter={() => {
          void ref.current?.play().then(() => setPlaying(true)).catch(() => undefined);
        }}
        onMouseLeave={() => {
          const el = ref.current;
          if (!el) return;
          el.pause();
          el.currentTime = 0;
          setPlaying(false);
        }}
      >
        {post.videoUrl ? (
          <video
            ref={ref}
            src={post.videoUrl}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-2xs text-on-inverse-muted">
            {post.status === "FAILED" ? "render failed" : "not rendered yet"}
          </div>
        )}

        {post.videoUrl && !playing ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-lg">
              <Play size={14} strokeWidth={2.6} className="ml-0.5 text-ink-strong" />
            </span>
          </span>
        ) : null}

        <div className="absolute left-2 right-2 top-2 flex items-start justify-between gap-2">
          <StatusPill status={post.status} />
          {post.durationMs ? (
            <span className="tnum rounded-md bg-black/65 px-1.5 py-0.5 text-2xs font-semibold text-white">
              {(post.durationMs / 1000).toFixed(0)}s
            </span>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-3 pt-12">
          <p className="line-clamp-2 text-2xs font-semibold leading-snug text-white">{post.hookText}</p>
          {post.views > 0 ? (
            <p className="tnum mt-1 text-2xs text-white/70">
              {post.views.toLocaleString("en-US")} views
            </p>
          ) : null}
        </div>

        {post.decision === "DOUBLE_DOWN" || post.decision === "AMPLIFY" ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-win px-1.5 py-0.5 text-2xs font-bold text-white">
            OUTLIER
          </span>
        ) : null}
      </div>

      <div className="mt-2.5">
        <p className="truncate text-sm font-medium text-ink">{post.personaName ?? post.handle}</p>
        <p className="truncate text-2xs text-ink-subtle">{formatName}</p>
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    PUBLISHED: { cls: "bg-win text-white", label: "live" },
    READY: { cls: "bg-accent text-white", label: "ready" },
    RENDERING: { cls: "bg-warn text-white", label: "rendering" },
    QA_PENDING: { cls: "bg-warn text-white", label: "checking" },
    QA_REJECTED: { cls: "bg-kill text-white", label: "blocked" },
    FAILED: { cls: "bg-kill text-white", label: "failed" },
  };
  const s = map[status] ?? { cls: "bg-black/65 text-white", label: status.toLowerCase() };
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-2xs font-semibold", s.cls)}>{s.label}</span>
  );
}

/* -------------------------------------------------------------------------- */

function PostDetail({
  post,
  formatName,
  onClose,
}: {
  post: DashboardPost;
  formatName: string;
  onClose: () => void;
}) {
  const qa = post.qaVerdict as
    | { verdict?: string; reasons?: string[]; fixes?: string[]; severity?: string }
    | null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-[900px] overflow-y-auto rounded-t-3xl bg-canvas sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas/90 px-6 py-4 backdrop-blur-xl">
          <div className="min-w-0">
            <h2 className="truncate text-xl">{post.hookText}</h2>
            <p className="mt-0.5 text-sm text-ink-subtle">
              {post.personaName ?? post.handle} · {formatName} · {post.formatId}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors hover:text-ink"
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[280px_1fr]">
          <div>
            <div className="aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-inverse">
              {post.videoUrl ? (
                <video src={post.videoUrl} controls playsInline className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-on-inverse-muted">
                  No render available
                </div>
              )}
            </div>

            {post.externalUrl ? (
              <a
                href={post.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center justify-center gap-1.5 rounded-pill border border-line bg-surface py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong"
              >
                Watch on YouTube <ExternalLink size={13} strokeWidth={2.4} />
              </a>
            ) : null}
          </div>

          <div className="space-y-6">
            {/* Metrics */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.07em] text-ink-subtle">
                Results
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
                <Metric icon={Eye} value={post.views} label="views" />
                <Metric icon={Heart} value={post.likes} label="likes" />
                <Metric icon={Share2} value={post.shares} label="shares" />
                <Metric icon={MessageCircle} value={post.comments} label="comments" />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
                <Rate value={post.retention3s} label="held past 3s" />
                <Rate value={post.completionRate} label="watched through" />
                <Rate
                  value={post.views > 0 ? post.linkClicks / post.views : 0}
                  label="clicks / views"
                />
              </div>
            </div>

            {/* Darwinian verdict */}
            {post.decision && post.decision !== "PENDING" ? (
              <div
                className={cn(
                  "rounded-xl border p-4",
                  post.decision === "KILL"
                    ? "border-kill/20 bg-kill-soft"
                    : post.decision === "MAINTAIN"
                      ? "border-line bg-surface-2"
                      : "border-win/20 bg-win-soft",
                )}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      post.decision === "KILL"
                        ? "kill"
                        : post.decision === "MAINTAIN"
                          ? "neutral"
                          : "win"
                    }
                  >
                    {post.decision}
                  </Badge>
                  <span className="tnum text-sm text-ink-muted">
                    score {post.score.toFixed(3)}
                  </span>
                </div>
                {post.rationale ? (
                  <p className="mt-2.5 text-base leading-relaxed text-ink-muted">{post.rationale}</p>
                ) : null}
              </div>
            ) : null}

            {/* QA */}
            {qa ? (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.07em] text-ink-subtle">
                  <ShieldAlert size={14} strokeWidth={2.3} />
                  Quality control
                </h3>
                <div
                  className={cn(
                    "mt-3 rounded-xl border p-4",
                    qa.verdict === "REJECT" ? "border-kill/20 bg-kill-soft" : "border-win/20 bg-win-soft",
                  )}
                >
                  <Badge tone={qa.verdict === "REJECT" ? "kill" : "win"}>
                    {qa.verdict === "REJECT" ? (
                      <X size={11} strokeWidth={3} />
                    ) : (
                      <Check size={11} strokeWidth={3} />
                    )}
                    {qa.verdict === "REJECT" ? "blocked" : "passed"}
                  </Badge>
                  {qa.reasons?.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {qa.reasons.map((r) => (
                        <li key={r} className="flex gap-2 text-base leading-relaxed text-ink-muted">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : null}

            {post.failureReason && !qa ? (
              <div className="rounded-xl border border-kill/20 bg-kill-soft p-4">
                <p className="text-sm font-semibold text-kill">Failed</p>
                <p className="mt-1.5 text-base leading-relaxed text-ink-muted">{post.failureReason}</p>
              </div>
            ) : null}

            {/* Timeline */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.07em] text-ink-subtle">
                <Scissors size={14} strokeWidth={2.3} />
                Timeline
              </h3>
              <dl className="mt-3 space-y-2">
                <Row label="Created" value={fmtDate(post.createdAt)} />
                <Row label="Scheduled" value={fmtDate(post.scheduledFor)} />
                <Row label="Posted" value={fmtDate(post.publishedAt)} />
                <Row label="Title" value={post.title ?? "—"} />
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Eye;
  value: number;
  label: string;
}) {
  return (
    <div className="bg-surface px-3 py-3">
      <Icon size={13} strokeWidth={2.2} className="text-ink-faint" />
      <div className="tnum mt-1.5 font-display text-lg font-semibold text-ink-strong">
        {value.toLocaleString("en-US")}
      </div>
      <div className="text-2xs text-ink-subtle">{label}</div>
    </div>
  );
}

function Rate({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-surface px-3 py-3 text-center">
      <div className="tnum font-display text-lg font-semibold text-ink-strong">
        {(value * 100).toFixed(1)} %
      </div>
      <div className="text-2xs text-ink-subtle">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd className="truncate text-base text-ink">{value}</dd>
    </div>
  );
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

