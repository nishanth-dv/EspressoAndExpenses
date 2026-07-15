import { NSE_STOCKS } from "./nseStocks";
import { getAccessToken } from "./googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

// Reliable server-side quote — the Cloudflare Worker fetches Yahoo without CORS
// or the flaky public proxies the browser is stuck with. Returns null (rather
// than throwing) on any failure so the caller can fall back gracefully.
async function fetchBackendQuote(symbol) {
  if (!API) return null;
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(
      `${API}/quote?symbol=${encodeURIComponent(symbol)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.price;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

// ── Mutual Funds — MFAPI.in ───────────────────────────

export async function searchMFSchemes(query) {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim();
  const res = await fetch(
    `https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`,
  );
  if (!res.ok) throw new Error("Fund search failed");
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return [];

  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  function score(schemeName) {
    const n = schemeName.toLowerCase();
    if (n === lower) return 10000;
    if (n.startsWith(lower + " ") || n.startsWith(lower + "-")) return 5000;
    const matched = words.filter((w) => n.includes(w)).length;
    if (matched === words.length) return 1000 + matched * 10 - n.length;
    return matched * 10;
  }

  return data
    .map((item) => ({ item, s: score(item.schemeName) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 10)
    .map(({ item }) => item);
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
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId.toLowerCase())}&vs_currencies=inr`,
  );
  if (!res.ok) throw new Error("CoinGecko request failed");
  const data = await res.json();
  const price = data[coinId.toLowerCase()]?.inr;
  if (price == null)
    throw new Error(
      `Coin ID "${coinId}" not found — check id at coingecko.com`,
    );
  return price;
}

// ── NSE stock search (local, no network) ─────────────────

function searchNSE(query) {
  const q = query.trim().toLowerCase();
  return NSE_STOCKS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.symbol.toLowerCase().replace(".ns", "").startsWith(q) ||
      s.symbol.toLowerCase().replace(".ns", "").includes(q),
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
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
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
    PROXY_WRAPPERS.map((wrap) => fetchWithTimeout(wrap(host + path))),
  );
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("Network error");
  }
}

async function fetchYahooPrice(ticker) {
  const sym = ticker.toUpperCase();

  // Try the reliable backend proxy first — no CORS, no third-party proxy
  // outages (the #1 cause of "price refresh failed" for stocks).
  const backendPrice = await fetchBackendQuote(sym);
  if (backendPrice != null && backendPrice > 0) return backendPrice;

  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  let res;
  try {
    res = await proxyFetch(path);
  } catch {
    throw new Error(
      `Could not fetch price for "${sym}" — check your connection or update manually`,
    );
  }
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (price == null) {
    const hint = sym.includes(".")
      ? ""
      : ` — try adding exchange suffix, e.g. ${sym}.NS`;
    throw new Error(`No price data for "${sym}"${hint}`);
  }
  return price;
}

async function searchYahooQuotes(query) {
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

export async function searchStockTickers(query, indiaOnly = false) {
  if (!query || query.trim().length < 2) return [];

  if (indiaOnly) {
    const local = searchNSE(query);
    if (local.length > 0) return local;
    return searchYahooQuotes(query);
  }

  return searchYahooQuotes(query);
}

// ── SIP — historical NAV computation ─────────────────

function navDateKey(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}-${m}-${date.getFullYear()}`;
}

function closestNav(navMap, date) {
  for (let i = 0; i <= 5; i++) {
    const d = new Date(date); d.setDate(d.getDate() + i);
    if (navMap[navDateKey(d)] != null) return navMap[navDateKey(d)];
    if (i > 0) {
      const d2 = new Date(date); d2.setDate(d2.getDate() - i);
      if (navMap[navDateKey(d2)] != null) return navMap[navDateKey(d2)];
    }
  }
  return null;
}

export async function fetchSIPData(schemeCode, monthlyAmount, startDate, sipDay) {
  const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
  if (!res.ok) throw new Error("Scheme not found");
  const { data } = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("No NAV history found");

  const navMap = {};
  data.forEach(({ date, nav }) => { navMap[date] = parseFloat(nav); });

  const monthly = parseFloat(monthlyAmount) || 0;
  const startRaw = new Date(startDate);
  // Normalise to local midnight so date-only comparisons aren't thrown off by
  // the UTC-vs-local offset (e.g. "2024-10-02" parses as UTC 00:00 which is
  // 05:30 IST, making same-day cursors appear "before" the start date).
  const start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate());
  const day = parseInt(sipDay) || start.getDate();
  const now = new Date();

  let totalUnits = 0;
  let instalments = 0;

  // First instalment: same month as start if SIP day >= start day, else next month
  let cursor = new Date(start.getFullYear(), start.getMonth(), day);
  if (cursor < start) cursor = new Date(start.getFullYear(), start.getMonth() + 1, day);

  while (cursor <= now) {
    const nav = closestNav(navMap, cursor);
    if (nav != null && nav > 0) {
      totalUnits += monthly / nav;
      instalments++;
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, day);
  }

  const totalInvested = monthly * instalments;
  const avgNav = totalUnits > 0 ? totalInvested / totalUnits : 0;
  const currentNav = parseFloat(data[0].nav);

  return {
    currentNav,
    totalUnits: Math.round(totalUnits * 1000) / 1000,
    avgNav: Math.round(avgNav * 100) / 100,
    totalInvested,
    instalments,
  };
}

// ── Public entry point ────────────────────────────────

const ceil2 = (n) => Math.ceil((Number(n) || 0) * 100 - 1e-9) / 100;

export async function fetchCurrentPrice(type, ticker) {
  if (!ticker?.trim()) throw new Error("No ticker/identifier set");
  const t = ticker.trim();
  let price;
  if (type === "mf" || type === "sip") price = await fetchMFPrice(t);
  else if (type === "crypto") price = await fetchCryptoPrice(t);
  else price = await fetchYahooPrice(t);
  return ceil2(price);
}

export function tickerPlaceholder(type) {
  if (type === "mf" || type === "sip") return "Scheme code";
  if (type === "crypto") return "CoinGecko ID";
  return "Ticker";
}
