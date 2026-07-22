import assert from "node:assert";
import {
  smaSeries,
  emaSeries,
  macd,
  atrSeries,
  stochastic,
  supertrend,
  adx,
  obv,
  vwap,
  INDICATORS,
} from "./chartIndicators.js";

const DAY = 86400;
const t0 = 1700000000;
const candles = [];
for (let i = 0; i < 80; i++) {
  const p = 100 + 20 * Math.sin(i / 6) + i * 0.15;
  candles.push({
    time: t0 + i * DAY,
    open: p,
    high: p + 1.2,
    low: p - 1.3,
    close: p + 0.4,
    volume: 1000 + (i % 5) * 250,
  });
}
const closes = candles.map((c) => c.close);

assert.strictEqual(smaSeries([2, 4, 6], 2)[2], 5);
assert.strictEqual(emaSeries([1, 2, 3, 4], 2)[1], 1.5);

const m = macd(closes);
for (let i = 0; i < closes.length; i++) {
  if (m.line[i] != null && m.signal[i] != null) {
    assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-9);
  }
}

const atr = atrSeries(candles, 14);
assert.strictEqual(atr[13], null);
assert.ok(atr.slice(14).every((v) => v > 0));

const st = stochastic(candles);
assert.ok(st.k.slice(13).every((v) => v >= 0 && v <= 100));

const sup = supertrend(candles);
sup.st.forEach((v, i) => {
  if (v != null) assert.ok(sup.dir[i] === 1 || sup.dir[i] === -1);
});

const a = adx(candles);
assert.ok(a.adx.some((v) => v != null && v >= 0 && v <= 100));

const o = obv(candles);
assert.strictEqual(o.length, candles.length);
assert.strictEqual(o[0], 0);

const w = vwap(candles);
const hi = Math.max(...candles.map((c) => c.high));
const lo = Math.min(...candles.map((c) => c.low));
assert.ok(w.every((v) => v == null || (v >= lo && v <= hi)));

for (const def of INDICATORS) {
  const built = def.build(candles);
  assert.ok(Array.isArray(built) && built.length > 0, `${def.key} built lines`);
  for (const line of built) {
    let prev = -Infinity;
    for (const pt of line.data) {
      assert.ok(pt.time > prev, `${def.key} times ascending`);
      prev = pt.time;
    }
  }
}

console.log("chartIndicators: all checks passed");
