/**
 * The darwinian engine — DOC-126 to DOC-135.
 *
 * Three jobs, deliberately kept separate:
 *   1. `scorePost`      — turn raw metrics into one comparable number.
 *   2. `decide`         — turn a score + checkpoint into KILL / MAINTAIN / DOUBLE_DOWN.
 *   3. `thompsonSample` — decide what to produce *next* from the accumulated verdicts.
 *
 * Everything here is pure. No database, no clock, no I/O — which means the whole
 * decision layer is testable and replayable against historical snapshots.
 */

export type Checkpoint = "T2H" | "T24H" | "T72H" | "T7D" | "T30D";
export type Verdict = "PENDING" | "KILL" | "MAINTAIN" | "DOUBLE_DOWN" | "AMPLIFY";

export interface PostMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  subscribersGained: number;
  retention3s: number; // 0..1
  completionRate: number; // 0..1
  profileClicks: number;
  linkClicks: number;
  signups: number;
}

/**
 * Composite score.
 *
 *   S = 1.8·W3s + 4.5·CR100 + 5.0·(shares/views) + 3.5·(saves/views)
 *
 * Weights come straight from the brief and encode the platform's own signal
 * hierarchy: a share is worth ten likes, a save seven. Rates, never absolutes —
 * otherwise a channel with more subscribers always wins and the fleet stops
 * learning anything about the *creative*.
 */
export function scorePost(m: PostMetrics): number {
  const views = Math.max(m.views, 1);
  const shareRate = m.shares / views;
  const saveRate = m.saves / views;
  const score =
    1.8 * m.retention3s + 4.5 * m.completionRate + 5.0 * shareRate + 3.5 * saveRate;
  return Math.round(score * 10000) / 10000;
}

/** Extra conversion-weighted score, only meaningful from T+72h onward. */
export function conversionScore(m: PostMetrics): number {
  const views = Math.max(m.views, 1);
  return Math.round((m.linkClicks / views) * 10000) / 10000;
}

export interface Thresholds {
  kill: number;
  maintainLow: number;
  maintainHigh: number;
  superstar: number;
}

/** DOC-126 decision grid, per checkpoint. */
export const CHECKPOINT_THRESHOLDS: Record<Checkpoint, {
  metric: string;
  thresholds: Thresholds;
  minViews: number;
}> = {
  T2H: {
    metric: "retention3s",
    thresholds: { kill: 0.35, maintainLow: 0.35, maintainHigh: 0.55, superstar: 0.6 },
    // Below this, the sample is noise: a 12-view post tells us nothing.
    minViews: 150,
  },
  T24H: {
    metric: "completionRate",
    thresholds: { kill: 0.18, maintainLow: 0.2, maintainHigh: 0.35, superstar: 0.38 },
    minViews: 400,
  },
  T72H: {
    metric: "linkClickRate",
    thresholds: { kill: 0.008, maintainLow: 0.01, maintainHigh: 0.025, superstar: 0.04 },
    minViews: 800,
  },
  T7D: {
    metric: "linkClickRate",
    thresholds: { kill: 0.006, maintainLow: 0.008, maintainHigh: 0.02, superstar: 0.035 },
    minViews: 1500,
  },
  T30D: {
    metric: "linkClickRate",
    thresholds: { kill: 0.005, maintainLow: 0.007, maintainHigh: 0.018, superstar: 0.03 },
    minViews: 3000,
  },
};

/** At T+24h a superstar must clear completion AND share rate, not just one. */
export const T24H_SHARE_FLOOR = 0.005;
export const T24H_SHARE_SUPERSTAR = 0.025;

export interface DecisionInput {
  checkpoint: Checkpoint;
  metrics: PostMetrics;
  /** How many consecutive failures this format has already recorded on this channel. */
  consecutiveFailures: number;
}

export interface Decision {
  verdict: Verdict;
  score: number;
  /** The metric that drove the verdict, for the dashboard. */
  drivingMetric: { name: string; value: number; threshold: Thresholds };
  rationale: string;
  /** Set when the verdict should also trigger paid amplification. */
  recommendAmplification: boolean;
}

export function decide(input: DecisionInput): Decision {
  const { checkpoint, metrics, consecutiveFailures } = input;
  const config = CHECKPOINT_THRESHOLDS[checkpoint];
  const score = scorePost(metrics);
  const views = Math.max(metrics.views, 1);

  // Not enough distribution to judge the creative. Never kill on noise.
  if (metrics.views < config.minViews) {
    return {
      verdict: "PENDING",
      score,
      drivingMetric: { name: "views", value: metrics.views, threshold: config.thresholds },
      rationale: `Sample too small: ${metrics.views} views at ${checkpoint}, decision threshold is ${config.minViews}. No verdict.`,
      recommendAmplification: false,
    };
  }

  const shareRate = metrics.shares / views;
  const linkClickRate = metrics.linkClicks / views;

  let value: number;
  switch (checkpoint) {
    case "T2H":
      value = metrics.retention3s;
      break;
    case "T24H":
      value = metrics.completionRate;
      break;
    default:
      value = linkClickRate;
  }

  const t = config.thresholds;
  let verdict: Verdict;
  let rationale: string;
  let recommendAmplification = false;

  if (checkpoint === "T2H") {
    if (value > t.superstar) {
      verdict = "DOUBLE_DOWN";
      rationale = `Held ${pct(value)} past three seconds at T+2h (superstar threshold ${pct(t.superstar)}). Flagged for priority watching — this hook can be reused as-is on sibling channels.`;
    } else if (value < t.kill) {
      // A weak hook at T+2h is a warning, not a death sentence: the video has not
      // had time to find its audience. Killing here would destroy exploration.
      verdict = "MAINTAIN";
      rationale = `Held ${pct(value)} at T+2h, under the ${pct(t.kill)} threshold. Weak signal noted, decision deferred to T+24h — dropping at two hours would destroy exploration.`;
    } else {
      verdict = "MAINTAIN";
      rationale = `Held ${pct(value)} at T+2h, within the normal range.`;
    }
  } else if (checkpoint === "T24H") {
    const isSuperstar = value > t.superstar && shareRate > T24H_SHARE_SUPERSTAR;
    const isFailure = value < t.kill || shareRate < T24H_SHARE_FLOOR;

    if (isSuperstar) {
      verdict = "DOUBLE_DOWN";
      rationale = `Completion ${pct(value)} (threshold ${pct(t.superstar)}) AND shares ${pct(shareRate)} (threshold ${pct(T24H_SHARE_SUPERSTAR)}). Doubling down: five variations queued.`;
    } else if (isFailure) {
      // The kill protocol needs three consecutive failures on the same format.
      if (consecutiveFailures + 1 >= 3) {
        verdict = "KILL";
        rationale = `Third consecutive failure for this scenario: completion ${pct(value)}, shares ${pct(shareRate)}. Dropping it — production suspended on this channel, pivoting to a different shape.`;
      } else {
        verdict = "MAINTAIN";
        rationale = `Failure ${consecutiveFailures + 1} of 3 for this scenario (completion ${pct(value)}, shares ${pct(shareRate)}). Three in a row are needed before it is dropped.`;
      }
    } else {
      verdict = "MAINTAIN";
      rationale = `Completion ${pct(value)}, shares ${pct(shareRate)} — standard performance, scenario kept.`;
    }
  } else {
    if (value > t.superstar) {
      verdict = "AMPLIFY";
      recommendAmplification = true;
      rationale = `Click-through ${pct(value)} at ${checkpoint} (threshold ${pct(t.superstar)}), ${metrics.signups} signups. Candidate for paid amplification.`;
    } else if (value < t.kill) {
      verdict = consecutiveFailures + 1 >= 3 ? "KILL" : "MAINTAIN";
      rationale = `Click-through ${pct(value)} at ${checkpoint}, under the ${pct(t.kill)} threshold. This scenario gets attention but not traffic — move toward something more useful.`;
    } else {
      verdict = "MAINTAIN";
      rationale = `Click-through ${pct(value)} at ${checkpoint} — conversion as expected.`;
    }
  }

  return {
    verdict,
    score,
    drivingMetric: { name: config.metric, value, threshold: t },
    rationale,
    recommendAmplification,
  };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/* ==========================================================================
   Exploration vs exploitation — Thompson sampling over Beta(α, β)
   ========================================================================== */

export interface BanditArm {
  key: string;
  alpha: number;
  beta: number;
  trials: number;
  meanScore: number;
}

/**
 * Sample from Beta(α, β) using the ratio of two Gamma draws.
 *
 * `rng` is injected so a fleet run is reproducible: the same seed replays the
 * same allocation, which is what makes "why did the agent pick that format on
 * Tuesday?" an answerable question.
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/** Marsaglia-Tsang gamma sampler, with Johnk's boost for shape < 1. */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(1 + shape, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface AllocationResult {
  key: string;
  sampledTheta: number;
  /** EXPLOIT slots go to the highest samples, EXPLORE to under-tried arms. */
  mode: "EXPLOIT" | "EXPLORE";
}

/**
 * Allocate `slots` production briefs across arms.
 *
 * 80% exploitation / 20% exploration (DOC-129). Exploration deliberately favours
 * the *least tried* arms rather than sampling again, because Thompson sampling
 * alone converges too fast when early results are lucky — and a fleet that stops
 * exploring stops finding the outliers that carry the whole business.
 */
export function allocate(
  arms: BanditArm[],
  slots: number,
  rng: () => number = Math.random,
  exploreRatio = 0.2,
): AllocationResult[] {
  if (arms.length === 0 || slots <= 0) return [];

  const sampled = arms
    .map((a) => ({ key: a.key, sampledTheta: sampleBeta(a.alpha, a.beta, rng), trials: a.trials }))
    .sort((a, b) => b.sampledTheta - a.sampledTheta);

  const exploreSlots = Math.max(0, Math.round(slots * exploreRatio));
  const exploitSlots = slots - exploreSlots;

  const out: AllocationResult[] = [];

  for (let i = 0; i < exploitSlots; i++) {
    const arm = sampled[i % sampled.length]!;
    out.push({ key: arm.key, sampledTheta: arm.sampledTheta, mode: "EXPLOIT" });
  }

  const leastTried = [...sampled].sort((a, b) => a.trials - b.trials);
  for (let i = 0; i < exploreSlots; i++) {
    const arm = leastTried[i % leastTried.length]!;
    out.push({ key: arm.key, sampledTheta: arm.sampledTheta, mode: "EXPLORE" });
  }

  return out;
}

/** Fold a verdict back into the arm's posterior. */
export function updateArm(arm: BanditArm, verdict: Verdict, score: number): BanditArm {
  const isWin = verdict === "DOUBLE_DOWN" || verdict === "AMPLIFY";
  const isLoss = verdict === "KILL";
  if (verdict === "PENDING") return arm;

  const trials = arm.trials + 1;
  return {
    ...arm,
    alpha: arm.alpha + (isWin ? 1 : 0),
    beta: arm.beta + (isLoss ? 1 : 0),
    trials,
    // Running mean, so an old winner does not dominate forever.
    meanScore: arm.meanScore + (score - arm.meanScore) / trials,
  };
}

/* ==========================================================================
   Retention curve diagnosis
   ========================================================================== */

export interface RetentionPoint {
  ratio: number; // 0..1 position in the video
  watched: number; // 0..1 share of the audience still watching
}

export interface DropDiagnosis {
  biggestDropAtRatio: number;
  biggestDropMagnitude: number;
  atMs: number;
  interpretation: string;
}

/**
 * Find where the audience leaves, and say what it means.
 *
 * This is the single most actionable output of the whole analytics layer: it
 * turns "this video underperformed" into "your hook works but the demo at 6.2s
 * loses 22% of viewers", which the scriptwriter can act on.
 */
export function diagnoseRetention(
  points: RetentionPoint[],
  durationMs: number,
): DropDiagnosis | null {
  if (points.length < 3) return null;

  const sorted = [...points].sort((a, b) => a.ratio - b.ratio);
  let worstDrop = 0;
  let worstIndex = 1;

  for (let i = 1; i < sorted.length; i++) {
    const drop = sorted[i - 1]!.watched - sorted[i]!.watched;
    if (drop > worstDrop) {
      worstDrop = drop;
      worstIndex = i;
    }
  }

  const ratio = sorted[worstIndex]!.ratio;
  const atMs = Math.round(ratio * durationMs);

  let interpretation: string;
  if (atMs < 3000) {
    interpretation =
      "Drop inside the hook: the first shot does not deliver on its visual promise. Rewrite the first four seconds, not the rest.";
  } else if (atMs < 6000) {
    interpretation =
      "Drop just after the hook: it promised something the rest does not deliver. That reads as clickbait and gets penalised. Shorten the gap before the first piece of proof.";
  } else if (ratio < 0.6) {
    interpretation =
      "Drop in the middle: the demonstration runs long or over-explains. Add a pattern interrupt exactly there and cut a fifth of the content.";
  } else {
    interpretation =
      "Late drop: the call to action lands too early, or the ending drags. Loop the end back onto the opening instead of concluding.";
  }

  return {
    biggestDropAtRatio: ratio,
    biggestDropMagnitude: Math.round(worstDrop * 10000) / 10000,
    atMs,
    interpretation,
  };
}
