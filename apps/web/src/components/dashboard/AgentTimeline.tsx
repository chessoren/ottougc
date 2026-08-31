"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { AgentRunRow } from "@/server/dashboard/queries";

export interface StepRow {
  sequence: number;
  kind: string;
  tool: string | null;
  content: string | null;
  args: unknown;
  result: unknown;
  isError: boolean;
  durationMs: number | null;
}

/**
 * Agent traces.
 *
 * The value here is not "a log exists" — it is that an operator can answer
 * *why did the fleet publish that*. So the trace shows the tool calls with their
 * arguments and results, not just a status line, and the arguments are the part
 * that is expanded by default.
 */
export function AgentTimeline({
  runs,
  latestSteps,
}: {
  runs: AgentRunRow[];
  latestSteps: StepRow[];
}) {
  const [openId, setOpenId] = useState<string | null>(runs[0]?.id ?? null);
  const [steps, setSteps] = useState<Record<string, StepRow[]>>(
    runs[0] ? { [runs[0].id]: latestSteps } : {},
  );
  const [loading, setLoading] = useState<string | null>(null);

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!steps[id]) {
      setLoading(id);
      try {
        const res = await fetch(`/api/agents/${id}/steps`);
        const data = (await res.json()) as { steps: StepRow[] };
        setSteps((prev) => ({ ...prev, [id]: data.steps }));
      } finally {
        setLoading(null);
      }
    }
  }

  return (
    <div className="space-y-2.5">
      {runs.map((run) => {
        const open = openId === run.id;
        const runSteps = steps[run.id];

        return (
          <div key={run.id} className="card overflow-hidden p-0">
            <button
              onClick={() => void toggle(run.id)}
              className="flex w-full items-start gap-3 p-5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="mt-1 shrink-0 text-ink-faint">
                {open ? <ChevronDown size={15} strokeWidth={2.4} /> : <ChevronRight size={15} strokeWidth={2.4} />}
              </span>

              <span
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  run.status === "SUCCEEDED"
                    ? "bg-win"
                    : run.status === "FAILED"
                      ? "bg-kill"
                      : "bg-accent pulse-live",
                )}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-ink">{run.label}</span>
                  <Badge>{run.kind}</Badge>
                  {run.personaName ? (
                    <span className="text-2xs text-ink-faint">{run.personaName}</span>
                  ) : null}
                </div>
                {run.summary ? (
                  <p className={cn("mt-1 text-sm leading-relaxed text-ink-muted", !open && "line-clamp-2")}>
                    {run.summary}
                  </p>
                ) : null}
                <p className="tnum mt-1.5 text-2xs text-ink-faint">
                  {new Date(run.startedAt).toLocaleString("en-US", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {run.steps} steps
                  {run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)} s` : ""}
                  {Number(run.costUsd) > 0 ? ` · ${Number(run.costUsd).toFixed(4)} $` : ""}
                  {run.model ? ` · ${run.model}` : ""}
                </p>
              </div>
            </button>

            {open ? (
              <div className="border-t border-line bg-surface-2 px-5 py-4">
                {loading === run.id ? (
                  <p className="text-sm text-ink-subtle">Loading trace…</p>
                ) : !runSteps || runSteps.length === 0 ? (
                  <p className="text-sm text-ink-subtle">No steps recorded.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {runSteps.map((s) => (
                      <Step key={s.sequence} step={s} />
                    ))}
                  </ol>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Step({ step }: { step: StepRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = Boolean(step.args || step.result);

  return (
    <li className="flex gap-3">
      <span className="tnum mt-0.5 w-6 shrink-0 text-right text-2xs text-ink-faint">
        {step.sequence}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={step.kind} isError={step.isError} />
          {step.tool ? (
            <span className="flex items-center gap-1 font-mono text-2xs text-ink">
              <Wrench size={10} strokeWidth={2.4} className="text-ink-faint" />
              {step.tool}
            </span>
          ) : null}
          {step.durationMs ? (
            <span className="tnum text-2xs text-ink-faint">{step.durationMs} ms</span>
          ) : null}
          {hasPayload ? (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-2xs font-medium text-accent hover:underline"
            >
              {expanded ? "hide" : "details"}
            </button>
          ) : null}
        </div>

        {step.content ? (
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap text-sm leading-relaxed",
              step.isError ? "text-kill" : "text-ink-muted",
            )}
          >
            {step.content}
          </p>
        ) : null}

        {expanded && hasPayload ? (
          <div className="mt-2 space-y-2">
            {step.args ? <Payload label="arguments" value={step.args} /> : null}
            {step.result ? <Payload label="result" value={step.result} /> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-2xs leading-relaxed text-ink-muted">
        {text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text}
      </pre>
    </div>
  );
}

function KindBadge({ kind, isError }: { kind: string; isError: boolean }) {
  const map: Record<string, { cls: string; label: string }> = {
    THOUGHT: { cls: "bg-surface-4 text-ink-muted", label: "thinking" },
    TOOL_CALL: { cls: "bg-accent-soft text-accent", label: "call" },
    TOOL_RESULT: { cls: "bg-win-soft text-win", label: "result" },
    MESSAGE: { cls: "bg-surface-4 text-ink", label: "message" },
    DELEGATION: { cls: "bg-warn-soft text-warn", label: "handoff" },
    ERROR: { cls: "bg-kill-soft text-kill", label: "error" },
  };
  const s = isError
    ? { cls: "bg-kill-soft text-kill", label: "error" }
    : (map[kind] ?? { cls: "bg-surface-4 text-ink-muted", label: kind.toLowerCase() });

  return (
    <span className={cn("rounded px-1.5 py-0.5 text-2xs font-semibold", s.cls)}>{s.label}</span>
  );
}
