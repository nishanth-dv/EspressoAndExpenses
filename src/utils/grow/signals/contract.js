export const CATEGORY = {
  CANDLESTICK: "candlestick",
  INDICATOR: "indicator",
  STRUCTURE: "structure",
  CHART: "chart",
};

export const DIRECTION = {
  BULL: "bullish",
  BEAR: "bearish",
  NEUTRAL: "neutral",
};

export const ENGINE = { source: "rules", version: "grow-signals-0.1.0" };

export const SUPPRESSED_TYPES = new Set([
  "double_top",
  "breakdown",
  "rsi_overbought",
  "head_shoulders",
  "shooting_star",
  "bearish_engulfing",
]);

export const EDGE_FLOOR = 0.2;
export const EDGE_PRIOR_N = 1000;
export const EDGE_Z = 1;

export const EDGE_VS_RANDOM = {
  "1d": {
    support_bounce: { edge: 0.442, n: 10143, sd: 0.232, windows: 9 },
    rsi_oversold: { edge: 1.017, n: 1028, sd: 0.659, windows: 9 },
    hammer: { edge: 0.12, n: 2544 },
    double_bottom: { edge: 0.04, n: 1575 },
    bullish_engulfing: { edge: 0.01, n: 3659 },
    morning_star: { edge: -0.02, n: 3427 },
    breakout: { edge: -0.12, n: 3891 },
    inverse_head_shoulders: { edge: -0.28, n: 754 },
  },
  "1wk": {
    support_bounce: { edge: 1.512, n: 266, sd: 1.03, windows: 5 },
    bullish_engulfing: { edge: -0.91, n: 344 },
    hammer: { edge: -1.09, n: 126 },
    morning_star: { edge: -1.94, n: 212 },
    breakout: { edge: -2.22, n: 258 },
  },
};

export function lowerBound(edge, sd, windows) {
  if (edge == null) return null;
  if (!sd || !windows) return edge;
  return edge - (EDGE_Z * sd) / Math.sqrt(windows);
}

export function shrinkEdge(edge, n) {
  if (edge == null || !n) return 0;
  return (edge * n) / (n + EDGE_PRIOR_N);
}

export function edgeFor(type, interval) {
  const row = EDGE_VS_RANDOM[interval]?.[type];
  if (!row) return null;
  return shrinkEdge(lowerBound(row.edge, row.sd, row.windows), row.n);
}

export function rawEdgeFor(type, interval) {
  return EDGE_VS_RANDOM[interval]?.[type] ?? null;
}

export function beatsRandom(type, interval) {
  if (!EDGE_VS_RANDOM[interval]) return true;
  const e = edgeFor(type, interval);
  return e != null && e >= EDGE_FLOOR;
}

export const CATEGORY_META = {
  candlestick: { label: "Candlestick", icon: "fa-chart-column" },
  indicator: { label: "Indicator", icon: "fa-wave-square" },
  structure: { label: "Structure", icon: "fa-ruler-horizontal" },
  chart: { label: "Chart pattern", icon: "fa-shapes" },
  btst: { label: "BTST", icon: "fa-bolt" },
};

export function signalId(symbol, interval, type, time) {
  return `${symbol}:${interval}:${type}:${time}`;
}

export const STYLES = [
  {
    key: "investment",
    label: "Investment",
    icon: "fa-seedling",
    intervals: ["1wk"],
    blurb: "weeks to months · weekly bars",
    live: true,
  },
  {
    key: "swing",
    label: "Swing",
    icon: "fa-chart-line",
    intervals: ["1d"],
    blurb: "days to weeks · daily bars",
    live: true,
  },
  {
    key: "btst",
    label: "BTST",
    icon: "fa-bolt",
    intervals: ["btst"],
    blurb: "buy today, sell tomorrow",
    live: true,
  },
  {
    key: "intraday",
    label: "Intraday",
    icon: "fa-clock",
    intervals: ["1h", "15m", "5m"],
    blurb: "same session · exit before the close",
    live: false,
  },
  {
    key: "scalping",
    label: "Scalping",
    icon: "fa-gauge-high",
    intervals: ["1m"],
    blurb: "minutes · 1-minute bars",
    live: false,
  },
];

export const LIVE_STYLES = STYLES.filter((s) => s.live);

const STYLE_BY_INTERVAL = new Map(STYLES.flatMap((s) => s.intervals.map((i) => [i, s])));

export function styleFor(interval) {
  return STYLE_BY_INTERVAL.get(interval) ?? null;
}

export function tradeType(interval) {
  if (interval === "1mo") return "Investment";
  return STYLE_BY_INTERVAL.get(interval)?.label ?? "Day";
}
