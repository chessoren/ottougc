import { collectBrandImages, findImages, type BrandImage } from "./brand-images";

import "server-only";

/**
 * Site crawler.
 *
 * Reads a company's own website and returns the raw material a brief is built
 * from. One page is rarely enough: the home page carries the positioning, but
 * the pricing page carries the numbers, the about page carries the founder
 * story, and the FAQ carries the objections — which are the four things a
 * scriptwriter actually needs.
 *
 * Deliberately conservative. It follows same-origin links only, caps the crawl,
 * obeys a short timeout per page, and never executes JavaScript. A marketing
 * site that renders nothing without JS yields a thin brief, and the onboarding
 * says so rather than inventing the difference.
 */

export interface ScrapedPage {
  url: string;
  kind: PageKind;
  title: string;
  description: string;
  headings: string[];
  paragraphs: string[];
  /** Prices, percentages, durations — anything a claim could be built on. */
  figures: string[];
  /** Question/answer pairs, which map directly onto objections. */
  faqs: Array<{ question: string; answer: string }>;
  /** Quoted text, which is where testimonials live. */
  quotes: string[];
  /** Visible call-to-action labels. */
  ctas: string[];
  /**
   * Pictures this page publishes, not yet downloaded.
   *
   * Collected during the crawl because the markup around an image — its alt
   * text, its class names, its position — is the only signal for what it is of,
   * and that context is gone by the time the file has been fetched.
   */
  imageCandidates: Array<Omit<BrandImage, "url" | "bytes">>;
  wordCount: number;
}

export type PageKind =
  | "HOME"
  | "PRICING"
  | "ABOUT"
  | "FAQ"
  | "FEATURES"
  | "BLOG"
  | "CUSTOMERS"
  | "OTHER";

export interface CrawlResult {
  origin: string;
  pages: ScrapedPage[];
  /** The brand's own pictures, downloaded and kept. */
  images: BrandImage[];
  /** Everything that went wrong, so the UI can be honest about coverage. */
  problems: string[];
  /** True when the site appears to require JavaScript to render its copy. */
  needsJavascript: boolean;
  durationMs: number;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MAX_PAGES = 8;
const PAGE_TIMEOUT_MS = 9000;
const TOTAL_TIMEOUT_MS = 35000;

/**
 * Paths worth following, in the order they matter to a brief.
 *
 * Matched against the URL **path** first and the link text only as a fallback.
 * Link text is unreliable: a card linking to a customer story often reads
 * "See how they ship faster", which matches nothing useful, while a nav item
 * reading "Product" links to five different places.
 */
const PRIORITY_PATTERNS: Array<{ kind: PageKind; path: RegExp; text?: RegExp; weight: number }> = [
  { kind: "PRICING", path: /\/(pricing|price|plans|tarifs?)(\/|$)/i, text: /^pricing$|^plans$|^tarifs?$/i, weight: 10 },
  { kind: "FAQ", path: /\/(faq|help|support|questions)(\/|$)/i, text: /^faq$|^help$/i, weight: 9 },
  { kind: "ABOUT", path: /\/(about|about-us|story|company|manifesto|mission|qui-sommes-nous|a-propos)(\/|$)/i, text: /^about( us)?$|^our story$/i, weight: 8 },
  { kind: "FEATURES", path: /\/(features?|product|how-it-works|platform|solutions?|fonctionnalites?)(\/|$)/i, text: /^features?$|^how it works$/i, weight: 7 },
  { kind: "CUSTOMERS", path: /\/(customers?|case-stud(y|ies)|testimonials?|reviews|clients?)(\/|$)/i, text: /^customers$|^case stud/i, weight: 6 },
  { kind: "BLOG", path: /\/(blog|changelog|news|posts?)(\/|$)/i, weight: 1 },
];

export async function crawlSite(rawUrl: string): Promise<CrawlResult> {
  const started = Date.now();
  const problems: string[] = [];
  const origin = normaliseUrl(rawUrl);

  if (!origin) {
    return {
      origin: rawUrl,
      pages: [],
      images: [],
      problems: ["Not a valid URL."],
      needsJavascript: false,
      durationMs: 0,
    };
  }

  const home = await fetchPage(origin);
  if (!home.ok) {
    return {
      origin,
      pages: [],
      images: [],
      problems: [home.error ?? "The site could not be reached."],
      needsJavascript: false,
      durationMs: Date.now() - started,
    };
  }

  const pages: ScrapedPage[] = [parsePage(origin, home.html!, "HOME")];
  const visited = new Set([canonical(origin)]);

  // Rank the internal links by how much a brief needs them, then take the best.
  const candidates = extractLinks(home.html!, origin)
    .filter((link) => !visited.has(canonical(link.url)))
    .map((link) => {
      let path = "";
      try {
        path = new URL(link.url).pathname;
      } catch {
        path = link.url;
      }
      // A deep path under a section is a leaf, not the section itself: we want
      // /customers, not /customers/acme, because the index carries the summary.
      const depth = path.split("/").filter(Boolean).length;
      const match =
        PRIORITY_PATTERNS.find((p) => p.path.test(path)) ??
        PRIORITY_PATTERNS.find((p) => p.text?.test(link.text.trim()));
      const weight = match ? match.weight - (depth > 1 ? 3 : 0) : 0;
      return { ...link, kind: match?.kind ?? ("OTHER" as PageKind), weight };
    })
    .filter((link) => link.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // One page per kind: five pricing pages tell us nothing five times.
  const seenKinds = new Set<PageKind>(["HOME"]);
  for (const candidate of candidates) {
    if (pages.length >= MAX_PAGES) break;
    if (Date.now() - started > TOTAL_TIMEOUT_MS) {
      problems.push("Crawl stopped early — the site was slow to respond.");
      break;
    }
    if (seenKinds.has(candidate.kind)) continue;

    const key = canonical(candidate.url);
    if (visited.has(key)) continue;
    visited.add(key);

    const page = await fetchPage(candidate.url);
    if (!page.ok || !page.html) {
      problems.push(`${candidate.url} — ${page.error ?? "unreachable"}`);
      continue;
    }
    const parsed = parsePage(candidate.url, page.html, candidate.kind);
    if (parsed.wordCount < 40) continue;
    pages.push(parsed);
    seenKinds.add(candidate.kind);
  }

  const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);
  const needsJavascript = totalWords < 120;
  if (needsJavascript) {
    problems.push(
      "The site returned almost no text without JavaScript, so very little could be read automatically.",
    );
  }

  // Download the pictures last, once every page has been read: the same social
  // card appears on every page, and deduplication only works across the whole
  // crawl.
  let images: BrandImage[] = [];
  try {
    const seen = new Set<string>();
    const candidates = pages
      .flatMap((page) => page.imageCandidates)
      .filter((candidate) => {
        if (seen.has(candidate.sourceUrl)) return false;
        seen.add(candidate.sourceUrl);
        return true;
      });
    images = await collectBrandImages(candidates, slugOf(origin));
    if (images.length === 0 && candidates.length > 0) {
      problems.push("Pictures were found but none could be downloaded.");
    }
  } catch {
    problems.push("The site's pictures could not be collected.");
  }

  return { origin, pages, images, problems, needsJavascript, durationMs: Date.now() - started };
}

/** A stable folder name per site, so a re-crawl overwrites rather than piles up. */
function slugOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-");
  } catch {
    return "brand";
  }
}

/* ── Fetch ───────────────────────────────────────────────────────────────── */

async function fetchPage(url: string): Promise<{ ok: boolean; html?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(timer);

    if (!res.ok) return { ok: false, error: `responded ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return { ok: false, error: "not an HTML page" };

    return { ok: true, html: await res.text() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.name === "AbortError" ? "timed out" : "unreachable",
    };
  }
}

/* ── Parse ───────────────────────────────────────────────────────────────── */

function parsePage(url: string, html: string, kind: PageKind): ScrapedPage {
  const stripped = html
    // Line breaks inside headings must become spaces, not disappear, or
    // "Intake<br/>and integrations" collapses into one word.
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // Navigation and footers are the same on every page and carry no positioning.
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");

  // Every capture is de-tagged: a paragraph containing a nested <span> or <div>
  // otherwise arrives with markup inside it and poisons everything downstream.
  const text_ = (raw: string) => clean(raw.replace(/<[^>]+>/g, " "));

  const headings = [...stripped.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => text_(m[2] ?? ""))
    .filter((t) => t.length > 2 && t.length < 200);

  const paragraphs = [...stripped.matchAll(/<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)]
    .map((m) => text_(m[1] ?? ""))
    .filter((t) => t.length > 25 && t.length < 600);

  const ctas = [...stripped.matchAll(/<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)]
    .map((m) => text_(m[1] ?? ""))
    .filter((t) => t.length > 2 && t.length < 40 && /[a-z]/i.test(t));

  const text = clean(stripped.replace(/<[^>]+>/g, " "));

  return {
    url,
    kind,
    title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
    description: metaContent(html, "description") || metaContent(html, "og:description"),
    headings: dedupe(headings).slice(0, 30),
    paragraphs: dedupe(paragraphs).slice(0, 40),
    figures: extractFigures(text),
    faqs: extractFaqs(headings, paragraphs),
    quotes: extractQuotes(stripped),
    ctas: dedupe(ctas).slice(0, 12),
    imageCandidates: findImages(html, url),
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Pull out anything numeric.
 *
 * These become the only claims an agent is allowed to make. Everything else in
 * the brief is prose; these are the sentences that can be contradicted, so they
 * are surfaced separately for the founder to confirm one by one.
 */
function extractFigures(text: string): string[] {
  const patterns = [
    /[€$£]\s?\d[\d\s.,]*(?:\s?(?:\/|per\s)?(?:mo|month|year|yr|user|seat|mois|an))?/gi,
    /\b\d+(?:[.,]\d+)?\s?%/g,
    /\b\d+(?:[.,]\d+)?\s?(?:x|×)\b/gi,
    /\b\d+\s?(?:seconds?|minutes?|hours?|days?|weeks?|months?|secondes?|minutes?|heures?|jours?)\b/gi,
    /\b\d[\d\s.,]*\+?\s?(?:users?|customers?|companies|teams|utilisateurs?|clients?)\b/gi,
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = clean(match[0]);
      // A bare year is never a claim, and every site is full of them.
      if (/^\d{4}$/.test(value)) continue;
      const context = withContext(text, match.index ?? 0, value);
      // CSS-in-JS leaks into the text of many modern sites; a fragment carrying
      // braces or custom properties is stylesheet, not a claim.
      if (/[{}]|:host|var\(--|@media|px\)|calc\(/.test(context)) continue;
      found.push(context);
    }
  }
  return dedupe(found).slice(0, 25);
}

/**
 * A figure alone is meaningless; the surrounding clause is what makes it a claim.
 *
 * The window is snapped to a sentence boundary where one exists, and page chrome
 * ("Skip to content", "Get started") is cut off the front — a claim beginning
 * with a navigation label reads as noise and nobody will confirm it.
 */
const CHROME = /(?:skip to (?:content|main)|get started|sign in|log in|menu|→|›)/gi;

function withContext(text: string, index: number, value: string): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + value.length + 90);
  let window = text.slice(start, end);

  // Start after the last sentence break before the figure, when there is one.
  const before = window.slice(0, index - start);
  const breakAt = Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "));
  if (breakAt > 0) window = window.slice(breakAt + 2);

  return clean(window.replace(CHROME, " ")).replace(/^[^A-Za-z0-9€$£]+/, "");
}

function extractFaqs(
  headings: string[],
  paragraphs: string[],
): Array<{ question: string; answer: string }> {
  const out: Array<{ question: string; answer: string }> = [];
  for (const [i, heading] of headings.entries()) {
    if (!/\?$/.test(heading)) continue;
    const answer = paragraphs.find((p) => p.length > 40) ?? "";
    out.push({ question: heading, answer: answer.slice(0, 400) });
    if (out.length >= 12) break;
    void i;
  }
  return out;
}

function extractQuotes(html: string): string[] {
  const blockquotes = [...html.matchAll(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi)].map((m) =>
    clean((m[1] ?? "").replace(/<[^>]+>/g, " ")),
  );
  const curly = [...html.matchAll(/[“"]([^”"]{40,300})[”"]/g)].map((m) => clean(m[1] ?? ""));
  return dedupe([...blockquotes, ...curly]).slice(0, 10);
}

/* ── Links ───────────────────────────────────────────────────────────────── */

function extractLinks(html: string, base: string): Array<{ url: string; text: string }> {
  const origin = new URL(base).origin;
  const out: Array<{ url: string; text: string }> = [];

  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1] ?? "";
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;

    try {
      const resolved = new URL(href, base);
      if (resolved.origin !== origin) continue;
      if (/\.(pdf|zip|png|jpe?g|svg|mp4|webm|css|js)$/i.test(resolved.pathname)) continue;
      resolved.hash = "";
      out.push({ url: resolved.toString(), text: clean((match[2] ?? "").replace(/<[^>]+>/g, " ")) });
    } catch {
      // A malformed href is not worth reporting.
    }
  }
  return out;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function canonical(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function metaContent(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0] ?? "";
  return clean(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
}

function clean(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
