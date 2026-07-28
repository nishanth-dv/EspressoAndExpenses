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
    live: true,
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
