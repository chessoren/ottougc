import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GENERATED_ROOT } from "@/lib/paths";

/**
 * The brand's own pictures, pulled off its own site.
 *
 * A video about a product that never shows the product is a video about nothing,
 * and generating an imaginary interface is worse than showing none: the shot
 * that came back with a fabricated Shopify dashboard is exactly the failure this
 * avoids. Whatever a company already publishes about itself — its screenshots,
 * its social card, its hero image — is real, is cleared for use, and looks like
 * the product because it *is* the product.
 *
 * They serve three purposes downstream:
 *   - as inserts in a video, where a proof beat needs something true on screen,
 *   - as the reference for a storyboard panel that has to show the product,
 *   - as the placeholder set for a demo, so a brand-new account is not empty.
 */

export interface BrandImage {
  /** Local path under /generated, ready for the renderer and the dashboard. */
  url: string;
  sourceUrl: string;
  width?: number;
  height?: number;
  bytes: number;
  kind: BrandImageKind;
  /** Alt text or the surrounding heading — what this picture is of. */
  caption?: string;
}

export type BrandImageKind =
  /** The social card. Almost always the best single picture a site has. */
  | "SOCIAL_CARD"
  /** A screenshot of the product interface. */
  | "SCREENSHOT"
  /** A large picture near the top of a page. */
  | "HERO"
  | "LOGO"
  | "OTHER";

const MAX_IMAGES = 12;
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Find the pictures worth keeping in one page's HTML.
 *
 * Deliberately conservative. A marketing page carries dozens of icons, avatars
 * and decorative blobs; almost none of them belong in a video. The filters below
 * are ordered by how reliably they identify something real.
 */
export function findImages(html: string, pageUrl: string): Array<Omit<BrandImage, "url" | "bytes">> {
  const found: Array<Omit<BrandImage, "url" | "bytes">> = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined, kind: BrandImageKind, caption?: string) => {
    if (!raw) return;
    const absolute = absolutise(raw, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    if (!isUsable(absolute)) return;
    seen.add(absolute);
    found.push({ sourceUrl: absolute, kind, caption: caption?.trim() || undefined });
  };

  // 1. The social card. A company chose this picture to represent itself.
  for (const property of ["og:image", "twitter:image", "twitter:image:src"]) {
    const match = html.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"),
    );
    push(match?.[1], "SOCIAL_CARD");
  }

  // 2. Everything else, classified by what the markup says about it.
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imgTags) {
    const src =
      attr(tag, "src") ??
      // Lazy-loaded images keep the real URL out of `src` until scroll.
      attr(tag, "data-src") ??
      firstFromSrcset(attr(tag, "srcset") ?? attr(tag, "data-srcset"));
    const alt = attr(tag, "alt");
    const width = Number(attr(tag, "width") ?? 0);

    if (width && width < 200) continue; // an icon
    push(src, classify(src ?? "", alt ?? "", tag), alt);
  }

  return found.slice(0, MAX_IMAGES * 2);
}

function classify(src: string, alt: string, tag: string): BrandImageKind {
  const haystack = `${src} ${alt} ${tag}`.toLowerCase();
  if (/logo|wordmark|brandmark/.test(haystack)) return "LOGO";
  if (/screenshot|screen-|dashboard|app-|ui-|interface|product-shot|preview/.test(haystack)) {
    return "SCREENSHOT";
  }
  if (/hero|banner|header|cover/.test(haystack)) return "HERO";
  return "OTHER";
}

/**
 * Reject what cannot be used, before spending a request on it.
 *
 * SVG is excluded deliberately: it is almost always an icon, and the image
 * models refuse it as a reference anyway.
 */
function isUsable(url: string): boolean {
  if (!/^https?:/i.test(url)) return false;
  if (/\.svg(\?|$)/i.test(url)) return false;
  if (/\.(gif|ico|bmp)(\?|$)/i.test(url)) return false;
  if (/sprite|icon-|favicon|avatar|placeholder|pixel|tracking|spacer/i.test(url)) return false;
  return true;
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1];
}

/** `srcset` is "url 1x, url 2x" — take the first, which is the smallest. */
function firstFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  return srcset.split(",")[0]?.trim().split(/\s+/)[0];
}

function absolutise(raw: string, pageUrl: string): string | null {
  try {
    return new URL(raw.trim(), pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Download the pictures and keep the ones that turn out to be worth keeping.
 *
 * Size is the filter that markup cannot provide: a company's own screenshots are
 * large files, and the 40 KB thing labelled `hero-bg` is a gradient. Ranking by
 * kind first and bytes second surfaces the real product shots.
 */
export async function collectBrandImages(
  candidates: Array<Omit<BrandImage, "url" | "bytes">>,
  brandSlug: string,
): Promise<BrandImage[]> {
  const priority: Record<BrandImageKind, number> = {
    SCREENSHOT: 0,
    SOCIAL_CARD: 1,
    HERO: 2,
    OTHER: 3,
    LOGO: 4,
  };
  const ordered = [...candidates].sort((a, b) => priority[a.kind] - priority[b.kind]);

  const dir = path.join(GENERATED_ROOT, "brand", brandSlug);
  await mkdir(dir, { recursive: true });

  const kept: BrandImage[] = [];

  for (const candidate of ordered) {
    if (kept.length >= MAX_IMAGES) break;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(candidate.sourceUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/") || type.includes("svg")) continue;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) continue;
      // Under 12 KB is a gradient, a divider or a tracking pixel that lied about
      // its content type.
      if (buffer.length < 12_000 && candidate.kind !== "LOGO") continue;

      const dimensions = measure(buffer);
      if (dimensions.width && dimensions.width < 320 && candidate.kind !== "LOGO") continue;

      const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      const id = createHash("sha1").update(candidate.sourceUrl).digest("hex").slice(0, 16);
      await writeFile(path.join(dir, `${id}.${extension}`), buffer);

      kept.push({
        ...candidate,
        url: `/generated/brand/${brandSlug}/${id}.${extension}`,
        bytes: buffer.length,
        ...dimensions,
      });
    } catch {
      // A picture that will not download is not a reason to fail an onboarding.
    }
  }

  return kept;
}

/** Dimensions from the file header, without decoding the whole image. */
function measure(buffer: Buffer): { width?: number; height?: number } {
  // PNG: IHDR is always the first chunk.
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  // JPEG: walk the segment markers to the first frame header.
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1]!;
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return {};
}
