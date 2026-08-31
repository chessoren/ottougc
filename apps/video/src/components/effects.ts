import { interpolate, Easing } from "remotion";

import type { Effect } from "../schema";

export interface Transform {
  scale: number;
  x: number;
  y: number;
  filter: string;
  opacity: number;
}

const EASINGS = {
  linear: (t: number) => t,
  easeOut: Easing.out(Easing.cubic),
  easeInOut: Easing.inOut(Easing.cubic),
  spring: Easing.out(Easing.back(1.4)),
} as const;

/**
 * Fold a clip's effect stack into one transform for the current frame.
 *
 * Effects compose multiplicatively on scale and additively on translation, which
 * is what lets a slow ken burns drift run *underneath* a punch-in without the
 * punch cancelling the drift — the thing that makes an edit feel hand-made
 * rather than keyframed by a script.
 */
export function resolveTransform(effects: Effect[], localMs: number, durationMs: number): Transform {
  let scale = 1;
  let x = 0;
  let y = 0;
  let opacity = 1;
  const filters: string[] = [];

  for (const e of effects) {
    switch (e.type) {
      case "kenBurns": {
        const p = EASINGS[e.easing](clamp01(localMs / Math.max(durationMs, 1)));
        scale *= e.fromScale + (e.toScale - e.fromScale) * p;
        x += e.fromX + (e.toX - e.fromX) * p;
        y += e.fromY + (e.toY - e.fromY) * p;
        break;
      }
      case "punchIn": {
        const t = localMs - e.atMs;
        if (t < 0 || t > e.attackMs + e.holdMs + e.releaseMs) break;
        let k: number;
        if (t < e.attackMs) {
          k = interpolate(t, [0, e.attackMs], [1, e.scale], {
            easing: Easing.out(Easing.quad),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
        } else if (t < e.attackMs + e.holdMs) {
          k = e.scale;
        } else {
          k = interpolate(t, [e.attackMs + e.holdMs, e.attackMs + e.holdMs + e.releaseMs], [e.scale, 1], {
            easing: Easing.inOut(Easing.quad),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
        }
        scale *= k;
        break;
      }
      case "shake": {
        // Two incommensurate frequencies so the motion never visibly repeats.
        const t = localMs / 1000;
        x += Math.sin(t * e.frequencyHz * Math.PI * 2) * e.amplitudePx;
        y += Math.cos(t * e.frequencyHz * 1.37 * Math.PI * 2) * e.amplitudePx * 0.7;
        break;
      }
      case "glitch": {
        const dt = localMs - e.atMs;
        const windowMs = (e.frames / 60) * 1000;
        if (dt >= 0 && dt < windowMs) {
          if (e.style === "invert") filters.push("invert(1)");
          else if (e.style === "crt") filters.push("contrast(2.4) saturate(0.2)");
          else filters.push("hue-rotate(90deg) saturate(2)");
          x += 8;
        }
        break;
      }
      case "color": {
        if (e.saturation !== 1) filters.push(`saturate(${e.saturation})`);
        if (e.contrast !== 1) filters.push(`contrast(${e.contrast})`);
        if (e.brightness !== 1) filters.push(`brightness(${e.brightness})`);
        if (e.hueRotate !== 0) filters.push(`hue-rotate(${e.hueRotate}deg)`);
        if (e.blurPx > 0) filters.push(`blur(${e.blurPx}px)`);
        break;
      }
      case "freeze":
      case "speed":
        // Applied at the source-time level, not as a transform.
        break;
    }
  }

  return { scale, x, y, opacity, filter: filters.join(" ") || "none" };
}

/**
 * Map a timeline instant to a position inside the source media, honouring speed
 * ramps and freeze holds.
 */
export function resolveSourceTime(effects: Effect[], localMs: number): number {
  let t = localMs;
  for (const e of effects) {
    if (e.type === "speed") t = t * e.rate;
    if (e.type === "freeze") {
      if (localMs > e.atMs + e.durationMs) t -= e.durationMs;
      else if (localMs > e.atMs) t = e.atMs;
    }
  }
  return Math.max(0, t);
}

/** Entry transition, expressed as an extra transform over the first frames. */
export function resolveTransition(
  transition: { type: string; durationMs: number; direction: string },
  localMs: number,
): Partial<Transform> & { clipPath?: string } {
  if (transition.type === "cut" || transition.durationMs <= 0) return {};
  const p = clamp01(localMs / transition.durationMs);
  if (p >= 1) return {};

  const sign = transition.direction === "right" || transition.direction === "down" ? -1 : 1;

  switch (transition.type) {
    case "fade":
      return { opacity: p };
    case "slide":
      return { x: (1 - p) * 1080 * sign, opacity: 1 };
    case "whipPan":
      // Motion blur plus overshoot: the shot arrives as if the camera whipped to it.
      return {
        x: (1 - p) * 420 * sign,
        filter: `blur(${(1 - p) * 22}px)`,
        opacity: 1,
      };
    case "zoomBlur":
      return { scale: 1 + (1 - p) * 0.35, filter: `blur(${(1 - p) * 14}px)`, opacity: p };
    case "wipe":
      return {
        clipPath:
          transition.direction === "left"
            ? `inset(0 ${(1 - p) * 100}% 0 0)`
            : `inset(0 0 0 ${(1 - p) * 100}%)`,
      };
    default:
      return {};
  }
}

/** Piecewise-linear gain envelope with ramps. */
export function resolveGain(
  automation: Array<{ atMs: number; gain: number; rampMs: number }>,
  baseGain: number,
  ms: number,
): number {
  if (automation.length === 0) return baseGain;

  let prev = automation[0]!;
  if (ms <= prev.atMs) return prev.gain * baseGain;

  for (let i = 1; i < automation.length; i++) {
    const next = automation[i]!;
    if (ms < next.atMs) {
      const rampStart = Math.max(prev.atMs, next.atMs - next.rampMs);
      if (ms <= rampStart) return prev.gain * baseGain;
      const p = clamp01((ms - rampStart) / Math.max(next.atMs - rampStart, 1));
      return (prev.gain + (next.gain - prev.gain) * p) * baseGain;
    }
    prev = next;
  }
  return prev.gain * baseGain;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
