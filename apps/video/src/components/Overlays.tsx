import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";

import type { Overlay } from "../schema";
import { clamp01 } from "./effects";

/** Shared type face. Loaded via @remotion/google-fonts in Root. */
const DISPLAY = "'Montserrat', 'Inter', sans-serif";

interface Props {
  overlay: Overlay;
}

export const OverlayLayer: React.FC<Props> = ({ overlay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  switch (overlay.type) {
    case "textBar":
      return <TextBar overlay={overlay} ms={ms} />;
    case "captions":
      return <Captions overlay={overlay} ms={ms} />;
    case "storyCard":
      return <StoryCard overlay={overlay} ms={ms} />;
    case "annotation":
      return <Annotation overlay={overlay} ms={ms} />;
    case "timer":
      return <Timer overlay={overlay} ms={ms} />;
    case "stepBadge":
      return <StepBadge overlay={overlay} ms={ms} />;
    case "commentCard":
      return <CommentCard overlay={overlay} ms={ms} />;
    case "chatBubble":
      return <ChatBubble overlay={overlay} ms={ms} />;
    default:
      return null;
  }
};

function within(ms: number, startMs: number, durationMs: number): boolean {
  return ms >= startMs && ms <= startMs + durationMs;
}

function justify(align: string): React.CSSProperties["justifyContent"] {
  return align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
}

/* -------------------------------------------------------------------------- */

const TextBar: React.FC<{ overlay: Extract<Overlay, { type: "textBar" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  if (!within(ms, o.startMs, o.durationMs)) return null;
  const t = ms - o.startMs;

  // The banner is a poster: it lands, then holds absolutely still. Any drift
  // during the hook window pulls the eye away from the face.
  let scale = 1;
  let opacity = 1;
  if (o.enter === "pop") {
    scale = interpolate(t, [0, 90, 170], [0.86, 1.06, 1], {
      easing: Easing.out(Easing.quad),
      extrapolateRight: "clamp",
    });
    opacity = clamp01(t / 70);
  } else if (o.enter === "slideUp") {
    opacity = clamp01(t / 90);
  }
  const exit = o.startMs + o.durationMs - ms;
  if (exit < 140) opacity *= clamp01(exit / 140);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: justify(o.anchor.align) as never,
        paddingTop: o.anchor.y,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          background: o.style.background,
          color: o.style.color,
          fontFamily: DISPLAY,
          fontWeight: o.style.fontWeight,
          fontSize: o.style.fontSize,
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
          textTransform: o.style.uppercase ? "uppercase" : "none",
          padding: `${o.style.paddingY}px ${o.style.paddingX}px`,
          borderRadius: o.style.radius,
          maxWidth: o.style.maxWidth,
          textAlign: "center",
          boxShadow: o.style.shadow ? "0 10px 40px rgba(0,0,0,0.55)" : "none",
          textWrap: "balance",
        }}
      >
        {o.text}
      </div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const Captions: React.FC<{ overlay: Extract<Overlay, { type: "captions" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  // Group into blocks once per render; the arrays are small.
  const blocks: Array<{ startMs: number; endMs: number; words: typeof o.words }> = [];
  for (let i = 0; i < o.words.length; i += o.wordsPerBlock) {
    const chunk = o.words.slice(i, i + o.wordsPerBlock);
    if (chunk.length) blocks.push({ startMs: chunk[0]!.startMs, endMs: chunk.at(-1)!.endMs, words: chunk });
  }

  const block = blocks.find((b) => ms >= b.startMs && ms <= b.endMs + 60);
  if (!block) return null;

  const t = ms - block.startMs;
  // Scale overshoot on entry, phoneme-aligned: 0.8 -> 1.15 -> 1.0 over 100ms.
  const scale = interpolate(t, [0, 55, 100], [0.82, 1.15, 1], {
    easing: Easing.out(Easing.quad),
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: o.anchor.y,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 940,
          transform: `scale(${scale})`,
        }}
      >
        {block.words.map((w, i) => {
          const active = ms >= w.startMs && ms <= w.endMs;
          return (
            <span
              key={`${w.word}-${i}`}
              style={{
                fontFamily: DISPLAY,
                fontWeight: 900,
                fontSize: o.style.fontSize,
                lineHeight: 1.05,
                color: active && w.emphasis ? o.style.highlight : o.style.color,
                textTransform: o.style.uppercase ? "uppercase" : "none",
                WebkitTextStroke: `${o.style.strokeWidth}px ${o.style.strokeColor}`,
                paintOrder: "stroke fill",
                letterSpacing: "-0.02em",
                // The active word sits slightly forward — the eye tracks it without
                // the block itself moving.
                transform: active ? "translateY(-4px) scale(1.04)" : "none",
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const StoryCard: React.FC<{ overlay: Extract<Overlay, { type: "storyCard" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  if (!within(ms, o.startMs, o.durationMs)) return null;
  const t = ms - o.startMs;

  let opacity = 1;
  let translateY = 0;
  if (o.enter === "fadeSlide") {
    opacity = clamp01(t / 260);
    translateY = interpolate(t, [0, 340], [14, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
  }
  const exit = o.startMs + o.durationMs - ms;
  if (exit < 260) opacity *= clamp01(exit / 260);

  const visibleText =
    o.enter === "typewriter"
      ? o.text.slice(0, Math.floor(clamp01(t / Math.max(o.durationMs * 0.55, 1)) * o.text.length))
      : o.text;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: justify(o.style.align) as never,
        paddingTop: o.anchor.y,
        paddingLeft: 90,
        paddingRight: 90,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: o.style.fontSize,
          lineHeight: 1.24,
          letterSpacing: "-0.025em",
          color: o.style.color,
          background: o.style.background,
          maxWidth: o.style.maxWidth,
          textAlign: o.style.align,
          textWrap: "balance",
          textShadow: o.style.shadow
            ? "0 4px 24px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)"
            : "none",
          padding: o.style.background === "transparent" ? 0 : "22px 30px",
          borderRadius: 18,
        }}
      >
        {visibleText}
      </div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const Annotation: React.FC<{ overlay: Extract<Overlay, { type: "annotation" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  if (!within(ms, o.startMs, o.durationMs)) return null;
  const t = ms - o.startMs;
  // Drawn on, as if by hand.
  const draw = clamp01(t / 420);
  // Three blinks at 4Hz once drawn, then hold.
  const blink = t > 460 && t < 1200 ? (Math.sin((t / 1000) * 4 * Math.PI * 2) > -0.4 ? 1 : 0.25) : 1;

  const perimeter = 2 * Math.PI * (o.width / 2);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg
        width={1080}
        height={1920}
        style={{ position: "absolute", inset: 0, opacity: blink }}
        viewBox="0 0 1080 1920"
      >
        <g transform={`translate(${o.x} ${o.y}) rotate(${o.rotation})`}>
          {o.shape === "circle" && (
            <ellipse
              cx={0}
              cy={0}
              rx={o.width / 2}
              ry={o.height / 2}
              fill="none"
              stroke={o.color}
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={perimeter}
              strokeDashoffset={perimeter * (1 - draw)}
            />
          )}
          {o.shape === "box" && (
            <rect
              x={-o.width / 2}
              y={-o.height / 2}
              width={o.width}
              height={o.height}
              rx={14}
              fill="none"
              stroke={o.color}
              strokeWidth={9}
              strokeDasharray={2 * (o.width + o.height)}
              strokeDashoffset={2 * (o.width + o.height) * (1 - draw)}
            />
          )}
          {o.shape === "underline" && (
            <line
              x1={-o.width / 2}
              y1={o.height / 2}
              x2={-o.width / 2 + o.width * draw}
              y2={o.height / 2}
              stroke={o.color}
              strokeWidth={11}
              strokeLinecap="round"
            />
          )}
          {o.shape === "arrow" && (
            <g>
              <line
                x1={-o.width / 2}
                y1={-o.height / 2}
                x2={-o.width / 2 + o.width * draw}
                y2={-o.height / 2 + o.height * draw}
                stroke={o.color}
                strokeWidth={11}
                strokeLinecap="round"
              />
              {draw > 0.85 && (
                <polygon
                  points={`${o.width / 2},${o.height / 2} ${o.width / 2 - 34},${o.height / 2 - 10} ${o.width / 2 - 10},${o.height / 2 - 34}`}
                  fill={o.color}
                />
              )}
            </g>
          )}
        </g>
        {o.label && (
          <text
            x={o.x}
            y={o.y + o.height / 2 + 52}
            fontFamily={DISPLAY}
            fontSize={34}
            fontWeight={800}
            fill={o.color}
            textAnchor="middle"
          >
            {o.label}
          </text>
        )}
      </svg>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const Timer: React.FC<{ overlay: Extract<Overlay, { type: "timer" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  if (!within(ms, o.startMs, o.durationMs)) return null;
  const elapsed = ms - o.startMs;
  const rawRemaining = o.mode === "countdown" ? o.fromMs - elapsed : elapsed;
  const value = o.freezeAtEnd ? Math.max(0, rawRemaining) : rawRemaining;
  const urgent = o.mode === "countdown" && value <= o.urgentBelowMs;
  const pulse = urgent ? 0.65 + 0.35 * Math.abs(Math.sin((ms / 1000) * Math.PI * 2)) : 1;

  const totalSec = Math.max(0, value) / 1000;
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(Math.floor(totalSec % 60)).padStart(2, "0");
  const cs = String(Math.floor((totalSec % 1) * 100)).padStart(2, "0");

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: justify(o.anchor.align) as never,
        paddingTop: o.anchor.y,
        paddingRight: 60,
        paddingLeft: 60,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 62,
          fontWeight: 800,
          color: urgent ? "#FF3B30" : "#FFFFFF",
          background: "rgba(0,0,0,0.62)",
          padding: "12px 24px",
          borderRadius: 14,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          opacity: pulse,
          border: urgent ? "3px solid #FF3B30" : "3px solid rgba(255,255,255,0.18)",
        }}
      >
        {mm}:{ss}.{cs}
      </div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const StepBadge: React.FC<{ overlay: Extract<Overlay, { type: "stepBadge" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  if (!within(ms, o.startMs, o.durationMs)) return null;
  const t = ms - o.startMs;
  const scale = interpolate(t, [0, 120, 200], [0.7, 1.1, 1], {
    easing: Easing.out(Easing.quad),
    extrapolateRight: "clamp",
  });
  const checked = o.checkAtMs !== undefined && ms >= o.checkAtMs;
  const checkT = checked ? clamp01((ms - (o.checkAtMs ?? 0)) / 260) : 0;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: justify(o.anchor.align) as never,
        paddingTop: o.anchor.y,
        paddingLeft: 70,
        paddingRight: 70,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          transform: `scale(${scale})`,
          background: "rgba(0,0,0,0.66)",
          borderRadius: 100,
          padding: "14px 28px 14px 14px",
        }}
      >
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: "50%",
            background: checked ? "#0F9D58" : "#FFFFFF",
            color: checked ? "#FFFFFF" : "#111111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 34,
            transform: `scale(${1 + checkT * 0.12})`,
          }}
        >
          {checked ? "✓" : o.index}
        </div>
        {o.label && (
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: 38,
              color: "#FFFFFF",
              letterSpacing: "-0.02em",
            }}
          >
            {o.label}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const CommentCard: React.FC<{ overlay: Extract<Overlay, { type: "commentCard" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  if (!within(ms, o.startMs, o.durationMs)) return null;
  const t = ms - o.startMs;
  const y = interpolate(t, [0, 320], [26, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: o.anchor.y,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity: clamp01(t / 200),
          background: "rgba(20,20,22,0.94)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 22,
          padding: "22px 26px",
          maxWidth: 880,
          display: "flex",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#6b7280,#374151)",
            flexShrink: 0,
          }}
        />
        <div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 26,
              fontWeight: 700,
              color: "#8b93a1",
              marginBottom: 6,
            }}
          >
            {o.author}
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 34,
              fontWeight: 600,
              color: "#FFFFFF",
              lineHeight: 1.3,
              letterSpacing: "-0.02em",
            }}
          >
            {o.text}
          </div>
          <div style={{ fontFamily: DISPLAY, fontSize: 24, color: "#8b93a1", marginTop: 10 }}>
            ♥ {o.likes}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------------- */

const ChatBubble: React.FC<{ overlay: Extract<Overlay, { type: "chatBubble" }>; ms: number }> = ({
  overlay: o,
  ms,
}) => {
  const typingStart = o.startMs;
  const bubbleStart = o.startMs + o.typingMs;
  if (ms < typingStart || ms > o.startMs + o.durationMs) return null;

  const isTyping = ms < bubbleStart;
  const outgoing = o.side === "outgoing";
  const t = ms - bubbleStart;
  const scale = isTyping
    ? 1
    : interpolate(t, [0, 130], [0.9, 1], { easing: Easing.out(Easing.quad), extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: outgoing ? "flex-end" : "flex-start",
        padding: "0 60px 420px",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: outgoing ? "bottom right" : "bottom left",
          background: outgoing ? "#0B84FE" : "#2C2C2E",
          color: "#FFFFFF",
          borderRadius: 28,
          padding: isTyping ? "22px 28px" : "20px 26px",
          maxWidth: 720,
          fontFamily: DISPLAY,
          fontSize: 36,
          fontWeight: 600,
          lineHeight: 1.28,
          letterSpacing: "-0.02em",
        }}
      >
        {isTyping ? (
          <span style={{ display: "flex", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.55)",
                  opacity: 0.4 + 0.6 * Math.abs(Math.sin((ms / 1000) * 3 + i * 0.6)),
                }}
              />
            ))}
          </span>
        ) : o.imageSrc ? (
          <img src={o.imageSrc} style={{ width: 520, borderRadius: 16, display: "block" }} alt="" />
        ) : (
          o.text
        )}
      </div>
    </AbsoluteFill>
  );
};
