import path from "node:path";

/**
 * Where generated media lives.
 *
 * It is the Remotion project's own `public/` directory, not the Next app's.
 *
 * Reason: Remotion serves its public folder under a content-hashed prefix and
 * `staticFile()` is the only reliable way to build those URLs. Keeping the media
 * inside the folder Remotion already owns means no `publicDir` override, no
 * copy step per render, and no class of bug where an asset resolves in the
 * studio but 404s in a headless render.
 *
 * The Next app serves the same files through `/generated/[...path]`, so a single
 * path string works in the renderer, in the dashboard and in an upload.
 */
/**
 * On Cloud Run the repository directory is read-only-ish and ephemeral either
 * way, so generation writes to `/tmp` and finished renders are copied to Cloud
 * Storage. `GENERATED_DIR` is how the container says so.
 */
export const GENERATED_ROOT = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.resolve(process.cwd(), "../video/public/generated");

/** Public URL for a file inside the generated root. */
export function generatedUrl(...segments: string[]): string {
  return `/generated/${segments.join("/")}`;
}

/** Absolute path for a file inside the generated root. */
export function generatedPath(...segments: string[]): string {
  return path.join(GENERATED_ROOT, ...segments);
}
