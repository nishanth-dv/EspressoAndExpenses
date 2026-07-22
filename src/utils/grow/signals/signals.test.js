import assert from "node:assert";
import { runSignals } from "./index.js";
import { gradeSignal, scoreCard } from "./grade.js";
import { atrSeries } from "./indicators.js";
import { SUPPRESSED_TYPES } from "./contract.js";

function candle(time, o, h, l, c, v = 1000) {
  return { time, open: o, high: h, low: l, close: c, volume: v };
}

const DAY = 86400;
const t0 = 1700000000;
const candles = [];
for (let i = 0; i < 30; i++) {
  const p = 100 - i * 0.5;
  candles.push(candle(t0 + i * DAY, p, p + 0.5, p - 1, p - 0.4, 1000));
}
const i = candles.length;
candles.push(candle(t0 + i * DAY, 85.5, 85.7, 84.8, 85.0, 1000));
candles.push(candle(t0 + (i + 1) * DAY, 84.9, 88.5, 84.7, 88.2, 3000));

const rep = runSignals(candles, { symbol: "TEST.NS", interval: "1d", timeframe: "6M", includeSuppressed: true });

const be = rep.signals.find((s) => s.type === "bullish_engulfing");
assert(be, "expected a bullish_engulfing signal");
assert.strictEqual(be.time, candles[candles.length - 1].time, "engulfing on the last bar");
assert(be.confidence >= 0 && be.confidence <= 100, "confidence in range");
const sum = be.confidenceBreakdown.rows.reduce((s, r) => s + r.points, 0);
assert.strictEqual(sum, be.confidence, "breakdown rows sum to confidence");
assert.strictEqual(typeof be.marker.text, "string", "marker has a text code");
assert.strictEqual(be.marker.shape, "arrowUp", "bullish marker points up");
assert.strictEqual(be.id, "TEST.NS:1d:bullish_engulfing:" + be.time, "deterministic id");

const gated = runSignals(candles, { symbol: "TEST.NS", interval: "1d", timeframe: "6M" });
assert(gated.signals.every((s) => !SUPPRESSED_TYPES.has(s.type)), "default run excludes suppressed patterns");
assert(gated.signals.length <= rep.signals.length, "gating is a subset of includeSuppressed");

const tf = runSignals(candles, { symbol: "TEST.NS", interval: "1d", timeframe: "6M", includeSuppressed: true, trendFilter: true, trendPeriod: 20 });
assert(!tf.signals.some((s) => s.type === "bullish_engulfing"), "trend filter drops a bullish signal in a downtrend");

const lo = runSignals(candles, { symbol: "TEST.NS", interval: "1d", timeframe: "6M", includeSuppressed: true, longOnly: true });
assert(lo.signals.every((s) => s.direction !== "bearish"), "long-only drops bearish signals");

console.log(`ok — ${rep.signals.length} signals; bullish_engulfing confidence ${be.confidence}`);

const seq = [110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100.5, 103, 106, 109, 112, 114];
const w = seq.map((p, k) =>
  candle(t0 + k * DAY, k ? seq[k - 1] : p, p + 0.5, p - 0.5, p, k === 19 ? 3000 : 1000),
);
const rep2 = runSignals(w, { symbol: "W.NS", interval: "1d", timeframe: "1Y" });
const db = rep2.signals.find((s) => s.type === "double_bottom");
assert(db, "expected a double_bottom signal");
assert.strictEqual(db.fromTime, db.meta.shape[0].time, "double bottom fromTime = shape start (leading point)");
assert.strictEqual(db.time, w[19].time, "double bottom confirms on the neckline breakout bar");
assert.strictEqual(db.category, "chart", "geometric pattern is category chart");
assert(Array.isArray(db.meta?.shape) && db.meta.shape.length >= 3, "double_bottom carries a plotted shape");
for (let i = 1; i < db.meta.shape.length; i++) {
  assert(db.meta.shape[i].time >= db.meta.shape[i - 1].time, "shape points are time-ordered");
}

console.log(`ok — double_bottom confidence ${db.confidence}`);

const rising = [];
for (let k = 0; k < 15; k++) {
  const p = k < 3 ? 100 : 100 + (k - 2);
  rising.push(candle(t0 + k * DAY, p, p + 0.5, p - 0.5, p));
}
const idxByTime = new Map(rising.map((c, k) => [c.time, k]));
const sig = { time: rising[2].time, direction: "bullish", type: "x", name: "X", confidenceBreakdown: { band: "high" } };
const oc = gradeSignal(sig, rising, idxByTime, { horizon: 10, target: 0.04, stop: 0.03 });
assert.strictEqual(oc.status, "win", "a bullish signal into a rising trend should win");

const sc = scoreCard([sig], rising, { horizon: 10 });
assert.strictEqual(sc.overall.resolved, 1, "one resolved signal");
assert.strictEqual(sc.overall.hitRate, 1, "hit rate 100% for the single win");
assert(sc.byBand.find((b) => b.band === "high").wins === 1, "the high-confidence band records the win");

console.log(`ok — grade win; hit rate ${Math.round(sc.overall.hitRate * 100)}%`);

const rise2 = [];
for (let k = 0; k < 30; k++) {
  const p = 100 + 2 * k;
  rise2.push(candle(t0 + k * DAY, p - 2, p + 0.5, p - 0.6, p));
}
const r2idx = new Map(rise2.map((c, k) => [c.time, k]));
const atr2 = atrSeries(rise2, 14);
const si = 20;
assert(atr2[si] > 0, "atr defined at the signal index");
const ocAtr = gradeSignal({ time: rise2[si].time, direction: "bullish" }, rise2, r2idx, { atr: atr2 });
assert.strictEqual(ocAtr.status, "win", "ATR-graded bullish into a strong uptrend wins");
const costPct = 15 / 10000;
const expected = (2 * atr2[si]) / rise2[si].close - costPct;
assert(Math.abs(ocAtr.returnPct - expected) < 1e-9, "ATR win return = 2×ATR/entry minus round-trip cost");

const strad = [candle(t0, 100, 100.5, 99.5, 100), candle(t0 + DAY, 100, 105, 96, 100)];
const stradIdx = new Map(strad.map((c, k) => [c.time, k]));
const ocStrad = gradeSignal({ time: strad[0].time, direction: "bullish" }, strad, stradIdx, { horizon: 10, target: 0.04, stop: 0.03 });
assert.strictEqual(ocStrad.status, "loss", "a bar hitting BOTH target and stop is booked a loss (worst-case), not a win");

console.log(`ok — ATR grade win ${(expected * 100).toFixed(1)}% net of ${(costPct * 100).toFixed(2)}% cost; intrabar straddle → loss`);

const allIds = rep.signals.map((s) => s.id);
assert.strictEqual(allIds.length, new Set(allIds).size, "signal ids must be unique");
assert.deepStrictEqual(runSignals([], { symbol: "X" }).signals, [], "empty candles → no signals, no throw");

const falling = [];
for (let k = 0; k < 15; k++) {
  const p = k < 3 ? 100 : 100 - (k - 2);
  falling.push(candle(t0 + k * DAY, p, p + 0.5, p - 0.5, p));
}
const fidx = new Map(falling.map((c, k) => [c.time, k]));
const bear = gradeSignal({ time: falling[2].time, direction: "bearish" }, falling, fidx, { horizon: 10, target: 0.04, stop: 0.03 });
assert.strictEqual(bear.status, "win", "bearish signal into a falling trend should win");
const bull = gradeSignal({ time: falling[2].time, direction: "bullish" }, falling, fidx, { horizon: 10, target: 0.04, stop: 0.03 });
assert.strictEqual(bull.status, "loss", "bullish signal into a falling trend should lose");

for (const s of rep.signals) {
  assert(["high", "moderate", "low"].includes(s.confidenceBreakdown.band), "every signal has a valid band");
  assert.strictEqual(
    s.confidenceBreakdown.rows.reduce((a, r) => a + r.points, 0),
    s.confidence,
    "breakdown rows always sum to confidence",
  );
}

console.log("ok — invariants: unique ids, empty-safe, bearish/loss grade, band sums");
