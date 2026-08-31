"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A single fleet output.
 *
 * Hover-to-play rather than autoplay: a grid of eight autoplaying videos is
 * hostile on a laptop and unusable on a phone. `preload="metadata"` fetches only
 * the header so the poster frame appears without pulling twenty megabytes.
 */
export function VideoCard({
  src,
  hookText,
  durationMs,
  persona,
  formatName,
}: {
  src: string | null;
  hookText: string;
  durationMs: number | null;
  persona: string | null;
  formatName: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  function play() {
    const el = ref.current;
    if (!el) return;
    void el.play().then(() => setPlaying(true)).catch(() => undefined);
  }

  function stop() {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
  }

  return (
    <figure className="group">
      <div
        className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-2xl border border-line bg-inverse"
        onMouseEnter={play}
        onMouseLeave={stop}
        onClick={() => (playing ? stop() : play())}
      >
        {src ? (
          <>
            <video
              ref={ref}
              src={src}
              muted
              loop
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
            <span
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity",
                playing ? "opacity-0" : "opacity-100",
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 shadow-lg backdrop-blur">
                <Play size={16} strokeWidth={2.6} className="ml-0.5 text-ink-strong" />
              </span>
            </span>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-2xs text-on-inverse-muted">
            still rendering
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-12">
          <p className="line-clamp-2 text-2xs font-semibold leading-snug text-white">{hookText}</p>
        </div>

        {durationMs ? (
          <span className="tnum absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-2xs font-semibold text-white">
            {(durationMs / 1000).toFixed(0)}s
          </span>
        ) : null}
      </div>

      <figcaption className="mt-2.5">
        <p className="truncate text-sm font-medium text-ink">{persona ?? "Unnamed creator"}</p>
        <p className="truncate text-2xs text-ink-subtle">{formatName}</p>
      </figcaption>
    </figure>
  );
}
