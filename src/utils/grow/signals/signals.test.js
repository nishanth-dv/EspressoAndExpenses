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
assert(be.plan && be.plan.entry === be.price, "signal carries a trade plan anchored at entry");
assert(be.plan.target > be.plan.entry && be.plan.stop < be.plan.entry, "bullish plan: target above, stop below entry");
assert(Math.abs(be.plan.rr - 2 / 1.5) < 0.01, "R:R = atrTarget/atrStop");
assert.strictEqual(be.tradeType, "Swing", "1d interval -> Swing trade type");

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

assert.strictEqual(db.meta.shape[db.meta.shape.length - 1].value, db.meta.neckline, "double bottom ends ON its neckline, not past the breakout close");

console.log(`ok — double_bottom confidence ${db.confidence}`);

const dtSeq = [
  100, 104, 108, 112, 108, 104, 100, 96, 98, 100, 102, 104, 106, 108, 106, 104, 102, 104, 106, 108,
  106, 103, 100, 98, 96,
];
const dtC = dtSeq.map((p, k) => candle(t0 + k * DAY, k ? dtSeq[k - 1] : p, p + 0.5, p - 0.5, p, k === 22 ? 3000 : 1000));
const dt = runSignals(dtC, { symbol: "M.NS", interval: "1d", timeframe: "1Y", includeSuppressed: true }).signals.find(
  (s) => s.type === "double_top",
);
assert(dt, "expected a double_top signal");
assert.strictEqual(dt.meta.shape.length, 5, "double top: lead-in + two tops + trough + break");
assert.strictEqual(dt.fromTime, dt.meta.shape[0].time, "double top fromTime = shape start");
assert.strictEqual(dt.meta.shape[0].time, dtC[7].time, "lead-in is the swing low adjacent to the first top");
assert.strictEqual(dt.meta.shape[1].time, dtC[13].time, "second point is the first top");
assert.strictEqual(dt.meta.shape[4].value, dt.meta.neckline, "double top ends ON its neckline");
assert.strictEqual(dt.meta.neckline, dtC[16].low, "neckline is the exact trough low between the tops");
for (let k = 1; k < dt.meta.shape.length; k++) {
  assert(dt.meta.shape[k].time > dt.meta.shape[k - 1].time, "double top shape strictly time-ordered");
}

console.log(`ok — double_top shape ${dt.meta.shape.length} points, neckline ${dt.meta.neckline}`);

const midSeq = [
  104, 101, 98, 95, 98, 101, 104, 108, 106, 103, 100, 101, 102, 103, 102, 100, 98, 101, 104, 107,
  108.2, 106, 103, 99, 97,
];
const midC = midSeq.map((p, k) => candle(t0 + k * DAY, k ? midSeq[k - 1] : p, p + 0.5, p - 0.5, p));
const mid = runSignals(midC, { symbol: "MID.NS", interval: "1d", timeframe: "1Y", includeSuppressed: true }).signals.find(
  (s) => s.type === "double_top",
);
assert(mid, "twin tops separated by a LOWER pivot high are still a double top");
assert.strictEqual(mid.meta.shape[1].time, midC[7].time, "first top is bar 7, not the minor high between");
assert.strictEqual(mid.meta.shape[3].time, midC[20].time, "second top is bar 20 — non-consecutive pivot pairing");
assert.strictEqual(mid.meta.neckline, midC[16].low, "neckline is the lowest trough between the two tops");

const headSeq = midSeq.map((p, k) => (k === 13 ? 118 : p));
const headC = headSeq.map((p, k) => candle(t0 + k * DAY, k ? headSeq[k - 1] : p, p + 0.5, p - 0.5, p));
const notDt = runSignals(headC, { symbol: "HEAD.NS", interval: "1d", timeframe: "1Y", includeSuppressed: true }).signals.find(
  (s) => s.type === "double_top",
);
assert(!notDt, "a HIGHER peak between the two tops is a head, not a double top — must not pair across it");

console.log("ok — non-consecutive twin pairing; higher intervening peak rejected");

const hsSeq = [
  100, 96, 92, 88, 92, 96, 100, 104, 102, 100, 98, 100, 103, 106, 108, 106, 104, 102, 104, 105,
  106, 107, 108, 109, 110, 111, 112, 110, 106, 102, 104, 106, 108.5, 106, 103, 100, 98, 96,
];
const hsC = hsSeq.map((p, k) => candle(t0 + k * DAY, k ? hsSeq[k - 1] : p, p + 0.5, p - 0.5, p));
const rep3 = runSignals(hsC, { symbol: "HS.NS", interval: "1d", timeframe: "1Y", includeSuppressed: true });
const hs = rep3.signals.find((s) => s.type === "head_shoulders");
assert(hs, "expected a head_shoulders signal");
assert.strictEqual(hs.meta.shape.length, 7, "H&S shape draws both shoulder flanks (lead-in + 5 anchors + breakout)");
assert.strictEqual(hs.fromTime, hs.meta.shape[0].time, "H&S fromTime = shape start, so focus() frames the whole drawing");
assert.strictEqual(hs.meta.shape[0].time, hsC[10].time, "lead-in is the swing low ADJACENT to the left shoulder, not the deeper one further back");
assert.strictEqual(hs.meta.shape[1].time, hsC[14].time, "second point is the left shoulder peak");
assert.strictEqual(hs.meta.shape[6].time, hs.time, "shape ends on the neckline-break bar — the right shoulder's outer flank");
assert.strictEqual(hs.meta.shape[6].value, hs.meta.neckline, "shape ends ON the neckline the dashed line is drawn at, not below it");
assert.strictEqual(hs.meta.neckline, 101.5, "neckline is the exact swing low, unrounded, so line and shape coincide");
for (let k = 1; k < hs.meta.shape.length; k++) {
  assert(hs.meta.shape[k].time > hs.meta.shape[k - 1].time, "H&S shape points strictly time-ordered");
}

const ihsC = hsSeq.map((p, k) => {
  const v = 212 - p;
  return candle(t0 + k * DAY, k ? 212 - hsSeq[k - 1] : v, v + 0.5, v - 0.5, v);
});
const ihs = runSignals(ihsC, { symbol: "IHS.NS", interval: "1d", timeframe: "1Y" }).signals.find(
  (s) => s.type === "inverse_head_shoulders",
);
assert(ihs, "expected an inverse_head_shoulders signal on the mirrored series");
assert.strictEqual(ihs.meta.shape.length, 7, "inverse H&S shape draws both shoulder flanks too");
assert.strictEqual(ihs.fromTime, ihs.meta.shape[0].time, "inverse H&S fromTime = shape start");
assert.strictEqual(ihs.meta.shape[6].time, ihs.time, "inverse H&S shape ends on the breakout bar");
assert.strictEqual(ihs.meta.shape[6].value, ihs.meta.neckline, "inverse H&S shape ends on its neckline too");

console.log(`ok — head_shoulders / inverse shapes ${hs.meta.shape.length} points`);

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

const nd = [candle(t0, 100, 101, 99, 100), candle(t0 + DAY, 100, 103, 100, 102)];
const ndIdx = new Map(nd.map((c, k) => [c.time, k]));
const ocNd = gradeSignal({ time: nd[0].time, direction: "bullish" }, nd, ndIdx, { horizon: 1, exit: "nextday" });
assert.strictEqual(ocNd.status, "win", "next-day close above entry -> win");
assert(Math.abs(ocNd.returnPct - ((102 - 100) / 100 - costPct)) < 1e-9, "next-day return = close-to-close minus cost");

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
