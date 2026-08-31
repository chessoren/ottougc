import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { buildAuthUrl } from "@/server/integrations/youtube";

export const dynamic = "force-dynamic";

/**
 * Begin the YouTube consent flow.
 *
 * The `state` parameter carries the brand and slot the channel will occupy, and
 * is mirrored into a signed-ish cookie so the callback can reject a state it did
 * not issue — the standard CSRF defence for OAuth, and the reason we do not read
 * the brand id straight out of the query string on return.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brandId");
  const slot = url.searchParams.get("slot") ?? "0";

  if (!brandId) {
    return new Response("Missing brandId.", { status: 400 });
  }

  if (!env.youtube.clientId || !env.youtube.clientSecret) {
    return Response.redirect(
      `${env.appUrl}/dashboard/channels?error=${encodeURIComponent(
        "YouTube OAuth isn't configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (see docs/SETUP.md, section 4).",
      )}`,
      302,
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const state = `${nonce}.${brandId}.${slot}`;

  const jar = await cookies();
  jar.set("ottougc_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 600,
  });

  return Response.redirect(buildAuthUrl(state), 302);
}
