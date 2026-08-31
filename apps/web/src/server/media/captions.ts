import "server-only";

import { createHash } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { extractAudio } from "@remotion/renderer";

import { capabilities, env, googleCredentials } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";

import { estimateAlignment } from "./providers/mock";
import type { AlignmentResult, TranscriptWord } from "./types";

/**
 * Word timings for a clip that already contains its own dialogue.
 *
 * This exists because of how Omni works. Every other pipeline in this codebase
 * synthesises speech separately, aligns it, and lays it under the picture — so
 * the word timings are a by-product of making the audio. Omni renders the voice
 * *inside* the clip, which is what makes the lip sync believable, and the price
 * is that nothing downstream knows when each word was said.
 *
 * Without these timings the montage has no captions, and a short-form video with
 * no captions is not a short-form video: 85% of Shorts are watched muted, so the
 * text is not an accessibility layer, it is the delivery of the hook.
 *
 * So we go and get them: pull the audio out of the generated clip, run it
 * through speech-to-text with word offsets, and read the timings off what the
 * model actually said rather than off what we asked it to say. That difference
 * matters — Omni paraphrases, pauses, and swallows words, and captions written
 * from the script drift out of sync within two seconds.
 */

const CACHE_DIR = path.join(GENERATED_ROOT, "captions");

export interface ClipTranscript extends AlignmentResult {
  /** What the model actually said, which is not always what it was asked to say. */
  transcript: string;
  /** True when the timings are estimated rather than measured. */
  estimated: boolean;
}

/**
 * Transcribe a generated clip and return word-level timings.
 *
 * Never throws. A missing transcript costs captions; a thrown error costs the
 * whole video, and the two are not close in value.
 */
export async function transcribeClip(
  clipUrl: string,
  expectedText: string,
  clipDurationMs: number,
): Promise<ClipTranscript> {
  const fallback = (): ClipTranscript => {
    const estimated = estimateAlignment(expectedText);
    // Stretch the estimate onto the clip's real duration so captions at least
    // begin and end with the picture.
    const scale = estimated.durationMs > 0 ? clipDurationMs / estimated.durationMs : 1;
    return {
      words: estimated.words.map((w) => ({
        ...w,
        startMs: Math.round(w.startMs * scale),
        endMs: Math.round(w.endMs * scale),
      })),
      breathGroupEndsMs: estimated.breathGroupEndsMs.map((m) => Math.round(m * scale)),
      durationMs: clipDurationMs,
      transcript: expectedText,
      estimated: true,
    };
  };

  if (!expectedText.trim()) {
    return { words: [], breathGroupEndsMs: [], durationMs: clipDurationMs, transcript: "", estimated: true };
  }
  if (!capabilities.tts.configured) return fallback();

  let wavPath: string | null = null;
  try {
    wavPath = await audioTrackOf(clipUrl);
    if (!wavPath) return fallback();

    const { SpeechClient } = await import("@google-cloud/speech");
    const { readFile } = await import("node:fs/promises");
    const client = new SpeechClient({
      ...googleCredentials(),
      projectId: env.gcpProjectId,
    });

    const [result] = await client.recognize({
      audio: { content: await readFile(wavPath) },
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 48000,
        audioChannelCount: 2,
        languageCode: "en-US",
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: false,
        model: "latest_short",
        useEnhanced: true,
        // The line we asked for is a strong prior. Omni's delivery is
        // conversational and the generic model mishears proper nouns; feeding it
        // the script recovers most of them.
        speechContexts: [{ phrases: expectedText.split(/\s+/).slice(0, 40), boost: 12 }],
      },
    });

    const words: TranscriptWord[] = [];
    for (const alt of result.results ?? []) {
      for (const w of alt.alternatives?.[0]?.words ?? []) {
        const text = (w.word ?? "").trim();
        if (!text) continue;
        words.push({
          word: text,
          startMs: toMs(w.startTime),
          endMs: toMs(w.endTime),
          emphasis: isEmphatic(text),
        });
      }
    }

    if (words.length === 0) return fallback();

    // A gap over 260ms is a breath, and a breath is the only place the editor
    // may cut without clipping a syllable.
    const breathGroupEndsMs: number[] = [];
    for (let i = 1; i < words.length; i++) {
      if (words[i]!.startMs - words[i - 1]!.endMs > 260) breathGroupEndsMs.push(words[i - 1]!.endMs);
    }
    breathGroupEndsMs.push(words.at(-1)!.endMs);

    return {
      words,
      breathGroupEndsMs,
      durationMs: Math.max(words.at(-1)!.endMs, clipDurationMs),
      transcript: words.map((w) => w.word).join(" "),
      estimated: false,
    };
  } catch {
    return fallback();
  } finally {
    if (wavPath) await rm(wavPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Pull the audio track out of a generated clip.
 *
 * Uses Remotion's bundled ffmpeg rather than a system one: the renderer is
 * already a hard dependency and its binary is guaranteed present, whereas a
 * system ffmpeg is not — this machine does not have one.
 */
async function audioTrackOf(clipUrl: string): Promise<string | null> {
  const source = path.join(GENERATED_ROOT, clipUrl.replace(/^\/generated\//, ""));
  try {
    await stat(source);
  } catch {
    return null;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const out = path.join(CACHE_DIR, `${createHash("sha1").update(clipUrl).digest("hex").slice(0, 16)}.wav`);

  await extractAudio({ videoSource: source, audioOutput: out, logLevel: "error" });
  return out;
}

/**
 * Which words carry the emphasis.
 *
 * Numbers and money first — they are the reason most of these videos exist, and
 * a highlighted figure is the single most reliable place for the eye to land.
 */
function isEmphatic(word: string): boolean {
  const bare = word.replace(/[^\p{L}\p{N}$€£%]/gu, "");
  if (/[\d$€£%]/.test(bare)) return true;
  if (/^[A-ZÀ-Ý]{2,}$/.test(bare)) return true;
  return bare.length >= 8;
}

function toMs(t: unknown): number {
  if (!t || typeof t !== "object") return 0;
  const d = t as { seconds?: number | string | { low?: number }; nanos?: number };
  const seconds =
    typeof d.seconds === "object" ? Number(d.seconds?.low ?? 0) : Number(d.seconds ?? 0);
  return Math.round(seconds * 1000 + (d.nanos ?? 0) / 1_000_000);
}
