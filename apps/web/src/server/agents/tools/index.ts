import { ANALYTICS_TOOLS } from "./analytics";
import { EDITING_TOOLS } from "./editing";
import { KNOWLEDGE_TOOLS } from "./knowledge";
import { MEDIA_TOOLS } from "./media";
import { PRODUCTION_TOOLS } from "./production";
import { PUBLISHING_TOOLS } from "./publishing";
import { STRATEGY_TOOLS } from "./strategy";
import type { AgentKind, AgentTool } from "../types";

export const ALL_TOOLS: AgentTool[] = [
  ...KNOWLEDGE_TOOLS,
  ...STRATEGY_TOOLS,
  ...PRODUCTION_TOOLS,
  ...MEDIA_TOOLS,
  ...EDITING_TOOLS,
  ...PUBLISHING_TOOLS,
  ...ANALYTICS_TOOLS,
];

export const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

/**
 * Toolsets per role.
 *
 * Narrow toolsets are not a security measure — they are an accuracy measure. A
 * model offered 50 tools picks worse than a model offered 12, and the failure
 * mode is subtle: it reaches for a plausible-sounding tool instead of the right
 * one. Each agent gets exactly what its job requires.
 */
export const TOOLSETS: Record<AgentKind, AgentTool[]> = {
  MANAGER: [
    ...KNOWLEDGE_TOOLS,
    ...STRATEGY_TOOLS,
    ...PRODUCTION_TOOLS.filter((t) => t.name === "list_scenarios"),
    ...ANALYTICS_TOOLS,
    ...PUBLISHING_TOOLS.filter((t) => t.name === "check_publish_capacity"),
  ],
  ACCOUNT: [
    ...KNOWLEDGE_TOOLS,
    ...PRODUCTION_TOOLS,
    ...MEDIA_TOOLS,
    ...EDITING_TOOLS,
    ...PUBLISHING_TOOLS,
    ...ANALYTICS_TOOLS,
  ],
  SCRIPTWRITER: [...KNOWLEDGE_TOOLS],
  VISUAL_DIRECTOR: [...MEDIA_TOOLS, ...KNOWLEDGE_TOOLS.filter((t) => t.name !== "save_memory")],
  AUDIO_ENGINEER: MEDIA_TOOLS.filter((t) =>
    ["synthesize_voiceover", "generate_music_bed"].includes(t.name),
  ),
  EDITOR: [...EDITING_TOOLS, ...KNOWLEDGE_TOOLS.filter((t) => t.name === "get_craft_rules")],
  QA: [
    ...EDITING_TOOLS.filter((t) => ["check_timeline", "describe_timeline"].includes(t.name)),
    ...KNOWLEDGE_TOOLS.filter((t) =>
      ["get_craft_rules", "get_format_spec", "get_brand_dna", "score_hook"].includes(t.name),
    ),
  ],
  COMMUNITY_MANAGER: [
    ...PUBLISHING_TOOLS.filter((t) =>
      ["fetch_comments", "reply_to_comment", "publish_pinned_comment"].includes(t.name),
    ),
    ...KNOWLEDGE_TOOLS.filter((t) =>
      ["get_brand_dna", "search_brand_knowledge", "recall_memory", "save_memory"].includes(t.name),
    ),
  ],
  ANALYST: [...ANALYTICS_TOOLS, ...STRATEGY_TOOLS, ...KNOWLEDGE_TOOLS],
  SONAR: [...KNOWLEDGE_TOOLS],
};

export function toolsFor(kind: AgentKind): AgentTool[] {
  return TOOLSETS[kind] ?? ALL_TOOLS;
}

export * from "./knowledge";
export * from "./strategy";
export * from "./production";
export * from "./media";
export * from "./editing";
export * from "./publishing";
export * from "./analytics";
