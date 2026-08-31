import "server-only";

import { getBrain, DEGRADED_MARKER } from "@/server/llm/client";
import { extractJson } from "./runtime";
import type { CharacterSheet, Icp } from "@/server/knowledge/prompting/character";
import type { Scenario, ScenarioBeat } from "@/server/knowledge/scenarios";
import { countWords } from "@/server/knowledge/text";

/**
 * The writer.
 *
 * Takes a scenario — a shape and a beat structure — and fills it with this
 * brand's material and this persona's voice. It does not choose the shape, it
 * does not choose the shots, and it never writes a prompt: those are decided by
 * the taxonomy and compiled by the craft layer.
 *
 * What it does decide is the only thing that genuinely requires judgement: what
 * actually happens in this particular story, and what people say.
 */

export interface WrittenBeat {
  label: string;
  /** What physically happens. Feeds ShotSpec.action. */
  direction: string;
  /** Spoken in the clip, if this beat has speech. */
  line?: string;
  /** Text laid over this beat. */
  overlayText?: string;
  durationSeconds: number;
}

export interface WrittenScenario {
  scenarioId: string;
  /** The banner or first card. Seven words maximum. */
  hook: string;
  /** What the video is about, in one sentence, for the operator. */
  logline: string;
  beats: WrittenBeat[];
  /** Title for the platform. */
  title: string;
  description: string;
  tags: string[];
  /** Posted and pinned within ninety seconds of publication. */
  pinnedComment: string;
  degraded: boolean;
  /** Why the model did not write this, when it did not. Surfaced in the run. */
  writerFailure?: string;
}

const WRITER_SYSTEM = `
You are writing a short video. It is NOT an advertisement and must never look like
one.

WHAT YOU'RE WRITING
A situation that actually happens to somebody. The product is not the subject: it is
what, at one moment, gets them out of it. It is never introduced, never explained,
never recommended. It is simply there, it works, and the story carries on.

HARD RULES
- The product does not appear before the point in the story the scenario specifies.
- It is named at most once, and never in a sentence that sells it.
- No opening address ("hey guys", "hi everyone"). You always enter mid-sentence or
  mid-action.
- No marketing vocabulary: revolutionary, game-changer, seamless, unlock, don't
  wait, discover, innovative solution.
- No number that isn't in the brand material you're given.
- Lines have to work out loud. Short sentences, hesitations, ellipses. If you
  wouldn't say it, don't write it.
- Every line has to fit its beat: roughly three words per second, maximum.

THE HOOK
Seven words maximum. It sells a SITUATION, not a benefit. It doesn't ask a
rhetorical question. It doesn't promise anything.

Return JSON matching the schema. Nothing else.
`.trim();

const SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string" },
    logline: { type: "string" },
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          direction: { type: "string" },
          line: { type: "string" },
          overlayText: { type: "string" },
        },
        required: ["label", "direction"],
      },
    },
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    pinnedComment: { type: "string" },
  },
  required: ["hook", "logline", "beats", "title", "pinnedComment"],
} as const;

export interface WriteInput {
  scenario: Scenario;
  /**
   * Short lines from this brand's own material that could open a video. Used
   * when no model is available, and rotated by `rotation` so the fleet does not
   * converge on one sentence.
   */
  hookSeeds: string[];
  /** Stable per-channel offset into the candidate list. */
  rotation: number;
  brandName: string;
  brandDna: Record<string, string>;
  knowledge: Array<{ kind: string; title: string; body: string }>;
  icp: Icp | null;
  sheet: CharacterSheet | null;
  personaName: string;
  /** Lessons this channel has already learned. */
  memory: string[];
  targetUrl: string | null;
}

export async function writeScenario(input: WriteInput): Promise<WrittenScenario> {
  const brain = getBrain();
  const { scenario } = input;
  let writerFailure: string | null = null;
  let correction = "";

  if (brain.kind === "gemini") {
    // Two attempts, the second with a much larger budget.
    //
    // The first version of this swallowed every failure into a silent fallback,
    // and the fallback is convincing enough that nobody noticed the model had
    // stopped writing: the videos still shipped, assembled from templates, and
    // the run summary said "media may still be live" rather than "the writer
    // did not run". A creative step that fails quietly is worse than one that
    // fails loudly, because it never gets fixed.
    for (const [attempt, maxOutputTokens] of [
      [1, 16384],
      [2, 32768],
    ] as const) {
      try {
        const res = await brain.generate({
          system: WRITER_SYSTEM,
          temperature: 1.0,
          maxOutputTokens,
          responseSchema: SCHEMA as unknown as Record<string, unknown>,
          messages: [{ role: "user", text: buildBrief(input) + correction }],
        });

        if (!res.text || res.text === DEGRADED_MARKER) {
          writerFailure = `attempt ${attempt}: the model returned nothing (thinking probably consumed the ${maxOutputTokens}-token budget)`;
          continue;
        }

        // Tolerant rather than strict: a truncated or fenced response is
        // recoverable, and a thrown parse error is not.
        const parsed = extractJson(res.text) as
          | (Partial<WrittenScenario> & { beats?: Array<Partial<WrittenBeat>> })
          | null;

        if (!parsed || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
          writerFailure = `attempt ${attempt}: the response had no usable beats`;
          continue;
        }

        // Check the figures here, where a rejection costs one model call, rather
        // than in quality control, where it costs the whole video.
        const allowed = allowedFigures(input);
        const spoken = [
          parsed.hook ?? "",
          ...(parsed.beats ?? []).flatMap((b) => [b?.line ?? "", b?.overlayText ?? ""]),
        ].join(" \n ");
        const invented = unconfirmedFigures(spoken, allowed);

        if (invented.length > 0 && attempt === 1) {
          writerFailure = `attempt 1 used figures the brand never published: ${invented.join(", ")}`;
          correction = `\n\nYou used ${invented.map((f) => `"${f}"`).join(", ")}, which appear nowhere in the brand material. Rewrite WITHOUT them. Either use a figure that is in the material above, word for word, or say it without a number at all — "barely anything", "a couple of weeks". A number you invented is the one thing that gets this account taken down.`;
          continue;
        }

        if (invented.length > 0) {
          writerFailure = `shipped with unverified figures: ${invented.join(", ")}`;
        }

        return normalise(parsed, input, false);
      } catch (error) {
        writerFailure = `attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  const written = normalise({}, input, true);
  if (writerFailure) written.writerFailure = writerFailure;
  return written;
}

function buildBrief(input: WriteInput): string {
  const { scenario, brandDna: dna } = input;

  const beatBrief = scenario.beats
    .map((b, i) => {
      const wants: string[] = [];
      if (hasSpeech(scenario, b)) {
        wants.push(`a line of at most ${Math.floor(b.durationSeconds * 3)} words`);
      }
      if (b.overlayText) wants.push("text on screen");
      return [
        `BEAT ${i + 1} — ${b.label} (${b.durationSeconds}s)`,
        `  Purpose: ${b.purpose}`,
        `  What happens: ${b.direction}`,
        b.interrupt ? `  The break: ${b.interrupt}` : "",
        wants.length ? `  Write: ${wants.join(", ")}` : "  Write: nothing, this beat is silent",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const knowledge = input.knowledge
    .slice(0, 14)
    .map((k) => `[${k.kind}] ${k.title} — ${k.body}`)
    .join("\n");

  return `
SCENARIO: ${scenario.name}
Situation: ${scenario.premise}
The product's role in the story: ${scenario.productRole}
The brand cannot appear before ${Math.round(scenario.brandEntry.atRatio * 100)}% of the story.
When it does: ${scenario.brandEntry.manner}
Specific to this scenario, never: ${scenario.forbidden.join(" · ")}

BRAND: ${input.brandName}
${input.targetUrl ? `Traffic goes to: ${input.targetUrl}` : ""}

BRAND MATERIAL — the ONLY source for any number or claim:
${knowledge || "(empty — do not state any number)"}

Material: ${JSON.stringify(dna).slice(0, 1400)}

WHO'S TALKING: ${input.personaName}
${input.sheet ? `Voice: ${input.sheet.voice.pace}, says "${input.sheet.voice.fillers.join('", "')}", never says "${input.sheet.voice.neverSays.join('", "')}"` : ""}

TO WHOM: ${input.icp ? `${input.icp.selfDescription} — ${input.icp.ageRange}, ${input.icp.occupation}. Their pain: ${input.icp.visceralPain}. What makes them scroll: ${input.icp.turnOffs.join(", ")}.` : "audience not defined"}

WHAT THIS CHANNEL HAS LEARNED:
${input.memory.slice(0, 6).map((m) => `- ${m}`).join("\n") || "- nothing yet"}

${beatBrief}

Write it.
`.trim();
}

/* ── The number gate ─────────────────────────────────────────────────────── */

/**
 * Every figure a script is allowed to contain.
 *
 * Drawn from the brand's own confirmed material and nowhere else. Small counting
 * numbers are exempt — "three weeks", "two people" — because forbidding those
 * makes speech impossible without adding any protection: nobody is misled by
 * "the second time".
 */
function allowedFigures(input: WriteInput): Set<string> {
  const corpus = [
    ...Object.values(input.brandDna ?? {}),
    ...input.knowledge.map((k) => `${k.title} ${k.body}`),
  ].join(" ");
  return new Set(corpus.match(/\d[\d,.\s]*\d|\d/g)?.map(normaliseFigure) ?? []);
}

function normaliseFigure(raw: string): string {
  return raw.replace(/[\s,]/g, "").replace(/\.$/, "");
}

/** Written-out numbers are numbers. A model asked to avoid "4,000" writes "four thousand". */
const WORD_NUMBERS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  hundred: "100", thousand: "1000", grand: "1000", million: "1000000",
};

/**
 * Figures a script uses that the brand never published.
 *
 * This runs before a single frame is generated. Without it the same claim is
 * caught by quality control *after* the storyboard, the footage and the render
 * have been paid for — which is exactly what happened twice in a row, at about
 * three dollars a time, for one invented "twelve signups".
 */
export function unconfirmedFigures(text: string, allowed: Set<string>): string[] {
  const found: string[] = [];

  for (const match of text.match(/\$?\d[\d,.]*\d|\$?\d+/g) ?? []) {
    const bare = normaliseFigure(match.replace("$", ""));
    // Under a hundred with no currency marker is counting, not claiming.
    if (!match.includes("$") && Number(bare) < 100) continue;
    if (allowed.has(bare)) continue;
    found.push(match);
  }

  // "two thousand dollars", "four thousand views"
  const spelled = text.toLowerCase().match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)[\s-](hundred|thousand|grand|million)\b/g,
  );
  for (const phrase of spelled ?? []) {
    const [unit, scale] = phrase.split(/[\s-]/);
    const value = String(Number(WORD_NUMBERS[unit!] ?? 0) * Number(WORD_NUMBERS[scale!] ?? 1));
    if (!allowed.has(value)) found.push(phrase);
  }

  return [...new Set(found)];
}

function normalise(
  parsed: Partial<WrittenScenario> & { beats?: Array<Partial<WrittenBeat>> },
  input: WriteInput,
  degraded: boolean,
): WrittenScenario {
  const { scenario } = input;
  const vars = templateVars(input);

  const beats: WrittenBeat[] = scenario.beats.map((beat, i) => {
    const written: Partial<WrittenBeat> = parsed.beats?.[i] ?? {};
    return {
      label: beat.label,
      direction: clean(written.direction) || interpolate(beat.direction, vars),
      line: hasSpeech(scenario, beat)
        ? trimToDuration(clean(written.line) || interpolate(beat.line ?? "", vars), beat.durationSeconds)
        : undefined,
      overlayText: beat.overlayText
        ? clean(written.overlayText) || interpolate(beat.overlayText, vars)
        : clean(written.overlayText) || undefined,
      durationSeconds: beat.durationSeconds,
    };
  });

  // Prefer a source that already fits the seven-word limit: a hook that has to be
  // hard-cut ends mid-clause and reads as broken. The channel seed rotates the
  // choice so ten creators do not all open with the same sentence.
  const candidates = [
    clean(parsed.hook),
    beats.find((b) => b.overlayText)?.overlayText,
    ...input.hookSeeds,
    vars.hookLine,
  ].filter((c): c is string => Boolean(c && c.trim()));

  const fitting = candidates.filter((c) => countWords(stripPovPrefix(c)) <= 7);
  const chosen = fitting.length
    ? fitting[input.rotation % fitting.length]!
    : (candidates[0] ?? vars.hookLine);

  const hook = enforceHook(chosen);

  return {
    scenarioId: scenario.id,
    hook,
    logline: clean(parsed.logline) || interpolate(scenario.premise, vars),
    beats,
    title: (clean(parsed.title) || hook).slice(0, 100),
    description: clean(parsed.description) || "",
    tags: parsed.tags?.slice(0, 8) ?? [],
    pinnedComment: clean(parsed.pinnedComment) || defaultPinned(input),
    degraded,
  };
}

/** Whether this beat carries spoken words, given the scenario's speech mode. */
function hasSpeech(scenario: Scenario, beat: ScenarioBeat): boolean {
  if (scenario.shape.speech === "NONE") return false;
  return Boolean(beat.line);
}

/** A "POV:" prefix is scaffolding, not content — it does not count toward the limit. */
function stripPovPrefix(text: string): string {
  return text.replace(/^\s*POV\s*:\s*/i, "");
}

/** Seven words maximum, no opening formula, no exclamation. */
function enforceHook(raw: string): string {
  let text = raw.trim().replace(/^[«"']\s*|\s*[»"']$/g, "");
  text = text.replace(
    /^(hey guys|hi everyone|hello everyone|what's up guys|hey friends)[\s,!:]*/i,
    "",
  );
  text = text.replace(/!+/g, "");
  const tokens = text.split(/\s+/).filter(Boolean);
  const words = tokens.filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (words.length <= 7) return text.trim();

  const kept: string[] = [];
  let counted = 0;
  for (const t of tokens) {
    const isWord = /[\p{L}\p{N}]/u.test(t);
    if (isWord && counted >= 7) break;
    kept.push(t);
    if (isWord) counted++;
  }
  return kept.join(" ").replace(/\s*[,;:.]$/, "");
}

/** Roughly three words a second; beyond that the delivery stops sounding human. */
function trimToDuration(line: string, seconds: number): string {
  const max = Math.max(3, Math.floor(seconds * 3.2));
  const words = line.trim().split(/\s+/);
  if (words.length <= max) return line.trim();
  return words.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

function defaultPinned(input: WriteInput): string {
  return [
    `for everyone asking in the comments, it's ${input.brandName}`,
    "",
    "free to try while they're launching, no card",
    "link's at the top of my profile",
  ].join("\n");
}

function templateVars(input: WriteInput): Record<string, string> {
  const dna = input.brandDna;
  const icp = input.icp;
  return {
    brand: input.brandName,
    persona: input.personaName,
    pain: dna.pain ?? icp?.visceralPain ?? "this chore",
    task: dna.task ?? "this task",
    oldWay: dna.oldWay ?? "the old way",
    metric: dna.metric ?? "",
    outcome: dna.outcome ?? "the problem is gone",
    action: dna.outcome ?? "it runs",
    hookLine: dna.hookLine ?? icp?.stoppingThought ?? "",
    situation: icp?.visceralPain ?? dna.pain ?? "",
    aftermath: icp?.visceralPain ?? "",
    escalation: icp?.stoppingThought ?? "",
    question: icp?.stoppingThought ?? "",
    setup: dna.oldWay ?? "",
    payoff: dna.newWayDuration ?? "",
    wrongClaim: dna.commonBelief ?? "",
    incomingMessage: "",
    resolutionMessage: "",
    lateNightConfession: "",
    rant: "",
    demand: "",
    deadline: "",
    misunderstanding: "",
    headline: "",
    hookCard: icp?.stoppingThought ?? "",
    bodyCards: "",
    pivotCard: "",
    closingCard: "",
    comment: "",
    doingLine: "",
    midActionLine: "",
    waitingLine: "",
    resultLine: "",
    openingLine: "",
    lowPoint: "",
    pivotLine: "",
    dayNumber: "1",
    dailyResult: "",
    nextAttempt: "",
    taskHeadline: dna.task ?? "",
    finalTime: dna.newWayDuration ?? "",
    streetQuestion: "",
    streetAnswers: "",
    lastAnswer: "",
    timestamp: "",
  };
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function clean(value?: string): string {
  return (value ?? "").trim();
}
