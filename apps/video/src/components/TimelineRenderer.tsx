import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import type { AudioClip, Timeline, VideoClip } from "../schema";
import { resolveGain, resolveTransform, resolveTransition, resolveSourceTime } from "./effects";
import { OverlayLayer } from "./Overlays";

/**
 * Resolve an asset reference to a URL the renderer can actually fetch.
 *
 * The pipeline stores media as root-relative paths ("/generated/clips/x.mp4")
 * because that is what the web app serves them under. Remotion, however, serves
 * its public directory beneath a content-hashed prefix, so a root-relative path
 * 404s during a render and the frame comes out black. `staticFile` builds the
 * correct URL for both the studio and a headless render.
 */
function resolveSrc(src: string): string {
  if (!src) return src;
  // The render pipeline hands us absolute URLs from its own asset server; the
  // studio hands us paths relative to the Remotion public folder.
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  if (src.startsWith("#") || src.startsWith("rgb")) return src; // solid colour clips
  return staticFile(src.replace(/^\//, ""));
}

/**
 * The single composition that renders every format.
 *
 * There is deliberately no per-format component. A format is a *starting
 * timeline*, not a React tree — which is what allows the editor agent to invent
 * a montage the taxonomy never described, and what keeps 28 formats from
 * becoming 28 renderers to maintain.
 */
export const TimelineRenderer: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  const msToFrames = (ms: number) => Math.max(1, Math.round((ms / 1000) * fps));

  const layers = useMemo(() => {
    const byLayer = new Map<number, VideoClip[]>();
    for (const clip of timeline.video) {
      const list = byLayer.get(clip.layer) ?? [];
      list.push(clip);
      byLayer.set(clip.layer, list);
    }
    return [...byLayer.entries()].sort((a, b) => a[0] - b[0]);
  }, [timeline.video]);

  return (
    <AbsoluteFill style={{ backgroundColor: timeline.background, overflow: "hidden" }}>
      {/* ---- Video ------------------------------------------------------- */}
      {layers.map(([layer, clips]) => (
        <AbsoluteFill key={`layer-${layer}`}>
          {clips.map((clip) => (
            <Sequence
              key={clip.id}
              from={Math.round((clip.startMs / 1000) * fps)}
              durationInFrames={msToFrames(clip.durationMs)}
              name={clip.note ?? clip.id}
              layout="none"
            >
              <ClipRenderer clip={clip} />
            </Sequence>
          ))}
        </AbsoluteFill>
      ))}

      {/* ---- Overlays ----------------------------------------------------
          Rendered at the root rather than inside a Sequence: overlays are
          authored against absolute timeline milliseconds and read the clock
          themselves, so wrapping them would rebase that clock and shift every
          caption. They gate their own visibility. */}
      {timeline.overlays.map((overlay) => (
        <OverlayLayer key={overlay.id} overlay={overlay} />
      ))}

      {/* ---- Audio ------------------------------------------------------- */}
      {timeline.audio.map((clip) => (
        <AudioTrack key={clip.id} clip={clip} />
      ))}
    </AbsoluteFill>
  );
};

/* ========================================================================== */

const ClipRenderer: React.FC<{ clip: VideoClip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localMs = (frame / fps) * 1000;

  const base = resolveTransform(clip.effects, localMs, clip.durationMs);
  const trans = resolveTransition(clip.transitionIn, localMs);

  const scale = base.scale * (trans.scale ?? 1);
  const x = base.x + (trans.x ?? 0);
  const y = base.y + (trans.y ?? 0);
  const opacity = clip.opacity * base.opacity * (trans.opacity ?? 1);
  const filter = [base.filter === "none" ? "" : base.filter, trans.filter ?? ""]
    .filter(Boolean)
    .join(" ");

  const box = layoutBox(clip);

  const inner: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: clip.fit,
    transform: `scale(${scale}) translate(${x}px, ${y}px)`,
    filter: filter || undefined,
    // The rendered frame is fixed; letting the browser know avoids per-frame
    // layer promotion churn on long renders.
    willChange: "transform",
  };

  const sourceMs = resolveSourceTime(clip.effects, localMs) + clip.sourceInMs;
  const src = clip.kind === "color" ? clip.src : resolveSrc(clip.src);

  return (
    <AbsoluteFill style={{ ...box, opacity, clipPath: trans.clipPath }}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: box.borderRadius }}>
        {clip.kind === "color" ? (
          <div style={{ ...inner, background: clip.src || "#000" }} />
        ) : clip.kind === "image" || /\.(svg|png|jpe?g|webp|avif)$/i.test(clip.src) ? (
          <Img src={src} style={inner} />
        ) : (
          <OffthreadVideo
            src={src}
            style={inner}
            startFrom={Math.round((sourceMs / 1000) * fps)}
            // Video audio is never used: the mix is authored on the audio track.
            muted
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Translate a layout into absolute CSS box geometry in the 1080x1920 frame. */
function layoutBox(clip: VideoClip): React.CSSProperties {
  const l = clip.layout;
  switch (l.mode) {
    case "splitH": {
      const height = 1920 * l.share;
      return {
        top: l.position === "top" ? 0 : 1920 - height,
        left: 0,
        width: 1080,
        height,
      };
    }
    case "pip":
      return {
        top: l.y,
        left: l.x,
        width: l.size,
        height: l.size,
        borderRadius: l.shape === "circle" ? l.size / 2 : 32,
        boxShadow: "0 14px 48px rgba(0,0,0,0.55)",
        border: "6px solid rgba(255,255,255,0.9)",
      };
    case "cutout": {
      const width = 1080 * l.scale;
      const height = 1920 * l.scale;
      const left =
        l.anchor === "bottomLeft" ? 0 : l.anchor === "bottomRight" ? 1080 - width : (1080 - width) / 2;
      return { top: 1920 - height, left, width, height };
    }
    default:
      return { top: 0, left: 0, width: 1080, height: 1920 };
  }
}

/* ========================================================================== */

const AudioTrack: React.FC<{ clip: AudioClip }> = ({ clip }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence
      from={Math.round((clip.startMs / 1000) * fps)}
      durationInFrames={Math.max(1, Math.round((clip.durationMs / 1000) * fps))}
      name={`audio:${clip.bus}:${clip.id}`}
      layout="none"
    >
      <Audio
        src={resolveSrc(clip.src)}
        loop={clip.loop}
        startFrom={Math.round((clip.sourceInMs / 1000) * fps)}
        volume={(frame) => {
          const ms = clip.startMs + (frame / fps) * 1000;
          let gain = resolveGain(clip.automation, clip.gain, ms);
          const local = (frame / fps) * 1000;
          if (clip.fadeInMs > 0) gain *= Math.min(1, local / clip.fadeInMs);
          const remaining = clip.durationMs - local;
          if (clip.fadeOutMs > 0) gain *= Math.min(1, remaining / clip.fadeOutMs);
          return Math.max(0, Math.min(1, gain));
        }}
      />
    </Sequence>
  );
};
