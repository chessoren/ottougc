/**
 * Generate the sound-effect library.
 *
 * The editing tool has always offered eleven presets by name and written
 * `/sfx/<preset>.wav` into the timeline. The folder did not exist. Nothing
 * complained until an agent — correctly, following its own instruction that more
 * than 50ms of opening silence kills the hook — placed one, and the render died
 * on a 404 after every clip had already been generated and paid for.
 *
 * So the library is synthesised here rather than sourced: eleven short WAVs,
 * generated from oscillators and noise, committed next to the renderer. No
 * licence to track, no download step, and the preset list in the tool and the
 * files on disk cannot drift apart because both come from `PRESETS` below.
 *
 *   node apps/video/scripts/make-sfx.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 48000;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");

/* ── Building blocks ─────────────────────────────────────────────────────── */

const sine = (t, hz) => Math.sin(2 * Math.PI * hz * t);
const noise = () => Math.random() * 2 - 1;

/** Exponential decay — how almost every real percussive sound behaves. */
const decay = (t, tau) => Math.exp(-t / tau);

/** Short raised-cosine fade, to keep any edit from clicking. */
function envelope(t, duration, attack = 0.004, release = 0.03) {
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  const remaining = duration - t;
  if (remaining < release) return 0.5 - 0.5 * Math.cos((Math.PI * remaining) / release);
  return 1;
}

/** One-pole low-pass, for turning white noise into air rather than hiss. */
function lowPass(samples, cutoffHz) {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / RATE);
  let state = 0;
  return samples.map((s) => (state += alpha * (s - state)));
}

/**
 * Make a buffer loop without a seam.
 *
 * A looped file whose first and last samples do not agree produces a click at
 * every repeat — every eight seconds, under the whole video. Equal-power
 * crossfading the tail back over the head removes it: the join is continuous in
 * value and in energy, which is what the ear is actually listening for.
 */
function seamless(samples, crossfadeSeconds) {
  const fade = Math.min(Math.round(crossfadeSeconds * RATE), Math.floor(samples.length / 3));
  const out = samples.slice(0, samples.length - fade);
  for (let i = 0; i < fade; i++) {
    const p = i / fade;
    // sin/cos keeps the summed power constant through the overlap, where a
    // linear fade would dip in the middle and read as a dropout.
    const head = Math.sin((p * Math.PI) / 2);
    const tail = Math.cos((p * Math.PI) / 2);
    out[i] = out[i] * head + samples[samples.length - fade + i] * tail;
  }
  return out;
}

function render(duration, fn) {
  const count = Math.round(duration * RATE);
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = fn(i / RATE, duration);
  return out;
}

/** Normalise to a comfortable peak. These sit under a voice, never over it. */
function normalise(samples, peak = 0.72) {
  const max = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0) || 1;
  const gain = peak / max;
  return samples.map((s) => s * gain);
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/* ── The eleven presets ──────────────────────────────────────────────────── */

const PRESETS = {
  /** Air rushing past, then a body hit. The transition workhorse. */
  whoosh_impact: () => {
    const air = lowPass(
      render(0.42, (t) => noise() * Math.sin((Math.PI * t) / 0.42) ** 2),
      900 + 5200,
    );
    return render(0.42, (t, d) => {
      const i = Math.round(t * RATE);
      const thump = sine(t, 70 - 28 * t) * decay(t, 0.09) * 0.9;
      return (air[i] * 0.85 + thump) * envelope(t, d, 0.002, 0.08);
    });
  },

  /** A bubble. Pitch rises through the transient, which is what makes it "pop". */
  pop_transition: () =>
    render(0.16, (t, d) => sine(t, 420 + 900 * t) * decay(t, 0.028) * envelope(t, d, 0.001, 0.04)),

  /** A key bottoming out. Eight milliseconds of noise and nothing else. */
  keyboard_haptic: () =>
    render(0.05, (t, d) => (noise() * decay(t, 0.006) + sine(t, 1800) * decay(t, 0.004) * 0.4) * envelope(t, d, 0.0005, 0.02)),

  /** Confirmation: a fifth, struck. */
  validation_ding: () =>
    render(0.7, (t, d) => (sine(t, 880) * 0.6 + sine(t, 1320) * 0.4) * decay(t, 0.17) * envelope(t, d, 0.002, 0.12)),

  /** Same idea, lower and longer, with the inharmonic partial a bell has. */
  bell_validate: () =>
    render(1.1, (t, d) =>
      (sine(t, 660) * 0.5 + sine(t, 1980) * 0.22 + sine(t, 2640) * 0.12) *
      decay(t, 0.3) *
      envelope(t, d, 0.002, 0.2),
    ),

  /** A rise that lands on the beat after it. Four notes up a pentatonic. */
  magic_harp_rise: () => {
    const steps = [523, 659, 784, 988, 1319];
    return render(0.85, (t, d) => {
      let value = 0;
      steps.forEach((hz, i) => {
        const start = i * 0.115;
        if (t >= start) value += sine(t - start, hz) * decay(t - start, 0.18) * (0.9 - i * 0.1);
      });
      return value * 0.45 * envelope(t, d, 0.002, 0.15);
    });
  },

  /** A phone notification: two quick tones, the second higher. */
  notification_bip: () =>
    render(0.34, (t, d) => {
      const first = t < 0.12 ? sine(t, 1046) * decay(t, 0.045) : 0;
      const second = t >= 0.13 ? sine(t - 0.13, 1568) * decay(t - 0.13, 0.055) : 0;
      return (first + second) * 0.8 * envelope(t, d, 0.001, 0.05);
    }),

  /** Sent: a short upward swoosh with a tail. */
  imessage_send: () => {
    const air = lowPass(render(0.3, () => noise()), 2600);
    return render(0.3, (t, d) => {
      const i = Math.round(t * RATE);
      return (sine(t, 700 + 1500 * t) * decay(t, 0.07) + air[i] * decay(t, 0.05) * 0.35) * envelope(t, d, 0.002, 0.07);
    });
  },

  /** Received: two descending taps. */
  imessage_receive: () =>
    render(0.32, (t, d) => {
      const first = t < 0.11 ? sine(t, 1320) * decay(t, 0.035) : 0;
      const second = t >= 0.12 ? sine(t - 0.12, 990) * decay(t - 0.12, 0.05) : 0;
      return (first + second) * 0.75 * envelope(t, d, 0.001, 0.06);
    }),

  /** The record stopping: pitch and speed falling away together. */
  vinyl_stop: () => {
    const crackle = lowPass(render(0.75, () => noise()), 3800);
    return render(0.75, (t, d) => {
      const i = Math.round(t * RATE);
      const fall = Math.max(0.08, 1 - t / 0.6);
      return (sine(t, 320 * fall) * 0.55 + crackle[i] * 0.22 * fall) * decay(t, 0.34) * envelope(t, d, 0.004, 0.14);
    });
  },

  /** The quietest thing in the library. A UI tick, not an event. */
  soft_haptic_click: () =>
    render(0.045, (t, d) => (noise() * 0.5 + sine(t, 950)) * decay(t, 0.005) * 0.55 * envelope(t, d, 0.0005, 0.018)),

  /**
   * Eight seconds of a room being quiet, meant to loop.
   *
   * Not a sound effect — a floor. Omni's clip audio stops when the speech stops,
   * so a shot held past its last word falls to digital silence, and a scenario
   * whose shape says `music: NONE` has nothing underneath it at all. A rendered
   * video measured -90 dBFS for five seconds in the middle: not quiet, *absent*.
   * Nothing gives a generated video away faster.
   *
   * Heavily low-passed noise with a slow wander, plus the faint mains hum that
   * is in every real indoor recording. It sits around -46 dBFS: inaudible as a
   * sound, audible as the absence of a hole.
   */
  room_tone: () => {
    const air = lowPass(lowPass(render(8, () => noise()), 420), 260);
    const raw = render(8, (t) => {
      const i = Math.round(t * RATE);
      // The wander completes exactly two cycles across the file, so its value
      // and slope match at both ends.
      const wander = 0.75 + 0.25 * Math.sin((2 * Math.PI * 2 * t) / 8);
      // 50 Hz and 100 Hz both complete whole cycles in 8 s, so the hum is
      // continuous across the loop point too.
      const hum = sine(t, 50) * 0.05 + sine(t, 100) * 0.02;
      return (air[i] * wander + hum) * 0.5;
    });
    return seamless(raw, 0.6);
  },
};

/** Room tone is a floor, not an event: it is normalised far lower. */
const QUIET = new Set(["room_tone"]);

/* ── Write them out ──────────────────────────────────────────────────────── */

await mkdir(OUT, { recursive: true });
for (const [name, make] of Object.entries(PRESETS)) {
  const file = path.join(OUT, `${name}.wav`);
  const peak = QUIET.has(name) ? 0.055 : name === "soft_haptic_click" ? 0.45 : 0.72;
  await writeFile(file, toWav(normalise(make(), peak)));
  console.log(`${name}.wav`);
}
console.log(`\n${Object.keys(PRESETS).length} sound effects written to ${OUT}`);
