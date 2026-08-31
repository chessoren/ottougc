import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Design primitives.
 *
 * The tokens come from the Cognefy design system (see `globals.css`): a light
 * canvas, near-black ink, one blue accent, pill radii and Inter's two optical
 * sizes. These components exist so those decisions are made once — a landing
 * page and a dashboard that disagree about what a button looks like read as two
 * products.
 */

/* -------------------------------------------------------------------------- */

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("eyebrow", className)}>{children}</span>;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "dark" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return <button className={cn(buttonClasses(variant, size), className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost" | "dark" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return <Link className={cn(buttonClasses(variant, size), className)} {...props} />;
}

function buttonClasses(variant: string, size: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-pill font-semibold tracking-[-0.02em]",
    "transition-all duration-200 ease-[var(--ease-out-quint)] whitespace-nowrap",
    "disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]",
    size === "sm" && "h-9 px-4 text-xs",
    size === "md" && "h-11 px-6 text-base",
    size === "lg" && "h-[52px] px-8 text-md",
    variant === "primary" &&
      "bg-accent text-accent-ink shadow-accent hover:bg-accent-hover hover:-translate-y-px",
    variant === "secondary" &&
      "bg-surface text-ink border border-line shadow-xs hover:border-line-strong hover:-translate-y-px",
    variant === "ghost" && "text-ink-muted hover:text-ink hover:bg-surface-3",
    variant === "dark" && "bg-inverse text-on-inverse hover:bg-inverse-2 hover:-translate-y-px",
    variant === "danger" && "bg-kill text-white hover:brightness-95",
  );
}

/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div className={cn("card p-6", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="text-4xl md:text-5xl max-w-[18ch]">{title}</h2>
      {description ? (
        <p className="text-ink-muted text-lg max-w-[52ch] leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const BADGE_TONES = {
  neutral: "bg-surface-3 text-ink-muted border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  win: "bg-win-soft text-win border-win/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  kill: "bg-kill-soft text-kill border-kill/20",
  live: "bg-live/10 text-live border-live/20",
} as const;

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-2xs font-semibold tracking-[-0.01em]",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A metric with its label. Tabular figures so columns of numbers line up. */
export function Stat({
  value,
  label,
  sub,
  tone,
  className,
}: {
  value: ReactNode;
  label: string;
  sub?: ReactNode;
  tone?: "win" | "kill" | "warn";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span
        className={cn(
          "tnum font-display text-3xl font-semibold tracking-[-0.03em]",
          tone === "win" && "text-win",
          tone === "kill" && "text-kill",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </span>
      <span className="text-xs font-medium text-ink-subtle">{label}</span>
      {sub ? <span className="text-2xs text-ink-faint">{sub}</span> : null}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

/** Small dot + label used for live/queued/failed states. */
export function StatusDot({
  tone,
  label,
  pulse,
}: {
  tone: "win" | "warn" | "kill" | "neutral" | "accent";
  label: string;
  pulse?: boolean;
}) {
  const color =
    tone === "win"
      ? "bg-win"
      : tone === "warn"
        ? "bg-warn"
        : tone === "kill"
          ? "bg-kill"
          : tone === "accent"
            ? "bg-accent"
            : "bg-ink-faint";
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-ink-muted">
      <span className={cn("h-1.5 w-1.5 rounded-full", color, pulse && "pulse-live")} />
      {label}
    </span>
  );
}

/** Empty state that says what to do next rather than merely that nothing is here. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-8 py-14 text-center">
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <h3 className="text-xl">{title}</h3>
      <p className="max-w-[46ch] text-base text-ink-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
