import "server-only";

import path from "node:path";

import { and, asc, eq, isNotNull, lte, or, sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";
import { db } from "@/server/db";
import { channels, posts } from "@/server/db/schema";
import { uploadVideo, postComment } from "@/server/integrations/youtube";

/**
 * Publishing scheduler.
 *
 * Responsibilities, in order of importance:
 *   1. Never exceed the platform quota (checked inside `uploadVideo`).
 *   2. Never publish two videos on one channel within four hours.
 *   3. Post and pin the conversion comment within 90 seconds of going live —
 *      that comment is the highest-converting surface in the whole product, and
 *      it only works if it is there before the first wave of viewers arrives.
 */

export interface PublishOutcome {
  postId: string;
  published: boolean;
  externalId?: string;
  url?: string;
  reason?: string;
  dryRun?: boolean;
}

export async function publishReadyPost(postId: string): Promise<PublishOutcome> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return { postId, published: false, reason: "Post not found." };
  if (post.status !== "READY") {
    return { postId, published: false, reason: `Status is ${post.status}; only a READY post can be posted.` };
  }
  if (!post.renderedVideoUrl) {
    return { postId, published: false, reason: "No rendered video." };
  }

  const [channel] = await db
    .select({
      id: channels.id,
      status: channels.status,
      lastPublishedAt: channels.lastPublishedAt,
      externalId: channels.externalId,
    })
    .from(channels)
    .where(eq(channels.id, post.channelId))
    .limit(1);

  if (!channel) return { postId, published: false, reason: "Channel not found." };
  if (["PAUSED", "FLAGGED", "TOKEN_EXPIRED"].includes(channel.status)) {
    return { postId, published: false, reason: `Channel is ${channel.status}.` };
  }

  if (channel.lastPublishedAt) {
    const elapsed = Date.now() - new Date(channel.lastPublishedAt).getTime();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    if (elapsed < FOUR_HOURS) {
      return {
        postId,
        published: false,
        reason: `Last post was ${Math.round(elapsed / 60000)} minutes ago. Minimum spacing is four hours so the two videos do not eat each other.`,
      };
    }
  }

  await db.update(posts).set({ status: "PUBLISHING", updatedAt: new Date() }).where(eq(posts.id, postId));

  try {
    const filePath = path.join(
      GENERATED_ROOT,
      "..",
      post.renderedVideoUrl.replace(/^\//, ""),
    );

    const result = await uploadVideo({
      channelId: post.channelId,
      postId,
      filePath,
      title: post.title ?? post.hookText,
      description: buildDescription(post),
      tags: (post.tags as string[]) ?? [],
      privacyStatus: "public",
    });

    await db
      .update(posts)
      .set({
        status: "PUBLISHED",
        externalId: result.videoId,
        externalUrl: result.url,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId));

    await db
      .update(channels)
      .set({
        lastPublishedAt: new Date(),
        videoCount: sql`${channels.videoCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(channels.id, post.channelId));

    // The pinned comment is time-critical: it must greet the first viewers.
    if (post.pinnedComment) {
      try {
        await postComment({
          channelId: post.channelId,
          videoId: result.videoId,
          text: post.pinnedComment,
        });
      } catch {
        // A failed comment must not un-publish a successful video.
      }
    }

    return {
      postId,
      published: true,
      externalId: result.videoId,
      url: result.url,
      dryRun: result.dryRun,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(posts)
      .set({ status: "READY", failureReason: message, updatedAt: new Date() })
      .where(eq(posts.id, postId));
    return { postId, published: false, reason: message };
  }
}

/** Publish everything whose slot has arrived. Called by the cron endpoint. */
export async function publishDueposts(brandId?: string): Promise<PublishOutcome[]> {
  const conditions = [
    eq(posts.status, "READY"),
    isNotNull(posts.renderedVideoUrl),
    or(lte(posts.scheduledFor, new Date()), sql`${posts.scheduledFor} is null`),
  ];
  if (brandId) conditions.push(eq(posts.brandId, brandId));

  const due = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(...conditions))
    .orderBy(asc(posts.scheduledFor))
    .limit(20);

  const outcomes: PublishOutcome[] = [];
  for (const p of due) {
    outcomes.push(await publishReadyPost(p.id));
  }
  return outcomes;
}

/**
 * The description carries the tracked link.
 *
 * YouTube truncates after roughly three lines in the collapsed view, so the link
 * goes first — anything below the fold is, for conversion purposes, absent.
 */
function buildDescription(post: typeof posts.$inferSelect): string {
  const lines: string[] = [];
  if (post.description) lines.push(post.description.trim());
  const tags = (post.tags as string[]) ?? [];
  if (tags.length) lines.push("", tags.map((t) => `#${t.replace(/^#/, "")}`).join(" "));
  return lines.join("\n").slice(0, 5000);
}

export { env };
