"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Film,
  Gauge,
  LayoutGrid,
  MessagesSquare,
  Radio,
  Settings2,
  Users,
} from "lucide-react";

import { Logo } from "@/components/marketing/Nav";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge, exact: true },
  { href: "/dashboard/posts", label: "Videos", icon: Film },
  { href: "/dashboard/fleet", label: "Creators", icon: Users },
  { href: "/dashboard/agents", label: "Activity", icon: Activity },
  { href: "/dashboard/formats", label: "Scenarios", icon: LayoutGrid },
  { href: "/dashboard/comments", label: "Comments", icon: MessagesSquare },
  { href: "/dashboard/channels", label: "Channels", icon: Radio },
  { href: "/dashboard/settings", label: "Settings", icon: Settings2 },
];

export function DashboardShell({
  children,
  brandName,
  capabilities,
}: {
  children: React.ReactNode;
  brandName: string;
  capabilities: { label: string; live: boolean }[];
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Logo size={24} />
          <span className="font-display text-base font-semibold tracking-[-0.04em] text-ink-strong">
            OttoUGC
          </span>
        </Link>

        <div className="mt-6 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-2xs font-medium text-ink-faint">Brand</p>
          <p className="truncate text-base font-semibold tracking-[-0.02em] text-ink-strong">
            {brandName}
          </p>
        </div>

        <nav className="mt-5 flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-base font-medium transition-colors",
                  active
                    ? "bg-inverse text-on-inverse"
                    : "text-ink-muted hover:bg-surface-3 hover:text-ink",
                )}
              >
                <item.icon size={16} strokeWidth={2.2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* What is actually wired up. An operator must never wonder whether a
            number is real or a placeholder. */}
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
            Connected
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {capabilities.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    c.live ? "bg-win" : "bg-ink-faint",
                  )}
                />
                <span className={c.live ? "text-ink" : "text-ink-faint"}>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile nav */}
        <div className="hide-scrollbar sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-inverse text-on-inverse" : "bg-surface text-ink-muted",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <main className="px-5 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-4xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-[68ch] text-base leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
