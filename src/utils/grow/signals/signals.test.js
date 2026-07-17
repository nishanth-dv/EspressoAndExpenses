import assert from "node:assert";
import { runSignals } from "./index.js";
import { gradeSignal, scoreCard } from "./grade.js";

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

const rep = runSignals(candles, { symbol: "TEST.NS", interval: "1d", timeframe: "6M" });

const be = rep.signals.find((s) => s.type === "bullish_engulfing");
assert(be, "expected a bullish_engulfing signal");
assert.strictEqual(be.time, candles[candles.length - 1].time, "engulfing on the last bar");
assert(be.confidence >= 0 && be.confidence <= 100, "confidence in range");
const sum = be.confidenceBreakdown.rows.reduce((s, r) => s + r.points, 0);
assert.strictEqual(sum, be.confidence, "breakdown rows sum to confidence");
assert.strictEqual(typeof be.marker.text, "string", "marker has a text code");
assert.strictEqual(be.marker.shape, "arrowUp", "bullish marker points up");
assert.strictEqual(be.id, "TEST.NS:1d:bullish_engulfing:" + be.time, "deterministic id");

console.log(`ok — ${rep.signals.length} signals; bullish_engulfing confidence ${be.confidence}`);

const seq = [110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100.5, 103, 106, 109, 112, 114];
const w = seq.map((p, k) =>
  candle(t0 + k * DAY, k ? seq[k - 1] : p, p + 0.5, p - 0.5, p, k === 19 ? 3000 : 1000),
);
const rep2 = runSignals(w, { symbol: "W.NS", interval: "1d", timeframe: "1Y" });
const db = rep2.signals.find((s) => s.type === "double_bottom");
assert(db, "expected a double_bottom signal");
assert.strictEqual(db.fromTime, w[5].time, "double bottom spans from the first low");
assert.strictEqual(db.time, w[19].time, "double bottom confirms on the neckline breakout bar");
assert.strictEqual(db.category, "chart", "geometric pattern is category chart");

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
