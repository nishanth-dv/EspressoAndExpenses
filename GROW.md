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
  NSE symbol. The timeframe strip is **two groups** (`TIMEFRAMES[].group`, divider between
  them): **intervals** `1m/5m/15m/1h` (bar size) and **ranges** `Today/5D/1M/6M/1Y/5Y`
  (window shown) — they were one undifferentiated row, which read as if `1D` meant daily
  bars. Horizontal-scroll strip on mobile. Opens at **Today** (`DEFAULT_TF`) on the last
  symbol viewed (`localStorage["grow-chart-last"]`, symbol only — the timeframe is
  deliberately not sticky); `?i=<scan interval>` from Signals overrides via `INTERVAL_TF`.
  A **Chart editor** modal toggles indicators from a registry
  (`src/utils/grow/chartIndicators.js`): MA 20/50, MA 200, Bollinger, VWAP,
  Supertrend, Ichimoku (price pane) and RSI, MACD, Stochastic, ADX, ATR, OBV, Volume
  (separate panes). Detected signals render as confidence cards with an animated pattern
  overlay and a self-grading scorecard. Data via `growData.js` (backend `/candles` first,
  Yahoo CORS-proxy fallback). The chart passes `includeSuppressed` — it shows **all**
  patterns for exploration.
  - **Warm-up buffers** (`TIMEFRAMES[].viewBars`): `1M` fetches 1y and shows the last 21
    bars, `6M` fetches 2y and shows the last 126. The engine burns 30 bars before its
    first signal (20-bar volume/breakout lookback + `trendAt`'s SMA20-vs-SMA20-ten-bars-ago)
    and MA 200 needs 200 — at a bare 1mo (21 bars) or 6mo (125) neither could compute.
    Signals are filtered to the visible window so the extra history feeds indicators and
    the per-symbol reliability calibration, not the card list.
  - **Time is rendered in IST** (`Asia/Kolkata`) via a `tickMarkFormatter` +
    `localization.timeFormatter`; lightweight-charts formats raw UNIX stamps in UTC, so the
    NSE open read as 03:45. A calendar chip shows the loaded window (`5 Aug 2026,
    09:15–15:25`), and clicking a candle retargets it to that bar.
- **Signals** (`src/pages/advisory/GrowSignals.jsx`) — the nightly breadth scan: ranked
  **long calls** across the universe, an **interval selector** (1D/1H/15m/5m/1m), direction
  and actionable-only filters, a live out-of-sample **track record**, and tap-through to
  Charts (`?symbol=…&t=…&ty=…` deep-link). Two context layers on top: a **market-sentiment
  banner** (India VIX regime — fear/neutral/calm, from the scan row) and an **"⚠ results in
  Xd" chip** on any call whose company reports earnings inside the hold window.
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

**Geometric pairing & shapes** (`geometric.js`, mirrored in `engine.py`). Twin patterns pair
pivots through `twinPairs(candles, piv, isTop)` / `_twin_pairs`: 5–80 bars apart, peaks within
**0.35 × the pattern's own height** (a %-of-price test is meaningless intraday — accuracy
note 8), **no intervening pivot beyond the pair** (a higher peak between two tops is a *head*,
not a twin), and a neckline break inside the pattern's own width. H&S applies the same idea:
shoulders within 0.5 × head height, break within the shoulder-to-shoulder span.
Pairs may be **non-consecutive** — previously only adjacent pivots were compared, so
any twin with a minor pivot between its two peaks was invisible. On a match the scan resumes
past the second pivot, so twins never overlap.

Each geometric signal carries `meta.shape`, the anchor points the chart animates:
lead-in → first extreme → trough/peak → second extreme → **neckline at the break bar**
(H&S adds head + second trough). The lead-in is the **adjacent opposite pivot** (`prevPivotIdx`),
not the lowest/highest bar in a wide window, and the tail stops **on** the neckline rather than
at the confirmation bar's close, which overshoots it by definition. `meta.neckline` is exact
(unrounded) because `GrowChart` draws its dashed price line from that same number — rounding
put the line off the shape. `meta.level` remains the twin price the card title quotes.
The Python engine emits no `shape` (it never draws); the pairing logic is what's kept in parity.

**Confidence** (`confidence.js`) is an **estimated win probability**: the pattern's
tested win rate (`baseReliability`) plus small strength/volume nudges, on a 0–100 scale.
Bands: **high ≥ 45, moderate ≥ 40, low < 40** — validated against 5y out-of-sample
outcomes (accuracy note 10), not just the break-even reasoning they were designed on. Recency was
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
python backtest.py [--limit N] [--interval 1d] [--range 5y] \
                   [--walkforward] [--split 0.7] [--trendfilter] [--longonly] [--vix]
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
7. **Non-consecutive twin pairing** (2026-07-27) — the doubles only ever compared *adjacent*
   pivots, so any twin with a minor pivot between its two peaks was missed. Pairing across
   intervening pivots (bounded: nothing between may exceed the pair) was walk-forward
   validated before shipping, since `double_bottom` is an un-gated production pattern:

   | `double_bottom`, OOS long-only, 148 names | trades | hit | expectancy |
   |---|---|---|---|
   | 1y — adjacent pivots only | 249 | 30.5% | **−0.2%** |
   | 1y — non-consecutive pairing | 248 | 34.7% | **+0.4%** |
   | 5y — adjacent pivots only | 1243 | 33.1% | **+0.1%** |
   | 5y — non-consecutive pairing | 1203 | 35.3% | **+0.4%** |

   The count barely moves because the new scan isn't a superset: taking a wider pair skips
   past intermediates the old loop would have paired adjacently, so weak twins are *replaced*
   by truer ones — the hit rate rises ~2–4pts on the same n. Over 5 years it lifts the pattern
   from +0.1% to **+0.4%**, the universe-wide durable edge, and holds across regimes
   (uptrend +0.5% / downtrend +0.3%). Overall long-only is untouched (5y: 32,380 trades,
   34.6% hit, +0.4%, payoff 1.32 — identical to baseline), as expected from ~4% of trades.
   Spearman moved +0.52 → +0.57 on 5y and +0.67 → +0.52 on 1y: a rank correlation over 8
   patterns is noisy in both directions and neither move is evidence either way.

8. **Amplitude-relative tolerances** (2026-07-27) — the twin/shoulder equality tests measured
   the gap between the two extremes as a **% of price** (3% twins, 5% shoulders). On a ₹213
   name whose whole session spans 0.7%, everything passes: two lows 0.5 apart inside a
   0.99-tall pattern scored 0.25% and drew a "double bottom" that looked nothing like one.
   Both are now measured against the **pattern's own height** (twins ≤ 0.35 × height,
   shoulders ≤ 0.5 × head height), and the neckline break must land within the pattern's own
   width — an 8-bar pattern "confirming" 40 bars later is drift, not a breakout.

   | `double_bottom`, OOS long-only, 1y, 296 names | trades | hit | expectancy |
   |---|---|---|---|
   | %-of-price tolerance, unbounded break | 504 | 35.5% | **+0.7%** |
   | amplitude-relative + bounded break | 242 | 33.9% | **+0.6%** |

   **This is a correctness fix, not an edge fix.** It removes half the double bottoms and
   expectancy does not improve — 0.1% on n=242 is well inside noise. The honest reading: a
   *visually valid* double bottom is no more predictive than a loosely paired one. It ships
   because a chart whose drawing contradicts its label costs more trust than the signals are
   worth. `inverse_head_shoulders` moved the same way (203 → 122 trades, +0.3% → +0.2%).
   Overall long-only is unchanged (9,434 → 9,091 trades, 37.1% → 37.2% hit, +0.9% both).

9. **Signal cooldown** (2026-07-27) — measured on 79 names over a year: **0.455 signals per
   symbol per bar**, of which **63% were the same symbol+type refiring within 5 bars**, and
   61% of all output was one detector (`support_bounce`). Dedupe was keyed on
   `symbol:interval:type:time`, so a level held for three bars became three signals with three
   plans — one trade. `runSignals` \ `run_signals` now collapse repeats inside
   `GRADE_DEFAULTS.horizon` (10 bars) to the **first** firing. First, not
   highest-confidence-in-window: picking the best of the next 10 bars needs future bars, which
   would bake lookahead into a tradeable number. First firing is when a human could act.

   | OOS long-only, 1y, 296 names | trades | hit | expectancy | payoff |
   |---|---|---|---|---|
   | no cooldown | 9091 | 37.2% | +0.9% | 1.35 |
   | 10-bar cooldown | **3626** | 37.4% | +0.9% | 1.36 |

   60% fewer trades at identical per-trade edge — the duplicates carried no information.
   `support_bounce` *improved*: 5189 @ +1.2% (37.5% hit) → 1160 @ **+1.5%** (40.3% hit). The
   repeats weren't neutral, they were worse than the first touch and were diluting the
   pattern's measured edge. This matters most for live intraday data: cooldown is counted in
   bars, and 5m bars are 75× denser than daily.

   **Open defect this exposed:** the `high` confidence band is now n=32, **28.1% hit, −0.5%
   expectancy** — worse than `moderate` (38.1%, +1.1%) and `low` (37.1%, +0.8%). It was
   already miscalibrated pre-cooldown (n=136, 35.3%); the cooldown just made the top band small
   enough to see clearly. The top of the confidence scale is not earning its label. Unfixed.

10. **Confidence thresholds — 1y and 5y disagree; 5y wins** (2026-07-27). Question asked: should
    a confidence floor decide what qualifies as a signal? Threshold sweeps, OOS long-only,
    296 names, gated:

    | keep conf ≥ t | 1y kept | 1y hit | 1y exp | 5y kept | 5y hit | 5y exp |
    |---|---|---|---|---|---|---|
    | all | 3626 | 37.4% | +0.9% | 18941 | 34.0% | +0.3% |
    | 38 | 2198 | 37.9% | +1.0% | 15412 | 34.1% | +0.3% |
    | 40 | 1444 | 37.9% | **+1.1%** | 7536 | 34.3% | +0.3% |
    | 42 | 663 | 35.7% | +0.8% | 4202 | 35.8% | +0.4% |
    | 44 | 110 | 31.8% | +0.6% | 2061 | 37.6% | +0.5% |
    | 46 | — | — | — | 1126 | 38.8% | **+0.7%** |

    **1y shows an inverted U peaking at 40; 5y is monotonically increasing to the top.** They
    are not reconcilable, and 5y is the one to believe: 18,941 rows vs 3,626, across five
    market regimes instead of one. The 1y "top band is the worst thing in the dataset" verdict
    rested on **n=110** — the thinnest cell in that table. Bands were briefly re-cut to
    `high ≥ 40 / moderate ≥ 36` on the 1y evidence and **reverted** once 5y landed. The
    original `high ≥ 45, moderate ≥ 40` stands, now with 5y support: top decile (conf 44–47)
    is the best bucket at 37.7% hit, and ≥46 reaches 38.8% hit / +0.7%.

    **The durable finding is that fixed cut points are fragile.** The score's range is not
    stable across datasets — 30–45 on the 1y calibration, 35–47 on 5y — because
    `baseReliability` is recalibrated per run, so the same numeric cut selects a different
    slice of the distribution each time. A percentile-based band would be scale-stable (but
    would always label a top X% "high", however bad the whole scan is). Unresolved.

    A floor is **not** worth shipping on this evidence: on 5y, ≥40 buys nothing (+0.3% → +0.3%
    while discarding 60% of signals), and the thresholds that do help (≥44, ≥46) keep 5–11% of
    signals — too few to fill a scan.

    **Root cause left standing:** `confidence = baseReliability×100 + strength×3 + volume×4`,
    so strength and volume can only move the score ±7 and the composite is ~95% pattern
    identity. Any threshold on it is a pattern-type filter in disguise; nothing in the score
    discriminates between two instances of the *same* pattern. Confluence, regime and the new
    per-symbol `history` are the candidates for fixing that.

**Per-symbol pattern history.** Every signal carries `history` — how that same pattern resolved
on that same symbol's own past: `{resolved, wins, hitRate, medianWinBars, horizon}`.
`medianWinBars` answers "how many bars did it take to get there", which `gradeSignal` was
already computing (`bars`) and `aggregate()` was discarding. Rendered per card by
`SignalHistory.jsx`; persisted by the batch into `grow_signals.history` (jsonb).

It is **context, not score**. Per-symbol sample sizes are thin — `double_bottom` fires ~2.9× per
symbol per year, `inverse_head_shoulders` ~1.3× — so under 5 resolved instances the card renders
greyed with "too few to lean on" instead of dressing n=3 up as a probability. Confidence keeps
using the empirical-Bayes shrunk reliability (`calibrateReliabilities`, k=5), which pulls a thin
per-symbol record toward the pooled prior; feeding the raw per-symbol rate into the score would
just amplify noise. Only `support_bounce` (~69/symbol/year) has n to stand alone.

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

**Schema** (`pybrain/schema.sql`): `grow_signals` (+ `earnings_in`) / `grow_scans`
(interval-aware, + `vix`/`sentiment`), `grow_candles`, and `grow_track(p_interval)`
(out-of-sample aggregation per interval). Idempotent — safe to re-run. **Must be applied to
Supabase after schema changes** or the scan errors on write. Every column added since
2026-07-23 also ships as a dated one-off in `pybrain/migrations/` (e.g.
`2026-07-23_scan_sentiment.sql`, `2026-07-24_earnings_flag.sql`) — run that instead of the
whole file for a small add.

**Backend** (`backend/src/index.ts`): `GET /search?q=` (server-side Yahoo symbol lookup — the
browser's public CORS proxies 403 or hang from a deployed origin, so search worked only on
localhost), `GET /grow/signals?interval=`,
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

## Market sentiment — India VIX regime
`backtest.py --vix` loads India VIX (`^INDIAVIX`) by day and buckets every out-of-sample
trade by the VIX level at entry:

| Sentiment at entry | Expectancy | Hit |
|---|---|---|
| calm (< 14) | +0.1% | — |
| normal (14–20) | — | — |
| **fear (> 20)** | **+3.0%** | **54%** |

The long mean-reversion edge is **concentrated in fear** — calm markets pay ~nothing. So the
nightly scan records the regime: `batch.market_sentiment()` fetches today's VIX, `write()`
stores `vix` + `sentiment` on `grow_scans`, the Worker returns them with the scan, and Signals
shows the banner. **Informational only** — the scan does not yet gate or reweight signals by
regime; the user reads the banner and sizes accordingly.

## Earnings avoidance
A signal that fires days before results is a coin-flip on an event, not a pattern trade.
`bhavcopy.fetch_earnings_calendar(days_ahead=30)` reads NSE's `corporate-board-meetings`
feed, keeps meetings whose purpose mentions *result*/*financial*, and returns the earliest
date per symbol. `collect_signals` tags each row with `earnings_in` (days to results) **only
when 0–10 days out** — the daily hold window — for the `1d` and `btst` lanes. Signals renders
it as a warning chip. **Not a suppression**: the call is still ranked and shown.

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
- **The two engines have drifted on `meta`.** `geometric.js` emits `shape` and an exact
  `neckline`; `engine.py` emits neither (it never draws) and still rounds `level`. Only the
  pairing/detection logic is held in parity — that is what changes the numbers.

---

## What's next
1. **Signals → actionable calls** — surface the ATR entry/stop/target/horizon (already
   computed in grading) as a trade plan, not just a pattern name.
2. **Delivery** — wire signals into the notification engine + a watchlist.
3. **BTST** — a closing-strength + delivery-% + volume detector with a next-day grading
   horizon (bhavcopy already gives delivery %); walk-forward-validated from day one.
4. **Cut over to `--source db`** once the candle store fills (or backfill via
   `bhavcopy.build_history`).
5. **Act on the regime** — the VIX banner is informational; the tested step is sizing or
   gating calls by sentiment (fear +3.0% vs calm +0.1%), validated walk-forward first.
6. Longer/bigger bets: bear-market validation, fundamentals (long-term lane), real-time
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
  bhavcopy.py            NSE bhavcopy parser/fetcher/universe/history + corp actions + earnings
  backtest.py            evaluation + walk-forward harness (--vix regime buckets)
  schema.sql             Supabase tables + grow_track()
  migrations/            dated idempotent one-off column adds
backend/src/index.ts     /grow/signals, /grow/track, /candles
.github/workflows/grow-scan.yml   daily + intraday schedule
```
