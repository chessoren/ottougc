import { PageHeader } from "@/components/dashboard/Shell";
import { Badge, Card } from "@/components/ui/primitives";
import { capabilitySnapshot, env } from "@/lib/env";
import { getPrimaryBrand } from "@/server/dashboard/queries";

export const dynamic = "force-dynamic";

/**
 * Settings.
 *
 * Deliberately read-only: it reports what is configured and what is not, and
 * names the environment variable that changes each one. A settings page that
 * writes credentials into a database is a settings page that leaks them; the
 * source of truth here stays the environment.
 */
export default async function SettingsPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const caps = capabilitySnapshot();

  const integrations = [
    {
      label: "Database",
      live: true,
      detail:
        caps.database.driver === "postgres"
          ? "External Postgres (DATABASE_URL)"
          : "Local PGlite — set DATABASE_URL to switch to Cloud SQL Postgres",
      env: "DATABASE_URL / DIRECT_URL",
    },
    {
      label: "Language model",
      live: caps.llm.configured,
      detail: caps.llm.configured
        ? `Live via ${caps.llm.via} — ${env.models.brain}`
        : "No model. Creators run on the rule-based planner: the pipeline works but nothing is improvised.",
      env: "GEMINI_API_KEY or GOOGLE_APPLICATION_CREDENTIALS",
    },
    {
      label: "Video generation",
      live: caps.video.configured,
      detail: caps.video.configured
        ? `Live — ${env.models.video}`
        : "Stand-in media generated locally. Timings are real, the pictures are not, and quality control blocks anything containing them.",
      env: "GOOGLE_APPLICATION_CREDENTIALS",
    },
    {
      label: "Voice and music",
      live: caps.tts.configured,
      detail: caps.tts.configured
        ? `Chirp 3 HD and Lyria live — default voice ${env.models.ttsVoice}`
        : "Stand-in voice and music, with estimated durations and word timings.",
      env: "GOOGLE_APPLICATION_CREDENTIALS",
    },
    {
      label: "Storage",
      live: caps.storage.configured,
      detail: caps.storage.configured
        ? `Cloud Storage — ${env.gcsBucket}`
        : "Files written to local disk, in the video project's public folder.",
      env: "GCS_BUCKET",
    },
    {
      label: "YouTube posting",
      live: caps.youtube.canPublish,
      detail: !caps.youtube.configured
        ? "OAuth not configured: no channel can be connected."
        : env.dryRunPublishing
          ? "OAuth is configured, but posting is in dry run. Nothing leaves for YouTube."
          : "Posting for real.",
      env: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / DRY_RUN_PUBLISHING",
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="What's connected, what isn't, and the environment variable that changes each line."
      />

      <div className="grid gap-3">
        {integrations.map((i) => (
          <Card key={i.label} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${i.live ? "bg-win" : "bg-ink-faint"}`}
                />
                <span className="text-base font-semibold tracking-[-0.02em] text-ink-strong">
                  {i.label}
                </span>
                <Badge tone={i.live ? "win" : "neutral"}>{i.live ? "on" : "off"}</Badge>
              </div>
              <p className="mt-2 max-w-[76ch] text-base leading-relaxed text-ink-muted">{i.detail}</p>
            </div>
            <code className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-2xs text-ink-subtle">
              {i.env}
            </code>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-xl">Limits</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Setting
            label="Daily generation budget"
            value={`$${env.limits.dailyGenerationBudgetUsd} / day, whole service`}
            note="Every creator shares this cap. When it is hit, generation stops."
          />
          <Setting
            label="Max steps per run"
            value={String(env.limits.maxAgentSteps)}
            note="Upper bound on a loop, so circular reasoning still terminates."
          />
          <Setting
            label="Parallel renders"
            value={String(env.limits.maxParallelRenders)}
            note="Each render holds a Chromium instance; past this the machine slows everything down."
          />
          <Setting
            label="Pricing"
            value={`$${env.pricing.perVideoUsd} per video · $${env.pricing.perThousandViewsUsd} per thousand views`}
            note="Used for margin reporting and usage billing."
          />
        </dl>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="text-xl">Brand</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Setting label="Name" value={brand.name} />
          <Setting label="Domain" value={brand.domain ?? "—"} />
          <Setting label="Where traffic goes" value={brand.targetUrl ?? "—"} />
          <Setting label="Channels allocated" value={String(brand.channelQuota)} />
          <Setting label="Timezone" value={brand.timezone} />
          <Setting label="Language" value={brand.primaryLocale} />
        </dl>
      </Card>
    </>
  );
}

function Setting({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-semibold text-ink-strong">{value}</dd>
      {note ? <p className="mt-1.5 text-sm leading-relaxed text-ink-subtle">{note}</p> : null}
    </div>
  );
}
