import assert from "node:assert";
import {
  TIMEFRAMES,
  DEFAULT_TF,
  INTERVAL_TF,
  BAR_SECONDS,
  BTST_MAX_VIEW_BARS,
  tfFor,
  barSecondsFor,
} from "./timeframes.js";

const keys = TIMEFRAMES.map((t) => t.key);
assert.strictEqual(new Set(keys).size, keys.length, "timeframe keys are unique");
assert(tfFor(DEFAULT_TF), `DEFAULT_TF "${DEFAULT_TF}" must be a real timeframe`);

for (const t of TIMEFRAMES) {
  assert(["interval", "range"].includes(t.group), `${t.key} has a valid group`);
  assert(BAR_SECONDS[t.interval], `${t.key} uses a known bar size (${t.interval})`);
  assert(t.label && t.range, `${t.key} has a label and a range`);
  const sub = BAR_SECONDS[t.interval] < BAR_SECONDS["1d"];
  assert.strictEqual(!!t.intraday, sub, `${t.key}: the intraday flag must match its bar size`);
  if (t.viewBars != null) assert(t.viewBars > 0, `${t.key} viewBars is positive`);
}

for (const [scan, key] of Object.entries(INTERVAL_TF)) {
  const t = tfFor(key);
  assert(t, `scan interval "${scan}" points at "${key}", which is not a timeframe`);
  if (BAR_SECONDS[scan]) {
    assert.strictEqual(
      barSecondsFor(key),
      BAR_SECONDS[scan],
      `a "${scan}" signal must open on ${scan} bars, not ${t.interval} — the chart would show the wrong resolution`,
    );
  }
}

const btst = tfFor(INTERVAL_TF.btst);
assert.strictEqual(barSecondsFor(INTERVAL_TF.btst), BAR_SECONDS["1d"], "BTST is decided on the daily bar, so its chart must be daily");
assert(
  btst.viewBars != null && btst.viewBars <= BTST_MAX_VIEW_BARS,
  `BTST is a next-day trade: its chart must open on <= ${BTST_MAX_VIEW_BARS} bars, not ${btst.viewBars ?? "all"} ` +
    `(it pointed at the 1Y tab until 2026-07-30, burying the signal bar in ~250)`,
);

const swing = tfFor(INTERVAL_TF["1d"]);
assert(swing.viewBars != null, "the swing chart should frame a window, not dump the whole fetched range");
assert(swing.viewBars > btst.viewBars, "a ~10-day swing needs more context than a next-day BTST call");

for (const [scan, key] of Object.entries(INTERVAL_TF)) {
  const t = tfFor(key);
  if (t.viewBars == null) continue;
  const barsInRange = { "1d": 1, "5d": 5, "1mo": 21, "3mo": 63, "1y": 250, "2y": 500, "5y": 1250 }[t.range];
  const unit = BAR_SECONDS[t.interval] / BAR_SECONDS["1d"];
  assert(
    t.viewBars <= barsInRange / (unit || 1),
    `${scan} -> ${key}: viewBars ${t.viewBars} exceeds what ${t.range} of ${t.interval} bars can supply`,
  );
}

console.log(
  "timeframes: " +
    Object.entries(INTERVAL_TF)
      .map(([s, k]) => `${s}→${k}(${tfFor(k).viewBars ?? "all"})`)
      .join(" "),
);
