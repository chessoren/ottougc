import "server-only";

import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";
import {
  PANEL_VERDICT_SCHEMA,
  compilePanel,
  continuityFrom,
  momentFor,
  panelFailures,
  panelPasses,
  type PanelVerdict,
} from "@/server/knowledge/prompting/storyboard";
import type { ShotSpec } from "@/server/knowledge/prompting/shot";
import { generateNanoBananaImages, toInlineImage } from "@/server/media/providers/nano-banana";

/**
 * Build the storyboard for one video.
 *
 * Panels are generated **in order and conditioned on each other**, which is the
 * whole point: panel two is made from panel one, so the room, the light, the
 * clothes and the face carry over as pixels rather than as adjectives. Ten
 * panels generated in parallel from the same text are ten different afternoons.
 *
 * Every panel is then looked at by a vision model before it is allowed through.
 * That check is cheap — a fraction of a cent — and it is where the pipeline's
 * failure rate is meant to live, because a rejected panel costs thirteen cents
 * and a rejected clip costs sixty plus forty seconds of wall clock.
 */

export interface BuiltPanel {
  beatIndex: number;
  url: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  costUsd: number;
  /** How many generations it took. More than one is worth surfacing. */
  attempts: number;
  verdict?: PanelVerdict;
  problems: string[];
}

export interface StoryboardResult {
  panels: BuiltPanel[];
  costUsd: number;
  /** True when at least one panel shipped without passing every check. */
  degraded: boolean;
  notes: string[];
}

export interface StoryboardOptions {
  shots: ShotSpec[];
  /** The character sheet's reference image URLs. Identity comes from these. */
  characterRefs: string[];
  seed: number;
  /** Two generations, then the best attempt ships with its problems recorded. */
  maxAttempts?: number;
  onNote?: (message: string) => Promise<void> | void;
}

export async function buildStoryboard(opts: StoryboardOptions): Promise<StoryboardResult> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const notes: string[] = [];
  const panels: BuiltPanel[] = [];
  let costUsd = 0;
  let degraded = false;

  // A stand-in reference is worse than no reference: it produces a convincing
  // clip of the wrong person. `toInlineImage` refuses SVG, so filter here too
  // and say so rather than silently generating a stranger.
  const usableRefs: string[] = [];
  for (const url of opts.characterRefs) {
    if (await toInlineImage(url)) usableRefs.push(url);
  }
  if (usableRefs.length === 0) {
    notes.push(
      "No usable character photographs — the panels cannot be identity-locked, and the face will drift between shots.",
    );
    degraded = true;
  }

  let previousPanelUrl: string | undefined;

  for (const [index, shot] of opts.shots.entries()) {
    const moment = momentFor(shot, index === 0);
    const previousShot = opts.shots[index - 1];
    const continuity =
      previousShot && previousPanelUrl ? continuityFrom(previousShot, shot) : undefined;

    const compiled = compilePanel({ beatIndex: index, shot, moment }, continuity);

    // What leads the reference list changes after the first panel, and so does
    // what the model is told to copy.
    //
    // Panel one establishes the scene, so it is conditioned on the character
    // sheet and only the identity carries over — the sheet's rooms and outfits
    // are deliberately various and must not be copied wholesale.
    //
    // Every later panel is a continuation of a single continuous moment, so the
    // previous panel leads and the whole scene carries: same room, same clothes,
    // same light. Two character photographs follow it to stop the face drifting
    // as the framing changes.
    const references = previousPanelUrl
      ? [previousPanelUrl, ...usableRefs.slice(0, 2)]
      : usableRefs.slice(0, 4);
    const preserve = previousPanelUrl ? "SCENE" : "IDENTITY";

    let best: BuiltPanel | null = null;
    let extraDirection = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let asset;
      try {
        [asset] = await generateNanoBananaImages({
          prompt: extraDirection ? `${compiled.prompt}\n\nCORRECT THIS: ${extraDirection}` : compiled.prompt,
          negativePrompt: compiled.negativePrompt,
          aspectRatio: "9:16",
          size: "2K",
          hiFi: true,
          preserve,
          count: 1,
          seed: opts.seed + index * 17 + attempt,
          referenceImageUrls: references,
        });
      } catch (error) {
        // A failed attempt must not end the loop. The first version of this
        // broke out on any error, which meant a rejected panel whose retry was
        // safety-blocked shipped the rejected version — the one case where
        // giving up costs the most.
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`Panel ${index + 1}, attempt ${attempt}: ${message}`);
        continue;
      }

      if (!asset) continue;
      costUsd += asset.costUsd;

      const candidate: BuiltPanel = {
        beatIndex: index,
        url: asset.url,
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        model: asset.model,
        costUsd: asset.costUsd,
        attempts: attempt,
        problems: [],
      };

      const verdict = await judgePanel(asset.url, usableRefs[0]);
      candidate.verdict = verdict ?? undefined;
      candidate.problems = verdict ? panelFailures(verdict) : [];

      // No verdict means the judge itself failed. Ship the panel rather than
      // block the video on a broken checker, but record that it went unchecked.
      if (!verdict) {
        candidate.problems = ["panel could not be inspected"];
        best = candidate;
        break;
      }

      if (panelPasses(verdict)) {
        best = candidate;
        break;
      }

      // Keep the least-bad attempt in case the retry comes back worse.
      if (!best || candidate.problems.length < best.problems.length) best = candidate;

      extraDirection = [verdict.fix, ...panelFailures(verdict)].filter(Boolean).join(". ");
      await opts.onNote?.(
        `Panel ${index + 1} rejected (${panelFailures(verdict).join("; ")}) — regenerating.`,
      );
    }

    if (!best) {
      notes.push(`Panel ${index + 1} could not be produced.`);
      degraded = true;
      continue;
    }

    if (best.problems.length > 0) {
      degraded = true;
      notes.push(`Panel ${index + 1} shipped with problems: ${best.problems.join("; ")}.`);
    }

    panels.push(best);
    previousPanelUrl = best.url;

    await opts.onNote?.(
      `Panel ${index + 1}/${opts.shots.length} ready${best.attempts > 1 ? ` (${best.attempts} attempts)` : ""}.`,
    );
  }

  return { panels, costUsd, degraded, notes };
}

/* ==========================================================================
   The vision check
   ========================================================================== */

let visionClient: GoogleGenAI | null = null;

function vision(): GoogleGenAI {
  if (!visionClient) {
    visionClient = new GoogleGenAI({
      vertexai: true,
      project: env.gcpProjectId!,
      location: "global",
      googleAuthOptions: { credentials: env.gcpServiceAccount as never },
    });
  }
  return visionClient;
}

const JUDGE_SYSTEM = `
You inspect a single frame that is about to be turned into a short video, and you
answer five factual questions about it. You are not a critic and you are not being
asked whether it is good.

Be strict on two of them in particular, because they are the failures that reach an
audience:

- ANY phone screen, camera application interface, shutter button, on-screen control,
  status bar or device frame counts as an interface. A phone lying on a table with a
  dark screen does not.
- ANY text counts, including text that is unreadable, garbled or nonsensical. Writing
  that genuinely belongs to the room — a label on a jar, a poster already on the wall —
  does not count.

If a reference photograph is attached, "the same individual" means a person a stranger
would identify as the same human being: same bone structure, same age, same hair. A
different haircut on the same face is still the same person; a different face is not.
`.trim();

/**
 * Ask a vision model whether this panel is fit to animate.
 *
 * Returns null when the check itself fails, which the caller treats as "shipped
 * unchecked" rather than as a rejection — a broken judge must not be able to
 * stop the whole fleet.
 */
export async function judgePanel(
  panelUrl: string,
  referenceUrl?: string,
): Promise<PanelVerdict | null> {
  try {
    const panel = await toInlineImage(panelUrl);
    if (!panel) return null;

    const parts: Array<Record<string, unknown>> = [];

    if (referenceUrl) {
      const reference = await toInlineImage(referenceUrl);
      if (reference) {
        parts.push({ text: "REFERENCE PHOTOGRAPH of the character:" });
        parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.data } });
      }
    }

    parts.push({ text: "THE FRAME TO INSPECT:" });
    parts.push({ inlineData: { mimeType: panel.mimeType, data: panel.data } });
    parts.push({
      text: "Answer the five questions about THE FRAME TO INSPECT. If anything fails, `fix` says in one sentence what to change in the prompt.",
    });

    const res = await vision().models.generateContent({
      model: env.models.brain,
      contents: [{ role: "user", parts: parts as never }],
      config: {
        systemInstruction: JUDGE_SYSTEM,
        temperature: 0,
        // Gemini 3.x spends output budget on thinking before it answers, so a
        // tight cap here returns an empty string rather than a verdict.
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseJsonSchema: PANEL_VERDICT_SCHEMA,
      } as never,
    });

    const text = res.text?.trim();
    if (!text) return null;
    return JSON.parse(text) as PanelVerdict;
  } catch {
    return null;
  }
}
