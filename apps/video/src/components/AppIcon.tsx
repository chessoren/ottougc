import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * The application mark, at icon size.
 *
 * Same idea as the mark in the web app, drawn for a 1024px canvas: three bars of
 * unequal length. Most of what a fleet posts goes nowhere and one post carries
 * the month — the outlier distribution the whole product is built on — so the
 * middle bar runs the full width of the frame and the other two do not come
 * close. It is the product's thesis, at 16 pixels.
 *
 * Rendered to PNG by `renderStill`, which is already a dependency here. No
 * design tool, no external rasteriser, and the source of truth stays in code.
 */
export const AppIcon: React.FC<{ padding?: number }> = ({ padding = 96 }) => {
  const size = 1024;
  const inner = size - padding * 2;
  const radius = inner * 0.235; // macOS squircle proportion, near enough
  const barHeight = inner * 0.116;
  const gap = inner * 0.062;
  const left = padding + inner * 0.115;
  const fullWidth = inner - inner * 0.23;
  const firstTop = padding + (inner - (barHeight * 3 + gap * 2)) / 2;

  const bars = [
    { width: fullWidth * 0.42, fill: "#FFFFFF", opacity: 0.42 },
    { width: fullWidth, fill: "#0084FE", opacity: 1 },
    { width: fullWidth * 0.63, fill: "#FFFFFF", opacity: 0.42 },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#232326" />
            <stop offset="100%" stopColor="#0E0E10" />
          </linearGradient>
        </defs>

        <rect x={padding} y={padding} width={inner} height={inner} rx={radius} fill="url(#ground)" />

        {bars.map((bar, i) => (
          <rect
            key={i}
            x={left}
            y={firstTop + i * (barHeight + gap)}
            width={bar.width}
            height={barHeight}
            rx={barHeight / 2}
            fill={bar.fill}
            opacity={bar.opacity}
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
};
