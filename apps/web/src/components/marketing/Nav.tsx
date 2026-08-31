import Link from "next/link";

import { ButtonLink } from "@/components/ui/primitives";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#videos", label: "Videos" },
  { href: "#pricing", label: "Pricing" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-canvas/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-lg font-semibold tracking-[-0.04em] text-ink-strong">
            OttoUGC
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-pill px-3.5 py-2 text-base font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ButtonLink href="/dashboard" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Dashboard
          </ButtonLink>
          <ButtonLink href="/onboarding" size="sm">
            Start free
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect width="28" height="28" rx="9" fill="var(--color-inverse)" />
      {/* Three bars of unequal length: most posts small, one very large — the
          outlier distribution the whole product is built on. */}
      <rect x="7" y="8" width="6" height="3" rx="1.5" fill="var(--color-accent)" />
      <rect x="7" y="12.5" width="14" height="3" rx="1.5" fill="white" />
      <rect x="7" y="17" width="9" height="3" rx="1.5" fill="var(--color-accent)" opacity="0.55" />
    </svg>
  );
}
