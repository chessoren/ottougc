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
      <defs>
        <linearGradient id="otto-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#232326" />
          <stop offset="100%" stopColor="#0E0E10" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="8.2" fill="url(#otto-ground)" />
      {/* Three bars of unequal length: most posts go nowhere and one carries the
          month — the outlier distribution the whole product is built on. The
          winner is the one in colour, and it is the only one that reaches the
          full width of the frame. Same mark as the desktop icon. */}
      <rect x="6.4" y="8.1" width="6.4" height="3.2" rx="1.6" fill="white" opacity="0.42" />
      <rect x="6.4" y="12.4" width="15.2" height="3.2" rx="1.6" fill="var(--color-accent)" />
      <rect x="6.4" y="16.7" width="9.6" height="3.2" rx="1.6" fill="white" opacity="0.42" />
    </svg>
  );
}
