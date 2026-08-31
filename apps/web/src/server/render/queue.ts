import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { env } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";
import { db } from "@/server/db";
import { postAssets, posts, renderJobs } from "@/server/db/schema";
import type { Timeline } from "@/server/edit/timeline";

/**
 * Render queue.
 *
 * In-process and bounded rather than a broker: a render pins a Chromium instance
 * and several hundred MB of RAM, so the useful concurrency on one machine is two
 * or three regardless of how many jobs are waiting. A queue that admits more
 * than the box can run is a queue that thrashes.
 *
 * The same interface fronts a Cloud Run worker in production — `enqueueRender`
 * is the only thing callers touch.
 */

const running = new Set<string>();
const pending: string[] = [];

export async function enqueueRender(jobId: string): Promise<void> {
  if (running.has(jobId) || pending.includes(jobId)) return;
  pending.push(jobId);
  void drain();
}

async function drain(): Promise<void> {
  while (pending.length > 0 && running.size < env.limits.maxParallelRenders) {
    const jobId = pending.shift();
    if (!jobId) break;
    running.add(jobId);
    void executeRender(jobId)
      .catch(() => undefined)
      .finally(() => {
        running.delete(jobId);
        void drain();
      });
  }
}

export function queueStatus() {
  return { running: [...running], pending: [...pending], capacity: env.limits.maxParallelRenders };
}

/**
 * Resolve once the queue is empty.
 *
 * Renders are fire-and-forget from the agent's point of view, which is right for
 * a server but wrong for a CLI process that would otherwise exit mid-encode and
 * leave a half-written MP4. Any short-lived caller awaits this before finishing.
 */
export async function waitForIdle(timeoutMs = 20 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (running.size > 0 || pending.length > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `Renders still running after ${Math.round(timeoutMs / 60000)} minutes (${running.size} active, ${pending.length} queued).`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* ========================================================================== */

/**
 * Single-flight bundle.
 *
 * We memoise the *promise*, not the resolved value. Two renders starting at the
 * same moment would otherwise each kick off a webpack build into overlapping
 * temp directories, and one would clobber the other's output — which showed up
 * as sporadic "Error loading image" failures that looked like an asset problem
 * and were in fact a build race.
 */
let bundlePromise: Promise<string> | null = null;

async function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      const entry = path.resolve(process.cwd(), "../video/src/index.ts");
      // No publicDir override: generated media already lives in the Remotion
      // project's own public folder, which it serves natively.
      return bundle({ entryPoint: entry, onProgress: () => undefined });
    })().catch((err) => {
      bundlePromise = null; // let the next render retry rather than cache a failure
      throw err;
    });
  }
  return bundlePromise;
}

export async function executeRender(jobId: string): Promise<void> {
  const [job] = await db.select().from(renderJobs).where(eq(renderJobs.id, jobId)).limit(1);
  if (!job) return;

  await db
    .update(renderJobs)
    .set({ status: "GENERATING", startedAt: new Date(), progress: 0 })
    .where(eq(renderJobs.id, jobId));

  const started = Date.now();

  try {
    const timeline = job.inputProps as unknown as Timeline;
    const outDir = path.join(GENERATED_ROOT, "videos");
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${job.postId}.mp4`);

    const [{ selectComposition, renderMedia }, serveUrl, assetBase] = await Promise.all([
      import("@remotion/renderer"),
      getBundle(),
      (await import("./assets")).assetBaseUrl(),
    ]);

    // Media is served over HTTP rather than through the bundle, so assets
    // generated after the bundle was built still resolve. See `render/assets.ts`.
    const { absolutiseTimeline } = await import("./assets");
    const renderTimeline = absolutiseTimeline(timeline, assetBase);

    const composition = await selectComposition({
      serveUrl,
      id: "TimelineRenderer",
      inputProps: { timeline: renderTimeline },
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps: { timeline: renderTimeline },
      // Short-form platforms re-encode aggressively; a high source bitrate is
      // what survives that pass looking sharp.
      crf: 18,
      x264Preset: "slow",
      audioCodec: "aac",
      audioBitrate: "192k",
      concurrency: 2,
      // Media that is not yet on disk should fail loudly, not render as a hole.
      onBrowserLog: () => undefined,
      onProgress: ({ progress }) => {
        if (Math.round(progress * 20) % 2 === 0) {
          void db
            .update(renderJobs)
            .set({ progress })
            .where(eq(renderJobs.id, jobId));
        }
      },
    });

    const publicUrl = `/generated/videos/${job.postId}.mp4`;
    const durationMs = Date.now() - started;

    // Copy the finished video somewhere it survives this container.
    //
    // On Cloud Run the filesystem is in memory and the instance scales to zero
    // a few minutes after the daily run ends, so a video that only exists on
    // disk exists until lunchtime. The storyboard panels go too: they are what
    // the dashboard shows to explain how the video was arrived at.
    const { keepDurable } = await import("@/server/media/durable");
    await keepDurable(publicUrl);
    const panels = await db
      .select({ url: postAssets.url })
      .from(postAssets)
      .where(eq(postAssets.postId, job.postId));
    for (const panel of panels) {
      if (panel.url?.startsWith("/generated/images/")) await keepDurable(panel.url);
    }

    await db
      .update(renderJobs)
      .set({
        status: "READY",
        progress: 1,
        outputUrl: publicUrl,
        finishedAt: new Date(),
        durationMs,
        // Roughly what the same render costs on Lambda, for margin reporting.
        costUsd: (0.0075 * (timeline.durationMs / 1000)).toFixed(5),
      })
      .where(eq(renderJobs.id, jobId));

    await db
      .update(posts)
      .set({
        renderedVideoUrl: publicUrl,
        durationMs: timeline.durationMs,
        status: "QA_PENDING",
        updatedAt: new Date(),
      })
      .where(eq(posts.id, job.postId));

    // Hand off to QA, which decides whether this ever reaches a channel.
    const { runQaOnPost } = await import("@/server/agents/qa");
    await runQaOnPost(job.postId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(renderJobs)
      .set({
        status: "FAILED",
        error: message,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
      })
      .where(eq(renderJobs.id, jobId));
    await db
      .update(posts)
      .set({ status: "FAILED", failureReason: `Render failed: ${message}`, updatedAt: new Date() })
      .where(eq(posts.id, job.postId));
  }
}
