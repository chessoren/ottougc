/**
 * OttoUGC — relational schema.
 *
 * Design notes
 * ------------
 * 1. The master brief models a "fleet of 10 standalone TikTok accounts". We model
 *    `channels` instead: real platform channels the *user* owns and connects over
 *    OAuth. Everything the brief attaches to an account (persona, archetype,
 *    awareness level, warming ramp, format mix, darwinian state) hangs off a
 *    channel unchanged, so the strategy layer is identical while staying inside
 *    platform ToS.
 * 2. Metrics are stored twice on purpose: denormalised "latest" columns on `posts`
 *    for fast dashboard reads, and an append-only `metricSnapshots` timeseries that
 *    the darwinian engine replays. Never compute a verdict from `posts` alone.
 * 3. Every autonomous decision is traceable: `agentRuns` -> `agentSteps` records
 *    each tool call with its arguments, result and token cost.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ==========================================================================
   Enums
   ========================================================================== */

export const platformEnum = pgEnum("platform", ["YOUTUBE", "TIKTOK", "INSTAGRAM"]);

export const channelStatusEnum = pgEnum("channel_status", [
  "PENDING_AUTH", // OAuth started, not finished
  "WARMING", // ramping publish cadence (J0-J14)
  "ACTIVE", // full cadence
  "COOLDOWN", // deliberately throttled after a bad signal
  "FLAGGED", // platform-side problem (strike, upload disabled)
  "TOKEN_EXPIRED", // refresh token rejected — needs re-consent
  "PAUSED", // user paused
]);

export const awarenessEnum = pgEnum("awareness_level", [
  "UNAWARE",
  "PROBLEM_AWARE",
  "SOLUTION_AWARE",
  "PRODUCT_AWARE",
  "MOST_AWARE",
]);

export const postStatusEnum = pgEnum("post_status", [
  "PLANNED", // brief exists, nothing generated
  "SCRIPTING", // scripting agent working
  "GENERATING_MEDIA", // veo / imagen / lyria / tts in flight
  "RENDERING", // remotion
  "QA_PENDING", // awaiting QA agent verdict
  "QA_REJECTED", // failed QA, will be regenerated
  "READY", // rendered + passed QA, waiting for its publish slot
  "PUBLISHING", // upload in flight
  "PUBLISHED",
  "FAILED",
  "ARCHIVED",
]);

export const darwinEnum = pgEnum("darwinian_action", [
  "PENDING", // not enough data yet
  "KILL",
  "MAINTAIN",
  "DOUBLE_DOWN",
  "AMPLIFY", // superstar: recommend paid amplification
]);

export const checkpointEnum = pgEnum("checkpoint", ["T2H", "T24H", "T72H", "T7D", "T30D"]);

export const assetKindEnum = pgEnum("asset_kind", [
  "AVATAR_CLIP", // Veo talking-head
  "BROLL_CLIP", // Veo b-roll
  "SCREENCAST", // captured product UI
  "STILL", // Imagen / Gemini Image
  "CAROUSEL_SLIDE",
  "VOICEOVER",
  "MUSIC",
  "SFX",
  "CAPTIONS", // word-level timing json
  "THUMBNAIL",
  "FINAL_VIDEO",
]);

export const assetStatusEnum = pgEnum("asset_status", [
  "QUEUED",
  "GENERATING",
  "READY",
  "FAILED",
]);

export const agentKindEnum = pgEnum("agent_kind", [
  "MANAGER", // fleet strategist
  "ACCOUNT", // one per channel
  "SONAR", // competitive intelligence
  "SCRIPTWRITER",
  "VISUAL_DIRECTOR",
  "AUDIO_ENGINEER",
  "EDITOR",
  "QA",
  "COMMUNITY_MANAGER",
  "ANALYST", // darwinian
]);

export const runStatusEnum = pgEnum("run_status", [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "AWAITING_APPROVAL",
]);

export const stepKindEnum = pgEnum("step_kind", [
  "THOUGHT",
  "TOOL_CALL",
  "TOOL_RESULT",
  "MESSAGE",
  "DELEGATION",
  "ERROR",
]);

export const usageKindEnum = pgEnum("usage_kind", [
  "VIDEO_PRODUCED", // $5 flat
  "VIEWS_DELIVERED", // $1 CPM
  "LLM_TOKENS",
  "MEDIA_GENERATION",
  "RENDER_MINUTES",
]);

/* ==========================================================================
   Identity
   ========================================================================== */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 200 }),
    avatarUrl: text("avatar_url"),
    googleSub: varchar("google_sub", { length: 128 }),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.token), index("sessions_user_idx").on(t.userId)],
);

/* ==========================================================================
   Brand — the app we are selling
   ========================================================================== */

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    domain: varchar("domain", { length: 320 }),
    targetUrl: text("target_url"),
    logoUrl: text("logo_url"),
    tagline: text("tagline"),
    /** Raw answers to the onboarding, keyed by question id (q01..q30). */
    onboardingAnswers: jsonb("onboarding_answers").notNull().default(sql`'{}'::jsonb`),
    /** Structured brand DNA distilled by the ingest agent from the answers. */
    brandDna: jsonb("brand_dna"),
    /** Compiled claims policy: what the agents may and may not assert. */
    claimsPolicy: jsonb("claims_policy"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    /** How many channels this brand is entitled to run. */
    channelQuota: integer("channel_quota").notNull().default(10),
    dailyPostTarget: integer("daily_post_target").notNull().default(15),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Europe/Paris"),
    primaryLocale: varchar("primary_locale", { length: 12 }).notNull().default("fr-FR"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brands_slug_uq").on(t.slug),
    index("brands_owner_idx").on(t.ownerId),
  ],
);

/** Retrieval corpus for the agents: pains, objections, jargon, proof points. */
export const brandKnowledge = pgTable(
  "brand_knowledge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 48 }).notNull(), // PAIN | OBJECTION | PROOF | JARGON | ICP | STORY | FORBIDDEN | FEATURE
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Where it came from: ONBOARDING | SONAR | ANALYTICS | AGENT */
    source: varchar("source", { length: 32 }).notNull().default("ONBOARDING"),
    /** Rises when content built on this knowledge performs. */
    weight: real("weight").notNull().default(1),
    embedding: jsonb("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brand_knowledge_brand_kind_idx").on(t.brandId, t.kind)],
);

/** Uploaded logos, screenshots, screencasts, product footage. */
export const brandAssets = pgTable(
  "brand_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(), // LOGO | SCREENSHOT | SCREENCAST | FOOTAGE | FONT
    label: text("label"),
    url: text("url").notNull(),
    mimeType: varchar("mime_type", { length: 128 }),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brand_assets_brand_idx").on(t.brandId)],
);

/* ==========================================================================
   Sonar — competitive intelligence
   ========================================================================== */

export const competitors = pgTable(
  "competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    platform: platformEnum("platform").notNull().default("YOUTUBE"),
    handle: varchar("handle", { length: 200 }),
    externalId: varchar("external_id", { length: 128 }),
    subscriberCount: integer("subscriber_count").notNull().default(0),
    /** Median views / subscribers across sampled videos — niche virality index. */
    outlierIndex: real("outlier_index").notNull().default(0),
    notes: text("notes"),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("competitors_brand_idx").on(t.brandId)],
);

export const competitorVideos = pgTable(
  "competitor_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    title: text("title"),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    /** views / channel subscribers — the brief's outlier ratio. */
    outlierRatio: real("outlier_ratio").notNull().default(0),
    transcript: text("transcript"),
    /** Hook sentence isolated from the first 4 seconds of the transcript. */
    hookText: text("hook_text"),
    detectedFormat: varchar("detected_format", { length: 32 }),
    analysis: jsonb("analysis"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competitor_videos_ext_uq").on(t.competitorId, t.externalId),
    index("competitor_videos_outlier_idx").on(t.outlierRatio),
  ],
);

/** Mined comment intelligence: unanswered questions, pains, feature demand. */
export const competitorInsights = pgTable(
  "competitor_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    competitorVideoId: uuid("competitor_video_id").references(() => competitorVideos.id, {
      onDelete: "set null",
    }),
    kind: varchar("kind", { length: 32 }).notNull(), // CONTENT_GAP | PAIN_INVERSION | FEATURE_DEMAND | OBJECTION | HOOK
    body: text("body").notNull(),
    /** How many distinct comments expressed this. */
    frequency: integer("frequency").notNull().default(1),
    sentiment: real("sentiment").notNull().default(0),
    exploited: boolean("exploited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("competitor_insights_brand_kind_idx").on(t.brandId, t.kind)],
);

/* ==========================================================================
   Fleet — channels, personas, strategies
   ========================================================================== */

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull().default("YOUTUBE"),
    /** YouTube channel id (UC...) once connected. */
    externalId: varchar("external_id", { length: 128 }),
    handle: varchar("handle", { length: 200 }),
    title: varchar("title", { length: 200 }),
    description: text("description"),
    thumbnailUrl: text("thumbnail_url"),
    status: channelStatusEnum("status").notNull().default("PENDING_AUTH"),

    /* -- OAuth ---------------------------------------------------------- */
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    grantedScopes: text("granted_scopes"),
    /** Which pooled Google Cloud project this channel's quota is charged to. */
    apiProjectId: uuid("api_project_id"),

    /* -- Fleet position -------------------------------------------------- */
    slotIndex: integer("slot_index").notNull().default(0),
    warmingDay: integer("warming_day").notNull().default(0),
    dailyPostTarget: integer("daily_post_target").notNull().default(1),
    /** Local hour-of-day slots this channel publishes at, e.g. [8, 18]. */
    publishSlots: jsonb("publish_slots").notNull().default(sql`'[18]'::jsonb`),

    /* -- Live stats ------------------------------------------------------ */
    subscriberCount: integer("subscriber_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    videoCount: integer("video_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channels_brand_idx").on(t.brandId),
    uniqueIndex("channels_platform_external_uq").on(t.platform, t.externalId),
  ],
);

/** The human the audience believes is behind the channel. */
export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    archetype: varchar("archetype", { length: 64 }).notNull(),
    awarenessLevel: awarenessEnum("awareness_level").notNull().default("PROBLEM_AWARE"),
    age: integer("age"),
    occupation: varchar("occupation", { length: 160 }),
    city: varchar("city", { length: 120 }),
    /** Free-form backstory the scriptwriter draws anecdotes from. */
    backstory: text("backstory"),
    /** Speech signature: pace, filler words, catchphrases, banned words. */
    voiceProfile: jsonb("voice_profile"),
    /** Locked physical description so every generation renders the same face. */
    appearancePrompt: text("appearance_prompt"),
    /**
     * The full character sheet: anchor, distinguishing features, wardrobe,
     * locations, voice signature and the reference plan. Built once, before any
     * video is generated, and never regenerated — it is the persona's identity.
     */
    characterSheet: jsonb("character_sheet"),
    /**
     * Who this persona is actually talking to. Each account targets a different
     * slice of the audience, which is what stops ten channels sounding alike.
     */
    icp: jsonb("icp"),
    /**
     * Reference stills passed to the video model on every generation. Gemini
     * Omni Flash accepts up to seven, and this set is the character-consistency
     * mechanism — a text description alone drifts.
     */
    referenceImageUrls: jsonb("reference_image_urls").notNull().default(sql`'[]'::jsonb`),
    ttsVoiceName: varchar("tts_voice_name", { length: 96 }),
    ttsPitch: real("tts_pitch").notNull().default(0),
    ttsSpeakingRate: real("tts_speaking_rate").notNull().default(1.08),
    /** Recurring characters, running jokes, ongoing storylines. */
    lore: jsonb("lore").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("personas_channel_uq").on(t.channelId)],
);

/** The account agent's current plan. Versioned: a new row supersedes the old. */
export const strategies = pgTable(
  "strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    /** One-paragraph statement of the angle this channel owns. */
    thesis: text("thesis").notNull(),
    icp: jsonb("icp"),
    /** Weighted format mix: { FORMAT_03: 0.4, FORMAT_06: 0.3, ... } */
    formatMix: jsonb("format_mix").notNull().default(sql`'{}'::jsonb`),
    /** Ordered hook archetypes this persona uses. */
    hookArchetypes: jsonb("hook_archetypes").notNull().default(sql`'[]'::jsonb`),
    contentPillars: jsonb("content_pillars").notNull().default(sql`'[]'::jsonb`),
    /** How and when the brand is allowed to appear. */
    brandIntroductionRule: text("brand_introduction_rule"),
    /** 0 = never mention the brand, 1 = brand-forward. Trojan-horse accounts sit ~0.15. */
    brandDensity: real("brand_density").notNull().default(0.35),
    postingCadence: jsonb("posting_cadence"),
    /** Free-form reasoning from the agent explaining why this plan. */
    rationale: text("rationale"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("strategies_channel_active_idx").on(t.channelId, t.isActive)],
);

/* ==========================================================================
   Production
   ========================================================================== */

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    objective: varchar("objective", { length: 64 }).notNull().default("SIGNUPS"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    monthlyBudget: numeric("monthly_budget", { precision: 12, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_brand_idx").on(t.brandId)],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),

    /* -- Creative identity ---------------------------------------------- */
    formatId: varchar("format_id", { length: 32 }).notNull(), // FORMAT_01..FORMAT_20
    hookArchetype: varchar("hook_archetype", { length: 48 }),
    hookText: text("hook_text").notNull(),
    /** Full second-by-second script produced by the scriptwriter agent. */
    script: jsonb("script"),
    title: text("title"),
    description: text("description"),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    /** The pinned conversion comment posted <90s after publish. */
    pinnedComment: text("pinned_comment"),
    /** Deliberate comment-bait device planted in the creative. */
    commentBait: jsonb("comment_bait"),

    /** Set when this post is a variation spawned by DOUBLE_DOWN. */
    parentPostId: uuid("parent_post_id"),
    /** Groups sibling variants of one concept for multivariate reads. */
    experimentKey: varchar("experiment_key", { length: 64 }),

    status: postStatusEnum("status").notNull().default("PLANNED"),
    failureReason: text("failure_reason"),

    /* -- QA -------------------------------------------------------------- */
    hookScore: real("hook_score"), // HES, 0-100, gate at 82
    qaVerdict: jsonb("qa_verdict"),

    /* -- Artefacts ------------------------------------------------------- */
    renderedVideoUrl: text("rendered_video_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationMs: integer("duration_ms"),

    /* -- Publication ----------------------------------------------------- */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalId: varchar("external_id", { length: 128 }), // youtube video id
    externalUrl: text("external_url"),
    utmContent: varchar("utm_content", { length: 200 }),

    /* -- Latest metrics (denormalised for dashboard reads) --------------- */
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    subscribersGained: integer("subscribers_gained").notNull().default(0),
    avgViewDurationMs: integer("avg_view_duration_ms").notNull().default(0),
    /** % of viewers still watching at 3s — the single most predictive metric. */
    retention3s: real("retention_3s").notNull().default(0),
    completionRate: real("completion_rate").notNull().default(0),
    profileClicks: integer("profile_clicks").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
    signups: integer("signups").notNull().default(0),

    /* -- Darwinian ------------------------------------------------------- */
    performanceScore: real("performance_score").notNull().default(0),
    darwinianAction: darwinEnum("darwinian_action").notNull().default("PENDING"),
    darwinianRationale: text("darwinian_rationale"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    /* -- Economics ------------------------------------------------------- */
    productionCostUsd: numeric("production_cost_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("posts_brand_created_idx").on(t.brandId, t.createdAt),
    index("posts_channel_status_idx").on(t.channelId, t.status),
    index("posts_format_idx").on(t.brandId, t.formatId),
    index("posts_scheduled_idx").on(t.status, t.scheduledFor),
    index("posts_score_idx").on(t.brandId, t.performanceScore),
    uniqueIndex("posts_external_uq").on(t.channelId, t.externalId),
  ],
);

export const postAssets = pgTable(
  "post_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    status: assetStatusEnum("status").notNull().default("QUEUED"),
    /** Ordering within its kind (carousel slide 1, 2, 3...). */
    sequence: integer("sequence").notNull().default(0),
    url: text("url"),
    localPath: text("local_path"),
    prompt: text("prompt"),
    provider: varchar("provider", { length: 48 }), // veo | imagen | lyria | gcp-tts | mock
    model: varchar("model", { length: 96 }),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    meta: jsonb("meta"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("post_assets_post_kind_idx").on(t.postId, t.kind)],
);

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    composition: varchar("composition", { length: 64 }).notNull(),
    inputProps: jsonb("input_props").notNull(),
    status: assetStatusEnum("status").notNull().default("QUEUED"),
    progress: real("progress").notNull().default(0),
    outputUrl: text("output_url"),
    renderer: varchar("renderer", { length: 32 }).notNull().default("local"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("render_jobs_status_idx").on(t.status)],
);

/* ==========================================================================
   Measurement
   ========================================================================== */

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    checkpoint: checkpointEnum("checkpoint").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    ageMinutes: integer("age_minutes").notNull(),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    subscribersGained: integer("subscribers_gained").notNull().default(0),
    avgViewDurationMs: integer("avg_view_duration_ms").notNull().default(0),
    retention3s: real("retention_3s").notNull().default(0),
    completionRate: real("completion_rate").notNull().default(0),
    profileClicks: integer("profile_clicks").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
    signups: integer("signups").notNull().default(0),
    score: real("score").notNull().default(0),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("metric_snapshots_post_checkpoint_uq").on(t.postId, t.checkpoint),
    index("metric_snapshots_post_idx").on(t.postId),
  ],
);

/** Second-by-second audience retention, straight from YouTube Analytics. */
export const retentionCurves = pgTable(
  "retention_curves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    /** [{ ratio: 0.0, watched: 1.0 }, ...] normalised 0..1 over video duration. */
    points: jsonb("points").notNull(),
    /** Timestamp (ms) of the sharpest negative slope — where we lose people. */
    biggestDropMs: integer("biggest_drop_ms"),
    biggestDropMagnitude: real("biggest_drop_magnitude"),
    analysis: text("analysis"),
  },
  (t) => [index("retention_curves_post_idx").on(t.postId)],
);

/** Thompson-sampling state per (channel, format). The exploration engine. */
export const formatBandits = pgTable(
  "format_bandits",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    formatId: varchar("format_id", { length: 32 }).notNull(),
    /** Beta(alpha, beta): successes+1 / failures+1 over the darwinian verdict. */
    alpha: real("alpha").notNull().default(1),
    beta: real("beta").notNull().default(1),
    trials: integer("trials").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    meanScore: real("mean_score").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.formatId] })],
);

/** Same idea, one level up: which hook archetypes convert for this brand. */
export const hookBandits = pgTable(
  "hook_bandits",
  {
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    hookArchetype: varchar("hook_archetype", { length: 48 }).notNull(),
    alpha: real("alpha").notNull().default(1),
    beta: real("beta").notNull().default(1),
    trials: integer("trials").notNull().default(0),
    meanRetention3s: real("mean_retention_3s").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.hookArchetype] })],
);

/* ==========================================================================
   Community
   ========================================================================== */

export const postComments = pgTable(
  "post_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 128 }),
    authorName: varchar("author_name", { length: 200 }),
    authorChannelId: varchar("author_channel_id", { length: 128 }),
    text: text("text").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Classified by the community manager agent. */
    intent: varchar("intent", { length: 32 }), // QUESTION | OBJECTION | PRAISE | TROLL | BUYING_SIGNAL | SPAM
    sentiment: real("sentiment").notNull().default(0),
    /** Worth turning into a video reply (Format 17). */
    isVideoReplyCandidate: boolean("is_video_reply_candidate").notNull().default(false),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    replyText: text("reply_text"),
    replyExternalId: varchar("reply_external_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_comments_ext_uq").on(t.postId, t.externalId),
    index("post_comments_intent_idx").on(t.postId, t.intent),
  ],
);

/* ==========================================================================
   Agent traces — everything the fleet decided, and why
   ========================================================================== */

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    parentRunId: uuid("parent_run_id"),
    kind: agentKindEnum("kind").notNull(),
    /** Human-readable one-liner shown in the activity feed. */
    label: text("label").notNull(),
    goal: text("goal"),
    status: runStatusEnum("status").notNull().default("RUNNING"),
    model: varchar("model", { length: 96 }),
    /** Final structured output of the run. */
    output: jsonb("output"),
    summary: text("summary"),
    error: text("error"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    stepCount: integer("step_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("agent_runs_brand_started_idx").on(t.brandId, t.startedAt),
    index("agent_runs_channel_idx").on(t.channelId),
    index("agent_runs_parent_idx").on(t.parentRunId),
  ],
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: stepKindEnum("kind").notNull(),
    /** Tool name for TOOL_CALL / TOOL_RESULT steps. */
    tool: varchar("tool", { length: 96 }),
    content: text("content"),
    args: jsonb("args"),
    result: jsonb("result"),
    isError: boolean("is_error").notNull().default(false),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_steps_run_seq_uq").on(t.runId, t.sequence)],
);

/** Durable long-term memory the agents write to and retrieve from. */
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(), // LESSON | WINNER | LOSER | AUDIENCE | CONSTRAINT
    body: text("body").notNull(),
    /** Evidence: post ids, metric deltas. */
    evidence: jsonb("evidence"),
    confidence: real("confidence").notNull().default(0.5),
    timesApplied: integer("times_applied").notNull().default(0),
    embedding: jsonb("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_memories_brand_kind_idx").on(t.brandId, t.kind)],
);

/* ==========================================================================
   Infrastructure — YouTube quota sharding
   ========================================================================== */

export const apiProjects = pgTable(
  "api_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: varchar("label", { length: 120 }).notNull(),
    googleProjectId: varchar("google_project_id", { length: 128 }).notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    /** Daily quota in YouTube API units. 10 000 by default, more once approved. */
    dailyQuotaUnits: integer("daily_quota_units").notNull().default(10000),
    unitsUsedToday: integer("units_used_today").notNull().default(0),
    quotaResetAt: timestamp("quota_reset_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_projects_google_uq").on(t.googleProjectId)],
);

export const quotaLedger = pgTable(
  "quota_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiProjectId: uuid("api_project_id")
      .notNull()
      .references(() => apiProjects.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    operation: varchar("operation", { length: 64 }).notNull(),
    units: integer("units").notNull(),
    succeeded: boolean("succeeded").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quota_ledger_project_created_idx").on(t.apiProjectId, t.createdAt)],
);

/* ==========================================================================
   Billing — $5 per produced video + $1 CPM on delivered views
   ========================================================================== */

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    kind: usageKindEnum("kind").notNull(),
    /** Videos produced, or views delivered, or tokens. */
    quantity: numeric("quantity", { precision: 16, scale: 4 }).notNull(),
    unitPriceUsd: numeric("unit_price_usd", { precision: 10, scale: 6 }).notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 4 }).notNull(),
    /** Our own cost, to compute margin per post. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 5 }).notNull().default("0"),
    billingPeriod: varchar("billing_period", { length: 7 }).notNull(), // YYYY-MM
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_brand_period_idx").on(t.brandId, t.billingPeriod),
    index("usage_events_post_kind_idx").on(t.postId, t.kind),
  ],
);

/** Attribution: every click that lands on the brand's target URL. */
export const attributionEvents = pgTable(
  "attribution_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 32 }).notNull(), // CLICK | SIGNUP | ACTIVATION | PURCHASE
    utmSource: varchar("utm_source", { length: 64 }),
    utmMedium: varchar("utm_medium", { length: 64 }),
    utmCampaign: varchar("utm_campaign", { length: 128 }),
    utmContent: varchar("utm_content", { length: 200 }),
    visitorId: varchar("visitor_id", { length: 64 }),
    country: varchar("country", { length: 8 }),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    valueUsd: numeric("value_usd", { precision: 12, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attribution_brand_created_idx").on(t.brandId, t.createdAt),
    index("attribution_post_idx").on(t.postId),
    index("attribution_visitor_idx").on(t.visitorId),
  ],
);

/** Waitlist / lead capture from the marketing site. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    company: varchar("company", { length: 200 }),
    appUrl: text("app_url"),
    monthlyBudget: varchar("monthly_budget", { length: 32 }),
    source: varchar("source", { length: 64 }),
    utm: jsonb("utm"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leads_email_uq").on(t.email)],
);

/* ==========================================================================
   Relations
   ========================================================================== */

export const usersRelations = relations(users, ({ many }) => ({
  brands: many(brands),
  sessions: many(sessions),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  owner: one(users, { fields: [brands.ownerId], references: [users.id] }),
  channels: many(channels),
  posts: many(posts),
  campaigns: many(campaigns),
  knowledge: many(brandKnowledge),
  assets: many(brandAssets),
  competitors: many(competitors),
  insights: many(competitorInsights),
  runs: many(agentRuns),
  memories: many(agentMemories),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  brand: one(brands, { fields: [channels.brandId], references: [brands.id] }),
  persona: one(personas),
  strategies: many(strategies),
  posts: many(posts),
  runs: many(agentRuns),
}));

export const personasRelations = relations(personas, ({ one }) => ({
  channel: one(channels, { fields: [personas.channelId], references: [channels.id] }),
}));

export const strategiesRelations = relations(strategies, ({ one, many }) => ({
  channel: one(channels, { fields: [strategies.channelId], references: [channels.id] }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  brand: one(brands, { fields: [posts.brandId], references: [brands.id] }),
  channel: one(channels, { fields: [posts.channelId], references: [channels.id] }),
  campaign: one(campaigns, { fields: [posts.campaignId], references: [campaigns.id] }),
  strategy: one(strategies, { fields: [posts.strategyId], references: [strategies.id] }),
  assets: many(postAssets),
  snapshots: many(metricSnapshots),
  retention: many(retentionCurves),
  comments: many(postComments),
  renderJobs: many(renderJobs),
}));

export const postAssetsRelations = relations(postAssets, ({ one }) => ({
  post: one(posts, { fields: [postAssets.postId], references: [posts.id] }),
}));

export const metricSnapshotsRelations = relations(metricSnapshots, ({ one }) => ({
  post: one(posts, { fields: [metricSnapshots.postId], references: [posts.id] }),
}));

export const postCommentsRelations = relations(postComments, ({ one }) => ({
  post: one(posts, { fields: [postComments.postId], references: [posts.id] }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  brand: one(brands, { fields: [agentRuns.brandId], references: [brands.id] }),
  channel: one(channels, { fields: [agentRuns.channelId], references: [channels.id] }),
  post: one(posts, { fields: [agentRuns.postId], references: [posts.id] }),
  steps: many(agentSteps),
}));

export const agentStepsRelations = relations(agentSteps, ({ one }) => ({
  run: one(agentRuns, { fields: [agentSteps.runId], references: [agentRuns.id] }),
}));

export const competitorsRelations = relations(competitors, ({ one, many }) => ({
  brand: one(brands, { fields: [competitors.brandId], references: [brands.id] }),
  videos: many(competitorVideos),
}));

export const competitorVideosRelations = relations(competitorVideos, ({ one }) => ({
  competitor: one(competitors, {
    fields: [competitorVideos.competitorId],
    references: [competitors.id],
  }),
}));

/* ==========================================================================
   Objectives & fleet governance
   --------------------------------------------------------------------------
   Each account agent is not a stateless prompt: it owns durable objectives it
   is measured against, and it is reviewed weekly by the manager agent, which
   can kill it, keep it, double its allocation or repurpose it entirely.
   ========================================================================== */

export const objectiveStatusEnum = pgEnum("objective_status", [
  "ACTIVE",
  "ACHIEVED",
  "MISSED",
  "ABANDONED",
  "SUPERSEDED",
]);

export const fleetActionEnum = pgEnum("fleet_action", [
  "KEEP", // performing, unchanged allocation
  "DOUBLE_DOWN", // increase daily quota and replicate winning formats
  "REPOSITION", // same channel, new persona angle / format mix
  "THROTTLE", // reduce allocation, keep alive
  "KILL", // stop producing for this channel
  "REVIVE", // bring a throttled channel back
]);

/**
 * What an account agent is trying to achieve, in measurable terms.
 * The agent reads these at the start of every daily run and reports against
 * them; the weekly review scores them.
 */
export const channelObjectives = pgTable(
  "channel_objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    horizon: varchar("horizon", { length: 16 }).notNull().default("WEEK"), // WEEK | MONTH | QUARTER
    /** Human-readable statement the agent keeps in its working context. */
    statement: text("statement").notNull(),
    /** Machine-checkable target, e.g. { metric: "retention3s", op: ">=", value: 0.55 } */
    metric: varchar("metric", { length: 48 }).notNull(),
    comparator: varchar("comparator", { length: 4 }).notNull().default(">="),
    targetValue: real("target_value").notNull(),
    currentValue: real("current_value").notNull().default(0),
    status: objectiveStatusEnum("status").notNull().default("ACTIVE"),
    priority: integer("priority").notNull().default(1),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Agent's own notes on progress — carried across runs. */
    progressNotes: text("progress_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("channel_objectives_channel_status_idx").on(t.channelId, t.status)],
);

/** One row per weekly manager review of the whole fleet. */
export const fleetReviews = pgTable(
  "fleet_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Fleet-level roll-up for the period. */
    totalPosts: integer("total_posts").notNull().default(0),
    totalViews: integer("total_views").notNull().default(0),
    totalLinkClicks: integer("total_link_clicks").notNull().default(0),
    totalSignups: integer("total_signups").notNull().default(0),
    medianScore: real("median_score").notNull().default(0),
    /** Share of posts that reached DOUBLE_DOWN — the outlier rate. */
    outlierRate: real("outlier_rate").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    /** The manager's written analysis, shown verbatim in the dashboard. */
    narrative: text("narrative"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fleet_reviews_brand_period_idx").on(t.brandId, t.periodStart)],
);

/** One decision per channel inside a weekly review. */
export const fleetDecisions = pgTable(
  "fleet_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => fleetReviews.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    action: fleetActionEnum("action").notNull(),
    /** Channel stats that drove the decision. */
    postsPublished: integer("posts_published").notNull().default(0),
    views: integer("views").notNull().default(0),
    medianScore: real("median_score").notNull().default(0),
    linkClickRate: real("link_click_rate").notNull().default(0),
    objectivesMet: integer("objectives_met").notNull().default(0),
    objectivesTotal: integer("objectives_total").notNull().default(0),
    /** Allocation before and after, in posts per day. */
    quotaBefore: integer("quota_before").notNull().default(0),
    quotaAfter: integer("quota_after").notNull().default(0),
    /** Format mix changes applied, if any. */
    formatMixBefore: jsonb("format_mix_before"),
    formatMixAfter: jsonb("format_mix_after"),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fleet_decisions_review_idx").on(t.reviewId),
    index("fleet_decisions_channel_idx").on(t.channelId),
  ],
);

export const channelObjectivesRelations = relations(channelObjectives, ({ one }) => ({
  channel: one(channels, { fields: [channelObjectives.channelId], references: [channels.id] }),
}));

export const fleetReviewsRelations = relations(fleetReviews, ({ one, many }) => ({
  brand: one(brands, { fields: [fleetReviews.brandId], references: [brands.id] }),
  decisions: many(fleetDecisions),
}));

export const fleetDecisionsRelations = relations(fleetDecisions, ({ one }) => ({
  review: one(fleetReviews, { fields: [fleetDecisions.reviewId], references: [fleetReviews.id] }),
  channel: one(channels, { fields: [fleetDecisions.channelId], references: [channels.id] }),
}));
