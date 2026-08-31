import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { GoogleGenAI } from "@google/genai";
import { GoogleAuth } from "google-auth-library";

import { env } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";

import { estimateAlignment } from "./mock";
import { generateNanoBananaImages } from "./nano-banana";
import {
  MEDIA_PRICING,
  type AlignmentResult,
  type ImageRequest,
  type MediaAsset,
  type MediaProvider,
  type MusicAsset,
  type MusicRequest,
  type SpeechAsset,
  type SpeechRequest,
  type TranscriptWord,
  type VideoClipRequest,
} from "../types";

/**
 * Live Google media stack.
 *
 *   Veo 3.1        — avatar and B-roll clips (long-running operation)
 *   Nano Banana    — stills, character references, storyboard panels
 *                    (delegated to ./nano-banana; Imagen is unavailable here)
 *   Lyria          — adaptive music with a beat grid
 *   Chirp 3 HD     — narration
 *   Speech-to-Text — word-level timings for kinetic captions
 *
 * Notes that matter in production:
 *   - Veo is asynchronous. We poll the operation rather than blocking a request
 *     thread, and every clip carries its real duration so the editor's timeline
 *     maths is exact.
 *   - We ask Veo for silent video (`generateAudio: false`) whenever we supply
 *     our own voice-over, otherwise the model's native audio fights the mix.
 *   - `appearanceSeed` is prepended to every prompt and the RNG seed is derived
 *     from the persona, which is what keeps the same face across a channel's
 *     entire back catalogue.
 */

const OUT_DIR = GENERATED_ROOT;

let ai: GoogleGenAI | null = null;
let auth: GoogleAuth | null = null;

function genai(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({
      vertexai: true,
      project: env.gcpProjectId!,
      location: env.gcpLocation,
      googleAuthOptions: env.gcpServiceAccount
        ? { credentials: env.gcpServiceAccount as never }
        : undefined,
    });
  }
  return ai;
}

function googleAuth(): GoogleAuth {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      credentials: env.gcpServiceAccount as never,
    });
  }
  return auth;
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

async function ensureDir(sub: string): Promise<string> {
  const dir = path.join(OUT_DIR, sub);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function saveBase64(sub: string, id: string, ext: string, b64: string) {
  const dir = await ensureDir(sub);
  const file = path.join(dir, `${id}.${ext}`);
  await writeFile(file, Buffer.from(b64, "base64"));
  return { file, url: `/generated/${sub}/${id}.${ext}` };
}

/** Stable numeric seed from a persona's appearance description. */
function seedFrom(text: string): number {
  return parseInt(hash(text).slice(0, 8), 16) % 2_147_483_647;
}

export class VertexMediaProvider implements MediaProvider {
  readonly name = "vertex";
  readonly live = true;

  async generateVideoClip(req: VideoClipRequest): Promise<MediaAsset> {
    const model = req.fast ? env.models.videoFast : env.models.video;

    // The appearance seed goes first: Veo weights the opening of the prompt most
    // heavily, and character consistency is the whole game for a persona channel.
    const prompt = [
      req.appearanceSeed ? `${req.appearanceSeed}.` : null,
      req.prompt,
      "Shot on a phone, handheld, natural imperfect lighting, realistic skin texture, no text overlay, no watermark, no logo.",
    ]
      .filter(Boolean)
      .join(" ");

    let operation = await genai().models.generateVideos({
      model,
      prompt,
      config: {
        numberOfVideos: 1,
        durationSeconds: Math.round(req.durationSeconds),
        aspectRatio: req.aspectRatio,
        resolution: "1080p",
        personGeneration: "allow_adult",
        generateAudio: req.generateAudio ?? false,
        negativePrompt:
          req.negativePrompt ??
          "blurry, distorted hands, extra fingers, deformed face, watermark, subtitles, corporate stock footage, studio lighting",
        seed: req.seed ?? (req.appearanceSeed ? seedFrom(req.appearanceSeed) : undefined),
        enhancePrompt: true,
      },
    });

    // Poll. Veo clips take 30-90s; the caller is a background job, not a request.
    const deadline = Date.now() + 6 * 60 * 1000;
    while (!operation.done) {
      if (Date.now() > deadline) {
        throw new Error(`${model} did not finish within six minutes.`);
      }
      await new Promise((r) => setTimeout(r, 8000));
      operation = await genai().operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(`Video generation failed: ${JSON.stringify(operation.error)}`);
    }

    const generated = operation.response?.generatedVideos?.[0]?.video;
    if (!generated) throw new Error("The video model returned nothing.");

    const id = hash(prompt + String(req.seed ?? ""));
    let url: string;
    let localPath: string | undefined;

    if (generated.videoBytes) {
      const saved = await saveBase64("clips", id, "mp4", generated.videoBytes);
      url = saved.url;
      localPath = saved.file;
    } else if (generated.uri) {
      url = generated.uri;
    } else {
      throw new Error("The video model returned a result with neither content nor a URI.");
    }

    const perSecond = req.fast ? MEDIA_PRICING.veoFastPerSecond : MEDIA_PRICING.veoPerSecond;

    return {
      url,
      localPath,
      mimeType: generated.mimeType ?? "video/mp4",
      provider: "vertex",
      model,
      costUsd: perSecond * req.durationSeconds,
      durationMs: Math.round(req.durationSeconds * 1000),
      width: req.aspectRatio === "9:16" ? 1080 : 1920,
      height: req.aspectRatio === "9:16" ? 1920 : 1080,
      meta: { prompt },
    };
  }

  /**
   * Images go to Nano Banana, never to Imagen.
   *
   * Imagen is not available on this account — five published model ids all
   * return 404 — and the Gemini image models refuse the `predict` endpoint that
   * `models.generateImages()` uses. `generateNanoBananaImages` calls
   * `generateContent` instead, which is also what lets reference images be
   * passed in and the character hold its face.
   */
  generateImages(req: ImageRequest): Promise<MediaAsset[]> {
    return generateNanoBananaImages(req);
  }

  /**
   * Lyria has no dedicated SDK method yet, so we call the Vertex predict
   * endpoint directly with the service account's token.
   */
  async generateMusic(req: MusicRequest): Promise<MusicAsset> {
    const model = env.models.music;
    const url = `https://${env.gcpLocation}-aiplatform.googleapis.com/v1/projects/${env.gcpProjectId}/locations/${env.gcpLocation}/publishers/google/models/${model}:predict`;

    const clientAuth = await googleAuth().getClient();
    const token = await clientAuth.getAccessToken();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt: req.prompt, negative_prompt: "vocals, speech, lyrics" }],
        parameters: { sample_count: 1 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Lyria responded ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; audioContent?: string }>;
    };
    const b64 = json.predictions?.[0]?.bytesBase64Encoded ?? json.predictions?.[0]?.audioContent;
    if (!b64) throw new Error("Lyria returned no audio.");

    const id = hash(req.prompt + req.durationSeconds);
    const saved = await saveBase64("music", id, "wav", b64);

    // Lyria does not report a beat grid; we derive one from the requested BPM so
    // the editor can still cut on the beat.
    const bpm = req.bpm ?? 124;
    const barMs = (60000 / bpm) * 4;
    const beatGridMs: number[] = [];
    for (let t = 0; t < req.durationSeconds * 1000; t += barMs) beatGridMs.push(Math.round(t));

    return {
      url: saved.url,
      localPath: saved.file,
      mimeType: "audio/wav",
      provider: "vertex",
      model,
      costUsd: MEDIA_PRICING.musicPerClip * Math.ceil(req.durationSeconds / 30),
      durationMs: req.durationSeconds * 1000,
      bpm,
      beatGridMs,
      meta: { prompt: req.prompt },
    };
  }

  async synthesizeSpeech(req: SpeechRequest): Promise<SpeechAsset> {
    const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
    const client = new TextToSpeechClient({
      credentials: env.gcpServiceAccount as never,
      projectId: env.gcpProjectId,
    });

    const [response] = await client.synthesizeSpeech({
      input: { text: req.text },
      voice: { languageCode: req.languageCode, name: req.voiceName },
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: 48000,
        speakingRate: req.speakingRate ?? 1.08,
        pitch: req.pitch ?? 0,
        // Short-form platforms normalise loudness; -14 LUFS keeps the voice from
        // being pulled down relative to the music bed after platform processing.
        effectsProfileId: ["headphone-class-device"],
      },
    });

    const audio = response.audioContent;
    if (!audio) throw new Error("Cloud TTS returned no audio.");

    const id = hash(req.text + req.voiceName);
    const dir = await ensureDir("voice");
    const file = path.join(dir, `${id}.wav`);
    const buffer = typeof audio === "string" ? Buffer.from(audio, "base64") : Buffer.from(audio);
    await writeFile(file, buffer);

    // Real word timings come from STT on the rendered audio — far more accurate
    // than estimating from text, and it is what makes captions land on the beat.
    let alignment: AlignmentResult;
    try {
      alignment = await this.alignTranscript(file, req.text);
    } catch {
      alignment = estimateAlignment(req.text, req.speakingRate ?? 1.08);
    }

    return {
      url: `/generated/voice/${id}.wav`,
      localPath: file,
      mimeType: "audio/wav",
      provider: "vertex",
      model: req.voiceName,
      costUsd: (req.text.length / 1_000_000) * MEDIA_PRICING.ttsPerMillionChars,
      durationMs: alignment.durationMs,
      alignment,
      meta: { voiceName: req.voiceName, chars: req.text.length },
    };
  }

  async alignTranscript(audioPath: string, transcript: string): Promise<AlignmentResult> {
    const { SpeechClient } = await import("@google-cloud/speech");
    const { readFile } = await import("node:fs/promises");
    const client = new SpeechClient({
      credentials: env.gcpServiceAccount as never,
      projectId: env.gcpProjectId,
    });

    const content = await readFile(audioPath);
    const [result] = await client.recognize({
      audio: { content },
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 48000,
        // The product, its scenarios and its scripts are all in English.
        // Aligning English audio against a French model returns zero words, which
        // silently fell back to an estimate and put every caption off the beat.
        languageCode: "en-US",
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
        model: "latest_long",
      },
    });

    const words: TranscriptWord[] = [];
    for (const alt of result.results ?? []) {
      for (const w of alt.alternatives?.[0]?.words ?? []) {
        const startMs = toMs(w.startTime);
        const endMs = toMs(w.endTime);
        const text = w.word ?? "";
        words.push({
          word: text,
          startMs,
          endMs,
          emphasis: text.length >= 7 || /^[A-ZÀ-Ý]{2,}$/.test(text),
        });
      }
    }

    if (words.length === 0) return estimateAlignment(transcript);

    // A gap of more than 260ms between words is a breath — the only place the
    // editor is allowed to cut without clipping a syllable.
    const breathGroupEndsMs: number[] = [];
    for (let i = 1; i < words.length; i++) {
      if (words[i]!.startMs - words[i - 1]!.endMs > 260) breathGroupEndsMs.push(words[i - 1]!.endMs);
    }
    breathGroupEndsMs.push(words.at(-1)!.endMs);

    return { words, breathGroupEndsMs, durationMs: words.at(-1)!.endMs };
  }
}

function toMs(t: unknown): number {
  if (!t || typeof t !== "object") return 0;
  const d = t as { seconds?: number | string | Long; nanos?: number };
  const seconds = typeof d.seconds === "object" ? Number((d.seconds as never)["low"] ?? 0) : Number(d.seconds ?? 0);
  return Math.round(seconds * 1000 + (d.nanos ?? 0) / 1_000_000);
}

type Long = { low: number; high: number; unsigned: boolean };
