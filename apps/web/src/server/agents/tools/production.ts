import { ALL_SCENARIOS, getScenario, shapeSignature } from "@/server/knowledge/scenarios";

import { produceScenario } from "../production";
import type { AgentTool } from "../types";

/**
 * The tool that actually makes the video.
 *
 * The split it encodes is the whole argument about what an agent should decide.
 *
 * Judgement is the agent's: which scenario, given what its memory says worked,
 * what its objectives are this week, and what shape it used last time. That
 * decision cannot be reduced to a rule, which is exactly why a model is here.
 *
 * Craft is not the agent's. Building the character sheet, drawing the storyboard
 * panel by panel, compiling each shot from a closed vocabulary, transcribing the
 * dialogue back off the generated audio, laying the captions on the timeline —
 * every one of those is a procedure with a right answer, and a model asked to
 * improvise it produces something worse, slower, and for about four dollars more.
 *
 * So the agent chooses and the pipeline executes. `produce_video` is the seam.
 */

export const listScenarioCatalogue: AgentTool = {
  name: "list_scenarios",
  description:
    "Every scenario you can film, with its SHAPE — length, how many people, how the sound works, what sits on screen, and the register. Choose on shape, not on subject: two scenarios with the same shape look like the same video to somebody scrolling, whatever the script says.",
  parameters: { type: "object", properties: {} },
  allowedFor: ["ACCOUNT", "MANAGER"],
  async handler() {
    return {
      scenarios: ALL_SCENARIOS.map((s) => ({
        id: s.id,
        name: s.name,
        family: s.family,
        shape: shapeSignature(s.shape),
        beats: s.beats.length,
        seconds: s.beats.reduce((total, b) => total + b.durationSeconds, 0),
        premise: s.premise,
      })),
    };
  },
};

export const produceVideo: AgentTool = {
  name: "produce_video",
  description:
    "Makes today's video in the scenario you name. Builds your character sheet if it does not exist yet, draws a storyboard panel for every shot from your own photographs, checks each panel, generates the footage from the approved panels, reads the dialogue back off the audio for word-level captions, and assembles the montage. Call it ONCE, after you have read your memory, your targets and your recent performance — it is the expensive step and there is no undo.",
  parameters: {
    type: "object",
    properties: {
      scenarioId: {
        type: "string",
        description: "The scenario to film, from list_scenarios. Leave empty to let the bandit choose.",
      },
      rationale: {
        type: "string",
        description:
          "Why this shape, today, for this channel. One or two sentences, referring to your memory or your numbers. This is written into the run trace and is what makes the decision reviewable later.",
      },
    },
    required: ["rationale"],
  },
  allowedFor: ["ACCOUNT"],
  async handler(args: { scenarioId?: string; rationale: string }, ctx) {
    if (!ctx.channelId) return { error: "This tool can only be called by a channel's own agent." };

    if (args.scenarioId && !getScenario(args.scenarioId)) {
      return {
        error: `No scenario called ${args.scenarioId}.`,
        hint: "Call list_scenarios and use an id from it.",
      };
    }

    const remaining = await ctx.budgetRemaining();
    if (remaining < 1.5) {
      return {
        error: `Only $${remaining.toFixed(2)} of today's generation budget is left, and a video costs about $2.50.`,
        hint: "Stop here and report it. Do not try a shorter scenario to squeeze under the cap.",
      };
    }

    await ctx.note(`Producing ${args.scenarioId ?? "a scenario chosen by the bandit"} — ${args.rationale}`);

    const result = await produceScenario(ctx.channelId, ctx, {
      scenarioId: args.scenarioId,
    });

    return {
      postId: result.postId,
      scenario: `${result.scenarioId} — ${result.scenarioName}`,
      hook: result.hook,
      shots: result.shots,
      seconds: Number((result.durationMs / 1000).toFixed(1)),
      costUsd: Number(result.costUsd.toFixed(3)),
      degraded: result.degraded,
      notes: result.notes,
      next: "Call check_timeline. Fix every blocking error, then render_post, then schedule_post, then save_memory.",
    };
  },
};

export const PRODUCTION_TOOLS: AgentTool[] = [listScenarioCatalogue, produceVideo];
