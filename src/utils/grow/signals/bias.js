import { sma } from "./indicators.js";

const clamp = (n) => Math.max(-1, Math.min(1, n));
const r2 = (n) => Math.round(n * 100) / 100;

export const BIAS_PARTS = [
  { key: "trend", label: "Trend", hint: "price versus its long moving average" },
  { key: "momentum", label: "Momentum", hint: "how far it has travelled over the last 20 bars" },
  { key: "flow", label: "Money flow", hint: "volume traded on up bars versus down bars" },
  { key: "position", label: "Range position", hint: "where it sits in its recent high–low range" },
];

export function symbolBias(candles) {
  const n = candles?.length ?? 0;
  if (n < 30) return null;
  const closes = candles.map((c) => c.close);
  const last = closes[n - 1];

  const period = n >= 200 ? 200 : n >= 50 ? 50 : 20;
  const base = sma(closes, period, n - 1);
  const trend = base ? clamp((last - base) / base / 0.15) : 0;

  const back = closes[n - 21];
  const momentum = back ? clamp((last - back) / back / 0.12) : 0;

  let net = 0;
  let tot = 0;
  for (let i = n - 20; i < n; i++) {
    const v = candles[i].volume || 0;
    tot += v;
    net += candles[i].close >= candles[i].open ? v : -v;
  }
  const flow = tot ? clamp(net / tot / 0.5) : 0;

  let hi = -Infinity;
  let lo = Infinity;
  for (let i = Math.max(0, n - 52); i < n; i++) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  const position = hi > lo ? clamp(((last - lo) / (hi - lo)) * 2 - 1) : 0;

  const score = (trend + momentum + flow + position) / 4;
  return {
    score: r2(score),
    label: score >= 0.3 ? "bullish" : score <= -0.3 ? "bearish" : "neutral",
    maPeriod: period,
    parts: { trend: r2(trend), momentum: r2(momentum), flow: r2(flow), position: r2(position) },
  };
}
