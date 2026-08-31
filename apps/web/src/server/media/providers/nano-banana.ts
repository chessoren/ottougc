import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { GoogleGenAI } from "@google/genai";

import { env, googleCredentials } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";

import type { ImageRequest, MediaAsset } from "../types";

/**
 * Nano Banana — Gemini's image line, on the Vertex global endpoint.
 *
 * This module replaces Imagen entirely. Two reasons, both measured rather than
 * assumed:
 *
 *   1. **Imagen is not available.** Five published model ids were probed against
 *      this project (`imagen-4.0-generate-001`, `-preview-06-06`, `-fast-`,
 *      `imagen-3.0-generate-002`, `imagegeneration@006`) and all five returned
 *      404. There is no Imagen fallback to keep.
 *   2. **The image models refuse `predict`.** `models.generateImages()` calls the
 *      Vertex predict endpoint, and Gemini image models answer it with
 *      `FAILED_PRECONDITION`. They are reached through `generateContent` with
 *      `responseModalities: ["IMAGE"]`, which is what this module does.
 *
 * The other thing `generateContent` buys is the reason the whole storyboard
 * layer is possible: **reference images go in as input parts**. A panel can be
 * generated *from* the character's own photographs, and the next panel from the
 * previous one, which is what makes one recognisable person hold across a shoot.
 * No amount of text description does that reliably.
 */

/** Ordered by preference. A 404 or a quota refusal falls through to the next. */
export const NANO_BANANA_MODELS = {
  /** Nano Banana 2. Best composition and face rendering; used for anything a person will look at twice. */
  hiFi: "gemini-3-pro-image",
  /** Same family, faster and cheaper. Used for volume. */
  fast: "gemini-3.1-flash-image",
  /** Previous generation. Still good; kept as the last resort. */
  legacy: "gemini-2.5-flash-image",
} as const;

/** USD per image. 2K costs more than 1K, which is why the tier is explicit. */
export const NANO_BANANA_PRICING: Record<string, number> = {
  "gemini-3-pro-image": 0.134,
  "gemini-3.1-flash-image": 0.039,
  "gemini-2.5-flash-image": 0.039,
};

export function nanoBananaConfigured(): boolean {
  return Boolean(!env.forceMockMedia && env.gcpAuthAvailable && env.gcpProjectId);
}

let cached: GoogleGenAI | null = null;

/**
 * The image models live on the global endpoint, not on `env.gcpLocation`.
 * Lyria and Chirp stay regional; only this client is global.
 */
function client(): GoogleGenAI {
  if (!cached) {
    cached = new GoogleGenAI({
      vertexai: true,
      project: env.gcpProjectId!,
      location: "global",
      googleAuthOptions: googleCredentials(),
    });
  }
  return cached;
}

export interface NanoBananaRequest extends ImageRequest {
  /** Overrides the tier choice. Used by the storyboard, which is always hi-fi. */
  model?: string;
}

/**
 * Generate one or more images.
 *
 * Reference images are sent *before* the instruction, which is the ordering the
 * image models treat as "here is the material, now do this to it". Reversing it
 * turns the references into loose inspiration and the face drifts.
 */
export async function generateNanoBananaImages(req: NanoBananaRequest): Promise<MediaAsset[]> {
  if (!nanoBananaConfigured()) {
    throw new Error("Vertex is not configured, so Nano Banana cannot be called.");
  }

  const count = Math.max(1, req.count ?? 1);
  const preferred = req.model ?? (req.hiFi ? NANO_BANANA_MODELS.hiFi : NANO_BANANA_MODELS.fast);
  const chain = [preferred, NANO_BANANA_MODELS.hiFi, NANO_BANANA_MODELS.fast, NANO_BANANA_MODELS.legacy].filter(
    (m, i, all) => all.indexOf(m) === i,
  );

  const references: Array<{ mimeType: string; data: string }> = [];
  for (const url of (req.referenceImageUrls ?? []).slice(0, 6)) {
    const inline = await toInlineImage(url);
    if (inline) references.push(inline);
  }

  const instruction = [
    references.length ? conditioningClause(req.preserve ?? "SCENE", references.length) : "",
    req.prompt,
    req.negativePrompt ? `\nMUST NOT APPEAR: ${req.negativePrompt}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const out: MediaAsset[] = [];
  let lastError: unknown = null;

  for (let i = 0; i < count; i++) {
    let produced: MediaAsset | null = null;

    for (const model of chain) {
      try {
        produced = await once(model, instruction, references, req, i);
        break;
      } catch (error) {
        lastError = error;
        // Three failures are worth trying the next tier for: no access (404),
        // no quota (429), and a safety block that returned nothing. The last one
        // is not a hypothetical — a storyboard panel of a hand turning a phone
        // over was blocked on the hi-fi tier and produced fine on the next, and
        // treating it as fatal shipped the rejected panel instead.
        const message = error instanceof Error ? error.message : String(error);
        if (!/NOT_FOUND|404|RESOURCE_EXHAUSTED|429|returned no image/.test(message)) throw error;
      }
    }

    if (!produced) {
      throw new Error(
        `Nano Banana produced nothing on any tier. Last error: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    }
    out.push(produced);
  }

  return out;
}

/**
 * How much of the attached photographs to copy.
 *
 * Getting this wrong is silent and expensive: an over-strict clause produces a
 * character sheet of seven identical pictures, which looks like it worked and
 * gives the video model no information about how the face moves or what else
 * the person owns.
 */
function conditioningClause(preserve: "IDENTITY" | "SCENE", count: number): string {
  const plural = count === 1 ? "photograph shows" : "photographs show";

  if (preserve === "IDENTITY") {
    // Calibrated against two observed failures, in both directions.
    //
    // Too strict and the whole sheet comes back as one photograph repeated: the
    // "different outfit" and "surprised expression" references were pixel-level
    // copies of the neutral one, which teaches the video model nothing about how
    // the face moves. Too loose and the model treats hair and hands as free
    // variables: it returned the same woman with different, wet hair, holding a
    // phone that nothing had asked for.
    //
    // So: identity and hair are locked, and the only things allowed to move are
    // the ones the instruction explicitly names.
    return [
      `The attached ${plural} the same real person. Copy the IDENTITY exactly: face shape, bone structure, eyes, nose, mouth, teeth, skin tone and texture, freckles, marks, apparent age, and the hair — same colour, same length, same texture, same way of being tied up. A stranger must recognise this as the same human being on a different day.`,
      "This is a SEPARATE photograph, not a retouch of the attached ones: change what the instruction below asks for — the expression, the pose, the outfit, the room — and change nothing it does not mention. Do not add objects, do not put anything in their hands, and do not copy the previous framing.",
    ].join(" ");
  }

  return `The attached ${plural} the same person in the same place, moments apart. Copy the identity, the clothing, the hair, the room and the light exactly — this is the same person on the same day, still wearing the same things, in the same light. Only the framing and what they are doing change, as described below.`;
}

async function once(
  model: string,
  instruction: string,
  references: Array<{ mimeType: string; data: string }>,
  req: NanoBananaRequest,
  index: number,
): Promise<MediaAsset> {
  const parts: Array<Record<string, unknown>> = references.map((r) => ({
    inlineData: { mimeType: r.mimeType, data: r.data },
  }));
  parts.push({ text: instruction });

  const res = await client().models.generateContent({
    model,
    contents: [{ role: "user", parts: parts as never }],
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: req.aspectRatio,
        imageSize: req.size ?? "2K",
      },
      // A seed keeps a set of references looking like one shoot on one device.
      //
      // Wrapped into int32 first. The seeds here come from FNV hashes of channel
      // ids, which are unsigned 32-bit, and Vertex rejects anything above
      // 2^31-1 with "Invalid value at 'generation_config.seed' (TYPE_INT32)".
      // That refusal took out every storyboard panel of a run while the clips
      // still generated, so the video shipped with no panels and nobody noticed
      // until the assets were inspected.
      ...(req.seed !== undefined ? { seed: toInt32Seed(req.seed + index) } : {}),
    } as never,
  });

  const candidate = res.candidates?.[0];
  const image = (candidate?.content?.parts ?? []).find(
    (p) => (p as { inlineData?: unknown }).inlineData,
  ) as { inlineData?: { data?: string; mimeType?: string } } | undefined;

  if (!image?.inlineData?.data) {
    const reason = candidate?.finishReason ? ` (${candidate.finishReason})` : "";
    throw new Error(`${model} returned no image${reason}. Most likely blocked by safety.`);
  }

  const buffer = Buffer.from(image.inlineData.data, "base64");
  const id = hash(`${instruction}#${model}#${req.seed ?? 0}#${index}`);
  const dir = path.join(GENERATED_ROOT, "images");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);
  await writeFile(file, buffer);

  const { width, height } = pngDimensions(buffer);

  return {
    url: `/generated/images/${id}.png`,
    localPath: file,
    mimeType: image.inlineData.mimeType ?? "image/png",
    provider: "nano-banana",
    model,
    costUsd: NANO_BANANA_PRICING[model] ?? 0.039,
    width,
    height,
    meta: {
      referenceCount: references.length,
      size: req.size ?? "2K",
      bytes: buffer.length,
    },
  };
}

/* ==========================================================================
   Helpers
   ========================================================================== */

/**
 * Load an image as inline base64, wherever it lives.
 *
 * SVG is refused rather than silently skipped upstream: a stand-in reference
 * would produce a real-looking clip of the wrong person, which is worse than no
 * reference at all.
 */
export async function toInlineImage(
  url: string,
): Promise<{ mimeType: string; data: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const header = url.slice(5, url.indexOf(";"));
      if (header === "image/svg+xml") return null;
      return { mimeType: header || "image/png", data: url.slice(comma + 1) };
    }

    if (/^https?:/.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const mimeType = res.headers.get("content-type") ?? "image/png";
      if (mimeType.includes("svg")) return null;
      return { mimeType, data: Buffer.from(await res.arrayBuffer()).toString("base64") };
    }

    const filePath = path.join(GENERATED_ROOT, url.replace(/^\/generated\//, ""));
    const mimeType = mimeOf(filePath);
    if (mimeType === "image/svg+xml") return null;
    const buffer = await readFile(filePath);
    return { mimeType, data: buffer.toString("base64") };
  } catch {
    return null;
  }
}

function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** Vertex takes a signed 32-bit seed. Anything larger is refused outright. */
function toInt32Seed(seed: number): number {
  return Math.abs(Math.trunc(seed)) % 2_147_483_647;
}

/** IHDR is always the first chunk, so width and height are at fixed offsets. */
function pngDimensions(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return {};
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
