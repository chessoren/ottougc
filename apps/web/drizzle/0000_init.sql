CREATE TYPE "public"."agent_kind" AS ENUM('MANAGER', 'ACCOUNT', 'SONAR', 'SCRIPTWRITER', 'VISUAL_DIRECTOR', 'AUDIO_ENGINEER', 'EDITOR', 'QA', 'COMMUNITY_MANAGER', 'ANALYST');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('AVATAR_CLIP', 'BROLL_CLIP', 'SCREENCAST', 'STILL', 'CAROUSEL_SLIDE', 'VOICEOVER', 'MUSIC', 'SFX', 'CAPTIONS', 'THUMBNAIL', 'FINAL_VIDEO');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('QUEUED', 'GENERATING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."awareness_level" AS ENUM('UNAWARE', 'PROBLEM_AWARE', 'SOLUTION_AWARE', 'PRODUCT_AWARE', 'MOST_AWARE');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('PENDING_AUTH', 'WARMING', 'ACTIVE', 'COOLDOWN', 'FLAGGED', 'TOKEN_EXPIRED', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."checkpoint" AS ENUM('T2H', 'T24H', 'T72H', 'T7D', 'T30D');--> statement-breakpoint
CREATE TYPE "public"."darwinian_action" AS ENUM('PENDING', 'KILL', 'MAINTAIN', 'DOUBLE_DOWN', 'AMPLIFY');--> statement-breakpoint
CREATE TYPE "public"."fleet_action" AS ENUM('KEEP', 'DOUBLE_DOWN', 'REPOSITION', 'THROTTLE', 'KILL', 'REVIVE');--> statement-breakpoint
CREATE TYPE "public"."objective_status" AS ENUM('ACTIVE', 'ACHIEVED', 'MISSED', 'ABANDONED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('YOUTUBE', 'TIKTOK', 'INSTAGRAM');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('PLANNED', 'SCRIPTING', 'GENERATING_MEDIA', 'RENDERING', 'QA_PENDING', 'QA_REJECTED', 'READY', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'AWAITING_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('THOUGHT', 'TOOL_CALL', 'TOOL_RESULT', 'MESSAGE', 'DELEGATION', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('VIDEO_PRODUCED', 'VIEWS_DELIVERED', 'LLM_TOKENS', 'MEDIA_GENERATION', 'RENDER_MINUTES');--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel_id" uuid,
	"kind" varchar(32) NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"embedding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel_id" uuid,
	"post_id" uuid,
	"parent_run_id" uuid,
	"kind" "agent_kind" NOT NULL,
	"label" text NOT NULL,
	"goal" text,
	"status" "run_status" DEFAULT 'RUNNING' NOT NULL,
	"model" varchar(96),
	"output" jsonb,
	"summary" text,
	"error" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" "step_kind" NOT NULL,
	"tool" varchar(96),
	"content" text,
	"args" jsonb,
	"result" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(120) NOT NULL,
	"google_project_id" varchar(128) NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"daily_quota_units" integer DEFAULT 10000 NOT NULL,
	"units_used_today" integer DEFAULT 0 NOT NULL,
	"quota_reset_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"post_id" uuid,
	"channel_id" uuid,
	"kind" varchar(32) NOT NULL,
	"utm_source" varchar(64),
	"utm_medium" varchar(64),
	"utm_campaign" varchar(128),
	"utm_content" varchar(200),
	"visitor_id" varchar(64),
	"country" varchar(8),
	"user_agent" text,
	"referrer" text,
	"value_usd" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"mime_type" varchar(128),
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" varchar(48) NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source" varchar(32) DEFAULT 'ONBOARDING' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"embedding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"domain" varchar(320),
	"target_url" text,
	"logo_url" text,
	"tagline" text,
	"onboarding_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand_dna" jsonb,
	"claims_policy" jsonb,
	"onboarding_completed_at" timestamp with time zone,
	"channel_quota" integer DEFAULT 10 NOT NULL,
	"daily_post_target" integer DEFAULT 15 NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL,
	"primary_locale" varchar(12) DEFAULT 'fr-FR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"objective" varchar(64) DEFAULT 'SIGNUPS' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"monthly_budget" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"horizon" varchar(16) DEFAULT 'WEEK' NOT NULL,
	"statement" text NOT NULL,
	"metric" varchar(48) NOT NULL,
	"comparator" varchar(4) DEFAULT '>=' NOT NULL,
	"target_value" real NOT NULL,
	"current_value" real DEFAULT 0 NOT NULL,
	"status" "objective_status" DEFAULT 'ACTIVE' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"progress_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" "platform" DEFAULT 'YOUTUBE' NOT NULL,
	"external_id" varchar(128),
	"handle" varchar(200),
	"title" varchar(200),
	"description" text,
	"thumbnail_url" text,
	"status" "channel_status" DEFAULT 'PENDING_AUTH' NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"granted_scopes" text,
	"api_project_id" uuid,
	"slot_index" integer DEFAULT 0 NOT NULL,
	"warming_day" integer DEFAULT 0 NOT NULL,
	"daily_post_target" integer DEFAULT 1 NOT NULL,
	"publish_slots" jsonb DEFAULT '[18]'::jsonb NOT NULL,
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_video_id" uuid,
	"kind" varchar(32) NOT NULL,
	"body" text NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	"sentiment" real DEFAULT 0 NOT NULL,
	"exploited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"title" text,
	"url" text,
	"published_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"outlier_ratio" real DEFAULT 0 NOT NULL,
	"transcript" text,
	"hook_text" text,
	"detected_format" varchar(32),
	"analysis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"platform" "platform" DEFAULT 'YOUTUBE' NOT NULL,
	"handle" varchar(200),
	"external_id" varchar(128),
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"outlier_index" real DEFAULT 0 NOT NULL,
	"notes" text,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"action" "fleet_action" NOT NULL,
	"posts_published" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"median_score" real DEFAULT 0 NOT NULL,
	"link_click_rate" real DEFAULT 0 NOT NULL,
	"objectives_met" integer DEFAULT 0 NOT NULL,
	"objectives_total" integer DEFAULT 0 NOT NULL,
	"quota_before" integer DEFAULT 0 NOT NULL,
	"quota_after" integer DEFAULT 0 NOT NULL,
	"format_mix_before" jsonb,
	"format_mix_after" jsonb,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"run_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_posts" integer DEFAULT 0 NOT NULL,
	"total_views" integer DEFAULT 0 NOT NULL,
	"total_link_clicks" integer DEFAULT 0 NOT NULL,
	"total_signups" integer DEFAULT 0 NOT NULL,
	"median_score" real DEFAULT 0 NOT NULL,
	"outlier_rate" real DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"narrative" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "format_bandits" (
	"channel_id" uuid NOT NULL,
	"format_id" varchar(32) NOT NULL,
	"alpha" real DEFAULT 1 NOT NULL,
	"beta" real DEFAULT 1 NOT NULL,
	"trials" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"mean_score" real DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "format_bandits_channel_id_format_id_pk" PRIMARY KEY("channel_id","format_id")
);
--> statement-breakpoint
CREATE TABLE "hook_bandits" (
	"brand_id" uuid NOT NULL,
	"hook_archetype" varchar(48) NOT NULL,
	"alpha" real DEFAULT 1 NOT NULL,
	"beta" real DEFAULT 1 NOT NULL,
	"trials" integer DEFAULT 0 NOT NULL,
	"mean_retention_3s" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hook_bandits_brand_id_hook_archetype_pk" PRIMARY KEY("brand_id","hook_archetype")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"company" varchar(200),
	"app_url" text,
	"monthly_budget" varchar(32),
	"source" varchar(64),
	"utm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"checkpoint" "checkpoint" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"age_minutes" integer NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"subscribers_gained" integer DEFAULT 0 NOT NULL,
	"avg_view_duration_ms" integer DEFAULT 0 NOT NULL,
	"retention_3s" real DEFAULT 0 NOT NULL,
	"completion_rate" real DEFAULT 0 NOT NULL,
	"profile_clicks" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"archetype" varchar(64) NOT NULL,
	"awareness_level" "awareness_level" DEFAULT 'PROBLEM_AWARE' NOT NULL,
	"age" integer,
	"occupation" varchar(160),
	"city" varchar(120),
	"backstory" text,
	"voice_profile" jsonb,
	"appearance_prompt" text,
	"reference_image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tts_voice_name" varchar(96),
	"tts_pitch" real DEFAULT 0 NOT NULL,
	"tts_speaking_rate" real DEFAULT 1.08 NOT NULL,
	"lore" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"status" "asset_status" DEFAULT 'QUEUED' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"url" text,
	"local_path" text,
	"prompt" text,
	"provider" varchar(48),
	"model" varchar(96),
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"meta" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"external_id" varchar(128),
	"author_name" varchar(200),
	"author_channel_id" varchar(128),
	"text" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"intent" varchar(32),
	"sentiment" real DEFAULT 0 NOT NULL,
	"is_video_reply_candidate" boolean DEFAULT false NOT NULL,
	"replied_at" timestamp with time zone,
	"reply_text" text,
	"reply_external_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"campaign_id" uuid,
	"strategy_id" uuid,
	"format_id" varchar(32) NOT NULL,
	"hook_archetype" varchar(48),
	"hook_text" text NOT NULL,
	"script" jsonb,
	"title" text,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned_comment" text,
	"comment_bait" jsonb,
	"parent_post_id" uuid,
	"experiment_key" varchar(64),
	"status" "post_status" DEFAULT 'PLANNED' NOT NULL,
	"failure_reason" text,
	"hook_score" real,
	"qa_verdict" jsonb,
	"rendered_video_url" text,
	"thumbnail_url" text,
	"duration_ms" integer,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_id" varchar(128),
	"external_url" text,
	"utm_content" varchar(200),
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"subscribers_gained" integer DEFAULT 0 NOT NULL,
	"avg_view_duration_ms" integer DEFAULT 0 NOT NULL,
	"retention_3s" real DEFAULT 0 NOT NULL,
	"completion_rate" real DEFAULT 0 NOT NULL,
	"profile_clicks" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"performance_score" real DEFAULT 0 NOT NULL,
	"darwinian_action" "darwinian_action" DEFAULT 'PENDING' NOT NULL,
	"darwinian_rationale" text,
	"decided_at" timestamp with time zone,
	"production_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_project_id" uuid NOT NULL,
	"channel_id" uuid,
	"post_id" uuid,
	"operation" varchar(64) NOT NULL,
	"units" integer NOT NULL,
	"succeeded" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"composition" varchar(64) NOT NULL,
	"input_props" jsonb NOT NULL,
	"status" "asset_status" DEFAULT 'QUEUED' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"output_url" text,
	"renderer" varchar(32) DEFAULT 'local' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_curves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"points" jsonb NOT NULL,
	"biggest_drop_ms" integer,
	"biggest_drop_magnitude" real,
	"analysis" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"thesis" text NOT NULL,
	"icp" jsonb,
	"format_mix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hook_archetypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_pillars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_introduction_rule" text,
	"brand_density" real DEFAULT 0.35 NOT NULL,
	"posting_cadence" jsonb,
	"rationale" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"post_id" uuid,
	"kind" "usage_kind" NOT NULL,
	"quantity" numeric(16, 4) NOT NULL,
	"unit_price_usd" numeric(10, 6) NOT NULL,
	"amount_usd" numeric(12, 4) NOT NULL,
	"cost_usd" numeric(12, 5) DEFAULT '0' NOT NULL,
	"billing_period" varchar(7) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(200),
	"avatar_url" text,
	"google_sub" varchar(128),
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_knowledge" ADD CONSTRAINT "brand_knowledge_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_objectives" ADD CONSTRAINT "channel_objectives_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_insights" ADD CONSTRAINT "competitor_insights_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_insights" ADD CONSTRAINT "competitor_insights_competitor_video_id_competitor_videos_id_fk" FOREIGN KEY ("competitor_video_id") REFERENCES "public"."competitor_videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_videos" ADD CONSTRAINT "competitor_videos_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_decisions" ADD CONSTRAINT "fleet_decisions_review_id_fleet_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."fleet_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_decisions" ADD CONSTRAINT "fleet_decisions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_reviews" ADD CONSTRAINT "fleet_reviews_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_reviews" ADD CONSTRAINT "fleet_reviews_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "format_bandits" ADD CONSTRAINT "format_bandits_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_bandits" ADD CONSTRAINT "hook_bandits_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_assets" ADD CONSTRAINT "post_assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_api_project_id_api_projects_id_fk" FOREIGN KEY ("api_project_id") REFERENCES "public"."api_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_curves" ADD CONSTRAINT "retention_curves_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memories_brand_kind_idx" ON "agent_memories" USING btree ("brand_id","kind");--> statement-breakpoint
CREATE INDEX "agent_runs_brand_started_idx" ON "agent_runs" USING btree ("brand_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_channel_idx" ON "agent_runs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "agent_runs_parent_idx" ON "agent_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_seq_uq" ON "agent_steps" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "api_projects_google_uq" ON "api_projects" USING btree ("google_project_id");--> statement-breakpoint
CREATE INDEX "attribution_brand_created_idx" ON "attribution_events" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "attribution_post_idx" ON "attribution_events" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "attribution_visitor_idx" ON "attribution_events" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "brand_assets_brand_idx" ON "brand_assets" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "brand_knowledge_brand_kind_idx" ON "brand_knowledge" USING btree ("brand_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_uq" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "brands_owner_idx" ON "brands" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "campaigns_brand_idx" ON "campaigns" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "channel_objectives_channel_status_idx" ON "channel_objectives" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "channels_brand_idx" ON "channels" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_platform_external_uq" ON "channels" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "competitor_insights_brand_kind_idx" ON "competitor_insights" USING btree ("brand_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_videos_ext_uq" ON "competitor_videos" USING btree ("competitor_id","external_id");--> statement-breakpoint
CREATE INDEX "competitor_videos_outlier_idx" ON "competitor_videos" USING btree ("outlier_ratio");--> statement-breakpoint
CREATE INDEX "competitors_brand_idx" ON "competitors" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "fleet_decisions_review_idx" ON "fleet_decisions" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "fleet_decisions_channel_idx" ON "fleet_decisions" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "fleet_reviews_brand_period_idx" ON "fleet_reviews" USING btree ("brand_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_uq" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_post_checkpoint_uq" ON "metric_snapshots" USING btree ("post_id","checkpoint");--> statement-breakpoint
CREATE INDEX "metric_snapshots_post_idx" ON "metric_snapshots" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_channel_uq" ON "personas" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "post_assets_post_kind_idx" ON "post_assets" USING btree ("post_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "post_comments_ext_uq" ON "post_comments" USING btree ("post_id","external_id");--> statement-breakpoint
CREATE INDEX "post_comments_intent_idx" ON "post_comments" USING btree ("post_id","intent");--> statement-breakpoint
CREATE INDEX "posts_brand_created_idx" ON "posts" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_channel_status_idx" ON "posts" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "posts_format_idx" ON "posts" USING btree ("brand_id","format_id");--> statement-breakpoint
CREATE INDEX "posts_scheduled_idx" ON "posts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "posts_score_idx" ON "posts" USING btree ("brand_id","performance_score");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_external_uq" ON "posts" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "quota_ledger_project_created_idx" ON "quota_ledger" USING btree ("api_project_id","created_at");--> statement-breakpoint
CREATE INDEX "render_jobs_status_idx" ON "render_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "retention_curves_post_idx" ON "retention_curves" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "strategies_channel_active_idx" ON "strategies" USING btree ("channel_id","is_active");--> statement-breakpoint
CREATE INDEX "usage_events_brand_period_idx" ON "usage_events" USING btree ("brand_id","billing_period");--> statement-breakpoint
CREATE INDEX "usage_events_post_kind_idx" ON "usage_events" USING btree ("post_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");