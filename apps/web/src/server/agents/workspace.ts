import type { Timeline } from "@/server/edit/timeline";
import type { ComposeAssets, ScriptBeat } from "@/server/edit/compose";

/**
 * Per-run scratch space.
 *
 * Tools are stateless functions, but editing is inherently stateful: the agent
 * calls `add_clip`, then `punch_in_at`, then `duck_music_under_voice` on the
 * *same* timeline. Rather than serialising the whole montage through every tool
 * call — which would burn thousands of tokens per step and invite the model to
 * silently drop clips — the timeline lives here and tools mutate it by id.
 *
 * The workspace is memory-only and scoped to one run. It is flushed when the run
 * finishes; the timeline itself is persisted to `render_jobs.input_props`.
 */

export interface Workspace {
  runId: string;
  timeline?: Timeline;
  beats: ScriptBeat[];
  assets: ComposeAssets;
  /** Working notes the agent accumulates and returns in its summary. */
  scratch: Record<string, unknown>;
}

const workspaces = new Map<string, Workspace>();

export function getWorkspace(runId: string): Workspace {
  let ws = workspaces.get(runId);
  if (!ws) {
    ws = { runId, beats: [], assets: { clips: [] }, scratch: {} };
    workspaces.set(runId, ws);
  }
  return ws;
}

export function clearWorkspace(runId: string): void {
  workspaces.delete(runId);
}

/** Bound the map so a long-lived process cannot leak abandoned runs. */
export function pruneWorkspaces(max = 64): void {
  if (workspaces.size <= max) return;
  const excess = workspaces.size - max;
  let i = 0;
  for (const key of workspaces.keys()) {
    if (i++ >= excess) break;
    workspaces.delete(key);
  }
}
