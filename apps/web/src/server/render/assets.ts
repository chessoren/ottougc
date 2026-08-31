import "server-only";

import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { GENERATED_ROOT } from "@/lib/paths";

/**
 * Local asset server for renders.
 *
 * Remotion *copies* the project's public folder into the bundle when it builds,
 * and `staticFile()` resolves against a snapshot taken at that moment. Media the
 * agents generate after that point simply is not in the bundle, which surfaced
 * as sporadic "could not play audio" failures whose real cause was a stale copy.
 *
 * So the renderer does not go through the bundle for media at all. It serves the
 * generated directory over HTTP and rewrites the timeline's root-relative paths
 * to absolute URLs against that origin. The same seam is what points at Cloud
 * Storage in production: only the base URL changes.
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
};

let server: Server | null = null;
let baseUrl: string | null = null;
let starting: Promise<string> | null = null;

export async function assetBaseUrl(): Promise<string> {
  // In production the media already lives behind a CDN and carries absolute URLs.
  if (process.env.ASSET_BASE_URL) return process.env.ASSET_BASE_URL;
  if (baseUrl) return baseUrl;
  if (starting) return starting;

  starting = new Promise<string>((resolve, reject) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const rel = decodeURIComponent(url.pathname).replace(/^\/generated\//, "");
      const target = path.resolve(GENERATED_ROOT, rel);

      if (!target.startsWith(GENERATED_ROOT + path.sep)) {
        res.writeHead(400).end("Chemin invalide");
        return;
      }

      let stat;
      try {
        stat = statSync(target);
      } catch {
        res.writeHead(404).end("Introuvable");
        return;
      }
      if (!stat.isFile()) {
        res.writeHead(404).end("Introuvable");
        return;
      }

      const type = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      const range = req.headers.range;

      // Chromium requests media with Range headers and will refuse to decode a
      // response that ignores them — this is what makes <Audio> and <Video> work.
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m?.[1] ? Number(m[1]) : 0;
        const end = m?.[2] ? Number(m[2]) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
          return;
        }
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        createReadStream(target, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
      });
      createReadStream(target).pipe(res);
    });

    server.on("error", reject);
    // Port 0 lets the OS pick a free one, so parallel workers never collide.
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (typeof address === "string" || !address) {
        reject(new Error("Could not determine the asset server port."));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve(baseUrl);
    });
    server.unref();
  });

  return starting;
}

export async function stopAssetServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  baseUrl = null;
  starting = null;
}

/** Rewrite every `/generated/...` reference in a timeline to an absolute URL. */
export function absolutiseTimeline<T>(timeline: T, base: string): T {
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.startsWith("/generated/") ? `${base}${value}` : value;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewrite(v);
      return out;
    }
    return value;
  };
  return rewrite(timeline) as T;
}
