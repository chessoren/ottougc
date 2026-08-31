"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Globe,
  Loader2,
  Pencil,
  Users,
  Youtube,
} from "lucide-react";

import { Badge, Button, ButtonLink } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  designFleetAction,
  makeFirstVideoAction,
  saveBriefAction,
  scanSiteAction,
  type FleetResult,
  type FirstVideoResult,
} from "@/server/onboarding/actions";
import type { CompanyBrief } from "@/server/onboarding/brief";

/**
 * Onboarding.
 *
 * Built on the pattern that makes language apps finishable: **one decision per
 * screen, and value delivered before anything is asked for.** We read the site,
 * hand back a brief about their own company, design creators, and produce a real
 * video — all before an account, a card, or a connection is requested.
 *
 * The second rule is that almost nothing is typed. Confirming a sentence we
 * already wrote is a tap; writing six paragraphs about your own business is a
 * form nobody finishes.
 */

type Step =
  | "url"
  | "scanning"
  | "brief"
  | "questions"
  | "designing"
  | "creators"
  | "filming"
  | "video"
  | "connect";

const TOTAL_STEPS = 6;

export function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [brief, setBrief] = useState<CompanyBrief | null>(null);
  const [pagesRead, setPagesRead] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [gapIndex, setGapIndex] = useState(0);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [creators, setCreators] = useState<NonNullable<FleetResult["creators"]>>([]);
  const [video, setVideo] = useState<FirstVideoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The question list is frozen once we enter the questions step. Recomputing it
  // as answers arrive would shrink the list underneath the user and jump them to
  // a different question mid-tap.
  const [gaps, setGaps] = useState<NonNullable<CompanyBrief["gaps"]>>([]);

  const progress = useMemo(() => {
    const map: Record<Step, number> = {
      url: 0.04,
      scanning: 0.14,
      brief: 0.3,
      questions: 0.3 + (gapIndex / Math.max(gaps.length, 1)) * 0.25,
      designing: 0.62,
      creators: 0.72,
      filming: 0.84,
      video: 0.93,
      connect: 1,
    };
    return map[step];
  }, [step, gapIndex, gaps.length]);

  /* -- Scan ------------------------------------------------------------- */
  const scan = useCallback(async () => {
    setError(null);
    setStep("scanning");
    const result = await scanSiteAction(url);
    if (!result.ok || !result.brief) {
      setError(result.error ?? "We couldn't read that site.");
      setStep("url");
      return;
    }
    setBrief(result.brief);
    setPagesRead(result.pagesRead);
    setStep("brief");
  }, [url]);

  /* -- Save + design ---------------------------------------------------- */
  const design = useCallback(async () => {
    if (!brief) return;
    setError(null);
    setStep("designing");

    const saved = await saveBriefAction({ url, brief, answers, channelCount: 10 });
    if (!saved.ok || !saved.brandId) {
      setError(saved.error ?? "Something went wrong saving your brief.");
      setStep("questions");
      return;
    }
    setBrandId(saved.brandId);

    const fleet = await designFleetAction(saved.brandId);
    if (!fleet.ok) {
      setError(fleet.error ?? "We couldn't design your creators.");
      setStep("questions");
      return;
    }
    setCreators(fleet.creators ?? []);
    setStep("creators");
  }, [brief, url, answers]);

  /* -- Film -------------------------------------------------------------- */
  const film = useCallback(async () => {
    if (!brandId) return;
    setError(null);
    setStep("filming");
    const result = await makeFirstVideoAction(brandId);
    if (!result.ok) {
      setError(result.error ?? "We couldn't make the video.");
      setStep("creators");
      return;
    }
    setVideo(result);
    setStep("video");
  }, [brandId]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1100px] flex-col px-5">
      <Progress value={progress} step={step} />

      <div className="flex flex-1 items-center py-8">
        {step === "url" ? (
          <UrlStep
            url={url}
            setUrl={setUrl}
            onSubmit={() => startTransition(() => void scan())}
            pending={pending}
            error={error}
          />
        ) : null}

        {step === "scanning" ? <Scanning url={url} /> : null}

        {step === "brief" && brief ? (
          <BriefStep
            brief={brief}
            pagesRead={pagesRead}
            onChange={setBrief}
            onNext={() => {
              const pending = brief.gaps.filter((g) => !answers[g.id]?.trim());
              setGaps(pending);
              setGapIndex(0);
              if (pending.length === 0) {
                setStep("designing");
                startTransition(() => void design());
              } else {
                setStep("questions");
              }
            }}
          />
        ) : null}

        {step === "questions" && brief ? (
          <QuestionStep
            gap={gaps[gapIndex]!}
            index={gapIndex}
            total={gaps.length}
            value={answers[gaps[gapIndex]!.id] ?? ""}
            onAnswer={(v) =>
              setAnswers((prev) => ({ ...prev, [gaps[gapIndex]!.id]: v }))
            }
            onBack={() => (gapIndex === 0 ? setStep("brief") : setGapIndex((i) => i - 1))}
            onNext={() => {
              if (gapIndex < gaps.length - 1) setGapIndex((i) => i + 1);
              else startTransition(() => void design());
            }}
            pending={pending}
            error={error}
          />
        ) : null}

        {step === "designing" ? (
          <Working
            title="Casting your creators."
            lines={[
              "Reading your brief",
              "Giving each account a different angle",
              "Writing their voices and their rules",
            ]}
          />
        ) : null}

        {step === "creators" ? (
          <CreatorsStep
            creators={creators}
            onNext={() => startTransition(() => void film())}
            pending={pending}
            error={error}
          />
        ) : null}

        {step === "filming" ? (
          <Working
            title="Filming your first one."
            lines={[
              "Picking a scenario",
              "Writing the scene",
              "Building the character's face",
              "Shooting every shot",
              "Cutting, mixing, rendering",
            ]}
            slow
          />
        ) : null}

        {step === "video" && video ? (
          <VideoStep video={video} onNext={() => setStep("connect")} />
        ) : null}

        {step === "connect" && brandId ? (
          <ConnectStep brandId={brandId} onDone={() => router.push("/dashboard")} />
        ) : null}
      </div>
    </div>
  );
}

/* ========================================================================== */

const STEP_LABELS: Partial<Record<Step, string>> = {
  url: "Your site",
  scanning: "Reading",
  brief: "Your brief",
  questions: "A few blanks",
  designing: "Casting",
  creators: "Your creators",
  filming: "Filming",
  video: "Your first video",
  connect: "Go live",
};

function Progress({ value, step }: { value: number; step: Step }) {
  return (
    <div className="sticky top-0 z-10 -mx-5 bg-canvas/85 px-5 pb-4 pt-6 backdrop-blur-xl">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-muted">{STEP_LABELS[step]}</span>
        <span className="tnum text-2xs text-ink-faint">{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-4">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-700 ease-[var(--ease-out-quint)]"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UrlStep({
  url,
  setUrl,
  onSubmit,
  pending,
  error,
}: {
  url: string;
  setUrl: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
  error: string | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="mx-auto w-full max-w-[620px] text-center">
      <h1 className="text-5xl md:text-6xl">What&rsquo;s your website?</h1>
      <p className="mx-auto mt-5 max-w-[42ch] text-lg leading-relaxed text-ink-muted">
        That&rsquo;s the only thing we need to start. We&rsquo;ll read it and show you what we found.
      </p>

      <form
        className="mt-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onSubmit();
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Globe
              size={17}
              strokeWidth={2.2}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              ref={ref}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourapp.com"
              inputMode="url"
              autoComplete="url"
              className="h-[56px] w-full rounded-pill border border-line bg-surface pl-12 pr-6 text-md text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
            />
          </div>
          <Button type="submit" size="lg" disabled={pending || !url.trim()} className="h-[56px]">
            {pending ? <Loader2 size={17} className="animate-spin" /> : null}
            Read my site
            {!pending ? <ArrowRight size={17} strokeWidth={2.4} /> : null}
          </Button>
        </div>
      </form>

      {error ? <p className="mt-4 text-base text-kill">{error}</p> : null}

      <p className="mt-7 text-sm text-ink-subtle">
        No account. No card. You&rsquo;ll watch a real video before we ask you for anything.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Scanning({ url }: { url: string }) {
  return (
    <Working
      title={`Reading ${host(url)}.`}
      lines={[
        "Opening your home page",
        "Looking for pricing, about and FAQ",
        "Pulling out every number you publish",
        "Writing your brief",
      ]}
    />
  );
}

function Working({ title, lines, slow }: { title: string; lines: string[]; slow?: boolean }) {
  const [done, setDone] = useState(0);

  useEffect(() => {
    // Pacing only. The real work is one await, and a frozen screen reads as a
    // crash — especially on the render step, which genuinely takes a minute.
    const interval = slow ? 3200 : 1100;
    const timer = setInterval(() => setDone((d) => Math.min(d + 1, lines.length - 1)), interval);
    return () => clearInterval(timer);
  }, [lines.length, slow]);

  return (
    <div className="mx-auto w-full max-w-[520px]">
      <h1 className="text-4xl md:text-5xl">{title}</h1>
      <ul className="mt-10 space-y-4">
        {lines.map((line, i) => (
          <li key={line} className="flex items-center gap-3.5">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                i < done
                  ? "border-win bg-win text-white"
                  : i === done
                    ? "border-accent text-accent"
                    : "border-line text-ink-faint",
              )}
            >
              {i < done ? (
                <Check size={14} strokeWidth={3} />
              ) : i === done ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className={cn("text-lg transition-colors", i <= done ? "text-ink" : "text-ink-faint")}>
              {line}
            </span>
          </li>
        ))}
      </ul>
      {slow ? (
        <p className="mt-9 text-base text-ink-subtle">
          This one takes a minute or two. Rendering is real work.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** The fields shown as editable cards, in the order they matter to a script. */
const BRIEF_CARDS: Array<{ key: keyof CompanyBrief; label: string; hint: string }> = [
  { key: "whatItDoes", label: "What it does", hint: "One plain sentence." },
  { key: "audience", label: "Who it's for", hint: "A person, not a segment." },
  { key: "chore", label: "The chore it kills", hint: "This is what every video opens on." },
  { key: "oldWay", label: "What they did before", hint: "The villain of half the scripts." },
  { key: "reliefMoment", label: "The moment it clicks", hint: "This is what we film." },
];

function BriefStep({
  brief,
  pagesRead,
  onChange,
  onNext,
}: {
  brief: CompanyBrief;
  pagesRead: number;
  onChange: (b: CompanyBrief) => void;
  onNext: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const setField = (key: keyof CompanyBrief, value: string) => {
    const field = brief[key] as { value: string; source: string; confidence: string };
    onChange({ ...brief, [key]: { ...field, value, confidence: "high" } });
  };

  const toggleClaim = (index: number) => {
    const claims = brief.claims.map((c, i) => (i === index ? { ...c, confirmed: !c.confirmed } : c));
    onChange({ ...brief, claims });
  };

  return (
    <div className="w-full">
      <div className="text-center">
        <Badge tone="win">
          <Check size={12} strokeWidth={3} />
          Read {pagesRead} {pagesRead === 1 ? "page" : "pages"}
        </Badge>
        <h1 className="mx-auto mt-6 max-w-[18ch] text-4xl md:text-5xl">
          Here&rsquo;s what we understood.
        </h1>
        <p className="mx-auto mt-4 max-w-[50ch] text-lg leading-relaxed text-ink-muted">
          Fix anything that&rsquo;s wrong. This is exactly what your creators will say, so it&rsquo;s
          worth thirty seconds.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-[760px] gap-3">
        {BRIEF_CARDS.map((card) => {
          const field = brief[card.key] as { value: string; confidence: string };
          const isEditing = editing === card.key;
          return (
            <div
              key={card.key as string}
              className={cn(
                "card p-5 transition-colors",
                field.confidence === "low" && !field.value && "border-warn/30 bg-warn-soft",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-subtle">{card.label}</p>
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={field.value}
                      onChange={(e) => setField(card.key, e.target.value)}
                      onBlur={() => setEditing(null)}
                      rows={2}
                      className="mt-2 w-full resize-none rounded-lg border border-accent bg-surface px-3 py-2 text-base text-ink outline-none"
                    />
                  ) : (
                    <p className="mt-1.5 text-lg leading-snug text-ink">
                      {field.value || <span className="text-ink-faint">We couldn&rsquo;t find this</span>}
                    </p>
                  )}
                  <p className="mt-1.5 text-2xs text-ink-faint">{card.hint}</p>
                </div>
                <button
                  onClick={() => setEditing(isEditing ? null : (card.key as string))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                  aria-label={`Edit ${card.label}`}
                >
                  <Pencil size={13} strokeWidth={2.3} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {brief.claims.length > 0 ? (
        <div className="mx-auto mt-8 max-w-[760px]">
          <h2 className="text-xl">Numbers we found on your site</h2>
          <p className="mt-1.5 text-base text-ink-muted">
            Tap the ones you&rsquo;re happy to defend in a comment section. Anything you leave off,
            your creators are never allowed to say.
          </p>
          <div className="mt-4 grid gap-2">
            {brief.claims.map((claim, i) => (
              <button
                key={claim.quote}
                onClick={() => toggleClaim(i)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                  claim.confirmed
                    ? "border-win/30 bg-win-soft"
                    : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                    claim.confirmed ? "border-win bg-win text-white" : "border-line-strong",
                  )}
                >
                  {claim.confirmed ? <Check size={12} strokeWidth={3.2} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-medium text-ink">{claim.text}</span>
                  <span className="mt-1 block truncate text-2xs text-ink-faint">
                    from your site: &ldquo;{claim.quote}&rdquo;
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-10 flex justify-center">
        <Button size="lg" onClick={onNext}>
          Looks right
          <ArrowRight size={17} strokeWidth={2.4} />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function QuestionStep({
  gap,
  index,
  total,
  value,
  onAnswer,
  onBack,
  onNext,
  pending,
  error,
}: {
  gap: { id: string; question: string; why: string; kind: string; choices?: string[]; required: boolean };
  index: number;
  total: number;
  value: string;
  onAnswer: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
  pending: boolean;
  error: string | null;
}) {
  const blocked = gap.required && !value.trim();
  const isLast = index === total - 1;

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <p className="text-sm font-medium text-ink-faint">
        {index + 1} of {total}
      </p>
      <h1 className="mt-3 text-4xl md:text-5xl">{gap.question}</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-muted">{gap.why}</p>

      <div className="mt-9">
        {gap.kind === "choice" && gap.choices?.length ? (
          <div className="grid gap-2.5">
            {gap.choices.map((choice) => (
              <button
                key={choice}
                onClick={() => {
                  onAnswer(choice);
                  // Tapping an option is the answer; advancing immediately is
                  // what makes the flow feel like two minutes instead of ten.
                  setTimeout(onNext, 180);
                }}
                className={cn(
                  "flex items-center justify-between rounded-2xl border-2 px-5 py-4 text-left text-lg transition-all active:scale-[0.99]",
                  value === choice
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line bg-surface text-ink hover:border-line-strong hover:-translate-y-px",
                )}
              >
                {choice}
                {value === choice ? (
                  <Check size={17} strokeWidth={3} className="shrink-0 text-accent" />
                ) : null}
              </button>
            ))}
            <button
              onClick={onNext}
              className="mt-1 self-start rounded-pill px-4 py-2 text-base text-ink-subtle transition-colors hover:text-ink"
            >
              None of these
            </button>
          </div>
        ) : gap.kind === "long" ? (
          <textarea
            autoFocus
            value={value}
            onChange={(e) => onAnswer(e.target.value)}
            rows={4}
            placeholder="Say it the way you'd say it out loud"
            className="w-full resize-none rounded-2xl border border-line bg-surface px-5 py-4 text-lg leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
          />
        ) : (
          <input
            autoFocus
            value={value}
            onChange={(e) => onAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !blocked) onNext();
            }}
            placeholder="Say it the way you'd say it out loud"
            className="h-[60px] w-full rounded-2xl border border-line bg-surface px-5 text-lg text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
          />
        )}
      </div>

      {error ? <p className="mt-5 text-base text-kill">{error}</p> : null}

      <div className="mt-9 flex items-center gap-3">
        <Button variant="ghost" onClick={onBack} disabled={pending}>
          <ArrowLeft size={16} strokeWidth={2.4} />
          Back
        </Button>
        <Button size="lg" onClick={onNext} disabled={pending || blocked}>
          {pending ? <Loader2 size={17} className="animate-spin" /> : null}
          {isLast ? "Cast my creators" : "Continue"}
          {!pending ? <ArrowRight size={17} strokeWidth={2.4} /> : null}
        </Button>
        {!gap.required && !value.trim() ? (
          <button onClick={onNext} className="text-base text-ink-subtle hover:text-ink">
            Skip
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const AWARENESS_LABEL: Record<string, string> = {
  UNAWARE: "cold audience",
  PROBLEM_AWARE: "knows the problem",
  SOLUTION_AWARE: "shopping for a fix",
  PRODUCT_AWARE: "knows you exist",
  MOST_AWARE: "ready to act",
};

function CreatorsStep({
  creators,
  onNext,
  pending,
  error,
}: {
  creators: NonNullable<FleetResult["creators"]>;
  onNext: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="w-full">
      <div className="text-center">
        <Badge tone="win">
          <Check size={12} strokeWidth={3} />
          {creators.length} creators cast
        </Badge>
        <h1 className="mx-auto mt-6 max-w-[20ch] text-4xl md:text-5xl">
          These are the people who&rsquo;ll post about you.
        </h1>
        <p className="mx-auto mt-4 max-w-[52ch] text-lg leading-relaxed text-ink-muted">
          Each one has a different angle, a different audience, and its own rule about when your
          product is allowed to show up. None of them will say the same thing.
        </p>
      </div>

      <div className="mt-11 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {creators.map((creator, i) => (
          <div
            key={creator.channelId}
            className="card animate-in-up p-5"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold leading-snug tracking-[-0.02em] text-ink-strong">
                {creator.name}
              </h3>
              <Users size={15} strokeWidth={2.2} className="mt-0.5 shrink-0 text-ink-faint" />
            </div>
            <div className="mt-2.5">
              <Badge>{AWARENESS_LABEL[creator.awareness] ?? creator.awareness}</Badge>
            </div>
            {creator.angle ? (
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-ink-muted">{creator.angle}</p>
            ) : null}
          </div>
        ))}
      </div>

      {error ? <p className="mt-8 text-center text-base text-kill">{error}</p> : null}

      <div className="mt-11 flex flex-col items-center gap-3">
        <Button size="lg" onClick={onNext} disabled={pending}>
          {pending ? <Loader2 size={17} className="animate-spin" /> : <Film size={17} strokeWidth={2.3} />}
          Make my first video
        </Button>
        <p className="text-sm text-ink-subtle">Still no account, still no card.</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VideoStep({ video, onNext }: { video: FirstVideoResult; onNext: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[860px]">
      <div className="text-center">
        <Badge tone="win">
          <Check size={12} strokeWidth={3} />
          Done
        </Badge>
        <h1 className="mt-6 text-4xl md:text-5xl">Your first video.</h1>
        {video.scenarioName ? (
          <p className="mt-4 text-lg text-ink-muted">
            {video.scenarioName}
            {video.durationMs ? ` · ${(video.durationMs / 1000).toFixed(0)}s` : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-9 grid gap-6 md:grid-cols-[300px_1fr] md:items-start">
        <div className="mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-3xl border border-line bg-inverse">
          {video.videoUrl ? (
            <video src={video.videoUrl} controls playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-on-inverse-muted">
              Still rendering
            </div>
          )}
        </div>

        <div>
          {video.hook ? (
            <div className="card p-5">
              <p className="text-sm font-semibold text-ink-subtle">The hook</p>
              <p className="mt-1.5 text-xl leading-snug text-ink">{video.hook}</p>
            </div>
          ) : null}

          {video.degraded ? (
            <div className="mt-3 rounded-2xl border border-warn/25 bg-warn-soft p-5">
              <p className="text-base font-semibold text-ink-strong">This one is a placeholder</p>
              <p className="mt-1.5 text-base leading-relaxed text-ink-muted">
                No video model is connected yet, so the shots are stand-ins. The script, the edit, the
                timing and the render are all real — only the pictures aren&rsquo;t. Nothing like this
                will ever be published: quality control blocks it.
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-win/25 bg-win-soft p-5">
              <p className="text-base font-semibold text-ink-strong">Nobody touched this</p>
              <p className="mt-1.5 text-base leading-relaxed text-ink-muted">
                A creator picked the scenario, wrote it, shot it, cut it and passed it through quality
                control. This is one of about ten a day, every day.
              </p>
            </div>
          )}

          <div className="mt-6">
            <Button size="lg" onClick={onNext} className="w-full sm:w-auto">
              Now let&rsquo;s get it posting
              <ArrowRight size={17} strokeWidth={2.4} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ConnectStep({ brandId, onDone }: { brandId: string; onDone: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[720px] text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF0000]/10">
        <Youtube size={26} strokeWidth={2} className="text-[#FF0000]" />
      </span>

      <h1 className="mt-6 text-4xl md:text-5xl">Connect your channels.</h1>
      <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-muted">
        Your creators post on <strong className="font-semibold text-ink">your own YouTube channels</strong>,
        through Google&rsquo;s official flow. Connect one channel per creator — you can add the rest later.
      </p>

      <div className="mt-9 flex flex-col items-center gap-3">
        <ButtonLink href={`/api/auth/youtube/start?brandId=${brandId}&slot=0`} size="lg">
          <Youtube size={17} strokeWidth={2.2} />
          Connect a YouTube channel
        </ButtonLink>
        <button onClick={onDone} className="text-base text-ink-subtle transition-colors hover:text-ink">
          I&rsquo;ll do this later
        </button>
      </div>

      <div className="mt-11 grid gap-3 text-left sm:grid-cols-3">
        {[
          {
            title: "One channel per creator",
            body: "Each account keeps its own angle. Ten channels means ten different people talking, not one brand posting ten times.",
          },
          {
            title: "Got Brand Accounts?",
            body: "Google will ask which channel each time. Pick a different one per connection — that's how you attach several.",
          },
          {
            title: "You stay in control",
            body: "Revoke access from your Google account whenever you want. Nothing publishes until you say so.",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-base font-semibold tracking-[-0.02em] text-ink-strong">{card.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{card.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function host(url: string): string {
  try {
    return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
