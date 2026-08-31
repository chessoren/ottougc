import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GENERATED_ROOT } from "@/lib/paths";

import type {
  AlignmentResult,
  ImageRequest,
  MediaAsset,
  MediaProvider,
  MusicAsset,
  MusicRequest,
  SpeechAsset,
  SpeechRequest,
  TranscriptWord,
  VideoClipRequest,
} from "../types";

/**
 * Offline media provider.
 *
 * It does not pretend to be Veo. What it does is produce **real files with real
 * durations and real timing metadata**, so every downstream stage — the editor's
 * timeline maths, the caption alignment, the Remotion render, the QA safe-zone
 * check — executes for real. The only thing missing is photographic content.
 *
 * That distinction matters: a mock that returns fake URLs would let the pipeline
 * "pass" while every timing bug stays hidden until the day the credentials land.
 */

const OUT_DIR = GENERATED_ROOT;

async function ensureDir(sub: string): Promise<string> {
  const dir = path.join(OUT_DIR, sub);
  await mkdir(dir, { recursive: true });
  return dir;
}

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

/** Stable pseudo-palette derived from the prompt, so the same shot looks the same. */
function palette(seedText: string): { a: string; b: string; ink: string } {
  const h = parseInt(hash(seedText).slice(0, 6), 16);
  const hue = h % 360;
  return {
    a: `hsl(${hue} 42% 22%)`,
    b: `hsl(${(hue + 38) % 360} 48% 42%)`,
    ink: `hsl(${(hue + 180) % 360} 90% 92%)`,
  };
}

function svgCard(opts: {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  badge: string;
  seedText: string;
}): string {
  const { a, b, ink } = palette(opts.seedText);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Wrap the prompt onto lines so long prompts stay readable in the preview.
  const words = opts.subtitle.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 34) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
    if (lines.length >= 7) break;
  }
  if (line.trim() && lines.length < 8) lines.push(line.trim());

  const cx = opts.width / 2;
  const startY = opts.height / 2 - (lines.length * 46) / 2 + 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="100%" stop-color="${b}"/>
    </linearGradient>
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/></filter>
  </defs>
  <rect width="${opts.width}" height="${opts.height}" fill="url(#g)"/>
  <rect width="${opts.width}" height="${opts.height}" filter="url(#n)" opacity="0.10"/>
  <rect x="48" y="48" width="${opts.width - 96}" height="${opts.height - 96}" fill="none" stroke="${ink}" stroke-opacity="0.22" stroke-width="2" rx="24"/>
  <text x="${cx}" y="${opts.height * 0.16}" font-family="Inter, sans-serif" font-size="30" font-weight="700" fill="${ink}" fill-opacity="0.55" text-anchor="middle" letter-spacing="4">${esc(opts.badge.toUpperCase())}</text>
  <text x="${cx}" y="${opts.height * 0.24}" font-family="Inter, sans-serif" font-size="52" font-weight="800" fill="${ink}" text-anchor="middle">${esc(opts.title)}</text>
  ${lines
    .map(
      (l, i) =>
        `<text x="${cx}" y="${startY + i * 46}" font-family="Inter, sans-serif" font-size="34" font-weight="500" fill="${ink}" fill-opacity="0.82" text-anchor="middle">${esc(l)}</text>`,
    )
    .join("\n  ")}
  <text x="${cx}" y="${opts.height - 90}" font-family="Inter, sans-serif" font-size="26" font-weight="600" fill="${ink}" fill-opacity="0.45" text-anchor="middle">OttoUGC — média de substitution (aucune clé Google configurée)</text>
</svg>`;
}

/**
 * Minimal 16-bit PCM WAV writer.
 *
 * Produces a barely-audible tone rather than digital silence: a silent track
 * hides mixing bugs (wrong sample rate, wrong channel count, ducking applied to
 * the wrong bus) that a tone makes immediately obvious in review.
 */
function wav(durationMs: number, frequency: number, amplitude = 0.06): Buffer {
  const sampleRate = 48000;
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // Gentle envelope so the file does not click at the boundaries.
    const t = i / sampleRate;
    const env = Math.min(1, t * 8) * Math.min(1, (samples - i) / sampleRate / 0.05 + 0.0001);
    const v = Math.sin(2 * Math.PI * frequency * t) * amplitude * Math.min(env, 1);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Estimate word timings from the text itself.
 *
 * French neutral narration runs at roughly 4.1 syllables/second (the brief's
 * target band is 3.8-4.4). We weight each word by its syllable count rather than
 * its character count, which tracks real speech far more closely and makes the
 * kinetic captions land on the right words even offline.
 */
export function estimateAlignment(text: string, speakingRate = 1.08): AlignmentResult {
  const syllablesPerSecond = 4.1 * speakingRate;
  const tokens = text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const words: TranscriptWord[] = [];
  const breathGroupEndsMs: number[] = [];
  let cursor = 0;

  for (const token of tokens) {
    const syllables = countSyllables(token);
    const durationMs = Math.max(120, (syllables / syllablesPerSecond) * 1000);
    const clean = token.replace(/[^\p{L}\p{N}'-]/gu, "");
    words.push({
      word: token,
      startMs: Math.round(cursor),
      endMs: Math.round(cursor + durationMs),
      // Emphasise long or capitalised words — these are the impact words.
      emphasis: clean.length >= 7 || /^[A-ZÀ-Ý]{2,}$/.test(clean),
    });
    cursor += durationMs;

    // Punctuation ends a breath group and adds a pause.
    if (/[.!?…]$/.test(token)) {
      cursor += 320;
      breathGroupEndsMs.push(Math.round(cursor));
    } else if (/[,;:]$/.test(token)) {
      cursor += 150;
      breathGroupEndsMs.push(Math.round(cursor));
    }
  }

  if (breathGroupEndsMs.at(-1) !== Math.round(cursor)) breathGroupEndsMs.push(Math.round(cursor));

  return { words, breathGroupEndsMs, durationMs: Math.round(cursor) };
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-zà-ÿ]/g, "");
  if (!w) return 1;
  // Vowel groups, with a correction for French silent final "e".
  const groups = w.match(/[aeiouyàâäéèêëîïôöùûüœ]+/g);
  let n = groups ? groups.length : 1;
  if (/e$/.test(w) && n > 1) n -= 1;
  return Math.max(1, n);
}

/**
 * The one line worth putting on a slate.
 *
 * The compiled prompt runs to a dozen lines; rendered small it is unreadable
 * noise. The ACTION line is the only part that says what this shot was meant to
 * be, so that is what the slate shows.
 */
function slateLine(prompt: string): string {
  const action = /^ACTION:\s*(.+)$/m.exec(prompt)?.[1];
  const subject = /^SUBJECT[^:]*:\s*(.+)$/m.exec(prompt)?.[1];
  const line = action ?? subject ?? prompt.split("\n")[0] ?? prompt;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

export class MockMediaProvider implements MediaProvider {
  readonly name = "mock";
  readonly live = false;

  async generateVideoClip(req: VideoClipRequest): Promise<MediaAsset> {
    const dir = await ensureDir("clips");
    const id = hash(req.prompt + (req.appearanceSeed ?? "") + String(req.seed ?? 0));
    const [w, h] = req.aspectRatio === "9:16" ? [1080, 1920] : req.aspectRatio === "1:1" ? [1080, 1080] : [1920, 1080];

    // A still + declared duration. Remotion animates it (slow push-in), so the
    // timeline behaves exactly as it will with a real clip.
    const file = path.join(dir, `${id}.svg`);
    await writeFile(
      file,
      // A production slate, not a fake video. It says what shot it stands for and
      // that it is a stand-in, because a placeholder dressed up to look like
      // content is how "the pipeline ran" gets mistaken for "this is watchable".
      svgCard({
        width: w,
        height: h,
        title: "NO VIDEO MODEL",
        subtitle: slateLine(req.prompt),
        badge: `stand-in · ${req.durationSeconds}s`,
        seedText: req.prompt,
      }),
      "utf8",
    );

    return {
      url: `/generated/clips/${id}.svg`,
      localPath: file,
      mimeType: "image/svg+xml",
      provider: "mock",
      model: "stand-in",
      costUsd: 0,
      durationMs: Math.round(req.durationSeconds * 1000),
      width: w,
      height: h,
      // Every asset from this provider is labelled. QA refuses to publish a post
      // that contains one, which is what keeps "the pipeline ran" from being
      // mistaken for "there is something worth publishing".
      meta: { isPlaceholder: true, animateAsClip: true, prompt: req.prompt },
    };
  }

  async generateImages(req: ImageRequest): Promise<MediaAsset[]> {
    const dir = await ensureDir("images");
    const count = req.count ?? 1;
    const [w, h] =
      req.aspectRatio === "9:16"
        ? [1080, 1920]
        : req.aspectRatio === "4:5"
          ? [1080, 1350]
          : req.aspectRatio === "1:1"
            ? [1080, 1080]
            : [1920, 1080];

    const out: MediaAsset[] = [];
    for (let i = 0; i < count; i++) {
      const id = hash(`${req.prompt}#${req.seed ?? 0}#${i}`);
      const file = path.join(dir, `${id}.svg`);
      await writeFile(
        file,
        svgCard({
          width: w,
          height: h,
          title: `IMAGE ${i + 1}/${count}`,
          subtitle: req.prompt,
          badge: req.hiFi ? "imagen 4" : "gemini image",
          seedText: `${req.prompt}#${req.seed ?? 0}`,
        }),
        "utf8",
      );
      out.push({
        url: `/generated/images/${id}.svg`,
        localPath: file,
        mimeType: "image/svg+xml",
        provider: "mock",
        model: "mock-image",
        costUsd: 0,
        width: w,
        height: h,
        meta: { isPlaceholder: true, prompt: req.prompt },
      });
    }
    return out;
  }

  async generateMusic(req: MusicRequest): Promise<MusicAsset> {
    const dir = await ensureDir("music");
    const id = hash(req.prompt + req.durationSeconds);
    const file = path.join(dir, `${id}.wav`);
    await writeFile(file, wav(req.durationSeconds * 1000, 110, 0.03));

    const bpm = req.bpm ?? 124;
    const beatMs = 60000 / bpm;
    const beatGridMs: number[] = [];
    for (let t = 0; t < req.durationSeconds * 1000; t += beatMs * 4) {
      beatGridMs.push(Math.round(t));
    }

    return {
      url: `/generated/music/${id}.wav`,
      localPath: file,
      mimeType: "audio/wav",
      provider: "mock",
      model: "mock-lyria",
      costUsd: 0,
      durationMs: req.durationSeconds * 1000,
      bpm,
      beatGridMs,
      meta: { isPlaceholder: true, prompt: req.prompt },
    };
  }

  async synthesizeSpeech(req: SpeechRequest): Promise<SpeechAsset> {
    const dir = await ensureDir("voice");
    const id = hash(req.text + req.voiceName);
    const alignment = estimateAlignment(req.text, req.speakingRate ?? 1.08);
    const file = path.join(dir, `${id}.wav`);
    await writeFile(file, wav(alignment.durationMs, 196, 0.05));

    return {
      url: `/generated/voice/${id}.wav`,
      localPath: file,
      mimeType: "audio/wav",
      provider: "mock",
      model: "mock-tts",
      costUsd: 0,
      durationMs: alignment.durationMs,
      alignment,
      meta: { isPlaceholder: true, voiceName: req.voiceName, chars: req.text.length },
    };
  }

  async alignTranscript(_audioPath: string, transcript: string): Promise<AlignmentResult> {
    return estimateAlignment(transcript);
  }
}
