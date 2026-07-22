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
};

export function signalId(symbol, interval, type, time) {
  return `${symbol}:${interval}:${type}:${time}`;
}
