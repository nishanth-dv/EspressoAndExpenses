import { EDGE_FLOOR } from "./contract.js";

const MEANING =
  "Confidence is built from how far this pattern beat a random entry on the same stock in out-of-sample testing — not from how often it wins. A high win rate on a stock that was rising anyway is worth nothing, so the score measures only the part the pattern itself added.";

export const WEIGHTS = { strength: 3, volume: 4 };

const rnd = Math.round;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function edgeBase(edge) {
  if (edge == null) return null;
  if (edge <= 0) return 0;
  return edge / (edge + EDGE_FLOOR);
}

export const BAND_EDGE = { high: 2 * EDGE_FLOOR, moderate: EDGE_FLOOR };

export const BAND_CUTS = {
  high: Math.round(edgeBase(BAND_EDGE.high) * 100),
  moderate: Math.round(edgeBase(BAND_EDGE.moderate) * 100),
};

export function band(s, benchmarked = true) {
  if (s >= BAND_CUTS.high) return benchmarked ? "high" : "moderate";
  if (s >= BAND_CUTS.moderate) return "moderate";
  return "low";
}

export function breakdownSignal(factors = {}) {
  const { baseReliability = 0.4, signalStrength = 0.5, volumeConfirm = 0, edgeVsRandom = null } = factors;
  const eb = edgeBase(edgeVsRandom);
  const base = eb == null ? baseReliability : eb;
  const rows = [
    eb == null
      ? {
          label: "Base win rate",
          points: rnd(base * 100),
          hint: `not yet benchmarked at this interval — falls back to a ~${Math.round(base * 100)}% tested win rate`,
        }
      : {
          label: "Edge over random",
          points: rnd(base * 100),
          hint: `beat a random entry on the same stock by ${edgeVsRandom.toFixed(2)} percentage points per trade in testing`,
        },
    {
      label: "Strength",
      points: rnd(signalStrength * WEIGHTS.strength),
      hint: signalStrength >= 0.7 ? "the pattern is pronounced" : signalStrength <= 0.3 ? "the pattern is faint" : "moderately formed",
    },
    {
      label: "Volume confirmation",
      points: rnd(volumeConfirm * WEIGHTS.volume),
      hint: volumeConfirm >= 0.6 ? "backed by above-average volume" : "volume is unremarkable",
    },
  ];
  const p = clamp(base + (signalStrength * WEIGHTS.strength) / 100 + (volumeConfirm * WEIGHTS.volume) / 100, 0, 1);
  const total = rnd(p * 100);
  const summed = rows.reduce((s, x) => s + x.points, 0);
  rows[rows.length - 1].points += total - summed;
  return { total, band: band(total, eb != null), rows, meaning: MEANING };
}

export function reasonForSignal(factors = {}, total = 0) {
  const { baseReliability = 0.4, signalStrength = 0.5, volumeConfirm = 0, edgeVsRandom = null } = factors;
  const b = band(total, edgeVsRandom != null);
  const lead =
    b === "high"
      ? `Beat a random entry on the same stock by at least ${BAND_EDGE.high}pp per trade after penalties for sample size and period-to-period variability — the strongest evidence this engine has.`
      : b === "moderate"
        ? `Beat a random entry, but by under ${BAND_EDGE.high}pp per trade once thin samples and inconsistent periods are discounted — a prompt, not a conviction trade.`
        : "Little or no measured edge over buying this stock on any other day.";
  const why =
    edgeVsRandom == null
      ? [`this pattern reached target first about ${Math.round(baseReliability * 100)}% of the time in testing`]
      : [`it added ${edgeVsRandom.toFixed(2)} percentage points per trade over a random entry on the same stock`];
  why.push(
    signalStrength >= 0.7 ? "it is strongly formed" : signalStrength <= 0.3 ? "it is faintly formed" : "it is moderately formed",
  );
  if (volumeConfirm >= 0.6) why.push("volume backs it up");
  return `${lead} The ${total}/100 estimate reflects that ${why.join(", ")}. ${MEANING}`;
}

export function withSignalConfidence(signal) {
  const f = signal.factors || {};
  const bd = breakdownSignal(f);
  return { ...signal, confidence: bd.total, reason: reasonForSignal(f, bd.total), confidenceBreakdown: bd };
}
