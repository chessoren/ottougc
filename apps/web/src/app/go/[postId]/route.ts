import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { attributionEvents, brands, posts } from "@/server/db/schema";

export const dynamic = "force-dynamic";

/**
 * Tracked redirect.
 *
 * Every video's description and pinned comment point here rather than straight
 * at the brand's site, which is what turns "we got some traffic" into "video 47
 * on the sceptic channel produced eleven signups". The redirect stamps UTM
 * parameters, records the click, and gets out of the way.
 *
 * Privacy: no IP is stored and no third-party identifier is set. The visitor id
 * is a random value in a first-party cookie whose only purpose is to let a later
 * signup be joined back to the click that produced it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;

  const [post] = await db
    .select({
      id: posts.id,
      brandId: posts.brandId,
      channelId: posts.channelId,
      utmContent: posts.utmContent,
      targetUrl: brands.targetUrl,
      slug: brands.slug,
    })
    .from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post?.targetUrl) {
    return Response.redirect(new URL("/", request.url), 302);
  }

  const destination = new URL(post.targetUrl);
  destination.searchParams.set("utm_source", "youtube");
  destination.searchParams.set("utm_medium", "ugc_studio");
  destination.searchParams.set("utm_campaign", post.slug);
  if (post.utmContent) destination.searchParams.set("utm_content", post.utmContent);

  const jar = await cookies();
  let visitorId = jar.get("ottougc_vid")?.value;
  if (!visitorId) {
    visitorId = randomBytes(12).toString("hex");
    jar.set("ottougc_vid", visitorId, {
      httpOnly: false, // the brand's own site reads it to attribute a signup
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  await db.insert(attributionEvents).values({
    brandId: post.brandId,
    postId: post.id,
    channelId: post.channelId,
    kind: "CLICK",
    utmSource: "youtube",
    utmMedium: "ugc_studio",
    utmCampaign: post.slug,
    utmContent: post.utmContent,
    visitorId,
    country: request.headers.get("x-vercel-ip-country") ?? undefined,
    userAgent: request.headers.get("user-agent")?.slice(0, 500),
    referrer: request.headers.get("referer")?.slice(0, 500),
  });

  await db
    .update(posts)
    .set({ linkClicks: sql`${posts.linkClicks} + 1`, updatedAt: new Date() })
    .where(eq(posts.id, post.id));

  // Passed through so a signup on the brand's side can be joined back to this
  // click without any third-party cookie.
  destination.searchParams.set("ottougc_vid", visitorId);

  if (new URL(request.url).searchParams.has("debug")) {
    return Response.json({ destination: destination.toString(), visitorId });
  }
  return Response.redirect(destination.toString(), 302);
}
