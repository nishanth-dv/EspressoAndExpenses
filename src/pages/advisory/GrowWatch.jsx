import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { motion } from "framer-motion";
import { getAccessToken } from "../../utils/googleDrive";
import { fetchCandles } from "../../utils/grow/growData";
import { symbolBias } from "../../utils/grow/signals/bias";
import { srLevels } from "../../utils/grow/chartIndicators";
import { readWatchlist, toggleWatch } from "../../utils/grow/watchlist";
import { groupInvestmentsByTicker } from "../../utils/investmentUtils";
import { persistSetPreference } from "../../redux/slices/transactionSlice";
import Skeleton from "../../components/Skeleton";
import SymbolBias from "./SymbolBias";
import GrowSection from "./GrowSection";

const API = import.meta.env.VITE_API_URL ?? "";
const EASE = [0.25, 0.46, 0.45, 0.94];
const TF = "6M";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const LANE_RANK = { "1d": 0, "1wk": 1, btst: 2 };

// Confidence is NOT comparable across lanes — btst has no benchmark, so its
// score falls back to a win rate while 1d/1wk use measured edge over random.
// Rank by lane first, and only compare scores inside the same lane.
function better(a, b) {
  const ra = LANE_RANK[a.interval] ?? 9;
  const rb = LANE_RANK[b.interval] ?? 9;
  if (ra !== rb) return ra < rb;
  return (a.confidence ?? 0) > (b.confidence ?? 0);
}

function quoteOf(candles) {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 2].close;
  const chg = last - prev;
  return { last, chg, pct: prev ? (chg / prev) * 100 : 0, up: chg >= 0 };
}

function bracketOf(candles, last) {
  const { support, resistance } = srLevels(candles);
  const below = support.filter((g) => g.price <= last).sort((a, b) => b.price - a.price)[0];
  const above = resistance.filter((g) => g.price >= last).sort((a, b) => a.price - b.price)[0];
  if (!below && !above) return null;
  return {
    support: below?.price ?? null,
    resistance: above?.price ?? null,
    supportAway: below ? ((last - below.price) / last) * 100 : null,
    resistanceAway: above ? ((above.price - last) / last) * 100 : null,
  };
}

export default function GrowWatch() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const prefs = data.preferences;
  const watchlist = useMemo(() => readWatchlist(prefs), [prefs]);

  const holdings = useMemo(() => {
    const stocks = (data.investments ?? []).filter((i) => i.type === "stock" && i.ticker);
    return groupInvestmentsByTicker(stocks)
      .filter((g) => g.ticker)
      .map((g) => ({
        symbol: g.ticker,
        name: g.name || g.ticker.replace(".NS", ""),
        qty: parseFloat(g.quantity) || 0,
        buyPrice: parseFloat(g.buyPrice) || 0,
        storedPrice: parseFloat(g.currentPrice) || 0,
        lots: g._lots ?? 1,
      }))
      .filter((h) => h.qty > 0);
  }, [data.investments]);

  const symbols = useMemo(() => {
    const held = holdings.map((h) => h.symbol);
    return [...new Set([...held, ...watchlist])];
  }, [holdings, watchlist]);

  const [rows, setRows] = useState({});
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    if (!symbols.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows({});
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    (async () => {
      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const candles = await fetchCandles(symbol, TF);
            const quote = quoteOf(candles);
            return [
              symbol,
              { quote, bias: symbolBias(candles), bracket: quote ? bracketOf(candles, quote.last) : null },
            ];
          } catch {
            return [symbol, { quote: null, bias: null, bracket: null }];
          }
        }),
      );
      if (alive) {
        setRows(Object.fromEntries(entries));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [symbols]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!API) return;
        const token = await getAccessToken();
        if (!token) return;
        const all = [];
        for (const iv of ["1d", "1wk", "btst"]) {
          const res = await fetch(`${API}/grow/signals?limit=200&interval=${iv}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) continue;
          const d = await res.json();
          for (const s of d.signals ?? []) all.push(s);
        }
        if (alive) setSignals(all);
      } catch {
        if (alive) setError("Could not load today's signals");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const bySymbol = useMemo(() => {
    const m = new Map();
    for (const s of signals) {
      const cur = m.get(s.symbol);
      if (!cur || better(s, cur)) m.set(s.symbol, s);
    }
    return m;
  }, [signals]);

  const priced = useMemo(
    () =>
      holdings.map((h) => {
        const live = rows[h.symbol]?.quote?.last ?? h.storedPrice;
        const invested = h.qty * h.buyPrice;
        const value = h.qty * (live || 0);
        return { ...h, live, invested, value, pl: value - invested, plPct: invested ? ((value - invested) / invested) * 100 : 0 };
      }),
    [holdings, rows],
  );

  const totals = useMemo(() => {
    const invested = priced.reduce((a, h) => a + h.invested, 0);
    const value = priced.reduce((a, h) => a + h.value, 0);
    const dayPl = priced.reduce((a, h) => a + h.qty * (rows[h.symbol]?.quote?.chg ?? 0), 0);
    return { invested, value, pl: value - invested, plPct: invested ? ((value - invested) / invested) * 100 : 0, dayPl };
  }, [priced, rows]);

  const heldSet = useMemo(() => new Set(holdings.map((h) => h.symbol)), [holdings]);
  const watchOnly = useMemo(() => watchlist.filter((s) => !heldSet.has(s)), [watchlist, heldSet]);

  function open(symbol, sig, name) {
    const q = new URLSearchParams({ symbol, name: name || symbol.replace(".NS", "") });
    if (sig) {
      q.set("t", sig.bar_time);
      q.set("ty", sig.type);
      q.set("i", sig.interval);
    }
    navigate(`/Advisory/grow/charts?${q}`);
  }

  function row(symbol, holding) {
    const r = rows[symbol] ?? {};
    const sig = bySymbol.get(symbol);
    return (
      <div key={symbol} className={`grow-watch-row${holding ? " grow-watch-row--held" : " grow-watch-row--watch"}`}>
        <button type="button" className="grow-watch-main" onClick={() => open(symbol, sig, holding?.name)}>
          <div className="grow-watch-top">
            <span className="grow-watch-sym">
              {symbol.replace(".NS", "")}
              <em className={`grow-watch-tag grow-watch-tag--${holding ? "held" : "watch"}`}>
                <i className={`fa-${holding ? "solid fa-briefcase" : "regular fa-star"}`} />
                {holding ? "Held" : "Watching"}
              </em>
            </span>
            {r.quote ? (
              <span className={`grow-watch-quote ${r.quote.up ? "is-up" : "is-down"}`}>
                {INR.format(r.quote.last)}
                <em>
                  {r.quote.chg >= 0 ? "+" : ""}
                  {r.quote.pct.toFixed(2)}%
                </em>
              </span>
            ) : (
              <span className="grow-watch-quote grow-watch-quote--dead">price unavailable</span>
            )}
          </div>

          {holding && (
            <div className={`grow-pos ${holding.pl >= 0 ? "is-up" : "is-down"}`}>
              <span className="grow-pos-qty">
                {NUM.format(holding.qty)} {holding.qty === 1 ? "share" : "shares"}
                <em>avg {INR.format(holding.buyPrice)}</em>
                {holding.lots > 1 && <em>{holding.lots} lots</em>}
              </span>
              <span className="grow-pos-val">
                {INR0.format(holding.value)}
                <em>
                  {holding.pl >= 0 ? "+" : ""}
                  {INR0.format(holding.pl)} ({holding.pl >= 0 ? "+" : ""}
                  {holding.plPct.toFixed(1)}%)
                </em>
              </span>
            </div>
          )}

          <div className="grow-watch-mid">
            <SymbolBias bias={r.bias} compact />
            {sig ? (
              <span className={`grow-watch-sig grow-watch-sig--${sig.band}`}>
                <i className="fa-solid fa-bolt" /> {sig.name}
                <em>{sig.confidence}</em>
                <i className="grow-watch-sig-lane">{sig.trade_type}</i>
              </span>
            ) : (
              <span className="grow-watch-sig grow-watch-sig--none">no live signal</span>
            )}
          </div>

          {r.bracket && (
            <div className="grow-watch-sr">
              <span className="grow-watch-sr-k">S/R</span>
              {r.bracket.support != null ? (
                <span className="grow-watch-sr-lo">
                  {NUM.format(Math.round(r.bracket.support))}
                  <em>−{r.bracket.supportAway.toFixed(1)}%</em>
                </span>
              ) : (
                <span className="grow-watch-sr-lo grow-watch-sr-none">none below</span>
              )}
              <span className="grow-watch-sr-bar" aria-hidden="true" />
              {r.bracket.resistance != null ? (
                <span className="grow-watch-sr-hi">
                  {NUM.format(Math.round(r.bracket.resistance))}
                  <em>+{r.bracket.resistanceAway.toFixed(1)}%</em>
                </span>
              ) : (
                <span className="grow-watch-sr-hi grow-watch-sr-none">none above</span>
              )}
            </div>
          )}

          {sig?.earnings_in != null && (
            <div className="grow-watch-earnings">
              <i className="fa-solid fa-triangle-exclamation" /> results in {sig.earnings_in}
              {sig.earnings_in === 1 ? " day" : " days"}
            </div>
          )}
        </button>

        <button
          type="button"
          className={`grow-watch-star${watchlist.includes(symbol) ? " is-on" : ""}`}
          title={watchlist.includes(symbol) ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={watchlist.includes(symbol)}
          onClick={() => dispatch(persistSetPreference("growWatchlist", toggleWatch(prefs, symbol)))}
        >
          <i className={`fa-${watchlist.includes(symbol) ? "solid" : "regular"} fa-star`} />
        </button>
      </div>
    );
  }

  return (
    <motion.div
      className="grow-watch"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      {error && (
        <div className="grow-watch-note">
          <i className="fa-solid fa-triangle-exclamation" /> {error} — prices and bias still shown.
        </div>
      )}

      {loading && <Skeleton className="grow-watch-row" count={Math.min(symbols.length || 3, 6)} lines={3} />}

      {!loading && priced.length > 0 && (
        <GrowSection
          icon="fa-briefcase"
          title="Your stock holdings"
          subtitle="Stocks added on the Investments page, valued at today's close. Other asset types are not shown here — this page only covers what the signal engine can read."
        >
          <div className={`grow-pf ${totals.pl >= 0 ? "is-up" : "is-down"}`}>
            <div className="grow-pf-stat">
              <span className="grow-pf-val">{INR0.format(totals.value)}</span>
              <span className="grow-pf-lbl">current value</span>
            </div>
            <div className="grow-pf-stat">
              <span className="grow-pf-val grow-pf-pl">
                {totals.pl >= 0 ? "+" : ""}
                {INR0.format(totals.pl)}
              </span>
              <span className="grow-pf-lbl">
                overall {totals.pl >= 0 ? "+" : ""}
                {totals.plPct.toFixed(1)}%
              </span>
            </div>
            <div className="grow-pf-stat">
              <span className={`grow-pf-val ${totals.dayPl >= 0 ? "is-up" : "is-down"}`}>
                {totals.dayPl >= 0 ? "+" : ""}
                {INR0.format(totals.dayPl)}
              </span>
              <span className="grow-pf-lbl">today</span>
            </div>
            <div className="grow-pf-stat">
              <span className="grow-pf-val">{INR0.format(totals.invested)}</span>
              <span className="grow-pf-lbl">invested</span>
            </div>
          </div>
          {priced.map((h) => row(h.symbol, h))}
        </GrowSection>
      )}

      {!loading && watchOnly.length > 0 && (
        <GrowSection
          icon="fa-star"
          title="Watchlist"
          subtitle="Followed but not held. Tap the star on any signal or chart to add a symbol."
          aside={<span className="grow-sig-count">{watchOnly.length}</span>}
        >
          {watchOnly.map((s) => row(s, null))}
        </GrowSection>
      )}

      {!loading && symbols.length === 0 && (
        <div className="grow-watch-empty">
          <i className="fa-regular fa-star" />
          <p>
            Nothing here yet. Add a stock on the <strong>Investments</strong> page to see it valued with live signals, or
            tap the star on any signal to follow a symbol without holding it.
          </p>
          <button type="button" className="grow-watch-cta" onClick={() => navigate("/Advisory/grow/signals")}>
            <i className="fa-solid fa-magnifying-glass-chart" /> Browse signals
          </button>
        </div>
      )}

      {!loading && symbols.length > 0 && (
        <p className="grow-watch-foot">
          Holdings are valued at the latest close, which can differ from the Investments page if its stored prices are
          older. Bias and support/resistance are computed in your browser; signals come from the last nightly scan.
        </p>
      )}
    </motion.div>
  );
}
