export const TIMEFRAMES = [
  { key: "1m", label: "1m", interval: "1m", range: "1d", intraday: true, group: "interval" },
  { key: "5m", label: "5m", interval: "5m", range: "5d", intraday: true, group: "interval" },
  { key: "15m", label: "15m", interval: "15m", range: "1mo", intraday: true, group: "interval" },
  { key: "1h", label: "1h", interval: "60m", range: "3mo", intraday: true, group: "interval" },
  { key: "1D", label: "Today", interval: "5m", range: "1d", intraday: true, group: "range" },
  { key: "1W", label: "5D", interval: "30m", range: "5d", intraday: true, group: "range" },
  { key: "1M", label: "1M", interval: "1d", range: "1y", viewBars: 21, group: "range" },
  { key: "6M", label: "6M", interval: "1d", range: "2y", viewBars: 126, group: "range" },
  { key: "1Y", label: "1Y", interval: "1d", range: "1y", group: "range" },
  { key: "5Y", label: "5Y", interval: "1wk", range: "5y", group: "range" },
];

export const DEFAULT_TF = "1D";

export const INTERVAL_TF = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "1d": "6M",
  "1wk": "5Y",
  btst: "1M",
};

export const BAR_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "60m": 3600,
  "1h": 3600,
  "1d": 86400,
  "1wk": 604800,
};

export const BTST_MAX_VIEW_BARS = 40;

export function tfFor(key) {
  return TIMEFRAMES.find((t) => t.key === key) ?? null;
}

export function barSecondsFor(key) {
  return BAR_SECONDS[tfFor(key)?.interval] ?? null;
}
