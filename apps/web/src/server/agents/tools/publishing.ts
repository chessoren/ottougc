import { and, desc, eq } from "drizzle-orm";

import { env } from "@/lib/env";
import { brands, channels, personas, postComments, posts, renderJobs } from "@/server/db/schema";
import { validateTimeline, hasBlockingIssues } from "@/server/edit/timeline";
import { getFormat } from "@/server/knowledge";
import { HOOK_MAX_WORDS, countWords } from "@/server/knowledge/text";
import { pickApiProject, postComment, listComments, replyToComment } from "@/server/integrations/youtube";

import { getWorkspace } from "../workspace";
import type { AgentTool } from "../types";

/**
 * Publishing tools.
 *
 * The gate order is deliberate and enforced in code, not in the prompt:
 *   script -> media -> edit -> validate -> render -> QA -> publish.
 * An agent cannot call `publish_post` on a timeline that never rendered, and
 * cannot render a timeline that fails validation. The model is free to be
 * creative inside the pipeline; it is not free to skip a stage.
 */

export const savePost: AgentTool = {
  name: "save_post",
  description:
    "Saves the post: scenario, hook, script, title, description, tags, pinned comment. Call this once the script is settled, BEFORE generating any footage.",
  parameters: {
    type: "object",
    properties: {
      formatId: { type: "string" },
      hookArchetype: { type: "string" },
      hookText: { type: "string", description: "The hook banner. Seven words maximum." },
      title: { type: "string", description: "YouTube title. 100 characters max, no dishonest clickbait." },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      script: {
        type: "object",
        description: "Le script complet : { beats: [...], narration: string, ctaLevel: number }",
      },
      pinnedComment: {
        type: "string",
        description:
          "The conversion comment, posted and pinned within 90 seconds of going live.",
      },
      commentBait: {
        type: "object",
        description:
          "{ technique: 'INTENTIONAL_SLIP'|'BINARY_DILEMMA'|'TRIGGER_WORD', detail: string } — what you planted in the video to provoke comments.",
      },
    },
    required: ["formatId", "hookText", "title", "script"],
  },
  async handler(
    args: {
      formatId: string;
      hookArchetype?: string;
      hookText: string;
      title: string;
      description?: string;
      tags?: string[];
      script: Record<string, unknown>;
      pinnedComment?: string;
      commentBait?: Record<string, unknown>;
    },
    ctx,
  ) {
    if (!ctx.channelId) return { error: "No channel in context." };
    const format = getFormat(args.formatId);
    if (!format) return { error: `Format inconnu : ${args.formatId}` };

    const words = countWords(args.hookText);
    if (words > HOOK_MAX_WORDS) {
      return {
        error: `The hook banner is ${words} words. Maximum ${HOOK_MAX_WORDS} — past that it isn't read in time. Rewrite it.`,
      };
    }

    const [brand] = await ctx.db
      .select({ targetUrl: brands.targetUrl, slug: brands.slug })
      .from(brands)
      .where(eq(brands.id, ctx.brandId))
      .limit(1);
    const [channel] = await ctx.db
      .select({ handle: channels.handle })
      .from(channels)
      .where(eq(channels.id, ctx.channelId))
      .limit(1);

    const existingId = ctx.postId;
    const values = {
      brandId: ctx.brandId,
      channelId: ctx.channelId,
      formatId: args.formatId,
      hookArchetype: args.hookArchetype,
      hookText: args.hookText,
      script: args.script as never,
      title: args.title.slice(0, 100),
      description: args.description ?? "",
      tags: (args.tags ?? []) as never,
      pinnedComment: args.pinnedComment,
      commentBait: (args.commentBait ?? null) as never,
      status: "SCRIPTING" as const,
      updatedAt: new Date(),
    };

    let postId: string;
    if (existingId) {
      await ctx.db.update(posts).set(values).where(eq(posts.id, existingId));
      postId = existingId;
    } else {
      const [row] = await ctx.db.insert(posts).values(values).returning({ id: posts.id });
      postId = row!.id;
      ctx.postId = postId;
    }

    // UTM content is the join key between a view on YouTube and a signup in the
    // client's app. It has to be stamped at creation, not at publish time.
    const utmContent = `${channel?.handle ?? "channel"}_${postId.slice(0, 8)}_${args.formatId}`;
    await ctx.db.update(posts).set({ utmContent }).where(eq(posts.id, postId));

    const trackingUrl = brand?.targetUrl
      ? `${brand.targetUrl}${brand.targetUrl.includes("?") ? "&" : "?"}utm_source=youtube&utm_medium=ugc_studio&utm_campaign=${brand.slug}&utm_content=${utmContent}`
      : null;

    return { postId, utmContent, trackingUrl, formatSpec: { id: format.id, name: format.name } };
  },
};

export const renderPost: AgentTool = {
  name: "render_post",
  description:
    "Renders the timeline to MP4 1080×1920 at 60fps. Refused while check_timeline reports a blocking error. This is the last step before quality control.",
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const ws = getWorkspace(ctx.runId);
    if (!ws.timeline) return { error: "Nothing to render. Call build_rough_cut first." };
    if (!ctx.postId) return { error: "No post saved. Call save_post first." };

    const issues = validateTimeline(ws.timeline);
    if (hasBlockingIssues(issues)) {
      return {
        error: "Render refused: the edit has blocking errors.",
        issues: issues.filter((i) => i.severity === "ERROR"),
      };
    }

    const [job] = await ctx.db
      .insert(renderJobs)
      .values({
        postId: ctx.postId,
        composition: "TimelineRenderer",
        inputProps: ws.timeline as never,
        status: "QUEUED",
        renderer: "local",
      })
      .returning({ id: renderJobs.id });

    await ctx.db
      .update(posts)
      .set({ status: "RENDERING", durationMs: ws.timeline.durationMs, updatedAt: new Date() })
      .where(eq(posts.id, ctx.postId));

    // The render worker picks the job up; we do not block the agent loop on a
    // multi-minute encode.
    const { enqueueRender } = await import("@/server/render/queue");
    void enqueueRender(job!.id);

    return {
      renderJobId: job!.id,
      status: "QUEUED",
      durationMs: ws.timeline.durationMs,
      clips: ws.timeline.video.length,
      warnings: issues.filter((i) => i.severity === "WARNING").length,
      note: "Queued. Quality control and posting run automatically when it finishes.",
    };
  },
};

export const schedulePost: AgentTool = {
  name: "schedule_post",
  description:
    "Schedules the post. The slots that perform are 11:45-13:15, 17:30-19:30 (strongest) and 21:30-23:00, in the audience's local time. Two posts on the same channel must be at least four hours apart.",
  parameters: {
    type: "object",
    properties: {
      publishAtIso: { type: "string", description: "Date ISO 8601." },
      rationale: { type: "string", description: "Why this slot." },
    },
    required: ["publishAtIso"],
  },
  async handler(args: { publishAtIso: string; rationale?: string }, ctx) {
    if (!ctx.postId) return { error: "No post in context." };
    const when = new Date(args.publishAtIso);
    if (Number.isNaN(when.getTime())) return { error: "Date invalide." };

    // Enforce spacing against what is already scheduled on this channel.
    const siblings = await ctx.db
      .select({ scheduledFor: posts.scheduledFor, publishedAt: posts.publishedAt })
      .from(posts)
      .where(and(eq(posts.channelId, ctx.channelId!), eq(posts.brandId, ctx.brandId)))
      .orderBy(desc(posts.createdAt))
      .limit(20);

    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    for (const s of siblings) {
      const other = s.scheduledFor ?? s.publishedAt;
      if (!other) continue;
      const delta = Math.abs(new Date(other).getTime() - when.getTime());
      if (delta < FOUR_HOURS) {
        return {
          error: `That slot is ${Math.round(delta / 60000)} minutes from another post on this channel. Minimum spacing is four hours, or the two videos eat each other.`,
          conflictAt: other,
        };
      }
    }

    await ctx.db
      .update(posts)
      .set({ scheduledFor: when, updatedAt: new Date() })
      .where(eq(posts.id, ctx.postId));

    return { scheduled: true, publishAt: when.toISOString(), rationale: args.rationale };
  },
};

export const checkPublishCapacity: AgentTool = {
  name: "check_publish_capacity",
  description:
    "How many YouTube uploads are still possible today. One upload costs 1,600 of a project's 10,000 daily units — six videos per project per day. Call this BEFORE planning a day's production.",
  parameters: { type: "object", properties: {} },
  async handler() {
    const quota = await pickApiProject(1600);
    return {
      uploadsRemainingToday: quota.uploadsRemaining,
      unitsRemaining: quota.remaining,
      dailyQuota: quota.dailyQuotaUnits,
      dryRunMode: env.dryRunPublishing,
      advice:
        quota.uploadsRemaining <= 0
          ? "No uploads left today. Schedule for tomorrow, or add another Google Cloud project to the pool."
          : `${quota.uploadsRemaining} upload(s) possible(s) aujourd'hui.`,
    };
  },
};

export const publishPinnedComment: AgentTool = {
  name: "publish_pinned_comment",
  description:
    "Posts the conversion comment under a video that's already live. Do it within 90 seconds: it's the first thing anyone opening the comments sees, and the single biggest source of profile clicks.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
  async handler(args: { text: string }, ctx) {
    if (!ctx.postId || !ctx.channelId) return { error: "Post or channel missing from context." };
    const [post] = await ctx.db
      .select({ externalId: posts.externalId })
      .from(posts)
      .where(eq(posts.id, ctx.postId))
      .limit(1);
    if (!post?.externalId) return { error: "This video isn't posted yet." };

    const result = await postComment({
      channelId: ctx.channelId,
      videoId: post.externalId,
      text: args.text,
    });
    await ctx.db
      .update(posts)
      .set({ pinnedComment: args.text, updatedAt: new Date() })
      .where(eq(posts.id, ctx.postId));
    return result;
  },
};

export const fetchComments: AgentTool = {
  name: "fetch_comments",
  description:
    "Fetches and classifies a video's comments. Replying to all of them in the first fifteen minutes sends a velocity signal that immediately widens distribution.",
  parameters: {
    type: "object",
    properties: {
      postId: { type: "string" },
      max: { type: "number" },
    },
  },
  async handler(args: { postId?: string; max?: number }, ctx) {
    const postId = args.postId ?? ctx.postId;
    if (!postId || !ctx.channelId) return { error: "Post ou compte manquant." };

    const [post] = await ctx.db
      .select({ externalId: posts.externalId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post?.externalId) return { error: "Video not posted." };

    const remote = await listComments({
      channelId: ctx.channelId,
      videoId: post.externalId,
      max: args.max ?? 60,
    });

    for (const c of remote) {
      await ctx.db
        .insert(postComments)
        .values({
          postId,
          externalId: c.externalId,
          authorName: c.authorName,
          authorChannelId: c.authorChannelId,
          text: c.text,
          likeCount: c.likeCount,
          publishedAt: c.publishedAt,
        })
        .onConflictDoNothing();
    }

    const stored = await ctx.db
      .select({
        id: postComments.id,
        text: postComments.text,
        authorName: postComments.authorName,
        likeCount: postComments.likeCount,
        intent: postComments.intent,
        repliedAt: postComments.repliedAt,
      })
      .from(postComments)
      .where(eq(postComments.postId, postId))
      .orderBy(desc(postComments.likeCount))
      .limit(args.max ?? 60);

    return { count: stored.length, comments: stored };
  },
};

export const replyToCommentTool: AgentTool = {
  name: "reply_to_comment",
  description:
    "Replies to a comment in the character's voice. Keep it short and spoken, with no commercial language. Never mock a critic: the reply is read by hundreds of people who are judging the account, not the comment.",
  parameters: {
    type: "object",
    properties: {
      commentId: { type: "string", description: "Internal comment id, not the YouTube one." },
      text: { type: "string" },
      intent: {
        type: "string",
        enum: ["QUESTION", "OBJECTION", "PRAISE", "TROLL", "BUYING_SIGNAL", "SPAM"],
        description: "How you classify this comment.",
      },
      isVideoReplyCandidate: {
        type: "boolean",
        description:
          "True if this deserves its own reply video — a public, head-on objection.",
      },
    },
    required: ["commentId", "text"],
  },
  async handler(
    args: { commentId: string; text: string; intent?: string; isVideoReplyCandidate?: boolean },
    ctx,
  ) {
    const [comment] = await ctx.db
      .select({ externalId: postComments.externalId, postId: postComments.postId })
      .from(postComments)
      .where(eq(postComments.id, args.commentId))
      .limit(1);
    if (!comment?.externalId) return { error: "Commentaire introuvable." };

    const result = await replyToComment({
      channelId: ctx.channelId!,
      parentCommentId: comment.externalId,
      text: args.text,
    });

    await ctx.db
      .update(postComments)
      .set({
        replyText: args.text,
        replyExternalId: result.replyId,
        repliedAt: new Date(),
        intent: args.intent,
        isVideoReplyCandidate: args.isVideoReplyCandidate ?? false,
      })
      .where(eq(postComments.id, args.commentId));

    return result;
  },
};

export const PUBLISHING_TOOLS: AgentTool[] = [
  savePost,
  renderPost,
  schedulePost,
  checkPublishCapacity,
  publishPinnedComment,
  fetchComments,
  replyToCommentTool,
];
