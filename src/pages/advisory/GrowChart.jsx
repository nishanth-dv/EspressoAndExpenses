import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { createChart, CandlestickSeries, LineSeries } from "lightweight-charts";
import { fetchCandles, TIMEFRAMES } from "../../utils/grow/growData";
import { runSignals } from "../../utils/grow/signals";
import { pivots } from "../../utils/grow/signals/indicators";
import { scoreCard } from "../../utils/grow/signals/grade";
import { searchStockTickers } from "../../utils/priceService";
import { ConfidenceBadge, ConfidenceReveal } from "./ConfidenceControl";

const DEFAULT = { symbol: "RELIANCE.NS", name: "Reliance Industries" };

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartOptions() {
  const grid = cssVar("--surface-border", "rgba(128,128,128,0.12)");
  return {
    layout: {
      background: { color: "transparent" },
      textColor: cssVar("--text-secondary", "#888"),
      attributionLogo: false,
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid },
    timeScale: { borderColor: grid },
  };
}

function candleOptions() {
  const up = cssVar("--amount-income", "#16a34a");
  const down = cssVar("--amount-expense", "#ef4444");
  return { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false };
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function fit(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    sxx += p.x * p.x;
  }
  const d = n * sxx - sx * sx;
  if (!d) return null;
  const slope = (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}

function trendLine(candles) {
  if (candles.length < 14) return null;
  const closeFit = fit(candles.map((c, i) => ({ x: i, y: c.close })));
  if (!closeFit) return null;
  const up = closeFit.slope >= 0;
  const piv = pivots(candles, 5, 5);
  const swings = (up ? piv.lows : piv.highs).slice(-2);
  if (swings.length < 2) return null;
  const [a, b] = swings;
  const slope = (b.price - a.price) / (b.index - a.index);
  const intercept = a.price - slope * a.index;
  const points = [];
  for (let i = a.index; i < candles.length; i++) {
    points.push({ time: candles[i].time, value: intercept + slope * i });
  }
  return { up, points };
}

function outcomeChip(oc) {
  if (!oc || oc.status === "pending") return null;
  const cls = oc.status === "win" ? "win" : oc.status === "loss" ? "loss" : "flat";
  const icon = oc.status === "win" ? "fa-check" : oc.status === "loss" ? "fa-xmark" : "fa-minus";
  const sign = oc.returnPct >= 0 ? "+" : "";
  return (
    <span className={`grow-sig-oc grow-sig-oc--${cls}`}>
      <i className={`fa-solid ${icon}`} /> {sign}
      {(oc.returnPct * 100).toFixed(1)}%
    </span>
  );
}

export default function GrowChart() {
  const [params] = useSearchParams();
  const [symbol, setSymbol] = useState(() => {
    const s = params.get("symbol");
    return s ? { symbol: s, name: params.get("name") || s.replace(/\.(NS|BO)$/i, "") } : DEFAULT;
  });
  const [tf, setTf] = useState("6M");
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(currentTheme);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const holderRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const trendRef = useRef(null);
  const priceLineRef = useRef(null);

  const signals = useMemo(() => {
    if (candles.length < 3) return [];
    const interval = TIMEFRAMES.find((t) => t.key === tf)?.interval ?? "1d";
    return runSignals(candles, { symbol: symbol.symbol, timeframe: tf, interval }).signals;
  }, [candles, symbol, tf]);

  const card = useMemo(() => scoreCard(signals, candles), [signals, candles]);
  const outcomeById = useMemo(() => {
    const m = new Map();
    card.graded.forEach((g) => m.set(g.signal.id, g.outcome));
    return m;
  }, [card]);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    fetchCandles(symbol.symbol, tf)
      .then((c) => alive && setCandles(c))
      .catch((e) => {
        if (!alive) return;
        setCandles([]);
        setError(e.message || "Could not load chart");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, tf]);

  useEffect(() => {
    if (!holderRef.current) return undefined;
    const chart = createChart(holderRef.current, {
      autoSize: true,
      crosshair: { mode: 0 },
      ...chartOptions(),
    });
    const series = chart.addSeries(CandlestickSeries, candleOptions());
    const trend = chart.addSeries(LineSeries, {
      color: cssVar("--amount-income", "#16a34a"),
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    trendRef.current = trend;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      trendRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    seriesRef.current.setData(candles);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const intraday = TIMEFRAMES.find((t) => t.key === tf)?.intraday ?? false;
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
  }, [tf]);

  useEffect(() => {
    chartRef.current?.applyOptions(chartOptions());
    seriesRef.current?.applyOptions(candleOptions());
  }, [theme]);

  useEffect(() => {
    const t = trendRef.current;
    if (!t) return;
    const tl = trendLine(candles);
    if (!tl) {
      t.setData([]);
      return;
    }
    t.applyOptions({ color: tl.up ? cssVar("--amount-income", "#16a34a") : cssVar("--amount-expense", "#ef4444") });
    t.setData(tl.points);
  }, [candles, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const active = signals.find((s) => s.id === activeId);
    if (active) chart.setCrosshairPosition(active.price, active.time, series);
    else chart.clearCrosshairPosition();
  }, [activeId, signals]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (priceLineRef.current) {
      series.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    const active = signals.find((s) => s.id === activeId);
    const level = active?.meta?.neckline ?? active?.meta?.level;
    if (level == null) return;
    priceLineRef.current = series.createPriceLine({
      price: level,
      color: active.direction === "bearish" ? cssVar("--amount-expense", "#ef4444") : cssVar("--amount-income", "#16a34a"),
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: active.name,
    });
  }, [activeId, signals, theme]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      searchStockTickers(q, true)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  const stat = useMemo(() => {
    if (candles.length < 2) return null;
    const last = candles[candles.length - 1].close;
    const first = candles[0].close;
    const chg = last - first;
    const pct = first ? (chg / first) * 100 : 0;
    return { last, chg, pct, up: chg >= 0 };
  }, [candles]);

  function pick(r) {
    setSymbol({ symbol: r.symbol, name: r.name });
    setQuery("");
    setResults([]);
    setOpen(false);
    setOpenId(null);
    setActiveId(null);
  }

  function focus(s) {
    const idx = candles.findIndex((c) => c.time === s.time);
    if (idx < 0 || !chartRef.current) return;
    chartRef.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, idx - 25), to: idx + 8 });
  }

  function select(s) {
    setActiveId(s.id);
    focus(s);
  }

  function hover(s) {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (chart && series) chart.setCrosshairPosition(s.price, s.time, series);
  }

  function unhover() {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const active = signals.find((s) => s.id === activeId);
    if (active) chart.setCrosshairPosition(active.price, active.time, series);
    else chart.clearCrosshairPosition();
  }

  return (
    <div className="grow-chart">
      <div className="grow-chart-search">
        <i className="fa-solid fa-magnifying-glass" />
        <input
          type="text"
          value={query}
          placeholder="Search NSE stock…"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && results.length > 0 && (
          <ul className="grow-chart-results">
            {results.map((r) => (
              <li key={r.symbol} onMouseDown={() => pick(r)}>
                <span className="grow-chart-res-sym">
                  {r.symbol.replace(/\.(NS|BO)$/i, "")}
                </span>
                <span className="grow-chart-res-name">{r.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grow-chart-title">
        <div>
          <span className="grow-chart-name">{symbol.name}</span>
          <span className="grow-chart-sym">{symbol.symbol}</span>
        </div>
        {stat && (
          <div className={`grow-chart-quote ${stat.up ? "is-up" : "is-down"}`}>
            <span className="grow-chart-price">{INR.format(stat.last)}</span>
            <span className="grow-chart-chg">
              <i className={`fa-solid fa-caret-${stat.up ? "up" : "down"}`} />
              {stat.chg >= 0 ? "+" : ""}
              {stat.chg.toFixed(2)} ({stat.pct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      <div className="grow-chart-tfs">
        {TIMEFRAMES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`grow-chart-tf${tf === t.key ? " is-active" : ""}`}
            onClick={() => setTf(t.key)}
          >
            {tf === t.key && (
              <motion.span
                layoutId="growTfPill"
                className="grow-chart-tf-pill"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="grow-chart-canvas">
        <div ref={holderRef} className="grow-chart-lw" />
        {loading && (
          <div className="grow-chart-overlay">
            <i className="fa-solid fa-spinner fa-spin" /> Loading…
          </div>
        )}
        {!loading && error && (
          <div className="grow-chart-overlay grow-chart-overlay--err">
            <i className="fa-solid fa-triangle-exclamation" /> {error}
          </div>
        )}
      </div>

      {signals.length > 0 && (
        <div className="grow-legend-key">
          <span className="grow-legend-dir grow-legend-dir--bull">
            <i className="fa-solid fa-arrow-trend-up" /> Uptrend
          </span>
          <span className="grow-legend-dir grow-legend-dir--bear">
            <i className="fa-solid fa-arrow-trend-down" /> Downtrend
          </span>
          <span className="grow-legend-hint">Trend line follows the slope · tap a signal to draw its level</span>
        </div>
      )}

      {card.overall.resolved > 0 && (
        <div className="grow-score">
          <div className="grow-score-head">
            <i className="fa-solid fa-clipboard-check" /> Track record
            <span className="grow-score-sub">this symbol’s history · backtest, not advice</span>
          </div>
          <div className="grow-score-hero">
            <div className="grow-score-stat">
              <span className="grow-score-val">{Math.round(card.overall.hitRate * 100)}%</span>
              <span className="grow-score-lbl">hit rate</span>
            </div>
            <div className="grow-score-stat">
              <span className={`grow-score-val ${card.overall.avgReturn >= 0 ? "is-up" : "is-down"}`}>
                {card.overall.avgReturn >= 0 ? "+" : ""}
                {(card.overall.avgReturn * 100).toFixed(1)}%
              </span>
              <span className="grow-score-lbl">avg return</span>
            </div>
            <div className="grow-score-stat">
              <span className="grow-score-val">{card.overall.resolved}</span>
              <span className="grow-score-lbl">graded</span>
            </div>
          </div>

          <div className="grow-score-sec">Does confidence predict wins?</div>
          <div className="grow-cal">
            {card.byBand
              .filter((b) => b.resolved > 0)
              .map((b) => (
                <div key={b.band} className="grow-cal-row">
                  <span className={`grow-cal-band grow-cal-band--${b.band}`}>{b.band}</span>
                  <div className="grow-cal-track">
                    <div className="grow-cal-fill" style={{ width: `${Math.round(b.hitRate * 100)}%` }} />
                  </div>
                  <span className="grow-cal-pct">
                    {Math.round(b.hitRate * 100)}%<span className="grow-cal-n"> ({b.resolved})</span>
                  </span>
                </div>
              ))}
          </div>

          {card.byType.length > 0 && (
            <>
              <div className="grow-score-sec">By pattern</div>
              <ul className="grow-score-types">
                {card.byType.slice(0, 6).map((t) => (
                  <li key={t.type} className="grow-score-type">
                    <span className="grow-score-type-name">{t.name}</span>
                    <span className="grow-score-type-stat">
                      {Math.round(t.hitRate * 100)}% ·{" "}
                      <span className={t.avgReturn >= 0 ? "is-up" : "is-down"}>
                        {t.avgReturn >= 0 ? "+" : ""}
                        {(t.avgReturn * 100).toFixed(1)}%
                      </span>{" "}
                      · {t.resolved}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="grow-score-note">
            Each past signal walked forward vs later candles (4% target / 3% stop, 10-bar horizon). One
            symbol’s backtest — not advice.
          </p>
        </div>
      )}

      {signals.length > 0 && (
        <div className="grow-sig">
          <div className="grow-sig-head">
            <i className="fa-solid fa-wand-magic-sparkles" /> Signals
            <span className="grow-sig-count">{signals.length}</span>
          </div>
          <ul className="grow-sig-list">
            {signals.map((s) => (
              <li
                key={s.id}
                className={`grow-sig-card grow-sig-card--${s.direction}${activeId === s.id ? " grow-sig-card--active" : ""}`}
                onMouseEnter={() => hover(s)}
                onMouseLeave={unhover}
              >
                <div className="grow-sig-row">
                  <button type="button" className="grow-sig-main" onClick={() => select(s)}>
                    <span className={`grow-sig-dir grow-sig-dir--${s.direction}`}>
                      <i className={`fa-solid fa-arrow-trend-${s.direction === "bullish" ? "up" : "down"}`} />
                    </span>
                    <span className="grow-sig-text">
                      <span className="grow-sig-title">{s.title}</span>
                      <span className="grow-sig-meta">
                        {s.name} · {new Date(s.time * 1000).toLocaleDateString("en-IN")}
                        {s.factors.confluence > 0 ? ` · +${s.factors.confluence} confirming` : ""}
                      </span>
                    </span>
                  </button>
                  {outcomeChip(outcomeById.get(s.id))}
                  <ConfidenceBadge
                    score={s.confidence}
                    open={openId === s.id}
                    onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                  />
                </div>
                <ConfidenceReveal open={openId === s.id} card={s} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
