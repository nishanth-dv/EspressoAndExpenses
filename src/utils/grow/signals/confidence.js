const MEANING =
  "Confidence is our estimated chance this setup reaches its target before its stop — from the pattern's tested win rate, plus its strength and volume. An estimate, not a guarantee.";

export const WEIGHTS = { strength: 3, volume: 4 };

const rnd = Math.round;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function band(s) {
  if (s >= 45) return "high";
  if (s >= 40) return "moderate";
  return "low";
}

export function breakdownSignal(factors = {}) {
  const { baseReliability = 0.4, signalStrength = 0.5, volumeConfirm = 0 } = factors;
  const rows = [
    {
      label: "Base win rate",
      points: rnd(baseReliability * 100),
      hint: `this pattern reached target before stop ~${Math.round(baseReliability * 100)}% of the time in testing`,
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
  const p = clamp(
    baseReliability + (signalStrength * WEIGHTS.strength) / 100 + (volumeConfirm * WEIGHTS.volume) / 100,
    0,
    1,
  );
  const total = rnd(p * 100);
  const summed = rows.reduce((s, x) => s + x.points, 0);
  rows[rows.length - 1].points += total - summed;
  return { total, band: band(total), rows, meaning: MEANING };
}

export function reasonForSignal(factors = {}, total = 0) {
  const b = band(total);
  const lead =
    b === "high"
      ? "Higher-probability setup — above the break-even win rate."
      : b === "moderate"
        ? "Middling setup — around break-even; weigh it with your own read."
        : "Lower-probability setup — historically below break-even; treat it as a prompt, not a trade.";
  const { baseReliability = 0.4, signalStrength = 0.5, volumeConfirm = 0 } = factors;
  const why = [`this pattern reached target first about ${Math.round(baseReliability * 100)}% of the time in testing`];
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
