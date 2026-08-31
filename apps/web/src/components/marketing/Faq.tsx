import { SectionHeading } from "@/components/ui/primitives";

/**
 * FAQ.
 *
 * Every entry answers an objection the product will actually receive, including
 * the two uncomfortable ones — the platform quota and the "it's obviously AI"
 * criticism. Burying those would only move the conversation to a support ticket
 * after the customer has already paid.
 */
export function Faq() {
  return (
    <section className="mx-auto max-w-[1180px] px-5 py-24">
      <SectionHeading
        eyebrow="Questions we get"
        title="What to know before you start."
        align="left"
      />

      <div className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.q}>
            <h3 className="text-lg leading-snug">{item.q}</h3>
            <p className="mt-2.5 text-base leading-relaxed text-ink-muted">{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const ITEMS = [
  {
    q: "Where does it post?",
    a: "Your own YouTube channels. You connect them through Google's official flow, and the agents post through the API. No fake accounts, no proxies, nothing that breaks anyone's terms.",
  },
  {
    q: "How many videos a day, really?",
    a: "YouTube allows about six uploads a day per Google Cloud project. We spread the load across several projects and track what's left in real time. Three projects means eighteen a day; with a quota extension there's no practical ceiling.",
  },
  {
    q: "Won't people tell it's AI?",
    a: "What people spot isn't the face — it's the flatness. One long static shot with a voice over it. Ours cut roughly every second and a half, with camera drift, real light sources and punch-ins on the numbers. And eight of the scenarios never show a face at all.",
  },
  {
    q: "Do I get to approve things?",
    a: "Every video passes a quality check before it can go out, and you can require your own approval on top. You see the script, the edit and why the creator chose it before anything is posted.",
  },
  {
    q: "Can they make up numbers about my product?",
    a: "No. During setup you confirm which numbers from your own site you're happy to stand behind. Anything you don't confirm, they're not allowed to say — the check blocks it.",
  },
  {
    q: "When do I see something?",
    a: "You'll watch a finished video during setup, before connecting anything. Real signal takes about three days. The learning loop starts being useful in week three, once each shape has been tried enough times to judge.",
  },
  {
    q: "What if none of it works?",
    a: "Channels that don't land get a new angle, and budget shifts to the ones that do. Nothing gets stopped before three weeks — that's how long warming up and finding an audience takes.",
  },
  {
    q: "TikTok and Instagram?",
    a: "Built for it, and the data model already assumes it. YouTube Shorts is first because it's the only one where posting and per-video measurement are both available through an official, stable API.",
  },
];
