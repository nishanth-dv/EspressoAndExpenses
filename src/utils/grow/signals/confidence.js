import { band } from "../../advisory/confidence.js";

const MEANING =
  "Confidence reflects how strong, well-tested and current this setup is — not a prediction that the trade will work.";

export const WEIGHTS = {
  baseMin: 25,
  baseSpan: 60,
  strength: 10,
  volume: 8,
  recency: 1.5,
  recencyCap: 15,
};

const rnd = Math.round;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function breakdownSignal(factors = {}) {
  const { baseReliability = 0.5, signalStrength = 0.5, volumeConfirm = 0, recencyBars = 0 } = factors;

  const rows = [
    {
      label: "Pattern reliability",
      points: rnd(WEIGHTS.baseMin + baseReliability * WEIGHTS.baseSpan),
      hint: `historically right ~${Math.round(baseReliability * 100)}% of the time on this symbol`,
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
    {
      label: "Recency",
      points: -Math.min(WEIGHTS.recencyCap, rnd(recencyBars * WEIGHTS.recency)),
      hint: recencyBars === 0 ? "fired on the latest bar" : `fired ${recencyBars} bar${recencyBars > 1 ? "s" : ""} ago`,
    },
  ];

  const summed = rows.reduce((s, x) => s + x.points, 0);
  const total = clamp(summed, 0, 100);
  rows[rows.length - 1].points += total - summed;
  return { total, band: band(total), rows, meaning: MEANING };
}

export function reasonForSignal(factors = {}, total = 0) {
  const b = band(total);
  const lead =
    b === "high"
      ? "High confidence — a well-tested, strong setup."
      : b === "moderate"
        ? "Moderate confidence — a reasonable setup; weigh it with your own read."
        : "Low confidence — a soft setup; treat it as a prompt to look, not to act.";
  const { baseReliability = 0.5, signalStrength = 0.5, volumeConfirm = 0 } = factors;
  const why = [`this pattern has worked about ${Math.round(baseReliability * 100)}% of the time on this symbol`];
  why.push(
    signalStrength >= 0.7 ? "it is strongly formed" : signalStrength <= 0.3 ? "it is faintly formed" : "it is moderately formed",
  );
  if (volumeConfirm >= 0.6) why.push("volume backs it up");
  return `${lead} The ${total}/100 reflects that ${why.join(", ")}. ${MEANING}`;
}

export function withSignalConfidence(signal) {
  const f = signal.factors || {};
  const bd = breakdownSignal(f);
  return { ...signal, confidence: bd.total, reason: reasonForSignal(f, bd.total), confidenceBreakdown: bd };
}
