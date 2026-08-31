import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { channels } from "@/server/db/schema";
import { exchangeCode } from "@/server/integrations/youtube";

export const dynamic = "force-dynamic";

/**
 * Complete the YouTube consent flow.
 *
 * Binds the returned tokens to a channel row. If the brand already has a
 * placeholder in that slot it is filled in; otherwise a new channel is created.
 * Re-connecting a channel that already exists updates its tokens rather than
 * duplicating it, which is what happens every time a refresh token expires under
 * an unverified OAuth app.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (message: string, ok = false) =>
    Response.redirect(
      `${env.appUrl}/dashboard/channels?${ok ? "connected" : "error"}=${encodeURIComponent(message)}`,
      302,
    );

  const error = url.searchParams.get("error");
  if (error) return back(`Authorisation was declined (${error}).`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("Incomplete OAuth response.");

  const jar = await cookies();
  const expected = jar.get("ottougc_oauth_state")?.value;
  if (!expected || expected !== state) {
    return back("Invalid OAuth state. Start the connection again from the dashboard.");
  }
  jar.delete("ottougc_oauth_state");

  const [, brandId, slotRaw] = state.split(".");
  if (!brandId) return back("Malformed OAuth state.");
  const slot = Number(slotRaw ?? 0);

  try {
    const connected = await exchangeCode(code);

    // Already connected somewhere? Refresh in place.
    const [existing] = await db
      .select({ id: channels.id, brandId: channels.brandId })
      .from(channels)
      .where(and(eq(channels.platform, "YOUTUBE"), eq(channels.externalId, connected.externalId)))
      .limit(1);

    const values = {
      externalId: connected.externalId,
      handle: connected.handle ?? connected.title.toLowerCase().replace(/\s+/g, "_").slice(0, 40),
      title: connected.title,
      description: connected.description,
      thumbnailUrl: connected.thumbnailUrl,
      refreshToken: connected.refreshToken,
      accessToken: connected.accessToken,
      accessTokenExpiresAt: connected.accessTokenExpiresAt,
      grantedScopes: connected.grantedScopes,
      subscriberCount: connected.subscriberCount,
      viewCount: connected.viewCount,
      videoCount: connected.videoCount,
      // A freshly connected channel starts warming, never at full cadence: a
      // brand-new channel publishing twice a day on day one reads as automated.
      status: "WARMING" as const,
      warmingDay: 1,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(channels).set(values).where(eq(channels.id, existing.id));
      return back(`Reconnected “${connected.title}”.`, true);
    }

    // Fill the placeholder in this slot if there is one.
    const [placeholder] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          eq(channels.brandId, brandId),
          eq(channels.status, "PENDING_AUTH"),
          eq(channels.slotIndex, slot),
        ),
      )
      .limit(1);

    if (placeholder) {
      await db.update(channels).set(values).where(eq(channels.id, placeholder.id));
    } else {
      await db.insert(channels).values({ brandId, platform: "YOUTUBE", slotIndex: slot, ...values });
    }

    return back(`Connected “${connected.title}”.`, true);
  } catch (err) {
    return back(err instanceof Error ? err.message : "Connection failed.");
  }
}
