import { desc, eq } from "drizzle-orm";

import { PageHeader } from "@/components/dashboard/Shell";
import { AgentTimeline } from "@/components/dashboard/AgentTimeline";
import { EmptyState } from "@/components/ui/primitives";
import { db } from "@/server/db";
import { agentSteps } from "@/server/db/schema";
import { getAgentRuns, getPrimaryBrand } from "@/server/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const runs = await getAgentRuns(brand.id, 40);

  // The most recent run gets its full trace expanded: that is what an operator
  // opens this page to read.
  const latestSteps = runs[0]
    ? await db
        .select({
          sequence: agentSteps.sequence,
          kind: agentSteps.kind,
          tool: agentSteps.tool,
          content: agentSteps.content,
          args: agentSteps.args,
          result: agentSteps.result,
          isError: agentSteps.isError,
          durationMs: agentSteps.durationMs,
        })
        .from(agentSteps)
        .where(eq(agentSteps.runId, runs[0].id))
        .orderBy(agentSteps.sequence)
        .limit(120)
    : [];

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every decision is traced: what the creator was thinking, what it called, with what, and what came back."
      />

      {runs.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Start a run or cast your creators from the overview."
        />
      ) : (
        <AgentTimeline runs={runs} latestSteps={latestSteps} />
      )}
    </>
  );
}
