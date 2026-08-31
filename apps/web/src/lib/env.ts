/**
 * Central environment resolution.
 *
 * Every integration degrades instead of throwing: if a credential is missing the
 * corresponding capability reports `configured: false` and the system falls back
 * to a deterministic mock. That keeps the whole pipeline runnable end-to-end on a
 * laptop with zero credentials, and makes "what is actually live?" a single
 * readable object instead of scattered `process.env` checks.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "apps/web/.env.local"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      // .env.local is the project source of truth. A stale MODEL_VIDEO in the
      // parent shell would otherwise keep calling a model Vertex rejects.
      process.env[key] = val;
    }
    break;
  }
}

loadDotEnv();

function str(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function bool(key: string, fallback = false): boolean {
  const v = str(key);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(key: string, fallback: number): number {
  const v = str(key);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Service-account JSON can arrive inline, base64'd, or as a file path. */
function resolveServiceAccount(): Record<string, unknown> | undefined {
  const inline = str("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (inline) {
    try {
      const decoded = inline.startsWith("{")
        ? inline
        : Buffer.from(inline, "base64").toString("utf8");
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  const fromEnvPath = str("GOOGLE_APPLICATION_CREDENTIALS");
  const candidates = [
    fromEnvPath,
    path.join(process.cwd(), ".gcp-service-account.json"),
    path.join(process.cwd(), "apps/web/.gcp-service-account.json"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    const parsed = readJsonFile(candidate);
    if (parsed?.type === "service_account") return parsed;
  }
  return undefined;
}

const serviceAccount = resolveServiceAccount();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",

  appUrl: str("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  authSecret: str("AUTH_SECRET") ?? "ottougc-dev-secret-change-me",

  /* -- Database ---------------------------------------------------------- */
  databaseUrl: str("DATABASE_URL"),
  directUrl: str("DIRECT_URL") ?? str("DATABASE_URL"),
  /** Where PGlite persists when no external Postgres is configured. */
  pgliteDir:
    str("PGLITE_DIR") ??
    (process.env.VERCEL ? "/tmp/ottougc-pglite" : ".pglite"),

  /* -- Google Cloud ------------------------------------------------------ */
  gcpProjectId:
    str("GOOGLE_CLOUD_PROJECT") ??
    (serviceAccount?.project_id as string | undefined),
  gcpLocation: str("GOOGLE_CLOUD_LOCATION") ?? "us-central1",
  /**
   * Gemini 3.x (and Omni interactions) are served from the global Vertex
   * endpoint. Imagen / Lyria / Chirp stay on `gcpLocation` (us-central1).
   */
  gcpGeminiLocation: str("GOOGLE_CLOUD_GEMINI_LOCATION") ?? "global",
  gcpServiceAccount: serviceAccount,
  gcpServiceAccountPath: str("GOOGLE_APPLICATION_CREDENTIALS"),
  gcsBucket: str("GCS_BUCKET"),

  /** Gemini API key (AI Studio) — alternative path to Vertex for the LLM. */
  geminiApiKey: str("GEMINI_API_KEY") ?? str("GOOGLE_API_KEY"),

  /* -- Models ------------------------------------------------------------ */
  models: {
    /** The agent brain. Gemini 3.7 Flash went GA 2026-08-13. */
    brain: str("MODEL_BRAIN") ?? "gemini-3.7-flash",
    /** Heavier reasoning for strategy synthesis and darwinian analysis. */
    strategist: str("MODEL_STRATEGIST") ?? "gemini-3.1-pro",
    /** Cheap classifier for comment triage. */
    fast: str("MODEL_FAST") ?? "gemini-3.1-flash-lite",
    // Gemini Omni Flash: 3-10 s clips, 9:16, up to seven reference images and
    // synchronised native audio. The reference-image input is what makes one
    // recognisable persona possible across a hundred clips.
    video: str("MODEL_VIDEO") ?? "gemini-omni-flash-preview",
    videoFast: str("MODEL_VIDEO_FAST") ?? "gemini-omni-flash-preview",
    /** "Nano Banana" is Gemini's image model line. */
    image: str("MODEL_IMAGE") ?? "gemini-2.5-flash-image",
    imageHiFi: str("MODEL_IMAGE_HIFI") ?? "imagen-4.0-generate-001",
    music: str("MODEL_MUSIC") ?? "lyria-002",
    ttsVoice: str("MODEL_TTS_VOICE") ?? "en-US-Chirp3-HD-Aoede",
  },

  /* -- YouTube ----------------------------------------------------------- */
  youtube: {
    clientId: str("YOUTUBE_CLIENT_ID") ?? str("GOOGLE_CLIENT_ID"),
    clientSecret: str("YOUTUBE_CLIENT_SECRET") ?? str("GOOGLE_CLIENT_SECRET"),
    redirectPath: "/api/auth/youtube/callback",
    /** Set true only once the OAuth app passes Google verification. */
    verified: bool("YOUTUBE_OAUTH_VERIFIED", false),
  },

  /* -- Economics --------------------------------------------------------- */
  pricing: {
    perVideoUsd: num("PRICE_PER_VIDEO_USD", 5),
    perThousandViewsUsd: num("PRICE_PER_CPM_USD", 1),
  },

  /* -- Safety rails ------------------------------------------------------ */
  limits: {
    /** Hard cap for the whole service per UTC day — not per brand. */
    dailyGenerationBudgetUsd: num("DAILY_GENERATION_BUDGET_USD", 10),
    maxAgentSteps: num("MAX_AGENT_STEPS", 40),
    maxParallelRenders: num("MAX_PARALLEL_RENDERS", 2),
  },

  /** Publish for real, or dry-run the upload and mark the post PUBLISHED locally. */
  dryRunPublishing: bool("DRY_RUN_PUBLISHING", true),
  /** Force mock media providers even when credentials exist (useful for demos). */
  forceMockMedia: bool("FORCE_MOCK_MEDIA", false),
} as const;

/** A single readable answer to "what is actually wired up right now?". */
export const capabilities = {
  get database() {
    return { configured: Boolean(env.databaseUrl), driver: env.databaseUrl ? "postgres" : "pglite" };
  },
  get llm() {
    return {
      configured: Boolean(env.geminiApiKey || (env.gcpServiceAccount && env.gcpProjectId)),
      via: env.gcpServiceAccount && env.gcpProjectId ? "vertex" : env.geminiApiKey ? "ai-studio" : "mock",
    };
  },
  get video() {
    return {
      configured:
        !env.forceMockMedia &&
        Boolean(env.gcpServiceAccount && env.gcpProjectId),
    };
  },
  get image() {
    return {
      configured:
        !env.forceMockMedia && Boolean(env.geminiApiKey || (env.gcpServiceAccount && env.gcpProjectId)),
    };
  },
  get music() {
    return { configured: !env.forceMockMedia && Boolean(env.gcpServiceAccount && env.gcpProjectId) };
  },
  get tts() {
    return { configured: !env.forceMockMedia && Boolean(env.gcpServiceAccount || env.gcpServiceAccountPath) };
  },
  get storage() {
    return { configured: Boolean(env.gcsBucket && (env.gcpServiceAccount || env.gcpServiceAccountPath)) };
  },
  get youtube() {
    return {
      configured: Boolean(env.youtube.clientId && env.youtube.clientSecret),
      canPublish: Boolean(env.youtube.clientId && env.youtube.clientSecret) && !env.dryRunPublishing,
    };
  },
} as const;

export type Capabilities = {
  [K in keyof typeof capabilities]: (typeof capabilities)[K];
};

/** Snapshot for the UI — plain object, safe to serialise to the client. */
export function capabilitySnapshot() {
  return {
    database: capabilities.database,
    llm: capabilities.llm,
    video: capabilities.video,
    image: capabilities.image,
    music: capabilities.music,
    tts: capabilities.tts,
    storage: capabilities.storage,
    youtube: capabilities.youtube,
    dryRunPublishing: env.dryRunPublishing,
  };
}
