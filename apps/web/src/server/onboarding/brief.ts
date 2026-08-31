import "server-only";

import { getBrain, DEGRADED_MARKER } from "@/server/llm/client";

import type { CrawlResult, ScrapedPage } from "./scraper";

/**
 * The company brief.
 *
 * Everything a scriptwriter needs, extracted from the company's own site and
 * handed back to the founder to correct rather than compose. That inversion is
 * the whole design of the onboarding: nobody finishes a thirty-field form, and
 * everybody will fix six sentences that are almost right about their own
 * business.
 *
 * Every field carries where it came from. A founder correcting a claim needs to
 * see the sentence on their site that produced it, or they cannot tell whether
 * we misread them or they wrote it badly.
 */

export interface BriefField<T = string> {
  value: T;
  /** Where this came from, shown next to the field. */
  source: string;
  /** How much we trust it. Low-confidence fields are asked about explicitly. */
  confidence: "high" | "medium" | "low";
}

export interface Claim {
  text: string;
  /** The sentence on their site this was read from. */
  quote: string;
  /** Claims start unconfirmed. Only confirmed claims may ever be said on camera. */
  confirmed: boolean;
}

export interface CompanyBrief {
  /**
   * The brand's own pictures, already downloaded.
   *
   * Kept on the brief rather than fetched later so the onboarding can show them
   * back — "here is what we found" is far more convincing than a progress bar —
   * and so a video that needs to show the product has something true to show.
   */
  images: import("./brand-images").BrandImage[];
  name: BriefField;
  /** One plain sentence. No adjectives, no category words. */
  whatItDoes: BriefField;
  /** Who this is for, as a person rather than a segment. */
  audience: BriefField;
  /** The chore it removes, described as a moment. */
  chore: BriefField;
  /** What they did before. The antagonist of half the scenarios. */
  oldWay: BriefField;
  /** The instant of relief. What we film. */
  reliefMoment: BriefField;
  /** Numbers found on the site. Each must be confirmed before it can be used. */
  claims: Claim[];
  /** What a sceptic says, in their words. */
  objections: string[];
  /** Words their community uses. */
  vocabulary: string[];
  /** What a visitor arriving from a video is offered. */
  offer: BriefField;
  /** The one line the site leads with, in the site's own words. */
  headline: BriefField;
  /** What it costs, as the site states it. Never inferred. */
  pricing: BriefField;
  /** Things the agents must never say. */
  forbidden: string[];
  /** What the site could not tell us, phrased as questions to ask. */
  gaps: BriefGap[];
  /** Pages actually read. Shown so the founder knows what we looked at. */
  sources: Array<{ url: string; kind: string; words: number }>;
  /** True when a model read the site. False means this is a shallow reading. */
  deep: boolean;
}

/**
 * A question the site could not answer.
 *
 * Each one offers choices wherever possible: picking from four options is a tap,
 * writing a sentence is work, and the difference decides whether an onboarding
 * gets finished.
 */
export interface BriefGap {
  id: string;
  question: string;
  /** Why we are asking. One line. Answers "can I skip this?". */
  why: string;
  kind: "choice" | "short" | "long";
  choices?: string[];
  /**
   * The model's own answer, from the site, pre-filled in the field.
   *
   * A question is not the same thing as a blank. Reading the whole site and then
   * handing back an empty text box is asking the founder to do the work twice —
   * they wrote the site. So the model answers its own questions from what it
   * read, the answer arrives in the box already, and the founder's job is to
   * correct it or press enter. That is the difference between an onboarding that
   * finishes and one that does not.
   */
  suggestion?: string;
  /** Where in the site the suggestion came from, so it can be judged. */
  suggestionSource?: string;
  /** Blocks completion. Kept to a handful. */
  required: boolean;
}

const BRIEF_SYSTEM = `
You read a company's own website and translate its marketing into the raw
material a short-form scriptwriter needs.

You are not summarising the site. You are translating it out of marketing
language and into the way a customer would actually describe their day.

RULES
- Write in English, plain and spoken. Second person where natural.
- ANSWER YOUR OWN QUESTIONS. Every gap you raise must carry a "suggestion": your
  best answer, from what you read. You have just read the whole site; handing
  back an empty box asks the founder to do work they already did. A wrong guess
  they correct in three seconds is worth more than a blank they have to fill.
- "headline" is the site's leading line quoted as written. "pricing" is what it
  costs, exactly as stated, or empty if the site never says. Never estimate a
  price.
- Every field is one short sentence. No adjectives that could apply to any
  company ("powerful", "seamless", "innovative").
- "chore" must be a MOMENT, not a category. Not "saves time on reporting" but
  "it's 11pm on Sunday and the report still isn't started".
- "reliefMoment" is the instant something stops being a problem. That is what
  gets filmed, so it must be visual.
- NEVER invent a number. Every entry in "claims" must quote the sentence on the
  site it came from, verbatim, in "quote".
- "objections" are what a sceptical prospect actually thinks, in their words,
  with the original bad faith intact.
- "gaps" lists what the site does not tell you. Ask about it as a real question.
  Give "choices" whenever the answer is likely to be one of a few options —
  tapping beats typing.

Return JSON matching the schema. Nothing else.
`.trim();

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    whatItDoes: { type: "string" },
    audience: { type: "string" },
    chore: { type: "string" },
    oldWay: { type: "string" },
    reliefMoment: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, quote: { type: "string" } },
        required: ["text", "quote"],
      },
    },
    objections: { type: "array", items: { type: "string" } },
    vocabulary: { type: "array", items: { type: "string" } },
    offer: { type: "string" },
    headline: {
      type: "string",
      description: "The site's own leading line, quoted as written. Not your paraphrase of it.",
    },
    pricing: {
      type: "string",
      description:
        "What it costs, exactly as the site states it — '$29/month, 14-day trial'. Empty string if the site never says. Never estimate a price.",
    },
    forbidden: { type: "array", items: { type: "string" } },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          why: { type: "string" },
          kind: { type: "string", enum: ["choice", "short", "long"] },
          choices: { type: "array", items: { type: "string" } },
          suggestion: {
            type: "string",
            description:
              "YOUR OWN ANSWER to this question, drawn from the site. Required. Never leave it empty: a best guess the founder can correct in three seconds beats a blank box every time. For a 'choice' question it must be one of the choices, word for word.",
          },
          suggestionSource: {
            type: "string",
            description: "Where on the site you got it — 'pricing page', 'home hero', or 'inferred' when you reasoned it out.",
          },
        },
        required: ["id", "question", "why", "kind", "suggestion"],
      },
    },
  },
  required: ["name", "whatItDoes", "audience", "chore", "oldWay", "reliefMoment", "gaps"],
} as const;

export async function buildBrief(crawl: CrawlResult): Promise<CompanyBrief> {
  const brain = getBrain();
  const sources = crawl.pages.map((p) => ({ url: p.url, kind: p.kind, words: p.wordCount }));

  if (brain.kind === "gemini" && crawl.pages.length > 0 && !crawl.needsJavascript) {
    try {
      const res = await brain.generate({
        system: BRIEF_SYSTEM,
        temperature: 0.6,
        responseSchema: SCHEMA as unknown as Record<string, unknown>,
        messages: [{ role: "user", text: renderCrawl(crawl) }],
      });

      if (res.text && res.text !== DEGRADED_MARKER) {
        const parsed = JSON.parse(res.text) as Record<string, unknown>;
        return assemble(parsed, crawl, sources, true);
      }
    } catch {
      // fall through to the shallow reading
    }
  }

  return assemble({}, crawl, sources, false);
}

/** Flatten the crawl into the text the model reads. */
function renderCrawl(crawl: CrawlResult): string {
  const section = (page: ScrapedPage) =>
    [
      `--- ${page.kind} · ${page.url}`,
      page.title ? `TITLE: ${page.title}` : "",
      page.description ? `META: ${page.description}` : "",
      page.headings.length ? `HEADINGS:\n${page.headings.slice(0, 18).map((h) => `  • ${h}`).join("\n")}` : "",
      page.paragraphs.length ? `BODY:\n${page.paragraphs.slice(0, 18).map((p) => `  ${p}`).join("\n")}` : "",
      page.figures.length ? `NUMBERS FOUND:\n${page.figures.slice(0, 14).map((f) => `  • ${f}`).join("\n")}` : "",
      page.faqs.length ? `FAQ:\n${page.faqs.map((f) => `  Q: ${f.question}\n  A: ${f.answer}`).join("\n")}` : "",
      page.quotes.length ? `QUOTES:\n${page.quotes.map((q) => `  "${q}"`).join("\n")}` : "",
      page.ctas.length ? `BUTTONS: ${page.ctas.join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  return [
    `SITE: ${crawl.origin}`,
    `Pages read: ${crawl.pages.length}`,
    "",
    ...crawl.pages.map(section),
  ].join("\n\n");
}

/**
 * Shallow reading.
 *
 * What we can work out from the markup alone, with no model. It matters more
 * than it looks: most first-time visitors see this, and a brief that comes back
 * almost empty reads as a broken product rather than an honest one.
 *
 * The heuristics are deliberately narrow — a sentence is only used when its
 * shape says what it is. A heading ending in a question mark is a question; a
 * paragraph containing "instead of" is a comparison to the old way; a sentence
 * starting with "for" names an audience.
 */
function shallowRead(crawl: CrawlResult) {
  const all = crawl.pages.flatMap((p) => p.paragraphs);
  const headings = crawl.pages.flatMap((p) => p.headings);
  const home = crawl.pages[0];

  const first = (patterns: RegExp[], pool: string[], maxLen = 220): string => {
    for (const pattern of patterns) {
      const hit = pool.find((t) => pattern.test(t) && t.length < maxLen && t.length > 20);
      if (hit) return hit;
    }
    return "";
  };

  // The clearest "what it does" is usually the meta description: it is written
  // to be read out of context, which is exactly our situation.
  const whatItDoes =
    (home?.description && home.description.length > 25 ? home.description : "") ||
    first([/\b(?:helps?|lets? you|makes? it|so you can|gives? you)\b/i], all) ||
    headings.find((h) => h.length > 25 && h.length < 160) ||
    "";

  const audience =
    first([/\b(?:for (?:teams|founders|developers|marketers|creators|businesses|companies|agencies))\b/i], [
      ...headings,
      ...all,
    ]) ||
    first([/\b(?:built for|designed for|made for|trusted by)\b/i], [...headings, ...all]);

  const chore = first(
    [
      /\b(?:hours?|manually|by hand|spreadsheets?|tedious|repetitive|copy[- ]?past|every week|every month)\b/i,
      /\b(?:stop|no more|without having to|instead of)\b/i,
    ],
    all,
  );

  const oldWay = first(
    [/\b(?:instead of|rather than|used to|before,|replaces?)\b/i, /\bspreadsheets?\b/i],
    all,
  );

  const reliefMoment = first(
    [/\b(?:in (?:seconds|minutes|one click)|instantly|automatically|in a single)\b/i],
    [...headings, ...all],
  );

  const faqs = crawl.pages.flatMap((p) => p.faqs);
  const objections = faqs
    .map((f) => f.question)
    .filter((q) => /\b(?:cost|price|expensive|secure|safe|hard|difficult|why|really|worth)\b/i.test(q))
    .slice(0, 5);

  return { whatItDoes, audience, chore, oldWay, reliefMoment, objections };
}

function assemble(
  parsed: Record<string, unknown>,
  crawl: CrawlResult,
  sources: CompanyBrief["sources"],
  deep: boolean,
): CompanyBrief {
  const home = crawl.pages[0];
  const shallow = shallowRead(crawl);
  const str = (key: string): string => (typeof parsed[key] === "string" ? (parsed[key] as string) : "");
  const arr = (key: string): string[] =>
    Array.isArray(parsed[key]) ? (parsed[key] as unknown[]).filter((v): v is string => typeof v === "string") : [];

  const name = str("name") || guessName(crawl);
  const tagline = home?.headings[0] ?? home?.description ?? "";

  const field = (value: string, source: string, fallback = ""): BriefField => ({
    value: value || fallback,
    source,
    confidence: value ? "high" : fallback ? "low" : "low",
  });

  const claims: Claim[] = Array.isArray(parsed.claims)
    ? (parsed.claims as Array<{ text?: string; quote?: string }>)
        .filter((c) => c.text && c.quote)
        .slice(0, 8)
        .map((c) => ({ text: c.text!, quote: c.quote!, confirmed: false }))
    : crawl.pages
        // Pricing first: that is where a company publishes numbers it will stand
        // behind, and those are the only numbers worth offering to confirm.
        .sort((a, b) => (a.kind === "PRICING" ? -1 : b.kind === "PRICING" ? 1 : 0))
        .flatMap((p) => p.figures)
        .slice(0, 6)
        .map((f) => ({ text: f.slice(0, 140), quote: f, confirmed: false }));

  // Only ask about fields the reading actually left empty. Asking somebody to
  // retype a sentence we just showed them correctly is the fastest way to make
  // an onboarding feel broken.
  const filled = new Set(
    (["whatItDoes", "audience", "chore", "oldWay", "reliefMoment", "offer"] as const).filter(
      (key) => {
        const fromModel = str(key);
        const fallbacks: Record<string, string> = {
          whatItDoes: shallow.whatItDoes || tagline,
          audience: shallow.audience,
          chore: shallow.chore,
          oldWay: shallow.oldWay,
          reliefMoment: shallow.reliefMoment,
          offer: inferOffer(crawl),
        };
        return Boolean(fromModel || fallbacks[key]);
      },
    ),
  );

  const gaps: BriefGap[] = (
    Array.isArray(parsed.gaps) && (parsed.gaps as unknown[]).length
      ? (parsed.gaps as BriefGap[]).map((g, i) => ({ ...g, required: i < 2 }))
      : defaultGaps(crawl)
  )
    .filter((g) => !filled.has(g.id as never))
    .slice(0, 5);

  return {
    images: crawl.images,
    name: field(name, sources[0]?.url ?? crawl.origin),
    whatItDoes: field(str("whatItDoes"), "home page", shallow.whatItDoes || tagline),
    audience: field(str("audience"), "home page", shallow.audience),
    chore: field(str("chore"), "home page", shallow.chore),
    oldWay: field(str("oldWay"), "home page", shallow.oldWay),
    reliefMoment: field(str("reliefMoment"), "home page", shallow.reliefMoment),
    headline: field(str("headline"), "home page", tagline),
    // Pricing is quoted, never guessed: a price the agents invent is the fastest
    // way to a complaint, and the crawler already reads the pricing page.
    pricing: field(
      str("pricing"),
      crawl.pages.find((p) => p.kind === "PRICING")?.url ?? "home page",
      crawl.pages
        .find((p) => p.kind === "PRICING")
        ?.figures.filter((f) => /[$€£]/.test(f))
        .slice(0, 3)
        .join(" · ") ?? "",
    ),
    claims,
    objections: arr("objections").length ? arr("objections").slice(0, 6) : shallow.objections,
    vocabulary: arr("vocabulary").slice(0, 10),
    offer: field(str("offer"), "pricing page", inferOffer(crawl)),
    forbidden: arr("forbidden"),
    gaps,
    sources,
    deep,
  };
}

/**
 * What to ask when the site could not answer.
 *
 * Ordered by how much a script suffers without it. The first two are required
 * because no scenario can be written without a chore and an audience; the rest
 * improve quality and can be skipped.
 */
function defaultGaps(crawl: CrawlResult): BriefGap[] {
  const gaps: BriefGap[] = [
    {
      id: "whatItDoes",
      question: "In one sentence, what does it do?",
      why: "We couldn't read enough from your site to be sure.",
      kind: "short",
      required: true,
    },
    {
      id: "chore",
      question: "What's the one chore your product takes off someone's plate?",
      why: "Every video opens on this moment. It's the whole hook.",
      kind: "short",
      required: true,
    },
    {
      id: "audience",
      question: "Who's actually using it?",
      why: "Decides who your creators talk like, and what they never say.",
      kind: "choice",
      choices: [
        "Founders and solo builders",
        "Marketing teams",
        "Ops and finance teams",
        "Developers and engineers",
        "Creators and freelancers",
        "Consumers, not businesses",
      ],
      required: true,
    },
    {
      id: "oldWay",
      question: "What were they doing before you existed?",
      why: "The old way is the villain in half the scripts.",
      kind: "choice",
      choices: [
        "Spreadsheets and copy-paste",
        "Doing it fully by hand",
        "Paying an agency or freelancer",
        "Another tool that's too complex",
        "Just not doing it at all",
      ],
      required: false,
    },
    {
      id: "objection",
      question: "What do people say when they don't buy?",
      why: "Your creators will answer this one on camera.",
      kind: "choice",
      choices: [
        "Too expensive",
        "I could do this with AI myself",
        "Looks complicated to set up",
        "Not sure it works for my case",
        "I've been burned by a similar tool",
      ],
      required: false,
    },
    {
      id: "offer",
      question: "What does someone get when they arrive from a video?",
      why: "This goes in the pinned comment under every post.",
      kind: "choice",
      choices: [
        "Free trial, no card",
        "Free plan forever",
        "Demo call",
        "Discount for new users",
        "Nothing special yet",
      ],
      required: false,
    },
  ];

  void crawl;
  return gaps;
}

function inferOffer(crawl: CrawlResult): string {
  const ctas = crawl.pages.flatMap((p) => p.ctas);
  if (ctas.some((c) => /free trial|start free|try free/i.test(c))) return "Free trial";
  if (ctas.some((c) => /get started|sign up/i.test(c))) return "Free sign-up";
  if (ctas.some((c) => /book|demo|talk to/i.test(c))) return "Demo call";
  return "";
}

/**
 * The company's name.
 *
 * The page title is unreliable — plenty of sites use it for a tagline — so a
 * title fragment is only trusted when it looks like a name: short, and without
 * the verbs and articles a sentence would carry. Otherwise the hostname wins,
 * which is almost always right and never embarrassing.
 */
function guessName(crawl: CrawlResult): string {
  const title = crawl.pages[0]?.title ?? "";
  const fromTitle = title.split(/[|—–·:]/)[0]?.trim() ?? "";
  const looksLikeSentence =
    /\b(?:the|a|an|for|that|your|with|and|is|are)\b/i.test(fromTitle) ||
    fromTitle.split(/\s+/).length > 3 ||
    /[.!?]$/.test(fromTitle);

  if (fromTitle.length > 1 && fromTitle.length < 32 && !looksLikeSentence) return fromTitle;

  try {
    const host = new URL(crawl.origin).hostname.replace(/^www\./, "");
    const base = host.split(".")[0] ?? host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Your brand";
  }
}
