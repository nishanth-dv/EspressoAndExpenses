import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { motion } from "framer-motion";
import { getAccessToken } from "../../utils/googleDrive";
import { fetchCandles } from "../../utils/grow/growData";
import { symbolBias } from "../../utils/grow/signals/bias";
import { srLevels } from "../../utils/grow/chartIndicators";
import { readWatchlist, toggleWatch } from "../../utils/grow/watchlist";
import { persistSetPreference } from "../../redux/slices/transactionSlice";
import Skeleton from "../../components/Skeleton";
import SymbolBias from "./SymbolBias";

const API = import.meta.env.VITE_API_URL ?? "";
const EASE = [0.25, 0.46, 0.45, 0.94];
const TF = "6M";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

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
  const prefs = useSelector((s) => s.transactions.transactionData?.preferences);
  const watchlist = useMemo(() => readWatchlist(prefs), [prefs]);

  const [rows, setRows] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    if (!watchlist.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError("");
    (async () => {
      const out = await Promise.all(
        watchlist.map(async (symbol) => {
          try {
            const candles = await fetchCandles(symbol, TF);
            const quote = quoteOf(candles);
            return {
              symbol,
              quote,
              bias: symbolBias(candles),
              bracket: quote ? bracketOf(candles, quote.last) : null,
            };
          } catch {
            return { symbol, quote: null, bias: null, bracket: null, failed: true };
          }
        }),
      );
      if (alive) {
        setRows(out);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [watchlist]);

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
          const data = await res.json();
          for (const s of data.signals ?? []) all.push(s);
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
      if (!cur || (s.confidence ?? 0) > (cur.confidence ?? 0)) m.set(s.symbol, s);
    }
    return m;
  }, [signals]);

  function open(symbol, sig) {
    const q = new URLSearchParams({ symbol, name: symbol.replace(".NS", "") });
    if (sig) {
      q.set("t", sig.bar_time);
      q.set("ty", sig.type);
      q.set("i", sig.interval);
    }
    navigate(`/Advisory/grow/charts?${q}`);
  }

  const withSignal = rows.filter((r) => bySymbol.has(r.symbol)).length;

  return (
    <motion.div
      className="grow-watch"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <div className="grow-watch-head">
        <span>
          <i className="fa-solid fa-star" /> Watchlist
        </span>
        {watchlist.length > 0 && (
          <span className="grow-watch-count">
            {watchlist.length} symbol{watchlist.length > 1 ? "s" : ""}
            {withSignal > 0 && ` · ${withSignal} with a live signal`}
          </span>
        )}
      </div>

      {error && (
        <div className="grow-watch-note">
          <i className="fa-solid fa-triangle-exclamation" /> {error} — prices and bias still shown.
        </div>
      )}

      {loading && <Skeleton className="grow-watch-row" count={Math.min(watchlist.length || 3, 6)} lines={3} />}

      {!loading && watchlist.length === 0 && (
        <div className="grow-watch-empty">
          <i className="fa-regular fa-star" />
          <p>
            Nothing on your watchlist yet. Tap the star on any signal or chart to follow a symbol, and it will appear
            here with its bias, live signals and nearest support/resistance.
          </p>
          <button type="button" className="grow-watch-cta" onClick={() => navigate("/Advisory/grow/signals")}>
            <i className="fa-solid fa-magnifying-glass-chart" /> Browse signals
          </button>
        </div>
      )}

      {!loading &&
        rows.map((r) => {
          const sig = bySymbol.get(r.symbol);
          return (
            <div key={r.symbol} className="grow-watch-row">
              <button type="button" className="grow-watch-main" onClick={() => open(r.symbol, sig)}>
                <div className="grow-watch-top">
                  <span className="grow-watch-sym">{r.symbol.replace(".NS", "")}</span>
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
                className="grow-watch-star is-on"
                title="Remove from watchlist"
                aria-label={`Remove ${r.symbol} from watchlist`}
                onClick={() => dispatch(persistSetPreference("growWatchlist", toggleWatch(prefs, r.symbol)))}
              >
                <i className="fa-solid fa-star" />
              </button>
            </div>
          );
        })}

      {!loading && rows.length > 0 && (
        <p className="grow-watch-foot">
          Bias and support/resistance are computed from daily bars in your browser. Live signals come from the last
          nightly scan — only detectors that beat a random entry on the same stock are shown.
        </p>
      )}
    </motion.div>
  );
}
