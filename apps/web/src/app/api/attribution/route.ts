import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { attributionEvents, brands, posts } from "@/server/db/schema";

export const dynamic = "force-dynamic";

/**
 * Conversion callback.
 *
 * The brand's own app calls this when a visitor signs up, passing back the
 * `ottougc_vid` it received on the tracked redirect. That single call is what
 * closes the loop from a view to a signup, and therefore what makes the T+72h
 * checkpoint mean anything.
 *
 *   POST /api/attribution
 *   { "brandSlug": "…", "visitorId": "…", "kind": "SIGNUP", "valueUsd": 0 }
 */
export async function POST(request: Request) {
  let body: {
    brandSlug?: string;
    visitorId?: string;
    kind?: string;
    valueUsd?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const { brandSlug, visitorId } = body;
  const kind = (body.kind ?? "SIGNUP").toUpperCase();

  if (!brandSlug || !visitorId) {
    return Response.json({ error: "brandSlug et visitorId sont requis." }, { status: 400 });
  }
  if (!["SIGNUP", "ACTIVATION", "PURCHASE"].includes(kind)) {
    return Response.json({ error: `Type inconnu : ${kind}` }, { status: 400 });
  }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.slug, brandSlug))
    .limit(1);
  if (!brand) return Response.json({ error: "Marque inconnue." }, { status: 404 });

  // Last-click attribution: find the most recent click from this visitor.
  const [click] = await db
    .select({ postId: attributionEvents.postId, channelId: attributionEvents.channelId })
    .from(attributionEvents)
    .where(
      and(
        eq(attributionEvents.brandId, brand.id),
        eq(attributionEvents.visitorId, visitorId),
        eq(attributionEvents.kind, "CLICK"),
      ),
    )
    .orderBy(desc(attributionEvents.createdAt))
    .limit(1);

  await db.insert(attributionEvents).values({
    brandId: brand.id,
    postId: click?.postId ?? null,
    channelId: click?.channelId ?? null,
    kind,
    visitorId,
    valueUsd: body.valueUsd !== undefined ? String(body.valueUsd) : null,
  });

  if (click?.postId && kind === "SIGNUP") {
    await db
      .update(posts)
      .set({ signups: sql`${posts.signups} + 1`, updatedAt: new Date() })
      .where(eq(posts.id, click.postId));
  }

  return Response.json({
    ok: true,
    attributed: Boolean(click?.postId),
    postId: click?.postId ?? null,
  });
}
