import "server-only";

import { createReadStream } from "node:fs";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { google, type youtube_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { apiProjects, channels, quotaLedger } from "@/server/db/schema";

/**
 * YouTube integration.
 *
 * The hard part of this file is not the API, it is the quota — though it is much
 * less hard than it used to be. Uploads used to cost 1 600 units out of a 10 000
 * unit daily pool, which capped a project at six videos a day. Since 1 June 2026
 * `videos.insert` has its **own bucket**: 1 unit per call, 100 calls a day, not
 * drawn from the 10 000 units everything else shares. `search.list` is metered
 * the same way.
 *
 * Three things follow, and all three are implemented here:
 *
 *   1. **Two budgets, tracked separately.** Uploads are counted as calls against
 *      the 100/day bucket; everything else draws on the unit pool. Conflating
 *      them is what produced the old six-a-day ceiling. Sharding across projects
 *      still works and is still used, but it is now an optimisation rather than
 *      the only way to reach a normal posting cadence.
 *   2. **No `search.list`, ever, on channels we own.** Search costs 100 units;
 *      reading the uploads playlist costs 1. Same data, hundredth of the price.
 *   3. **Analytics comes from the Analytics API, not the Data API.** Retention
 *      curves and traffic sources cost zero Data-API quota, which is what makes
 *      the darwinian engine affordable at fleet scale.
 */

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

/**
 * Published quota costs, in units.
 *
 * `videosInsert` and `searchList` are billed against their own daily buckets
 * (see `UPLOAD_CALLS_PER_DAY`), not against the 10 000-unit pool.
 */
export const QUOTA_COST = {
  videosInsert: 1,
  videosUpdate: 50,
  videosList: 1,
  playlistItemsList: 1,
  channelsList: 1,
  commentThreadsInsert: 50,
  commentThreadsList: 1,
  commentsSetModerationStatus: 50,
  searchList: 1,
} as const;

/**
 * Daily `videos.insert` calls per Google Cloud project.
 *
 * Its own bucket since 1 June 2026 — independent of the 10 000-unit pool. The
 * previous model (1 600 units out of 10 000) capped a project at six uploads a
 * day and is what the fleet's cadence used to be designed around.
 */
export const UPLOAD_CALLS_PER_DAY = 100;

export function redirectUri(): string {
  return `${env.appUrl}${env.youtube.redirectPath}`;
}

function oauthClient(clientId?: string, clientSecret?: string): OAuth2Client {
  const id = clientId ?? env.youtube.clientId;
  const secret = clientSecret ?? env.youtube.clientSecret;
  if (!id || !secret) {
    throw new Error(
      "YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (see docs/SETUP.md, section 4).",
    );
  }
  return new google.auth.OAuth2(id, secret, redirectUri());
}

/** Consent URL. `state` carries the brand and slot the channel will occupy. */
/**
 * Build the consent URL.
 *
 * `select_account consent` is doing specific work here. A Google account can own
 * several YouTube channels through Brand Accounts, and the only way to connect
 * more than one is to run this flow once per channel, letting the user pick a
 * different one each time. With the default prompt Google silently reuses the
 * last choice, so the second connection attempt returns the first channel again
 * and the user cannot tell why nothing happened.
 *
 * `consent` on top of that forces a refresh token on every pass. Without it a
 * returning user yields no refresh token and the channel expires within an hour.
 */
export function buildAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: YOUTUBE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export interface ConnectedChannel {
  externalId: string;
  title: string;
  handle?: string;
  description?: string;
  thumbnailUrl?: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId?: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  grantedScopes: string;
}

/** Exchange the authorisation code and read back the channel it belongs to. */
export async function exchangeCode(code: string): Promise<ConnectedChannel> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Revoke OttoUGC at https://myaccount.google.com/permissions, then connect the channel again.",
    );
  }
  client.setCredentials(tokens);

  const yt = google.youtube({ version: "v3", auth: client });
  const res = await yt.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    mine: true,
  });

  const channel = res.data.items?.[0];
  if (!channel?.id) {
    throw new Error("This Google account has no YouTube channel.");
  }

  return {
    externalId: channel.id,
    title: channel.snippet?.title ?? "Untitled channel",
    handle: channel.snippet?.customUrl ?? undefined,
    description: channel.snippet?.description ?? undefined,
    thumbnailUrl:
      channel.snippet?.thumbnails?.high?.url ?? channel.snippet?.thumbnails?.default?.url ?? undefined,
    subscriberCount: Number(channel.statistics?.subscriberCount ?? 0),
    viewCount: Number(channel.statistics?.viewCount ?? 0),
    videoCount: Number(channel.statistics?.videoCount ?? 0),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? undefined,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? "",
    accessTokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3500_000),
    grantedScopes: tokens.scope ?? YOUTUBE_SCOPES.join(" "),
  };
}

/** An authorised client for a stored channel, refreshing the token if needed. */
export async function clientForChannel(channelId: string): Promise<OAuth2Client> {
  const [row] = await db
    .select({
      refreshToken: channels.refreshToken,
      accessToken: channels.accessToken,
      expiresAt: channels.accessTokenExpiresAt,
      apiProjectId: channels.apiProjectId,
      status: channels.status,
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!row?.refreshToken) {
    throw new Error("This channel has no refresh token and needs reconnecting.");
  }

  // A channel can be pinned to a pooled project; otherwise the default app creds.
  let clientId = env.youtube.clientId;
  let clientSecret = env.youtube.clientSecret;
  if (row.apiProjectId) {
    const [proj] = await db
      .select({ clientId: apiProjects.clientId, clientSecret: apiProjects.clientSecret })
      .from(apiProjects)
      .where(eq(apiProjects.id, row.apiProjectId))
      .limit(1);
    if (proj) {
      clientId = proj.clientId;
      clientSecret = proj.clientSecret;
    }
  }

  const client = oauthClient(clientId, clientSecret);
  client.setCredentials({
    refresh_token: row.refreshToken,
    access_token: row.accessToken ?? undefined,
    expiry_date: row.expiresAt ? new Date(row.expiresAt).getTime() : undefined,
  });

  // Persist rotated tokens so the next process does not re-refresh needlessly.
  client.on("tokens", (tokens) => {
    void db
      .update(channels)
      .set({
        accessToken: tokens.access_token ?? undefined,
        accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(channels.id, channelId));
  });

  try {
    await client.getAccessToken();
  } catch (err) {
    await db
      .update(channels)
      .set({ status: "TOKEN_EXPIRED", updatedAt: new Date() })
      .where(eq(channels.id, channelId));
    throw new Error(
      `This channel's refresh token was rejected (${err instanceof Error ? err.message : "no reason given"}). ` +
        "If the OAuth consent screen is still in Testing, refresh tokens expire after seven days — see docs/SETUP.md.",
    );
  }

  return client;
}

/* ==========================================================================
   Quota
   ========================================================================== */

export interface QuotaStatus {
  apiProjectId: string | null;
  googleProjectId: string | null;
  dailyQuotaUnits: number;
  usedToday: number;
  remaining: number;
  uploadsRemaining: number;
}

/** Pick the pooled project with the most headroom, refreshing daily counters. */
export async function pickApiProject(unitsNeeded: number): Promise<QuotaStatus> {
  const projects = await db
    .select()
    .from(apiProjects)
    .where(eq(apiProjects.isActive, true))
    .orderBy(desc(sql`${apiProjects.dailyQuotaUnits} - ${apiProjects.unitsUsedToday}`));

  if (projects.length === 0) {
    // No pool configured: the app's own credentials, with an unmetered estimate.
    const used = await unitsUsedToday(null);
    return {
      apiProjectId: null,
      googleProjectId: env.gcpProjectId ?? null,
      dailyQuotaUnits: 10000,
      usedToday: used,
      remaining: 10000 - used,
      uploadsRemaining: UPLOAD_CALLS_PER_DAY - (await uploadCallsToday(null)),
    };
  }

  const now = new Date();
  for (const p of projects) {
    // Quota resets at midnight Pacific.
    const stale = !p.quotaResetAt || new Date(p.quotaResetAt) < now;
    const used = stale ? 0 : p.unitsUsedToday;
    if (stale) {
      await db
        .update(apiProjects)
        .set({ unitsUsedToday: 0, quotaResetAt: nextPacificMidnight() })
        .where(eq(apiProjects.id, p.id));
    }
    const remaining = p.dailyQuotaUnits - used;
    if (remaining >= unitsNeeded) {
      return {
        apiProjectId: p.id,
        googleProjectId: p.googleProjectId,
        dailyQuotaUnits: p.dailyQuotaUnits,
        usedToday: used,
        remaining,
        uploadsRemaining: UPLOAD_CALLS_PER_DAY - (await uploadCallsToday(p.id)),
      };
    }
  }

  const best = projects[0]!;
  return {
    apiProjectId: best.id,
    googleProjectId: best.googleProjectId,
    dailyQuotaUnits: best.dailyQuotaUnits,
    usedToday: best.unitsUsedToday,
    remaining: best.dailyQuotaUnits - best.unitsUsedToday,
    uploadsRemaining: UPLOAD_CALLS_PER_DAY - (await uploadCallsToday(best.id)),
  };
}

/**
 * Uploads used today, as a count of calls.
 *
 * `videos.insert` is billed against a bucket of 100 calls a day that is separate
 * from the 10 000-unit pool, so this counts rows rather than summing units.
 */
async function uploadCallsToday(apiProjectId: string | null): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const conditions = [
    gte(quotaLedger.createdAt, start),
    sql`${quotaLedger.operation} like 'videos.insert%'`,
  ];
  if (apiProjectId) conditions.push(eq(quotaLedger.apiProjectId, apiProjectId));
  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(quotaLedger)
    .where(and(...conditions));
  return Number(rows[0]?.n ?? 0);
}

async function unitsUsedToday(apiProjectId: string | null): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const conditions = [gte(quotaLedger.createdAt, start)];
  if (apiProjectId) conditions.push(eq(quotaLedger.apiProjectId, apiProjectId));
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${quotaLedger.units}), 0)` })
    .from(quotaLedger)
    .where(and(...conditions));
  return Number(rows[0]?.total ?? 0);
}

async function chargeQuota(opts: {
  apiProjectId: string | null;
  channelId?: string;
  postId?: string;
  operation: string;
  units: number;
  succeeded: boolean;
}) {
  if (opts.apiProjectId) {
    await db.insert(quotaLedger).values({
      apiProjectId: opts.apiProjectId,
      channelId: opts.channelId,
      postId: opts.postId,
      operation: opts.operation,
      units: opts.units,
      succeeded: opts.succeeded,
    });
    await db
      .update(apiProjects)
      .set({ unitsUsedToday: sql`${apiProjects.unitsUsedToday} + ${opts.units}` })
      .where(eq(apiProjects.id, opts.apiProjectId));
  }
}

function nextPacificMidnight(): Date {
  const now = new Date();
  // Pacific is UTC-8 (or -7 in DST); using -8 makes the reset conservative,
  // which is the correct direction to err for a quota.
  const pacificOffsetMs = 8 * 60 * 60 * 1000;
  const pacificNow = new Date(now.getTime() - pacificOffsetMs);
  pacificNow.setUTCHours(24, 0, 0, 0);
  return new Date(pacificNow.getTime() + pacificOffsetMs);
}

/* ==========================================================================
   Publishing
   ========================================================================== */

export interface UploadRequest {
  channelId: string;
  postId?: string;
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  /** Shorts are inferred from the vertical aspect ratio and <3min duration. */
  privacyStatus?: "public" | "unlisted" | "private";
  publishAt?: Date;
  categoryId?: string;
  madeForKids?: boolean;
}

export interface UploadResult {
  videoId: string;
  url: string;
  quotaUnitsCharged: number;
  dryRun: boolean;
}

export async function uploadVideo(req: UploadRequest): Promise<UploadResult> {
  const quota = await pickApiProject(QUOTA_COST.videosInsert);

  if (quota.uploadsRemaining <= 0 && !env.dryRunPublishing) {
    throw new Error(
      `All ${UPLOAD_CALLS_PER_DAY} of today's uploads are used up on this project. ` +
        `Add another Google Cloud project to the pool, or wait for the reset at midnight Pacific.`,
    );
  }

  if (env.dryRunPublishing) {
    // Dry run still charges the ledger so quota planning is exercised in dev.
    await chargeQuota({
      apiProjectId: quota.apiProjectId,
      channelId: req.channelId,
      postId: req.postId,
      operation: "videos.insert (dry-run)",
      units: 0,
      succeeded: true,
    });
    const fakeId = `dryrun_${Date.now().toString(36)}`;
    return {
      videoId: fakeId,
      url: `https://www.youtube.com/shorts/${fakeId}`,
      quotaUnitsCharged: 0,
      dryRun: true,
    };
  }

  const auth = await clientForChannel(req.channelId);
  const yt = google.youtube({ version: "v3", auth });

  try {
    const res = await yt.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: req.title.slice(0, 100),
          description: req.description.slice(0, 5000),
          tags: req.tags.slice(0, 30),
          categoryId: req.categoryId ?? "28", // Science & Technology
        },
        status: {
          privacyStatus: req.publishAt ? "private" : (req.privacyStatus ?? "public"),
          publishAt: req.publishAt?.toISOString(),
          selfDeclaredMadeForKids: req.madeForKids ?? false,
        },
      },
      media: { body: createReadStream(req.filePath) },
    });

    const videoId = res.data.id;
    if (!videoId) throw new Error("YouTube returned no video id.");

    await chargeQuota({
      apiProjectId: quota.apiProjectId,
      channelId: req.channelId,
      postId: req.postId,
      operation: "videos.insert",
      units: QUOTA_COST.videosInsert,
      succeeded: true,
    });

    return {
      videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
      quotaUnitsCharged: QUOTA_COST.videosInsert,
      dryRun: false,
    };
  } catch (err) {
    // A failed upload still consumes quota — record it, or the planner will
    // believe it has headroom it does not have.
    await chargeQuota({
      apiProjectId: quota.apiProjectId,
      channelId: req.channelId,
      postId: req.postId,
      operation: "videos.insert",
      units: QUOTA_COST.videosInsert,
      succeeded: false,
    });
    throw err;
  }
}

/* ==========================================================================
   Comments — the conversion channel
   ========================================================================== */

export async function postComment(opts: {
  channelId: string;
  videoId: string;
  text: string;
}): Promise<{ commentId: string; dryRun: boolean }> {
  if (env.dryRunPublishing) {
    return { commentId: `dryrun_comment_${Date.now().toString(36)}`, dryRun: true };
  }
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: "v3", auth });
  const res = await yt.commentThreads.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        videoId: opts.videoId,
        topLevelComment: { snippet: { textOriginal: opts.text } },
      },
    },
  });
  const quota = await pickApiProject(QUOTA_COST.commentThreadsInsert);
  await chargeQuota({
    apiProjectId: quota.apiProjectId,
    channelId: opts.channelId,
    operation: "commentThreads.insert",
    units: QUOTA_COST.commentThreadsInsert,
    succeeded: true,
  });
  return { commentId: res.data.id ?? "", dryRun: false };
}

export async function listComments(opts: {
  channelId: string;
  videoId: string;
  max?: number;
}): Promise<
  Array<{
    externalId: string;
    authorName: string;
    authorChannelId?: string;
    text: string;
    likeCount: number;
    publishedAt: Date;
  }>
> {
  if (env.dryRunPublishing) return [];
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: "v3", auth });
  const res = await yt.commentThreads.list({
    part: ["snippet"],
    videoId: opts.videoId,
    maxResults: Math.min(opts.max ?? 100, 100),
    order: "relevance",
  });

  return (res.data.items ?? []).flatMap((item) => {
    const s = item.snippet?.topLevelComment?.snippet;
    if (!s || !item.id) return [];
    return [
      {
        externalId: item.id,
        authorName: s.authorDisplayName ?? "inconnu",
        authorChannelId: s.authorChannelId?.value ?? undefined,
        text: s.textOriginal ?? s.textDisplay ?? "",
        likeCount: Number(s.likeCount ?? 0),
        publishedAt: new Date(s.publishedAt ?? Date.now()),
      },
    ];
  });
}

export async function replyToComment(opts: {
  channelId: string;
  parentCommentId: string;
  text: string;
}): Promise<{ replyId: string; dryRun: boolean }> {
  if (env.dryRunPublishing) {
    return { replyId: `dryrun_reply_${Date.now().toString(36)}`, dryRun: true };
  }
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: "v3", auth });
  const res = await yt.comments.insert({
    part: ["snippet"],
    requestBody: { snippet: { parentId: opts.parentCommentId, textOriginal: opts.text } },
  });
  return { replyId: res.data.id ?? "", dryRun: false };
}

/* ==========================================================================
   Metrics
   ========================================================================== */

export interface VideoStats {
  views: number;
  likes: number;
  comments: number;
  durationMs: number;
}

/** `videos.list` costs 1 unit. Never use `search.list` for our own videos. */
export async function getVideoStats(opts: {
  channelId: string;
  videoIds: string[];
}): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  if (env.dryRunPublishing || opts.videoIds.length === 0) return out;

  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: "v3", auth });

  // 50 ids per call, still 1 unit — this is why the ledger stays cheap.
  for (let i = 0; i < opts.videoIds.length; i += 50) {
    const batch = opts.videoIds.slice(i, i + 50);
    const res = await yt.videos.list({
      part: ["statistics", "contentDetails"],
      id: batch,
      maxResults: 50,
    });
    for (const v of res.data.items ?? []) {
      if (!v.id) continue;
      out.set(v.id, {
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        comments: Number(v.statistics?.commentCount ?? 0),
        durationMs: parseIsoDuration(v.contentDetails?.duration ?? "PT0S"),
      });
    }
  }
  return out;
}

export interface AnalyticsRow {
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  shares: number;
  subscribersGained: number;
  likes: number;
  comments: number;
  videosAddedToPlaylists: number;
}

/**
 * YouTube Analytics: watch time, retention and traffic.
 *
 * This API has its own quota, separate from and far more generous than the Data
 * API's. Reading here instead of there is what makes per-post measurement at
 * fleet scale economically possible.
 */
export async function getVideoAnalytics(opts: {
  channelId: string;
  externalChannelId: string;
  videoId: string;
  startDate: string;
  endDate: string;
}): Promise<AnalyticsRow | null> {
  if (env.dryRunPublishing) return null;
  const auth = await clientForChannel(opts.channelId);
  const ytA = google.youtubeAnalytics({ version: "v2", auth });

  const res = await ytA.reports.query({
    ids: `channel==${opts.externalChannelId}`,
    startDate: opts.startDate,
    endDate: opts.endDate,
    metrics:
      "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,shares,subscribersGained,likes,comments,videosAddedToPlaylists",
    filters: `video==${opts.videoId}`,
  });

  const row = res.data.rows?.[0];
  if (!row) return null;
  const n = (i: number) => Number(row[i] ?? 0);
  return {
    views: n(0),
    estimatedMinutesWatched: n(1),
    averageViewDuration: n(2),
    averageViewPercentage: n(3),
    shares: n(4),
    subscribersGained: n(5),
    likes: n(6),
    comments: n(7),
    videosAddedToPlaylists: n(8),
  };
}

/**
 * Second-by-second audience retention.
 *
 * `audienceWatchRatio` is relative to the average video; `relativeRetentionPerformance`
 * compares to similar videos. We normalise the former to an absolute 0-1 share so
 * the darwinian engine can compare across videos of different lengths.
 */
export async function getRetentionCurve(opts: {
  channelId: string;
  externalChannelId: string;
  videoId: string;
  startDate: string;
  endDate: string;
}): Promise<Array<{ ratio: number; watched: number }>> {
  if (env.dryRunPublishing) return [];
  const auth = await clientForChannel(opts.channelId);
  const ytA = google.youtubeAnalytics({ version: "v2", auth });

  const res = await ytA.reports.query({
    ids: `channel==${opts.externalChannelId}`,
    startDate: opts.startDate,
    endDate: opts.endDate,
    metrics: "audienceWatchRatio",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${opts.videoId};audienceType==ORGANIC`,
    sort: "elapsedVideoTimeRatio",
  });

  const rows = res.data.rows ?? [];
  if (rows.length === 0) return [];

  // audienceWatchRatio is indexed to 1.0 at the start; renormalise to a share.
  const first = Number(rows[0]?.[1] ?? 1) || 1;
  return rows.map((r) => ({
    ratio: Number(r[0] ?? 0),
    watched: Math.max(0, Math.min(1, Number(r[1] ?? 0) / first)),
  }));
}

/** Cheap listing of a channel's own uploads: 1 unit, not 100. */
export async function listChannelUploads(opts: {
  channelId: string;
  uploadsPlaylistId: string;
  max?: number;
}): Promise<Array<{ videoId: string; title: string; publishedAt: Date }>> {
  if (env.dryRunPublishing) return [];
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: "v3", auth });
  const res = await yt.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId: opts.uploadsPlaylistId,
    maxResults: Math.min(opts.max ?? 50, 50),
  });
  return (res.data.items ?? []).flatMap((i) => {
    const id = i.contentDetails?.videoId;
    if (!id) return [];
    return [
      {
        videoId: id,
        title: i.snippet?.title ?? "",
        publishedAt: new Date(i.contentDetails?.videoPublishedAt ?? Date.now()),
      },
    ];
  });
}

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!m) return 0;
  return (
    (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000
  );
}

export type { youtube_v3 };
