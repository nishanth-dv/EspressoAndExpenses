import { getAccessToken } from "../googleDrive";
import { proxyFetch } from "../priceService";

const API = import.meta.env.VITE_API_URL ?? "";

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
  "1d": "1Y",
  btst: "1Y",
};

function parseChart(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!ts || !q?.close) return [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  return out;
}

async function fromBackend(symbol, interval, range) {
  if (!API) return null;
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(
      `${API}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.candles) && data.candles.length ? data.candles : null;
  } catch {
    return null;
  }
}

export async function fetchCandles(symbol, timeframeKey = DEFAULT_TF) {
  const tf =
    TIMEFRAMES.find((t) => t.key === timeframeKey) ??
    TIMEFRAMES.find((t) => t.key === DEFAULT_TF);
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error("No symbol");

  const backend = await fromBackend(sym, tf.interval, tf.range);
  if (backend) return backend;

  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=${tf.interval}&range=${tf.range}`;
  const res = await proxyFetch(path);
  const candles = parseChart(await res.json());
  if (!candles.length) {
    const hint = sym.includes(".") ? "" : ` — try a suffix, e.g. ${sym}.NS`;
    throw new Error(`No candle data for "${sym}"${hint}`);
  }
  return candles;
}
