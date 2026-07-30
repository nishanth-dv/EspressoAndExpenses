import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { motion } from "framer-motion";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers } from "lightweight-charts";
import { fetchCandles, TIMEFRAMES, DEFAULT_TF, INTERVAL_TF } from "../../utils/grow/growData";
import { runSignals } from "../../utils/grow/signals";
import { CATEGORY_META } from "../../utils/grow/signals/contract";
import { INDICATORS } from "../../utils/grow/chartIndicators";
import { scoreCard } from "../../utils/grow/signals/grade";
import { searchStockTickers } from "../../utils/priceService";
import { persistSetPreference } from "../../redux/slices/transactionSlice";
import { isWatched, toggleWatch } from "../../utils/grow/watchlist";
import { ConfidenceBadge, ConfidenceReveal } from "./ConfidenceControl";
import Modal from "../../preStyledElements/modal/Modal";
import TradePlan from "./TradePlan";
import SignalHistory from "./SignalHistory";
import SymbolBias from "./SymbolBias";
import GrowSection from "./GrowSection";
import TrackStats from "./TrackStats";
import { symbolBias } from "../../utils/grow/signals/bias";

const DEFAULT = { symbol: "RELIANCE.NS", name: "Reliance Industries" };
const LS_LAST = "grow-chart-last";

function readLast() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LAST));
    return v?.symbol ? v : null;
  } catch {
    return null;
  }
}

const PATTERN_COLOR = "#f59e0b";
const CANDLE_BARS = {
  hammer: 1,
  shooting_star: 1,
  bullish_engulfing: 2,
  bearish_engulfing: 2,
  morning_star: 3,
  evening_star: 3,
};

const TF_GROUPS = [
  { key: "interval", label: "Bar size", hint: "how much time one candle covers" },
  { key: "range", label: "Period", hint: "how far back the chart looks" },
];

const IND_GROUPS = [
  { key: "price", label: "Drawn on the price chart", hint: "lines and bands over the candles" },
  { key: "separate", label: "Drawn in their own panel", hint: "different scale, so they sit below" },
];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const IST = "Asia/Kolkata";
const istFmt = (opts) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...opts });
const FMT_YEAR = istFmt({ year: "numeric" });
const FMT_MONTH = istFmt({ month: "short", year: "2-digit" });
const FMT_DAY = istFmt({ day: "numeric", month: "short" });
const FMT_TIME = istFmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const FMT_STAMP = istFmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const FMT_FULLDAY = istFmt({ day: "numeric", month: "short", year: "numeric" });

function tickMark(time, type) {
  const d = new Date(time * 1000);
  if (type <= 0) return FMT_YEAR.format(d);
  if (type === 1) return FMT_MONTH.format(d);
  if (type === 2) return FMT_DAY.format(d);
  return FMT_TIME.format(d);
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
    timeScale: { borderColor: grid, tickMarkFormatter: tickMark },
    localization: { locale: "en-IN" },
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
  const dispatch = useDispatch();
  const prefs = useSelector((s) => s.transactions.transactionData?.preferences);
  const [symbol, setSymbol] = useState(() => {
    const s = params.get("symbol");
    if (s) return { symbol: s, name: params.get("name") || s.replace(/\.(NS|BO)$/i, "") };
    const last = readLast();
    return last ? { symbol: last.symbol, name: last.name || last.symbol } : DEFAULT;
  });
  const [tf, setTf] = useState(() => INTERVAL_TF[params.get("i")] || DEFAULT_TF);
  const [picked, setPicked] = useState(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(currentTheme);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(false);
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [ind, setInd] = useState({ ma: false, boll: false, rsi: false });
  const [editorOpen, setEditorOpen] = useState(false);

  const holderRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const patternRef = useRef(null);
  const markersRef = useRef(null);
  const priceLineRef = useRef(null);
  const indRef = useRef([]);
  const deepDone = useRef(false);
  const chartWrapRef = useRef(null);

  const viewFrom = useMemo(() => {
    const bars = TIMEFRAMES.find((t) => t.key === tf)?.viewBars ?? 0;
    if (!bars || candles.length <= bars) return 0;
    return candles.length - bars;
  }, [candles, tf]);

  const signals = useMemo(() => {
    if (candles.length < 3) return [];
    const interval = TIMEFRAMES.find((t) => t.key === tf)?.interval ?? "1d";
    const all = runSignals(candles, { symbol: symbol.symbol, timeframe: tf, interval, includeSuppressed: true }).signals;
    if (!viewFrom) return all;
    const cut = candles[viewFrom].time;
    return all.filter((s) => s.time >= cut);
  }, [candles, symbol, tf, viewFrom]);

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
    setPicked(null);
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
    try {
      localStorage.setItem(LS_LAST, JSON.stringify(symbol));
    } catch {
      /* empty */
    }
  }, [symbol]);

  useEffect(() => {
    if (!holderRef.current) return undefined;
    const chart = createChart(holderRef.current, {
      autoSize: true,
      crosshair: { mode: 0 },
      ...chartOptions(),
    });
    const series = chart.addSeries(CandlestickSeries, candleOptions());
    const pattern = chart.addSeries(LineSeries, {
      color: PATTERN_COLOR,
      lineWidth: 3,
      pointMarkersVisible: true,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    patternRef.current = pattern;
    markersRef.current = createSeriesMarkers(series, []);
    chart.subscribeClick((p) => setPicked(typeof p.time === "number" ? p.time : null));
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      patternRef.current = null;
      markersRef.current = null;
      indRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    seriesRef.current.setData(candles);
    const ts = chartRef.current?.timeScale();
    if (viewFrom) ts?.setVisibleLogicalRange({ from: viewFrom, to: candles.length - 1 });
    else ts?.fitContent();
  }, [candles, viewFrom]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candles.length) return;
    indRef.current.forEach((s) => {
      try {
        chart.removeSeries(s);
      } catch {
        s;
      }
    });
    indRef.current = [];
    let nextPane = 1;
    for (const def of INDICATORS) {
      if (!ind[def.key]) continue;
      const pane = def.pane === "price" ? 0 : nextPane++;
      def.build(candles).forEach((l, i) => {
        const isHist = l.type === "histogram";
        const s = chart.addSeries(
          isHist ? HistogramSeries : LineSeries,
          isHist
            ? { color: l.color ?? "#94a3b8", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }
            : {
                color: l.color,
                lineWidth: l.width ?? 2,
                lineStyle: l.style ?? 0,
                lastValueVisible: l.axisLabel ?? false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
              },
          pane,
        );
        if (i === 0)
          (def.priceLines ?? []).forEach((p) =>
            s.createPriceLine({
              price: p,
              color: cssVar("--surface-border-open", "#888"),
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
            }),
          );
        s.setData(l.data);
        indRef.current.push(s);
      });
    }
  }, [candles, ind]);

  useEffect(() => {
    const intraday = TIMEFRAMES.find((t) => t.key === tf)?.intraday ?? false;
    chartRef.current?.applyOptions({
      timeScale: { timeVisible: intraday, secondsVisible: false },
      localization: {
        timeFormatter: (t) => (intraday ? FMT_STAMP : FMT_FULLDAY).format(new Date(t * 1000)),
      },
    });
  }, [tf]);

  useEffect(() => {
    chartRef.current?.applyOptions(chartOptions());
    seriesRef.current?.applyOptions(candleOptions());
  }, [theme]);

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
    const p = patternRef.current;
    if (!p) return undefined;
    const active = signals.find((s) => s.id === activeId);
    const shape = active?.meta?.shape;
    if (!shape || shape.length < 2) {
      p.setData([]);
      return undefined;
    }
    const pts = [];
    for (const q of shape) {
      if (!pts.length || q.time > pts[pts.length - 1].time) pts.push({ time: q.time, value: q.value });
    }
    if (pts.length < 2) {
      p.setData(pts);
      return undefined;
    }
    p.applyOptions({ color: PATTERN_COLOR });
    p.setData([]);
    const segs = pts.length - 1;
    const DUR = 600;
    let raf = 0;
    let start = 0;
    const draw = (now) => {
      if (!start) start = now;
      const prog = Math.min(1, (now - start) / DUR);
      const pos = prog * segs;
      const full = Math.floor(pos);
      const data = pts.slice(0, full + 1);
      if (full < segs) {
        const a = pts[full];
        const b = pts[full + 1];
        const frac = pos - full;
        const time = Math.round(a.time + (b.time - a.time) * frac);
        const value = a.value + (b.value - a.value) * frac;
        if (time > data[data.length - 1].time) data.push({ time, value });
      }
      p.setData(data);
      if (prog < 1) raf = requestAnimationFrame(draw);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(draw);
    }, 450);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [activeId, signals, theme]);

  useEffect(() => {
    const m = markersRef.current;
    if (!m) return undefined;
    m.setMarkers([]);
    const active = signals.find((s) => s.id === activeId);
    if (!active || active.category === "chart") return undefined;
    const idx = candles.findIndex((c) => c.time === active.time);
    if (idx < 0) return undefined;
    const n = CANDLE_BARS[active.type] ?? 1;
    const bull = active.direction === "bullish";
    const marks = [];
    for (let i = Math.max(0, idx - n + 1); i <= idx; i++) {
      marks.push({ time: candles[i].time, position: bull ? "belowBar" : "aboveBar", shape: "circle", color: PATTERN_COLOR });
    }
    const timer = setTimeout(() => m.setMarkers(marks), 450);
    return () => clearTimeout(timer);
  }, [activeId, signals, candles, theme]);

  useEffect(() => {
    if (deepDone.current || !signals.length) return;
    const t = Number(params.get("t"));
    const ty = params.get("ty");
    if (!t || !ty) return;
    const match = signals.find((s) => s.time === t && s.type === ty);
    if (!match) return;
    deepDone.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(match.id);
    focus(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, params]);

  useEffect(() => {
    if (!activeId) return undefined;
    const id = setTimeout(() => {
      chartWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(id);
  }, [activeId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setSearching(false);
      setSearchErr(false);
      return undefined;
    }
    let alive = true;
    setSearching(true);
    setSearchErr(false);
    const id = setTimeout(() => {
      searchStockTickers(q, true)
        .then((r) => {
          if (!alive) return;
          setResults(r);
          setSearching(false);
        })
        .catch(() => {
          if (!alive) return;
          setResults([]);
          setSearchErr(true);
          setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  const spanLabel = useMemo(() => {
    if (!candles.length) return "";
    const intraday = TIMEFRAMES.find((t) => t.key === tf)?.intraday ?? false;
    if (picked != null) {
      const d = new Date(picked * 1000);
      return intraday ? `${FMT_FULLDAY.format(d)}, ${FMT_TIME.format(d)}` : FMT_FULLDAY.format(d);
    }
    const a = new Date(candles[viewFrom].time * 1000);
    const b = new Date(candles[candles.length - 1].time * 1000);
    const end = FMT_FULLDAY.format(b);
    const sameDay = FMT_FULLDAY.format(a) === end;
    if (!intraday) return sameDay ? end : `${FMT_DAY.format(a)} – ${end}`;
    if (sameDay) return `${end}, ${FMT_TIME.format(a)}–${FMT_TIME.format(b)}`;
    return `${FMT_DAY.format(a)}, ${FMT_TIME.format(a)} – ${end}, ${FMT_TIME.format(b)}`;
  }, [candles, tf, picked, viewFrom]);

  const stat = useMemo(() => {
    if (candles.length < 2) return null;
    const last = candles[candles.length - 1].close;
    const first = candles[0].close;
    const chg = last - first;
    const pct = first ? (chg / first) * 100 : 0;
    return { last, chg, pct, up: chg >= 0 };
  }, [candles]);

  const bias = useMemo(() => symbolBias(candles), [candles]);

  const activeIndCount = Object.values(ind).filter(Boolean).length;

  function pick(r) {
    setSymbol({ symbol: r.symbol, name: r.name });
    setQuery("");
    setResults([]);
    setOpen(false);
    setOpenId(null);
    setActiveId(null);
  }

  function focus(s) {
    const chart = chartRef.current;
    if (!chart) return;
    const toIdx = candles.findIndex((c) => c.time === s.time);
    if (toIdx < 0) return;
    const fromT = s.fromTime ?? s.time;
    let fromIdx = candles.findIndex((c) => c.time === fromT);
    if (fromIdx < 0) fromIdx = toIdx;
    const pad = Math.max(8, Math.round((toIdx - fromIdx) * 0.4));
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, fromIdx - pad), to: toIdx + pad });
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
        {open && query.trim().length >= 2 && (
          <ul className="grow-chart-results">
            {searching ? (
              <li className="grow-chart-res-state">
                <i className="fa-solid fa-spinner fa-spin" /> Searching…
              </li>
            ) : results.length > 0 ? (
              results.map((r) => (
                <li key={r.symbol} onMouseDown={() => pick(r)}>
                  <span className="grow-chart-res-sym">
                    {r.symbol.replace(/\.(NS|BO)$/i, "")}
                  </span>
                  <span className="grow-chart-res-name">{r.name}</span>
                </li>
              ))
            ) : (
              <li
                className="grow-chart-res-state grow-chart-res-fallback"
                onMouseDown={() =>
                  pick({ symbol: query.trim().toUpperCase(), name: query.trim().toUpperCase() })
                }
              >
                {searchErr ? "Search unavailable." : "No matches."} Tap to load{" "}
                <b>{query.trim().toUpperCase()}</b> directly (add <b>.NS</b> for NSE).
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="grow-chart-title">
        <div className="grow-chart-titlehead">
          <button
            type="button"
            className={`grow-watch-star${isWatched(prefs, symbol.symbol) ? " is-on" : ""}`}
            title={isWatched(prefs, symbol.symbol) ? "Remove from watchlist" : "Add to watchlist"}
            aria-pressed={isWatched(prefs, symbol.symbol)}
            onClick={() => dispatch(persistSetPreference("growWatchlist", toggleWatch(prefs, symbol.symbol)))}
          >
            <i className={`fa-${isWatched(prefs, symbol.symbol) ? "solid" : "regular"} fa-star`} />
          </button>
          <div>
            <span className="grow-chart-name">{symbol.name}</span>
            <span className="grow-chart-sym">{symbol.symbol}</span>
          </div>
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

      {bias && (
        <GrowSection
          icon="fa-scale-balanced"
          title="Which way is it leaning?"
          subtitle="Four readings of how this stock has behaved lately. They describe the backdrop only — testing showed they do not improve a signal's odds."
        >
          <SymbolBias bias={bias} />
        </GrowSection>
      )}

      <GrowSection
        icon="fa-chart-column"
        title="Price chart"
        subtitle="Each candle is one bar: the body runs from open to close, the thin wicks mark the high and low. Green closed up, red closed down."
        aside={
          <button type="button" className="grow-ind-editor-btn" onClick={() => setEditorOpen(true)}>
            <i className="fa-solid fa-sliders" /> Indicators
            {activeIndCount > 0 && <span className="grow-ind-editor-count">{activeIndCount}</span>}
          </button>
        }
      >
        <div className="grow-chart-tfs">
          {TF_GROUPS.map((g) => (
            <div key={g.key} className="grow-tfg">
              <span className="grow-tfg-label">{g.label}</span>
              <span className="grow-tfg-hint">{g.hint}</span>
              <div className="grow-tfg-row">
                {TIMEFRAMES.filter((t) => t.group === g.key).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`grow-chart-tf${tf === t.key ? " is-active" : ""}`}
                    title={
                      t.group !== "range"
                        ? `${t.interval} bars`
                        : t.viewBars
                          ? `${t.label} of ${t.interval} bars · ${t.range} loaded for indicators`
                          : `${t.range} of ${t.interval} bars`
                    }
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
            </div>
          ))}
        </div>

        {spanLabel && (
          <span className={`grow-chart-span${picked != null ? " is-picked" : ""}`}>
            <i className="fa-regular fa-calendar" /> {spanLabel}
            {picked != null && <em>tap the chart again to clear</em>}
          </span>
        )}

        <div className="grow-chart-canvas" ref={chartWrapRef}>
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
      </GrowSection>

      {card.overall.resolved > 0 && (
        <GrowSection
          className="grow-score"
          icon="fa-clipboard-check"
          title="How these patterns did on this symbol"
          subtitle="Every pattern above, replayed against the candles that came after it. One stock’s history — a backtest, not advice."
        >
          <TrackStats
            hitRate={card.overall.hitRate}
            avgReturn={card.overall.avgReturn}
            resolved={card.overall.resolved}
          />

          <div className="grow-score-sec">
            Does a higher confidence score actually win more often?
            <em>If the bars fall from high to low, the score is telling you something.</em>
          </div>
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
              <div className="grow-score-sec">
                By pattern
                <em>hit rate · average result · how many were scored</em>
              </div>
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
            Each signal is scored by replaying the candles after it: it wins if price reached a target
            <strong> 2× the stock’s typical daily move</strong> before falling <strong>1.5×</strong> against
            you, within 10 bars. Ties inside a single bar count as a loss, and trading costs are
            deducted. One symbol’s backtest — not advice.
          </p>
        </GrowSection>
      )}

      {signals.length > 0 && (
        <GrowSection
          className="grow-sig"
          icon="fa-wand-magic-sparkles"
          title="Patterns found on this chart"
          subtitle="Tap one to draw it on the chart above. Every pattern is shown here, including ones the scanner filters out — this view is for exploring."
          aside={<span className="grow-sig-count">{signals.length}</span>}
        >
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
                      <span className="grow-sig-title">
                        <span className={`grow-cat grow-cat--${s.category}`}>
                          <i className={`fa-solid ${CATEGORY_META[s.category]?.icon ?? ""}`} />{" "}
                          {CATEGORY_META[s.category]?.label ?? s.category}
                        </span>
                        {s.title}
                      </span>
                      <span className="grow-sig-meta">
                        {new Date(s.time * 1000).toLocaleDateString("en-IN")}
                        {s.factors.confluence > 0 ? ` · +${s.factors.confluence} confirming` : ""}
                      </span>
                    </span>
                  </button>
                  {outcomeChip(outcomeById.get(s.id))}
                  <ConfidenceBadge
                    score={s.confidence}
                    band={s.confidenceBreakdown?.band}
                    open={openId === s.id}
                    onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                  />
                </div>
                <TradePlan
                  plan={s.plan}
                  tradeType={s.tradeType}
                  interval={TIMEFRAMES.find((t) => t.key === tf)?.interval ?? "1d"}
                  direction={s.direction}
                />
                <SignalHistory history={s.history} name={s.name} />
                <ConfidenceReveal open={openId === s.id} card={s} />
              </li>
            ))}
          </ul>
        </GrowSection>
      )}

      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title="Chart editor">
        <div className="grow-editor">
          {IND_GROUPS.map((g) => (
            <div className="grow-editor-sec" key={g.key}>
              <div className="grow-editor-sec-head">
                {g.label}
                <em>{g.hint}</em>
              </div>
              <div className="grow-editor-list">
                {INDICATORS.filter((d) => d.pane === g.key).map((def) => (
                  <button
                    key={def.key}
                    type="button"
                    className={`grow-ind-row${ind[def.key] ? " is-on" : ""}`}
                    aria-pressed={!!ind[def.key]}
                    onClick={() => setInd((p) => ({ ...p, [def.key]: !p[def.key] }))}
                  >
                    <span className="grow-ind-check">
                      <i className={`fa-solid ${ind[def.key] ? "fa-check" : "fa-plus"}`} />
                    </span>
                    <span className="grow-ind-text">
                      <span className="grow-ind-name">{def.label}</span>
                      <span className="grow-ind-blurb">{def.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {/* NOTE: this modal is the single home for ALL chart editors. Every
              future picker — pattern filters, drawing tools, extra overlays —
              mounts as a new <section> here, each reading from its own registry
              (indicators live in INDICATORS in utils/grow/chartIndicators.js).
              Do not scatter chart controls back onto the toolbar. */}
        </div>
      </Modal>
    </div>
  );
}
