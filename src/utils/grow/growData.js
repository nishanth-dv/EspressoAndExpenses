import { getAccessToken } from "../googleDrive";
import { proxyFetch } from "../priceService";
import { TIMEFRAMES, DEFAULT_TF } from "./timeframes.js";

const API = import.meta.env.VITE_API_URL ?? "";

export { TIMEFRAMES, DEFAULT_TF, INTERVAL_TF } from "./timeframes.js";

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
