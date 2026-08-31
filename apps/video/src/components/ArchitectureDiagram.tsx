import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * The submission's architecture diagram, rendered to PNG by `renderStill`.
 *
 * Drawn in code rather than in a diagram tool for the same reason the app icon
 * is: it stays in the repository, it regenerates when the system changes, and
 * there is no second file to fall out of date with the first.
 */

const INK = "#101413";
const PAPER = "#FBFAF6";
const LINE = "#C9CFC3";
const MUTED = "#6E7A74";
const TEAL = "#0F5C4E";
const ACCENT = "#0084FE";
const GOOGLE = "#C2410C";

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'Bricolage Grotesque', 'Helvetica Neue', Arial, sans-serif";

interface BoxProps {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
  tone?: "default" | "google" | "agent";
  badge?: string;
}

const Box: React.FC<BoxProps> = ({ x, y, w, h, title, lines, tone = "default", badge }) => {
  const stroke = tone === "google" ? GOOGLE : tone === "agent" ? TEAL : LINE;
  const fill = tone === "google" ? "#FBF1EC" : tone === "agent" ? "#E9F2EE" : "#FFFFFF";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={fill} stroke={stroke} strokeWidth={tone === "default" ? 1.5 : 2.5} />
      {badge ? (
        <text x={x + 18} y={y + 26} fontFamily={MONO} fontSize={13} fill={tone === "google" ? GOOGLE : TEAL} letterSpacing="1.4">
          {badge}
        </text>
      ) : null}
      <text x={x + 18} y={y + (badge ? 56 : 36)} fontFamily={SANS} fontSize={23} fontWeight={700} fill={INK}>
        {title}
      </text>
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + 18}
          y={y + (badge ? 84 : 64) + i * 25}
          fontFamily={MONO}
          fontSize={15}
          fill={MUTED}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

const Arrow: React.FC<{ from: [number, number]; to: [number, number]; label?: string; dashed?: boolean }> = ({
  from,
  to,
  label,
  dashed,
}) => {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={LINE}
        strokeWidth={2}
        markerEnd="url(#head)"
        strokeDasharray={dashed ? "7 6" : undefined}
      />
      {label ? (
        <>
          <rect x={midX - label.length * 4.1 - 8} y={midY - 15} width={label.length * 8.2 + 16} height={24} rx={5} fill={PAPER} />
          <text x={midX} y={midY + 2} fontFamily={MONO} fontSize={14} fill={MUTED} textAnchor="middle">
            {label}
          </text>
        </>
      ) : null}
    </g>
  );
};

export const ArchitectureDiagram: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: PAPER }}>
    <svg width={2400} height={1600} viewBox="0 0 2400 1600">
      <defs>
        <marker id="head" markerWidth="11" markerHeight="11" refX="9" refY="5.5" orient="auto">
          <path d="M0,1 L10,5.5 L0,10 z" fill={LINE} />
        </marker>
      </defs>

      <text x={80} y={86} fontFamily={SANS} fontSize={50} fontWeight={800} fill={INK}>
        OttoUGC — an autonomous creator fleet
      </text>
      <text x={80} y={128} fontFamily={MONO} fontSize={19} fill={MUTED}>
        Ten agents. Each wakes on its own clock, decides what to film, films it, cuts it, posts it, and learns from the numbers.
      </text>

      {/* ── Trigger ───────────────────────────────────────────────────── */}
      <text x={80} y={210} fontFamily={MONO} fontSize={15} fill={TEAL} letterSpacing="2">
        ASYNCHRONOUS · NO USER IN THE LOOP
      </text>
      <Box
        x={80}
        y={232}
        w={430}
        h={168}
        badge="CLOUD SCHEDULER"
        title="The clock"
        lines={["07:00  produce", "every 30m  publish", "hourly  ingest metrics", "Mon 09:00  fleet review"]}
        tone="google"
      />

      <Arrow from={[510, 316]} to={[600, 316]} />

      <Box
        x={600}
        y={232}
        w={430}
        h={168}
        badge="PUB/SUB"
        title="Job queue"
        lines={["one message per channel", "at-least-once delivery", "decouples clock from work"]}
        tone="google"
      />

      <Arrow from={[1030, 316]} to={[1120, 316]} />

      <Box
        x={1120}
        y={232}
        w={470}
        h={168}
        badge="CLOUD RUN JOB"
        title="Agent worker"
        lines={["long-running, up to 60 min", "Chromium for the renderer", "scales to zero between runs"]}
        tone="google"
      />

      {/* ── The agent loop ────────────────────────────────────────────── */}
      <text x={80} y={480} fontFamily={MONO} fontSize={15} fill={TEAL} letterSpacing="2">
        THE AGENT LOOP · GEMINI 3.7 FLASH + 51 TOOLS · GOOGLE GENAI SDK
      </text>

      <Box x={80} y={502} w={340} h={150} badge="ORIENT" title="Reads its memory" lines={["what worked, what failed", "this week's targets"]} tone="agent" />
      <Arrow from={[420, 577]} to={[500, 577]} />
      <Box x={500} y={502} w={340} h={150} badge="DECIDE" title="Picks a shape" lines={["Thompson sampling", "never twice in a row"]} tone="agent" />
      <Arrow from={[840, 577]} to={[920, 577]} />
      <Box x={920} y={502} w={340} h={150} badge="WRITE" title="Writes the scene" lines={["against real brand material", "invented figures refused"]} tone="agent" />
      <Arrow from={[1260, 577]} to={[1340, 577]} />
      <Box x={1340} y={502} w={360} h={150} badge="CHECK" title="Fixes its own edit" lines={["loops on check_timeline", "until zero blocking errors"]} tone="agent" />
      <Arrow from={[1700, 577]} to={[1780, 577]} />
      <Box x={1780} y={502} w={340} h={150} badge="LEARN" title="Writes what it learned" lines={["numbers required", "read again tomorrow"]} tone="agent" />

      {/* ── Generation ────────────────────────────────────────────────── */}
      <text x={80} y={740} fontFamily={MONO} fontSize={15} fill={GOOGLE} letterSpacing="2">
        GENERATION · VERTEX AI
      </text>

      <Box x={80} y={762} w={400} h={186} badge="GEMINI 3 PRO IMAGE" title="Nano Banana 2" lines={["7-image character sheet", "one storyboard panel per shot", "each panel drawn from the last", "2K, 9:16"]} tone="google" />
      <Arrow from={[480, 855]} to={[560, 855]} label="panel" />
      <Box x={560} y={762} w={400} h={186} badge="GEMINI 3.7 FLASH" title="Vision check" lines={["same person?", "any interface in frame?", "any burnt-in text?", "reject → regenerate"]} tone="google" />
      <Arrow from={[960, 855]} to={[1040, 855]} label="approved" />
      <Box x={1040} y={762} w={400} h={186} badge="GEMINI OMNI FLASH" title="Animates the panel" lines={["reference_to_video", "panel + character refs", "dialogue in sync, in-clip", "9:16, 3-10 s"]} tone="google" />

      <Box x={1500} y={762} w={300} h={186} badge="LYRIA 002" title="Music" lines={["adaptive bed", "ducked under speech"]} tone="google" />
      <Box x={1840} y={762} w={300} h={186} badge="CHIRP 3 HD / STT" title="Voice & timings" lines={["narration where needed", "word timings read back", "off the clip's own audio"]} tone="google" />

      {/* ── Assembly ──────────────────────────────────────────────────── */}
      <text x={80} y={1030} fontFamily={MONO} fontSize={15} fill={TEAL} letterSpacing="2">
        ASSEMBLY & PUBLICATION
      </text>

      <Box x={80} y={1052} w={430} h={168} title="Timeline (an IR, not a template)" lines={["cuts on the breath", "punch-in on the number", "karaoke captions, word-level", "music ducking envelope"]} />
      <Arrow from={[510, 1136]} to={[590, 1136]} />
      <Box x={590} y={1052} w={400} h={168} title="Remotion render" lines={["1080 × 1920, 60 fps", "one generic composition", "any timeline it is given"]} />
      <Arrow from={[990, 1136]} to={[1070, 1136]} />
      <Box x={1070} y={1052} w={400} h={168} title="Quality control" lines={["unconfirmed numbers", "absolute promises", "stand-in media", "fails closed"]} />
      <Arrow from={[1470, 1136]} to={[1550, 1136]} />
      <Box x={1550} y={1052} w={430} h={168} badge="YOUTUBE DATA API" title="Posts to the channel" lines={["the user's own channels", "synthetic-content disclosure", "pinned comment < 90 s"]} tone="google" />

      {/* ── State ─────────────────────────────────────────────────────── */}
      <text x={80} y={1300} fontFamily={MONO} fontSize={15} fill={GOOGLE} letterSpacing="2">
        STATE
      </text>
      <Box x={80} y={1322} w={470} h={186} badge="CLOUD SQL · POSTGRESQL" title="Everything the fleet knows" lines={["append-only run trace", "agent memory per channel", "strategies, objectives, verdicts", "bandit posteriors"]} tone="google" />
      <Box x={590} y={1322} w={400} h={186} badge="CLOUD STORAGE" title="The media" lines={["generated clips", "storyboard panels", "rendered videos"]} tone="google" />

      <Box x={1070} y={1322} w={430} h={186} title="Feedback" lines={["T+2h  hook rate", "T+24h  completion, shares", "T+72h  link clicks", "drop · keep · double down"]} />
      <Box x={1550} y={1322} w={430} h={186} title="Operator surface" lines={["Next.js dashboard", "every decision readable", "Electron shell for local runs"]} />

      {/* the loop closing */}
      <Arrow from={[1285, 1322]} to={[1285, 1240]} dashed />
      <Arrow from={[250, 1322]} to={[250, 668]} dashed label="read next morning" />

      <text x={80} y={1570} fontFamily={MONO} fontSize={16} fill={MUTED}>
        Gemini 3.7 Flash · Gemini 3 Pro Image · Gemini Omni Flash · Lyria 002 · Chirp 3 HD · Speech-to-Text — all on Vertex AI, via the Google GenAI SDK
      </text>
    </svg>
  </AbsoluteFill>
);
