# Grow — trading signals, breadth scanner & accuracy program

The "Grow your money" domain of the Advisory page. A rule-based technical-analysis
engine that detects chart patterns, scores them by an estimated win-probability,
grades every signal against real forward history, and scans the whole liquid NSE
market for fresh **buy calls**. Everything below has been walk-forward validated —
the system is built to refuse to fool itself.

---

## TL;DR — the current, validated configuration

The production scan (`pybrain/batch.py`, nightly) runs **long-only** on a
**turnover-ranked ~300-name bhavcopy universe**, with negative-expectancy patterns
**gated**, **ATR-sized** targets/stops, **worst-case** intrabar fills, and costs
subtracted. This exact config was chosen because it is what survived **out-of-sample
walk-forward** testing:

| Configuration (OOS, 294 names, train 70% / test 30%) | Trades | Hit | Expectancy | Payoff |
|---|---|---|---|---|
| Baseline (long + short) | 15,016 | 34.6% | +0.7% | 1.29 |
| Trend-filtered | 7,539 | 36.3% | +0.8% | 1.34 |
| **Long-only (production)** | **9,397** | **39.7%** | **+1.2%** | **1.37** |

Long-only nearly doubles out-of-sample expectancy over the baseline **and** made the
whole stack coherent: confidence became monotonic OOS (moderate +1.4% > low +1.2%)
and the per-pattern train→OOS expectancy correlation jumped from +0.03 to **+0.57**.

---

## Surfaces (frontend)

- **Charts** (`src/pages/advisory/GrowChart.jsx`) — `lightweight-charts` candles for any
  NSE symbol. Timeframes from **1m → 5Y** (intraday `1m/5m/15m/1h` + `1D/1W/1M/6M/1Y/5Y`),
  a horizontal-scroll strip on mobile. A **Chart editor** modal toggles indicators from a
  registry (`src/utils/grow/chartIndicators.js`): MA 20/50, MA 200, Bollinger, VWAP,
  Supertrend, Ichimoku (price pane) and RSI, MACD, Stochastic, ADX, ATR, OBV, Volume
  (separate panes). Detected signals render as confidence cards with an animated pattern
  overlay and a self-grading scorecard. Data via `growData.js` (backend `/candles` first,
  Yahoo CORS-proxy fallback). The chart passes `includeSuppressed` — it shows **all**
  patterns for exploration.
- **Signals** (`src/pages/advisory/GrowSignals.jsx`) — the nightly breadth scan: ranked
  **long calls** across the universe, an **interval selector** (1D/1H/15m/5m/1m), direction
  and actionable-only filters, a live out-of-sample **track record**, and tap-through to
  Charts (`?symbol=…&t=…&ty=…` deep-link).
- **Overview** — the Money-Made ledger.

---

## The signal engine (`src/utils/grow/signals/`, JS + `pybrain/engine.py`, Python)

Two faithful, parity-validated engines emitting the same locked JSON **contract**
(`contract.js`). The JS engine runs in-browser for the Charts POC; the Python engine
runs the server-side nightly brain and the backtest harness.

`runSignals(candles, ctx)` → detectors → per-pattern reliability → confidence →
gating → (optional) trend filter → (optional) long-only → ranked signals.

**Detectors** (`detectors.js`, `geometric.js`): candlestick (engulfing, hammer,
shooting star, morning/evening star), indicator (RSI extremes), structure (support/
resistance, range breakout/breakdown), and geometric chart patterns (double top/bottom,
head-&-shoulders, inverse H&S).

**Confidence** (`confidence.js`) is an **estimated win probability**: the pattern's
tested win rate (`baseReliability`) plus small strength/volume nudges, on a 0–100 scale.
Bands are anchored at break-even: **high ≥ 45, moderate ≥ 40, low < 40**. Recency was
**removed** from the score (it isn't predictive and corrupted backtests). The breakdown
sums exactly to the score — the number can't be faked.

**`ctx` flags** (all default off in the engine; production sets them explicitly):
- `includeSuppressed` — keep gated patterns (Charts uses this).
- `trendFilter` (+ `trendPeriod`, default 50) — drop counter-trend signals (bullish only
  above SMA, bearish only below).
- `longOnly` — drop bearish signals entirely (production default via `batch.py`).
- `reliabilities` — inject precomputed pooled reliabilities (walk-forward / batch).

**Gating** (`SUPPRESSED_TYPES` in `contract.js` / `engine.py`): patterns with negative
out-of-sample expectancy are suppressed from production calls — `double_top`,
`breakdown`, `rsi_overbought`, `head_shoulders`, `shooting_star`, `bearish_engulfing`.
(`bullish_engulfing` was gated on a 50-name sample, then **un-gated** once 300 names
showed it at +1.0% OOS.)

---

## Grading — how "accuracy" is measured (`grade.js` / `engine.py`)

Every signal is walked forward against later candles:
- **ATR-sized exits**: target = entry ± `2 × ATR`, stop = entry ∓ `1.5 × ATR`
  (fixed 4%/3% fallback when ATR is undefined). Adaptive to each symbol's volatility.
- **Worst-case intrabar fills**: when a single bar's range spans both target and stop,
  it is booked a **loss** (stop checked first). Removes the classic optimism bias.
- **Costs**: a round-trip `15 bps` is subtracted from every resolved/flat return.
- Horizon 10 bars. Win/loss returns are computed from the actual exit prices.

`GRADE_DEFAULTS` (horizon, atrTarget, atrStop, costBps…) is the single tuning knob.

---

## The accuracy program (`pybrain/backtest.py`) — the methodology

The harness is the yardstick: it runs the engine over the universe's history, grades
with the honest grader, and reports hit rate / expectancy / payoff **per pattern, per
confidence band (calibration), per direction**. Every change is accepted or rejected on
the number, not on vibes.

```
python backtest.py [--limit N] [--interval 1d] \
                   [--walkforward] [--split 0.7] [--trendfilter] [--longonly]
```

- **In-sample** vs **walk-forward** (`--walkforward`): pooled reliabilities are trained on
  the first `--split` of each series and evaluated only on the held-out tail, so confidence
  never sees the test outcomes. This is what proves generalization.
- **Rank generalization**: learns per-pattern expectancy on train, then reports the
  **Spearman** correlation between train and out-of-sample expectancy, plus a tercile check.
- The harness caught our own overfitting twice — an in-sample confidence calibration that
  went flat OOS, and a per-pattern ranking that didn't generalize until we went long-only.

### What the program established (in order)
1. **Honest grading** (worst-case + costs) — made the yardstick truthful.
2. **Gating** the negative-expectancy patterns — validated OOS (the gated set is deeply
   negative on unseen data: breakdown −2.5%, head_shoulders −2.2%, double_top −2.1%).
3. **Win-probability confidence** — spread the bands; usable for ranking (under long-only).
4. **Broad universe** (bhavcopy, ~300 names) — killed the small-sample noise; only high-n
   patterns generalize (support_bounce, resistance_reject each ~1–5k trades).
5. **Direction is the dominant, generalizing signal** — bullish patterns carry the edge
   (+1.2%), bearish carry none (−0.3% to −0.4%), trend-filtered or not.
6. **Long-only** — the biggest single lever; beat the trend filter and made confidence and
   pattern-ranking generalize. Now the production default.

The **durable edge**: long-side mean-reversion at levels — `support_bounce` (the workhorse,
~5k trades, +1.4% OOS), `double_bottom`, `rsi_oversold`, `inverse_head_shoulders`, plus
`breakout` momentum.

---

## Data pipeline

**Universe** (`pybrain/bhavcopy.py`): parses NSE's official `sec_bhavdata_full` daily file
(OHLC + volume + delivery %). `load_universe()` returns the **top ~300 by turnover**, with
Nifty 200 CSV → hardcoded list as fallbacks.

**Candle store** (`grow_candles` table): `batch.py --ingest` appends one bhavcopy (one
trading day) at a time, accumulating **point-in-time, survivorship-free** history (each
day's file contains exactly what traded that day, including since-delisted names).
`batch.py --source db` scans that store instead of Yahoo once ~60+ days have accrued.
On read, `--source db` **back-adjusts for splits/bonuses** using NSE's corporate-actions
feed (`bhavcopy.fetch_corp_actions` / `adjust_candles`) — raw stays stored, adjusted on
read. Delivery % is carried on every bar (for BTST conviction).

### Candle-store cutover plan (Yahoo → `--source db`)
The scan defaults to Yahoo (a delayed, unofficial POC feed). The store is the accuracy
upgrade: official NSE, survivorship-free, corporate-action-adjusted, delivery-carrying —
free, no broker account. Cut over when it has enough history for the indicators
(~200 bars for SMA200; practically ~60–200 trading days ingested).

1. **Check readiness**: the daily cron already ingests via `batch.py --ingest`. Verify
   depth with `select interval, count(*), count(distinct symbol) from grow_candles`
   (want ≥ ~60 days across the universe; more is better — 200+ unlocks SMA200/regime).
2. **Cut over**: in `.github/workflows/grow-scan.yml`, add `--source db` to the daily scan
   step (`python batch.py --interval 1d --source db`) and the BTST step
   (`python batch.py --btst --source db`). The BTST detector then gets **delivery %**
   (it's on every stored bar), which the Yahoo path can't provide.
3. **Verify** with one **Run workflow**: the log prints `source: bhavcopy DB store · N
   symbols` and `corporate-action adjusted: …`. Confirm the Signals tab still populates.
4. **Then**: BTST becomes backtestable *with* delivery (`backtest.py --btst` on db data),
   and every scan runs on clean, official data. Yahoo remains the fallback if `db` is empty.

Only the EOD (`1d`) and BTST lanes cut over — intraday (5m/15m/1h) stays on Yahoo until a
real-time feed replaces it (that needs a broker/vendor; see caveats).

**Nightly scan** (`batch.py`): fetch universe → universe-pooled reliabilities
(empirical-Bayes toward the global base rate) → run **long-only** → keep fresh signals
(≤ 2 bars) → rank by band/confidence/liquidity → top 200 → upsert Supabase → forward-grade
past signals. Interval-aware (`--interval 5m`); `--allow-shorts` to re-enable bearish.

```
GitHub Action → pybrain/batch.py --ingest        → grow_candles     (survivorship-free history)
GitHub Action → pybrain/batch.py --interval 1d   → grow_signals/grow_scans (long calls)
Signals tab   → Cloudflare Worker GET /grow/*     → Supabase
```

**Schedule** (`.github/workflows/grow-scan.yml`):
- `daily` job (19:00 IST, weekdays): bhavcopy ingest, then the `1d` long-only scan.
- `intraday` job (15:30 IST, weekdays): a matrix over `5m / 15m / 1h`.
- Manual: **Run workflow** (`workflow_dispatch`, interval input). Note: "Re-run jobs"
  replays the old commit — use Run workflow to pick up new code.
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

**Schema** (`pybrain/schema.sql`): `grow_signals` / `grow_scans` (interval-aware),
`grow_candles`, and `grow_track(p_interval)` (out-of-sample aggregation per interval).
Idempotent — safe to re-run. **Must be applied to Supabase after schema changes** or the
scan errors on write.

**Backend** (`backend/src/index.ts`): `GET /grow/signals?interval=`,
`GET /grow/track?interval=` (→ `grow_track`), `GET /candles?symbol=&interval=&range=`.
All interval-aware, defaulting to `1d`.

---

## Deployment

- **Frontend**: `npm run build && npx firebase-tools deploy --only hosting`
  → `https://espresso-and-expenses-14371.web.app`
- **Backend**: `cd backend && npx wrangler deploy`
  → `espresso-expenses-backend.nishanth-espresso.workers.dev`
- **Pipeline**: push to `main` (scheduled workflows run only from the default branch);
  apply `schema.sql` in Supabase; secrets as above.

---

## Tests (no network, deterministic)
- `pybrain/`: `python test_engine.py` · `python test_backtest.py` · `python test_bhavcopy.py`
  · `python validate.py` (live parity vs JS).
- JS: `node src/utils/grow/signals/signals.test.js` · `node src/utils/grow/chartIndicators.test.js`.

---

## Cross-regime validation (5 years)
`backtest.py --walkforward --longonly --range 5y` tags every trade by the symbol's
regime (above/below its 200-DMA at entry) and reports expectancy per regime. Over
~26k out-of-sample trades spanning the 2020 crash and 2022 correction:

| Regime (symbol vs its 200-DMA at entry) | Expectancy | Hit |
|---|---|---|
| Uptrend | +0.4% | 34.8% |
| Downtrend | +0.4% | 34.5% |

**The long edge survives bear regimes** — identical +0.4%/trade in up- and down-trends.
The +1.2% from the single bull year was regime-flattered; **+0.4% is the durable,
regime-robust number**, holding because the edge is mean-reversion at levels (works in
any trend). Spearman train→OOS = +0.60 over 5 years.

## Honest caveats
- **The durable edge is ~+0.4%/trade**, not the bull-year +1.2%. Hit rate (~34%) sits
  below break-even, so some of it is held-to-horizon drift — but it survives 5 years incl.
  downtrends, so it is not purely a bull-market artifact.
- **Long-only stays the default** — validated across regimes above. The trend filter is
  retained as the mechanism to re-admit shorts if a sustained downtrend regime warrants it.
- **Scan still uses Yahoo candles** (delayed POC feed) until the `grow_candles` store fills,
  then cut over to `--source db` for official, survivorship-free, **corporate-action-adjusted**
  data — see the *Candle-store cutover plan* above.
- **Delayed data.** Yahoo intraday (5m/15m/60m) is delayed — fine for the POC; a real-time
  feed is the eventual upgrade for day/scalping.

---

## What's next
1. **Signals → actionable calls** — surface the ATR entry/stop/target/horizon (already
   computed in grading) as a trade plan, not just a pattern name.
2. **Delivery** — wire signals into the notification engine + a watchlist.
3. **BTST** — a closing-strength + delivery-% + volume detector with a next-day grading
   horizon (bhavcopy already gives delivery %); walk-forward-validated from day one.
4. **Cut over to `--source db`** once the candle store fills (or backfill via
   `bhavcopy.build_history`).
5. Longer/bigger bets: bear-market validation, fundamentals (long-term lane), real-time
   feed + broker execution (day/scalping).

---

## File map
```
src/utils/grow/
  growData.js            timeframes + candle fetch (backend → Yahoo fallback)
  chartIndicators.js     indicator math + registry (13 indicators)
  signals/
    contract.js          DIRECTION/CATEGORY, SUPPRESSED_TYPES, signalId
    indicators.js        sma, rsi, atr, pivots, trend
    detectors.js         candlestick + indicator + structure detectors
    geometric.js         double top/bottom, H&S, inverse H&S
    confidence.js        win-probability scoring + bands
    grade.js             ATR walk-forward grading (worst-case + costs)
    index.js             runSignals(candles, ctx)
src/pages/advisory/      GrowChart, GrowSignals, GrowHome, ConfidenceControl
pybrain/
  engine.py              Python port (parity)
  batch.py               nightly scan + --ingest + --source db
  bhavcopy.py            NSE bhavcopy parser/fetcher/universe/history
  backtest.py            evaluation + walk-forward harness
  schema.sql             Supabase tables + grow_track()
backend/src/index.ts     /grow/signals, /grow/track, /candles
.github/workflows/grow-scan.yml   daily + intraday schedule
```
