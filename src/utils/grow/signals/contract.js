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

export function signalId(symbol, interval, type, time) {
  return `${symbol}:${interval}:${type}:${time}`;
}
