import { ENGINE, signalId, SUPPRESSED_TYPES, tradeType, edgeFor, beatsRandom } from "./contract.js";
import { rsiSeries, pivots, sma, atrSeries } from "./indicators.js";
import { detectAll } from "./detectors.js";
import { withSignalConfidence } from "./confidence.js";
import { calibrateReliabilities, typeHistory, GRADE_DEFAULTS } from "./grade.js";

function planFor(direction, entry, atr) {
  const useAtr = atr != null && atr > 0 && entry > 0;
  const t = useAtr ? GRADE_DEFAULTS.atrTarget * atr : entry * GRADE_DEFAULTS.target;
  const s = useAtr ? GRADE_DEFAULTS.atrStop * atr : entry * GRADE_DEFAULTS.stop;
  const dir = direction === "bearish" ? -1 : 1;
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    entry: r2(entry),
    target: r2(entry + dir * t),
    stop: r2(entry - dir * s),
    rr: s > 0 ? Math.round((t / s) * 100) / 100 : 0,
    horizonBars: GRADE_DEFAULTS.horizon,
  };
}

function asReliabilityMap(v) {
  return v instanceof Map ? v : new Map(Object.entries(v));
}

function applyCooldown(list, idxByTime, bars) {
  if (!bars) return list;
  const last = new Map();
  const kept = [];
  for (const s of [...list].sort((a, b) => a.time - b.time)) {
    const i = idxByTime.get(s.time);
    if (i == null) continue;
    const prev = last.get(s.type);
    if (prev != null && i - prev <= bars) continue;
    last.set(s.type, i);
    kept.push(s);
  }
  return kept;
}


export function runSignals(candles, ctx = {}) {
  const symbol = ctx.symbol || "";
  const interval = ctx.interval || "1d";
  const timeframe = ctx.timeframe || "";
  const lastIndex = candles.length - 1;

  if (candles.length < 3) {
    return { symbol, timeframe, interval, generatedAt: 0, engine: ENGINE, candleCount: candles.length, signals: [] };
  }

  const closes = candles.map((c) => c.close);
  const rsi = rsiSeries(closes, 14);
  const piv = pivots(candles, 3, 3);
  const atr = atrSeries(candles, GRADE_DEFAULTS.atrPeriod);
  const raw = detectAll(candles, closes, { rsi, piv });
  const reliability =
    ctx.reliabilities != null ? asReliabilityMap(ctx.reliabilities) : calibrateReliabilities(raw, candles, ctx.grade);

  const idxByTime = new Map();
  candles.forEach((c, i) => idxByTime.set(c.time, i));

  const byTime = new Map();
  for (const r of raw) {
    if (!byTime.has(r.time)) byTime.set(r.time, []);
    byTime.get(r.time).push(r);
  }

  const signals = raw.map((r) => {
    const cluster = byTime.get(r.time);
    const confluence = cluster.length - 1;
    const idx = idxByTime.get(r.time) ?? lastIndex;
    const recencyBars = lastIndex - idx;
    const withMeta = {
      ...r,
      id: signalId(symbol, interval, r.type, r.time),
      factors: {
        ...r.factors,
        baseReliability: reliability.get(r.type) ?? r.factors.baseReliability,
        edgeVsRandom: edgeFor(r.type, interval),
        confluence,
        recencyBars,
      },
      relatedIds: cluster.filter((x) => x !== r).map((x) => signalId(symbol, interval, x.type, x.time)),
    };
    const scored = withSignalConfidence(withMeta);
    scored.plan = planFor(scored.direction, scored.price, atr[idx]);
    scored.tradeType = tradeType(interval);
    scored.sortValue = Math.round(scored.factors.signalStrength * scored.confidence);
    return scored;
  });

  const byId = new Map();
  for (const s of signals) if (!byId.has(s.id)) byId.set(s.id, s);
  let unique = [...byId.values()];
  if (!ctx.includeSuppressed) {
    unique = unique.filter((s) => !SUPPRESSED_TYPES.has(s.type) && beatsRandom(s.type, interval));
  }
  if (ctx.trendFilter) {
    const tp = ctx.trendPeriod ?? 50;
    unique = unique.filter((s) => {
      if (s.direction === "neutral") return true;
      const i = idxByTime.get(s.time);
      if (i == null) return true;
      const m = sma(closes, tp, i);
      if (m == null) return true;
      return (s.direction === "bullish") === (closes[i] > m);
    });
  }
  if (ctx.longOnly) unique = unique.filter((s) => s.direction !== "bearish");
  unique = applyCooldown(unique, idxByTime, ctx.cooldownBars ?? GRADE_DEFAULTS.horizon);
  const history = typeHistory(unique, candles, { ...ctx.grade, atr });
  for (const s of unique) s.history = history.get(s.type) ?? null;
  unique.sort((a, b) => b.sortValue - a.sortValue);

  return {
    symbol,
    timeframe,
    interval,
    generatedAt: ctx.now ?? candles[lastIndex].time,
    engine: ENGINE,
    candleCount: candles.length,
    signals: unique,
  };
}
