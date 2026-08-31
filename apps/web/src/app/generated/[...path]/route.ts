import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { GENERATED_ROOT } from "@/lib/paths";

/**
 * Serve generated media.
 *
 * The files live in the Remotion project's public folder (see `lib/paths.ts`),
 * which Next.js does not serve. This route bridges the two so a single URL works
 * in the renderer, in the dashboard and in a YouTube upload.
 *
 * Range requests are honoured because the dashboard plays these MP4s inline, and
 * a browser cannot scrub a video the server will only send whole.
 */

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".json": "application/json",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  // Resolve, then verify containment: a caller must not be able to escape the
  // generated directory with "..", however the segments were assembled.
  const target = path.resolve(GENERATED_ROOT, ...segments);
  if (!target.startsWith(GENERATED_ROOT + path.sep)) {
    return new Response("Chemin invalide", { status: 400 });
  }

  let stat;
  try {
    stat = statSync(target);
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Introuvable", { status: 404 });

  const contentType = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range");

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      return new Response("Plage invalide", {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const stream = createReadStream(target, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const stream = createReadStream(target);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
