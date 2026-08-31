import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { agentSteps } from "@/server/db/schema";

export const dynamic = "force-dynamic";

/** Trace for one run. Loaded on demand so the agents page stays light. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const steps = await db
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
    .where(eq(agentSteps.runId, runId))
    .orderBy(agentSteps.sequence)
    .limit(300);

  return Response.json({ steps });
}
