import { Hono } from "hono";
import { cors } from "hono/cors";
import { createYoga } from "graphql-yoga";
import { requireUser, requireToken, requireAdmin } from "./middleware/auth";
import { serviceClient } from "./db/client";
import { schema, type GqlContext } from "./graphql/schema";
import type { AppEnv, Env } from "./types";

// Free, server-fetchable market levels (Yahoo, no CORS server-side). Each fetch
// is isolated so one failure never breaks the refresh.
async function fetchYahoo(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
    };
    const p = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === "number" ? p : null;
  } catch {
    return null;
  }
}

// Trailing annualised returns for an index from Yahoo's monthly history. Used
// to benchmark the user's equity against the real Nifty, not a flat assumption.
async function fetchYahooReturns(
  symbol: string,
): Promise<{ r1: number | null; r3: number | null; r5: number | null } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=5y`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: {
          timestamp?: number[];
          indicators?: { quote?: { close?: (number | null)[] }[] };
        }[];
      };
    };
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!ts || !closes || ts.length === 0) return null;

    let latest: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (typeof closes[i] === "number") {
        latest = closes[i] as number;
        break;
      }
    }
    if (latest == null || latest <= 0) return null;
    const L = latest;

    const nowSec = Date.now() / 1000;
    const closeYearsAgo = (yearsAgo: number): number | null => {
      const target = nowSec - yearsAgo * 365 * 86_400;
      let best: number | null = null;
      let bestDiff = Infinity;
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c !== "number") continue;
        const diff = Math.abs(ts[i] - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = c;
        }
      }
      return best;
    };
    const ann = (c: number | null, yrs: number): number | null =>
      c && c > 0 ? Math.round((Math.pow(L / c, 1 / yrs) - 1) * 1000) / 10 : null;

    return {
      r1: ann(closeYearsAgo(1), 1),
      r3: ann(closeYearsAgo(3), 3),
      r5: ann(closeYearsAgo(5), 5),
    };
  } catch {
    return null;
  }
}

async function fetchYahooCandles(
  symbol: string,
  interval: string,
  range: string,
): Promise<
  { time: number; open: number; high: number; low: number; close: number; volume: number }[] | null
> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: {
          timestamp?: number[];
          indicators?: {
            quote?: {
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }[];
          };
        }[];
      };
    };
    const r = data?.chart?.result?.[0];
    const ts = r?.timestamp;
    const q = r?.indicators?.quote?.[0];
    if (!ts || !q?.close) return null;
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
    }
    return out;
  } catch {
    return null;
  }
}

async function refreshRates(env: Env) {
  const db = serviceClient(env);
  const now = new Date().toISOString();
  const rows: {
    key: string;
    value: number;
    label: string;
    source: string;
    as_of: string;
  }[] = [];

  const nifty = await fetchYahoo("%5ENSEI");
  if (nifty != null)
    rows.push({ key: "nifty", value: nifty, label: "Nifty 50", source: "yahoo", as_of: now });

  // Nifty trailing returns — the real equity benchmark.
  const niftyRet = await fetchYahooReturns("%5ENSEI");
  if (niftyRet) {
    if (niftyRet.r1 != null)
      rows.push({ key: "nifty_ret_1y", value: niftyRet.r1, label: "Nifty 1-yr return", source: "yahoo", as_of: now });
    if (niftyRet.r3 != null)
      rows.push({ key: "nifty_ret_3y", value: niftyRet.r3, label: "Nifty 3-yr return (annualised)", source: "yahoo", as_of: now });
    if (niftyRet.r5 != null)
      rows.push({ key: "nifty_ret_5y", value: niftyRet.r5, label: "Nifty 5-yr return (annualised)", source: "yahoo", as_of: now });
  }

  const gold = await fetchYahoo("GOLDBEES.NS");
  if (gold != null)
    rows.push({ key: "gold_etf", value: gold, label: "Gold ETF (GoldBeES)", source: "yahoo", as_of: now });

  // Gold trailing returns — the benchmark for gold holdings.
  const goldRet = await fetchYahooReturns("GOLDBEES.NS");
  if (goldRet) {
    if (goldRet.r1 != null)
      rows.push({ key: "gold_ret_1y", value: goldRet.r1, label: "Gold 1-yr return", source: "yahoo", as_of: now });
    if (goldRet.r3 != null)
      rows.push({ key: "gold_ret_3y", value: goldRet.r3, label: "Gold 3-yr return (annualised)", source: "yahoo", as_of: now });
    if (goldRet.r5 != null)
      rows.push({ key: "gold_ret_5y", value: goldRet.r5, label: "Gold 5-yr return (annualised)", source: "yahoo", as_of: now });
  }

  // Administered / reference rates. These aren't market-traded (no free live
  // API), so they're maintained here as reference values and refreshed with the
  // cron's timestamp. Update on rate changes (RBI MPC, quarterly small-savings
  // revisions) — the advisory engine reads these for FD-renewal, G-Sec, SCSS
  // and arbitrage recommendations. Keep them roughly current.
  const REFERENCE_RATES: { key: string; value: number; label: string }[] = [
    { key: "repo", value: 6.0, label: "RBI repo rate" },
    { key: "inflation", value: 4.8, label: "CPI inflation" },
    { key: "fd_1y", value: 7.0, label: "Best 1-yr FD" },
    { key: "gsec_10y", value: 6.9, label: "10-yr G-Sec yield" },
    { key: "scss", value: 8.2, label: "Senior Citizens Savings Scheme" },
    { key: "ppf", value: 7.1, label: "PPF" },
    { key: "liquid_fund", value: 6.6, label: "Liquid fund (approx)" },
    { key: "arbitrage", value: 6.6, label: "Arbitrage fund (approx)" },
  ];
  for (const r of REFERENCE_RATES) {
    rows.push({ ...r, source: "reference", as_of: now });
  }

  if (rows.length) await db.from("advisory_rates").upsert(rows);
}

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const csv: string = c.env.APP_ORIGIN ?? "";
      if (!csv) return origin;
      const allowed = csv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
  }),
);
app.get("/health", (c) => c.text("ok"));

// Live single-symbol quote — server-side Yahoo fetch (no CORS, no flaky public
// proxies). Token-gated to any authenticated user. The client's price service
// tries this first and only falls back to the browser CORS-proxy race if it's
// unavailable. `symbol` is passed through verbatim (e.g. "RELIANCE.NS").
app.get("/quote", requireToken, async (c) => {
  const symbol = String(c.req.query("symbol") ?? "").trim();
  if (!symbol) return c.json({ error: "symbol required" }, 400);
  const price = await fetchYahoo(symbol);
  if (price == null) return c.json({ error: "no price data" }, 502);
  return c.json({ symbol, price });
});

const CANDLE_INTERVALS = new Set(["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"]);
const CANDLE_RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]);
app.get("/candles", requireToken, async (c) => {
  const symbol = String(c.req.query("symbol") ?? "").trim();
  const interval = String(c.req.query("interval") ?? "1d").trim();
  const range = String(c.req.query("range") ?? "6mo").trim();
  if (!symbol) return c.json({ error: "symbol required" }, 400);
  if (!CANDLE_INTERVALS.has(interval) || !CANDLE_RANGES.has(range))
    return c.json({ error: "bad interval/range" }, 400);
  const candles = await fetchYahooCandles(symbol, interval, range);
  if (!candles) return c.json({ error: "no candle data" }, 502);
  return c.json({ symbol, interval, range, candles });
});

// Grow breadth scan — ranked signals from the nightly pybrain batch (Supabase).
app.get("/grow/signals", requireToken, async (c) => {
  const db = serviceClient(c.env);
  const { data: scan } = await db
    .from("grow_scans")
    .select("scan_date, universe_size, signal_count, generated_at")
    .order("scan_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!scan) return c.json({ scan: null, signals: [] });

  const limit = Math.min(Number(c.req.query("limit") ?? 150) || 150, 300);
  let q = db
    .from("grow_signals")
    .select("*")
    .eq("scan_date", scan.scan_date)
    .order("confidence", { ascending: false })
    .limit(limit);
  const dir = c.req.query("direction");
  if (dir) q = q.eq("direction", dir);
  const band = c.req.query("band");
  if (band) q = q.eq("band", band);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ scan, signals: data ?? [] });
});

// Out-of-sample track record — aggregated forward-graded outcomes.
app.get("/grow/track", requireToken, async (c) => {
  const db = serviceClient(c.env);
  const { data, error } = await db.rpc("grow_track");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ track: data ?? [] });
});

// Page access — token-only (Drive users included). Returns the gated page keys
// this email may reach. No row = no gated access (default deny, fail-closed).
app.get("/access", requireToken, async (c) => {
  const email = c.get("user").email;
  const db = serviceClient(c.env);
  const { data, error } = await db
    .from("page_access")
    .select("pages")
    .eq("email", email)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const isAdmin = email.toLowerCase() === (c.env.ADMIN ?? "").toLowerCase();
  return c.json({ pages, isAdmin });
});

// ── Admin: manage page_access (admin email only) ──
const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

admin.get("/access", async (c) => {
  const db = serviceClient(c.env);
  const { data, error } = await db
    .from("page_access")
    .select("email, pages, updated_at")
    .order("email");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ grants: data ?? [] });
});

admin.post("/access", async (c) => {
  const body = (await c.req.json()) as { email?: string; pages?: unknown };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email) return c.json({ error: "email required" }, 400);
  const pages = Array.isArray(body.pages) ? body.pages.map(String) : [];
  const db = serviceClient(c.env);
  const { error } = await db
    .from("page_access")
    .upsert({ email, pages, updated_at: new Date().toISOString() });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, email, pages });
});

admin.delete("/access", async (c) => {
  const email = String(c.req.query("email") ?? "").trim().toLowerCase();
  if (!email) return c.json({ error: "email required" }, 400);
  const db = serviceClient(c.env);
  const { error } = await db.from("page_access").delete().eq("email", email);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

app.route("/admin", admin);

// Advisory market data — shared free rates the client engine reads.
app.get("/advisory/market", requireToken, async (c) => {
  const db = serviceClient(c.env);
  const { data, error } = await db
    .from("advisory_rates")
    .select("key, value, label, as_of, source");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ rates: data ?? [] });
});

// Manual trigger (admin) — same job the cron runs, for on-demand refresh.
app.post("/advisory/refresh", requireAdmin, async (c) => {
  await refreshRates(c.env);
  return c.json({ ok: true });
});

// Advisory Q&A — grounded natural-language answers over a DERIVED snapshot of
// the user's finances (never their raw ledger; the client builds and sends the
// summary). Provider-agnostic: it speaks the OpenAI-compatible chat-completions
// contract, so any gateway/provider works by setting LLM_API_URL + LLM_MODEL.
// Disabled (503) until LLM_API_KEY is configured, so the app degrades cleanly.
app.post("/advisory/ask", requireToken, async (c) => {
  const key = c.env.LLM_API_KEY;
  if (!key) return c.json({ error: "llm_not_configured" }, 503);

  const body = (await c.req.json().catch(() => ({}))) as {
    question?: string;
    snapshot?: unknown;
    history?: { role?: string; content?: string }[];
  };
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return c.json({ error: "question required" }, 400);

  const snapshot = body.snapshot ?? {};
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const url = c.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = c.env.LLM_MODEL || "gpt-4o-mini";

  const system =
    "You are a careful personal-finance assistant embedded in a money-tracking app for an Indian user. " +
    "Answer ONLY from the JSON snapshot of the user's own finances below. All amounts are Indian rupees (INR). " +
    "If the snapshot lacks what's needed, say so plainly and suggest what to add — never invent figures. " +
    "Be concise (2–5 sentences), concrete, and when you give a recommendation add a short reminder that you're not a registered adviser. " +
    `Snapshot:\n${JSON.stringify(snapshot)}`;

  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content ?? "").slice(0, 2000),
    })),
    { role: "user", content: question },
  ];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 500 }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return c.json({ error: "llm_error", status: res.status, detail }, 502);
    }
    const out = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = out?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) return c.json({ error: "empty_response" }, 502);
    return c.json({ answer });
  } catch (e) {
    return c.json({ error: "llm_unreachable", detail: String(e).slice(0, 200) }, 502);
  }
});

app.onError((err, c) => c.json({ error: err.message }, 500));

const yoga = createYoga<GqlContext>({
  schema,
  graphqlEndpoint: "/graphql",
  cors: false,
  landingPage: false,
});

app.on(["GET", "POST"], "/graphql", requireUser, (c) =>
  yoga.fetch(c.req.raw, { env: c.env, userId: c.get("user").sub }),
);

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  scheduled: (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(refreshRates(env));
  },
};
