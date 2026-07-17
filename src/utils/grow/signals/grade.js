export const GRADE_DEFAULTS = { horizon: 10, target: 0.04, stop: 0.03 };

export function gradeSignal(signal, candles, idxByTime, opts = {}) {
  const { horizon, target, stop } = { ...GRADE_DEFAULTS, ...opts };
  const i = idxByTime.get(signal.time);
  if (i == null || i >= candles.length - 1 || signal.direction === "neutral") {
    return { status: "pending", returnPct: 0, bars: 0 };
  }
  const dir = signal.direction === "bearish" ? -1 : 1;
  const entry = candles[i].close;
  const targetPrice = entry * (1 + dir * target);
  const stopPrice = entry * (1 - dir * stop);
  const end = Math.min(candles.length - 1, i + horizon);

  for (let j = i + 1; j <= end; j++) {
    const c = candles[j];
    if (dir === 1) {
      if (c.high >= targetPrice) return { status: "win", returnPct: target, bars: j - i };
      if (c.low <= stopPrice) return { status: "loss", returnPct: -stop, bars: j - i };
    } else {
      if (c.low <= targetPrice) return { status: "win", returnPct: target, bars: j - i };
      if (c.high >= stopPrice) return { status: "loss", returnPct: -stop, bars: j - i };
    }
  }

  const ret = (dir * (candles[end].close - entry)) / entry;
  const fullHorizon = end - i >= horizon;
  return { status: fullHorizon ? "flat" : "pending", returnPct: ret, bars: end - i };
}

function aggregate(items) {
  const res = items.filter((g) => g.outcome.status !== "pending");
  const wins = res.filter((g) => g.outcome.status === "win").length;
  const ret = res.reduce((s, g) => s + g.outcome.returnPct, 0);
  return {
    count: items.length,
    resolved: res.length,
    wins,
    hitRate: res.length ? wins / res.length : 0,
    avgReturn: res.length ? ret / res.length : 0,
  };
}

export function scoreCard(signals, candles, opts = {}) {
  const idxByTime = new Map();
  candles.forEach((c, i) => idxByTime.set(c.time, i));
  const graded = signals.map((s) => ({ signal: s, outcome: gradeSignal(s, candles, idxByTime, opts) }));

  const byTypeMap = new Map();
  for (const g of graded) {
    if (!byTypeMap.has(g.signal.type)) byTypeMap.set(g.signal.type, []);
    byTypeMap.get(g.signal.type).push(g);
  }
  const byType = [...byTypeMap.entries()]
    .map(([type, items]) => ({ type, name: items[0].signal.name, ...aggregate(items) }))
    .filter((t) => t.resolved > 0)
    .sort((a, b) => b.resolved - a.resolved);

  const byBand = ["high", "moderate", "low"].map((b) => ({
    band: b,
    ...aggregate(graded.filter((g) => g.signal.confidenceBreakdown?.band === b)),
  }));

  return { overall: aggregate(graded), byType, byBand, graded };
}

export function calibrateReliabilities(rawSignals, candles, opts = {}) {
  const k = opts.k ?? 5;
  const idxByTime = new Map();
  candles.forEach((c, i) => idxByTime.set(c.time, i));

  const byType = new Map();
  for (const s of rawSignals) {
    if (!byType.has(s.type)) byType.set(s.type, { prior: s.factors.baseReliability ?? 0.5, wins: 0, resolved: 0 });
    const g = gradeSignal(s, candles, idxByTime, opts);
    if (g.status === "pending") continue;
    const t = byType.get(s.type);
    t.resolved++;
    if (g.status === "win") t.wins++;
  }

  const out = new Map();
  for (const [type, t] of byType) {
    out.set(type, (t.wins + k * t.prior) / (t.resolved + k));
  }
  return out;
}
