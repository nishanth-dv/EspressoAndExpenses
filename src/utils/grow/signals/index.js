import { ENGINE, DIRECTION, signalId, SUPPRESSED_TYPES } from "./contract.js";
import { rsiSeries, pivots, sma } from "./indicators.js";
import { detectAll } from "./detectors.js";
import { withSignalConfidence } from "./confidence.js";
import { calibrateReliabilities } from "./grade.js";

const COLORS = { bullish: "#16a34a", bearish: "#ef4444", neutral: "#9ca3af" };

function markerFor(sig) {
  if (sig.direction === DIRECTION.BULL)
    return { time: sig.time, position: "belowBar", shape: "arrowUp", color: COLORS.bullish, text: sig.code };
  if (sig.direction === DIRECTION.BEAR)
    return { time: sig.time, position: "aboveBar", shape: "arrowDown", color: COLORS.bearish, text: sig.code };
  return { time: sig.time, position: "inBar", shape: "circle", color: COLORS.neutral, text: sig.code };
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
  const raw = detectAll(candles, closes, { rsi, piv });
  const reliability = calibrateReliabilities(raw, candles, ctx.grade);

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
        confluence,
        recencyBars,
      },
      relatedIds: cluster.filter((x) => x !== r).map((x) => signalId(symbol, interval, x.type, x.time)),
    };
    const scored = withSignalConfidence(withMeta);
    scored.marker = markerFor(scored);
    scored.sortValue = Math.round(scored.factors.signalStrength * scored.confidence);
    return scored;
  });

  const byId = new Map();
  for (const s of signals) if (!byId.has(s.id)) byId.set(s.id, s);
  let unique = [...byId.values()];
  if (!ctx.includeSuppressed) unique = unique.filter((s) => !SUPPRESSED_TYPES.has(s.type));
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
