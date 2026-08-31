import { PageHeader } from "@/components/dashboard/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { getPrimaryBrand, getRecentComments } from "@/server/dashboard/queries";

export const dynamic = "force-dynamic";

const INTENT: Record<string, { tone: "win" | "warn" | "kill" | "accent" | "neutral"; label: string }> = {
  QUESTION: { tone: "accent", label: "question" },
  OBJECTION: { tone: "warn", label: "objection" },
  PRAISE: { tone: "win", label: "praise" },
  TROLL: { tone: "kill", label: "troll" },
  BUYING_SIGNAL: { tone: "win", label: "buying signal" },
  SPAM: { tone: "neutral", label: "spam" },
};

export default async function CommentsPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const comments = await getRecentComments(brand.id, 60);

  return (
    <>
      <PageHeader
        title="Comments"
        description="Replying in the first fifteen minutes widens how far a video travels. Objections that keep coming back become their own videos."
      />

      {comments.length === 0 ? (
        <EmptyState
          title="No comments yet"
          description="They'll show up here once your creators post on connected channels."
        />
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const intent = c.intent ? INTENT[c.intent] : null;
            return (
              <Card key={c.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-ink">{c.author ?? "anonymous"}</span>
                  {intent ? <Badge tone={intent.tone}>{intent.label}</Badge> : null}
                  {c.repliedAt ? <Badge tone="win">replied</Badge> : <Badge tone="warn">no reply</Badge>}
                  <span className="tnum text-2xs text-ink-faint">♥ {c.likeCount}</span>
                </div>

                <p className="mt-2.5 text-base leading-relaxed text-ink">{c.text}</p>

                {c.replyText ? (
                  <div className="mt-3 rounded-xl border-l-2 border-accent bg-surface-2 px-4 py-3">
                    <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
                      Creator reply
                    </p>
                    <p className="mt-1.5 text-base leading-relaxed text-ink-muted">{c.replyText}</p>
                  </div>
                ) : null}

                <p className="mt-3 truncate text-2xs text-ink-faint">under &ldquo;{c.hookText}&rdquo;</p>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
