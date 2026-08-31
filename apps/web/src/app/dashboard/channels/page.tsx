import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Radio, Youtube } from "lucide-react";

import { PageHeader } from "@/components/dashboard/Shell";
import { Badge, ButtonLink, Card, EmptyState } from "@/components/ui/primitives";
import { capabilitySnapshot, env } from "@/lib/env";
import { getFleet, getPrimaryBrand } from "@/server/dashboard/queries";
import { QUOTA_COST, pickApiProject } from "@/server/integrations/youtube";

export const dynamic = "force-dynamic";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const params = await searchParams;
  const [fleet, caps, quota] = await Promise.all([
    getFleet(brand.id),
    Promise.resolve(capabilitySnapshot()),
    safeQuota(),
  ]);

  const connected = fleet.filter((c) => c.externalId);
  const pending = fleet.filter((c) => !c.externalId);

  return (
    <>
      <PageHeader
        title="Channels"
        description="Your creators post on your own YouTube channels, through Google's official flow. Connect one channel per creator."
        actions={
          pending.length > 0 && caps.youtube.configured ? (
            <ButtonLink href={`/api/auth/youtube/start?brandId=${brand.id}&slot=${pending[0]!.slotIndex}`} size="md">
              <Youtube size={16} strokeWidth={2.2} />
              Connect next channel
            </ButtonLink>
          ) : null
        }
      />

      {/* How to attach several channels. Google shows an account chooser on every
          pass, and people assume the first connection took all of them. */}
      {pending.length > 0 && caps.youtube.configured ? (
        <div className="mb-5 rounded-2xl border border-line bg-surface p-5">
          <p className="text-base font-semibold tracking-[-0.02em] text-ink-strong">
            Connecting more than one channel
          </p>
          <ol className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {[
              "Click connect. Google asks which account and which channel.",
              "Pick a different channel each time — Brand Accounts show up as separate options.",
              "Repeat for each creator. You can stop whenever and add the rest later.",
            ].map((step, i) => (
              <li key={step} className="flex gap-2.5 rounded-xl bg-surface-2 p-3.5">
                <span className="tnum shrink-0 text-2xs font-semibold text-ink-faint">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-ink-muted">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {params.connected ? (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-win/20 bg-win-soft p-4">
          <CheckCircle2 size={18} strokeWidth={2.2} className="shrink-0 text-win" />
          <p className="text-base text-ink">{params.connected}</p>
        </div>
      ) : null}
      {params.error ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-kill/20 bg-kill-soft p-4">
          <AlertTriangle size={18} strokeWidth={2.2} className="mt-0.5 shrink-0 text-kill" />
          <p className="text-base leading-relaxed text-ink">{params.error}</p>
        </div>
      ) : null}

      {/* The quota panel: the real operating constraint of this product. */}
      <Card className="mb-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl">Upload quota</h2>
            <p className="mt-1.5 max-w-[70ch] text-base leading-relaxed text-ink-muted">
              One upload costs {QUOTA_COST.videosInsert.toLocaleString("en-US")} of the{" "}{quota.dailyQuotaUnits.toLocaleString("en-US")} units a Google Cloud project gets per day — six videos a day, per project. Add more projects to go past that.
            </p>
          </div>
          <div className="text-right">
            <div className="tnum font-display text-4xl font-semibold tracking-[-0.04em] text-ink-strong">
              {quota.uploadsRemaining}
            </div>
            <div className="text-sm text-ink-subtle">uploads left today</div>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-4">
          <div
            className="h-full rounded-full bg-accent"
            style={{
              width: `${Math.min(100, (quota.usedToday / Math.max(quota.dailyQuotaUnits, 1)) * 100)}%`,
            }}
          />
        </div>
        <p className="tnum mt-2 text-sm text-ink-subtle">
          {quota.usedToday.toLocaleString("fr-FR")} / {quota.dailyQuotaUnits.toLocaleString("fr-FR")}{" "}
          units used
        </p>
      </Card>

      {!caps.youtube.configured ? (
        <div className="mb-5 rounded-2xl border border-warn/20 bg-warn-soft p-5">
          <p className="text-base font-semibold text-ink-strong">YouTube OAuth not configured</p>
          <p className="mt-1.5 max-w-[76ch] text-base leading-relaxed text-ink-muted">
            Set <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">YOUTUBE_CLIENT_ID</code> and{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">YOUTUBE_CLIENT_SECRET</code>{" "}
            in <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">.env.local</code>. Full steps are in <code className="font-mono text-sm">docs/SETUP.md</code>, section 4.
          </p>
          <p className="mt-3 text-sm text-ink-subtle">
            Redirect URI to register:{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">
              {env.appUrl}/api/auth/youtube/callback
            </code>
          </p>
        </div>
      ) : env.dryRunPublishing ? (
        <div className="mb-5 rounded-2xl border border-warn/20 bg-warn-soft p-5">
          <p className="text-base font-semibold text-ink-strong">Dry run is on</p>
          <p className="mt-1.5 text-base leading-relaxed text-ink-muted">
            Channels can be connected, but nothing is sent to YouTube. Set{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">DRY_RUN_PUBLISHING=false</code>{" "}
            to post for real.
          </p>
        </div>
      ) : null}

      {connected.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-3 text-xl">Connected</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {connected.map((c) => (
              <Card key={c.id} className="flex items-start gap-4 p-5">
                {c.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.thumbnailUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-3">
                    <Radio size={17} strokeWidth={2.2} className="text-ink-faint" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-semibold text-ink-strong">{c.title}</span>
                    <Badge tone={c.status === "ACTIVE" ? "win" : "accent"}>
                      {c.status === "WARMING" ? `warming · day ${c.warmingDay}` : c.status.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="tnum mt-1 text-sm text-ink-subtle">
                    {c.subscriberCount.toLocaleString("en-US")} subscribers ·{" "}{c.personaName ?? "no character"}
                  </p>
                  <a
                    href={`https://www.youtube.com/channel/${c.externalId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                  >
                    Open channel <ExternalLink size={12} strokeWidth={2.4} />
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <h2 className="mb-3 text-xl">Not connected yet</h2>
      {pending.length === 0 ? (
        <EmptyState
          title="All channels connected"
          description="Your creators can post everywhere."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pending.map((c) => (
            <Card key={c.id} className="p-5">
              <p className="text-base font-semibold text-ink-strong">
                {c.personaName ?? c.title ?? `Slot ${c.slotIndex + 1}`}
              </p>
              <p className="mt-1 text-sm text-ink-subtle">
                {c.archetype ?? "no character"} · slot {c.slotIndex + 1}
              </p>
              <ButtonLink
                href={`/api/auth/youtube/start?brandId=${brand.id}&slot=${c.slotIndex}`}
                size="sm"
                className="mt-4 w-full"
              >
                <Youtube size={14} strokeWidth={2.3} />
                Connect a channel
              </ButtonLink>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-8 max-w-[76ch] text-sm leading-relaxed text-ink-subtle">
        Each slot is one creator. Connect a different YouTube channel to each — that's what lets ten different angles run at once instead of one brand posting ten times. Google will ask which channel every time, so pick a different one on each pass.{" "}
        <Link href="/dashboard/fleet" className="font-medium text-accent hover:underline">
          See your creators
        </Link>
      </p>
    </>
  );
}

async function safeQuota() {
  try {
    return await pickApiProject(QUOTA_COST.videosInsert);
  } catch {
    return {
      apiProjectId: null,
      googleProjectId: null,
      dailyQuotaUnits: 10000,
      usedToday: 0,
      remaining: 10000,
      uploadsRemaining: 6,
    };
  }
}
