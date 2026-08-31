import Link from "next/link";

import { Logo } from "./Nav";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-[1180px] px-5 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-[36ch]">
            <div className="flex items-center gap-2.5">
              <Logo size={24} />
              <span className="font-display text-base font-semibold tracking-[-0.03em] text-ink-strong">
                OttoUGC
              </span>
            </div>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              Creators that write, film, edit and post for you — on your own channels.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-14 gap-y-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-semibold text-ink-strong">{col.title}</h4>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-base text-ink-muted transition-colors hover:text-ink"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-subtle">
            © {new Date().getFullYear()} OttoUGC. Numbers observed on our own channels, not a guarantee.
          </p>
          <p className="text-sm text-ink-subtle">
            Posting through the official YouTube API, on channels you own.
          </p>
        </div>
      </div>
    </footer>
  );
}

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Videos", href: "/#videos" },
      { label: "Scenarios", href: "/#formats" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "App",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Get started", href: "/onboarding" },
      { label: "Creator activity", href: "/dashboard/agents" },
    ],
  },
];
