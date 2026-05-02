import { NSE_STOCKS } from "./nseStocks";

// ── Mutual Funds — MFAPI.in ───────────────────────────

export async function searchMFSchemes(query) {
  if (!query || query.trim().length < 2) return [];
  const res = await fetch(
    `https://api.mfapi.in/mf/search?q=${encodeURIComponent(query.trim())}`
  );
  if (!res.ok) throw new Error("Fund search failed");
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 10) : [];
}

async function fetchMFPrice(schemeCode) {
  const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}/latest`);
  if (!res.ok) throw new Error("Scheme not found");
  const data = await res.json();
  const nav = parseFloat(data?.data?.[0]?.nav);
  if (!nav) throw new Error("NAV not available");
  return nav;
}

// ── Crypto — CoinGecko ────────────────────────────────

async function fetchCryptoPrice(coinId) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId.toLowerCase())}&vs_currencies=inr`
  );
  if (!res.ok) throw new Error("CoinGecko request failed");
  const data = await res.json();
  const price = data[coinId.toLowerCase()]?.inr;
  if (price == null) throw new Error(`Coin ID "${coinId}" not found — check id at coingecko.com`);
  return price;
}

// ── NSE stock search (local, no network) ─────────────────

function searchNSE(query) {
  const q = query.trim().toLowerCase();
  return NSE_STOCKS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.symbol.toLowerCase().replace(".ns", "").startsWith(q) ||
      s.symbol.toLowerCase().replace(".ns", "").includes(q)
  )
    .slice(0, 10)
    .map((s) => ({ symbol: s.symbol, name: s.name, exchange: "NSE" }));
}

// ── Stocks / ETF / Gold — Yahoo Finance (via CORS proxies) ──
// Fire all proxies × both Yahoo hosts in parallel; first success wins.

const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

const PROXY_WRAPPERS = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Builds every (proxy × host) combination for a given path and races them.
async function proxyFetch(path) {
  const attempts = YAHOO_HOSTS.flatMap((host) =>
    PROXY_WRAPPERS.map((wrap) => fetchWithTimeout(wrap(host + path)))
  );
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("Network error");
  }
}

async function fetchYahooPrice(ticker) {
  const sym = ticker.toUpperCase();
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  let res;
  try {
    res = await proxyFetch(path);
  } catch {
    throw new Error(`Could not fetch price for "${sym}" — check your connection or update manually`);
  }
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (price == null) {
    const hint = sym.includes(".") ? "" : ` — try adding exchange suffix, e.g. ${sym}.NS`;
    throw new Error(`No price data for "${sym}"${hint}`);
  }
  return price;
}

export async function searchStockTickers(query, indiaOnly = false) {
  if (!query || query.trim().length < 2) return [];

  if (indiaOnly) return searchNSE(query);

  const path = `/v1/finance/search?q=${encodeURIComponent(query.trim())}&quotesCount=10&newsCount=0`;
  let res;
  try {
    res = await proxyFetch(path);
  } catch {
    throw new Error("Search failed. Try entering the ticker directly.");
  }
  const data = await res.json();
  const quotes = data?.quotes ?? [];
  const excluded = new Set(["CURRENCY", "FUTURE", "OPTION", "INDEX"]);
  return quotes
    .filter((q) => q.symbol && !excluded.has(q.quoteType))
    .slice(0, 8)
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchDisp || q.exchange,
    }));
}

// ── Public entry point ────────────────────────────────

export async function fetchCurrentPrice(type, ticker) {
  if (!ticker?.trim()) throw new Error("No ticker/identifier set");
  const t = ticker.trim();
  if (type === "mf" || type === "sip") return fetchMFPrice(t);
  if (type === "crypto") return fetchCryptoPrice(t);
  return fetchYahooPrice(t);
}

export function tickerPlaceholder(type) {
  if (type === "mf" || type === "sip") return "Scheme code";
  if (type === "crypto") return "CoinGecko ID";
  return "Ticker";
}
