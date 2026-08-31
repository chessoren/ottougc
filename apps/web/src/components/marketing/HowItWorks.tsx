import { Clapperboard, Link2, PenLine, Repeat, ShieldCheck, Users } from "lucide-react";

import { SectionHeading } from "@/components/ui/primitives";

/**
 * How it works.
 *
 * Five steps, one sentence each. The previous version explained the agent
 * hierarchy — a manager delegating to account agents delegating to tools — which
 * is how the system is built, not what the customer gets. Nobody buys an
 * org chart.
 */
export function HowItWorks() {
  return (
    <section id="how" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[1180px] px-5 py-24">
        <SectionHeading
          eyebrow="How it works"
          title="You paste a link. They do the rest."
          description="Setup takes about two minutes, and you'll have watched a finished video before you connect anything."
        />

        <ol className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card flex flex-col p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink">
                  <step.icon size={18} strokeWidth={2.2} />
                </span>
                <span className="tnum text-2xs font-semibold text-ink-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-xl leading-snug">{step.title}</h3>
              <p className="mt-2.5 text-base leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-accent-line bg-accent-soft p-7">
            <h3 className="text-xl">They&rsquo;re not ads</h3>
            <p className="mt-2.5 text-base leading-relaxed text-ink-muted">
              Nobody watches an ad on purpose. So the videos are situations — someone gets a message
              they can&rsquo;t answer, someone gets caught doing something too fast, someone&rsquo;s
              up too late. Your product is what gets them out of it, mentioned once, near the end,
              like an afterthought.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-7">
            <h3 className="text-xl">They look filmed, not generated</h3>
            <p className="mt-2.5 text-base leading-relaxed text-ink-muted">
              What gives AI video away isn&rsquo;t the faces — it&rsquo;s the flatness. One long
              static shot with a voice on top. These get cut every second and a half, with the camera
              drifting like a real hand and the light coming from a real lamp.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    icon: Link2,
    title: "Paste your website",
    body: "We read it — home, pricing, about, FAQ — and hand you back a short brief about your own company. You fix whatever's wrong.",
  },
  {
    icon: Users,
    title: "Meet your creators",
    body: "Ten of them, each with a different face, a different audience and its own rule about when your product is allowed to appear.",
  },
  {
    icon: PenLine,
    title: "They write a scene",
    body: "Not a script about your features. A situation your customer recognises, with your product as the thing that resolves it.",
  },
  {
    icon: Clapperboard,
    title: "They shoot and cut it",
    body: "Every shot generated with the same face, then actually edited — cuts on the breath, punch-ins on the numbers, music under the voice.",
  },
  {
    icon: ShieldCheck,
    title: "It gets checked, then posted",
    body: "Any number you didn't confirm, any promise, any competitor: blocked. What passes goes live on your own YouTube channels.",
  },
  {
    icon: Repeat,
    title: "They learn and adjust",
    body: "At two hours, a day and three days, each video is scored. What works gets made again five ways. What doesn't gets dropped.",
  },
];
