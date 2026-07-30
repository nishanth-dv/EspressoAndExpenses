# Grow — trading signals, breadth scanner & accuracy program

The "Grow your money" domain of the Advisory page. A rule-based technical-analysis
engine that detects chart patterns, scores them by their **measured edge over a random entry
on the same stock**, grades every signal against real forward history, and scans the whole
liquid NSE market for fresh **buy calls**.

Everything below is walk-forward validated — but note the hard lesson of 2026-07-29:
**walk-forward validation is necessary and not sufficient.** Train/test splits, Spearman
train→OOS correlation, monotone terciles and regime tags all measure *ranking and
consistency*. None of them asks whether the entry beat picking a day at random, and every one
of them passed on a lane that trailed a coin flip. The benchmark is what makes this file
trustworthy; the splits alone never did.

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

> ⚠️ **The table above is superseded — read it as absolute return, not edge.** Until
> 2026-07-29 nothing in this file was compared against a random entry on the same stock, so
> every figure here includes market drift. Measured on 1d/5y: **ungated, the pooled edge over
> random is only ~+0.09pp/trade** (roughly half the headline is drift), and on `1wk` it is
> **negative**.
>
> **What actually ships now is gated to the detectors that beat random**, and that
> configuration is genuinely positive: `support_bounce` at **+0.48pp mean edge, positive in
> 9/9 consecutive ~6-month windows** including flat and falling markets. The six gated-out
> detectors are positive in only 2/9 with a negative mean.
>
> See *Benchmarking — edge over random entry* and *Rolling-window validation*.

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
  **long calls** across the universe, **trading-style tabs** (Investment / Swing / BTST — see
  *Trading styles*; Intraday and Scalping are `live: false`, swept and rejected), direction
  and actionable-only filters, a live out-of-sample **track record**, and tap-through to
  Charts (`?symbol=…&t=…&ty=…` deep-link). Three context layers on top: a **market-sentiment
  banner** (India VIX regime — fear/neutral/calm, from the scan row), a **per-symbol bias chip**
  on each card (trend/momentum/flow/range, flagged when it disagrees with the call), and an
  **"⚠ results in Xd" chip** on any call whose company reports earnings inside the hold window.
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

**Confidence** (`confidence.js`) is the pattern's **measured edge over a random entry on the
same stock**, plus small strength/volume nudges, on a 0–100 scale. The base term is
`edge / (edge + EDGE_FLOOR)` — monotone, saturating, zero for a negative edge. It was
`baseReliability`, a **win rate**, until 2026-07-30; win rate turned out not to predict
anything (`breakout` has a decent one and a *negative* edge), so the score now measures the
part the pattern actually added rather than how often it happened to be right.
Where no benchmark exists for an interval (`btst`, intraday) it falls back to the old win
rate — and **an unbenchmarked signal is capped at `moderate`**, because you cannot claim high
confidence without a benchmark, however well-formed the pattern.

**Bands are derived, not chosen** (2026-07-30). Two earlier sets of cuts (`45/40`, then
`75/55`) were invented to fit whatever the score range happened to be, and this file twice
recorded that as fragile without fixing it. The cuts now come from the **gate floor**:

| Band | Definition | Cut |
|---|---|---|
| high | shrunk edge ≥ `2 × EDGE_FLOOR` (0.4pp) | ≥ **67** |
| moderate | shrunk edge ≥ `EDGE_FLOOR` (0.2pp) | ≥ **50** |
| low | below the floor | < 50 |

`BAND_CUTS` is computed as `round(edgeBase(threshold) × 100)`, so changing `EDGE_FLOOR` moves
the bands with it and they cannot drift out of step again. A test asserts the derivation
rather than the literals.

Two properties fall out. **The moderate cut *is* the gate floor expressed as a score**, so
anything surviving the gate is at least `moderate` by construction — `low` can only appear on
Charts, where `includeSuppressed` bypasses the gate. And **`high` is reachable**: `1d`
`rsi_oversold` scores **71**. Under the previous 75 cut the best possible score was 71 and the
band was dead UI; a test now asserts the best measured detector can reach it.
Recency was **removed** from the score (it isn't predictive and corrupted backtests). The
breakdown sums exactly to the score — the number can't be faked.

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

    > **Superseded 2026-07-30.** The `45/40` cuts above are gone: `baseReliability` is no
    > longer the base term at all — confidence is now built on **edge over random**, and the
    > bands were re-cut to **75/55** for that scale. The sweep recorded here is still worth
    > reading, but note what it was measuring: buckets of a score that was ~95% pattern
    > identity, ranked by *absolute* expectancy with no benchmark. It could not have detected
    > that `breakout`'s +0.20% was worse than random. **The fragility warning stands and now
    > applies to 75/55, which are equally unvalidated.**

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

## Benchmarking — edge over random entry (2026-07-29)
Every expectancy number in this file predates any benchmark. "The signals return +0.3%
per trade" was never compared against **what an arbitrary entry on the same stock would
have returned over the same holding period**. On a market that trended up for five years,
that omission flatters everything.

The control: for each graded signal, also grade a **random entry day** on the *same
symbol*, in the *same test window*, with the *same exit config*. 1d/5y, 148 symbols:

| | n | Expectancy |
|---|---|---|
| Signal entries | 9,839 | +0.187% |
| **Random entries** | **29,227** | **+0.099%** |
| **Edge over random** | | **+0.088pp/trade** |

**About half of the Swing lane's return is drift.** The edge is real — it replicated at
+0.084pp on an independent random draw — but it is ~0.09pp, not ~0.19pp, and certainly
not the +1.2% in the TL;DR table (which is a different, older config on a bull window).

### It also invalidated the exit sweep
An exit grid (28 configs, target × stop × horizon) appeared to find **+0.49pp** by widening
targets and loosening stops. Extending the grid exposed it: the best cell was
**no target, no stop, hold 60 bars → +5.00%/trade** — i.e. buy-and-hold. Expectancy rose
monotonically as risk management was *removed*, while the worst trade went **−13.1% →
−50.6%**. The grid was rewarding market exposure, not better exits. **Any exit change must
be measured against a random entry held for the same duration**, or it is just a beta dial.

### And it killed both feature candidates
A univariate screen over 8 features found two with shape — `atr_pct` (top deciles +1.09%)
and `dist_200dma` (U-shaped, +0.78%/+0.79% at the extremes). Both **evaporated** once
random entries were bucketed by the same feature:

| Feature | Decile | Signal | Random | Edge |
|---|---|---|---|---|
| `atr_pct` | D9 | +1.09% | +1.02% | +0.07pp |
| `atr_pct` | D10 | +0.95% | +0.72% | +0.22pp |
| `dist_200dma` | D1 | +0.78% | +0.55% | +0.24pp |
| `dist_200dma` | D10 | +0.79% | +0.68% | +0.11pp |

High-ATR names and names far from their 200-DMA are simply **higher beta**. Across all 20
buckets the edge column scatters between −0.24pp and +0.35pp with no structure — the edge
is **uniform at ~0.09pp**, not concentrated anywhere we can find. `confidence` itself was
included as a control and behaved as expected (flat, D1 +0.43% vs D10 +0.46%), confirming
the screen was not manufacturing structure.

### Per-pattern edge over random — where the edge actually lives
Pooling all patterns hid the only real structure found so far. Matching each signal with 5
random entries **on the same symbol**, tagged with that signal's type:

| Pattern | n | Signal | Random | Edge |
|---|---|---|---|---|
| **support_bounce** | 3,733 | +0.45% | +0.08% | **+0.37pp** |
| **rsi_oversold** | 445 | +0.25% | −0.10% | **+0.34pp** |
| double_bottom | 549 | +0.28% | +0.28% | 0.00pp |
| hammer | 891 | −0.02% | +0.16% | −0.18pp |
| bullish_engulfing | 1,398 | −0.07% | +0.11% | −0.18pp |
| breakout | 1,347 | +0.20% | +0.40% | −0.20pp |
| morning_star | 1,224 | −0.14% | +0.13% | −0.26pp |
| inverse_head_shoulders | 292 | −0.09% | +0.31% | −0.40pp |

**Five of eight patterns are worse than a random entry on the same stock.** `breakout` is
the clearest case: +0.20% absolute looks acceptable, but random entries on those same
symbols returned +0.40% — it fires on names that were rising anyway and picks *worse* days
than chance. Keeping only the non-negative types: 4,727 trades, edge **+0.322pp**, ~4× the
pooled figure.

**Do not act on this table yet.** Two reasons:
1. Selecting the winners after seeing the results is post-hoc selection on the same 5 years
   every sweep has used. It is a hypothesis for the holdout, not a validated gate.
2. **The random baseline itself is noisy.** The overall edge measured +0.084pp, +0.088pp and
   +0.041pp across three runs differing only in random sampling — a 2× spread. Per-pattern
   edges at n≈300–1,400 are therefore close to noise. Only `support_bounce` (n=3,733) sits
   comfortably outside it. Quote these with the sampling error, not as point estimates.

### Holdout validation — the gate survives, on data nothing else touched
The per-pattern table above is post-hoc selection, so it was tested properly: reliabilities
trained *without* the final ~250 bars (~12 months), patterns selected on the earlier window
only, random baselines drawn **within each window separately** so drift is matched, then the
gate scored once on the untouched window.

| Pattern | select n | select edge | holdout n | holdout edge | sign holds |
|---|---|---|---|---|---|
| rsi_oversold | 705 | +0.70pp | 314 | +0.26pp | yes |
| **support_bounce** | **7,643** | **+0.40pp** | **2,444** | **+0.35pp** | **yes** |
| breakout | 2,985 | +0.08pp | 906 | −0.12pp | no |
| double_bottom | 1,195 | +0.07pp | 380 | +0.04pp | yes |
| inverse_head_shoulders | 558 | +0.01pp | 196 | −0.28pp | no |
| hammer | 1,960 | −0.00pp | 584 | +0.12pp | no |
| bullish_engulfing | 2,748 | −0.09pp | 911 | +0.01pp | no |
| morning_star | 2,571 | −0.10pp | 856 | −0.02pp | yes |

Only 4 of 8 signs agree — but **every flip was a pattern sitting within ±0.1pp of zero on
the select window**, which is what noise does. The ranking is informative at the extremes
and meaningless in the middle, so **a gate must use a threshold, not `edge > 0`**: the naive
version admitted `breakout` and `inverse_head_shoulders` and reached only +0.185pp against
+0.128pp ungated. A ~0.2pp threshold picks `support_bounce` + `rsi_oversold` — weighted
holdout edge **~+0.34pp, 2.6× ungated**.

**`support_bounce` is the one validated result in this file**: +0.40pp select → +0.35pp
holdout (n=2,444), and positive in **9/9 rolling daily windows** (mean +0.48pp, sd 0.23pp).
On `1wk` it is positive in 5/5 calendar windows but on only 30–95 trades each — the pooled
+2.55pp there overstates a window-level mean of +1.52pp ± 1.03pp, so on weekly trust the sign,
not the magnitude. `rsi_oversold` holds its sign but decays (+0.70 → +0.26pp, n=314) —
suggestive, not established. Everything else is noise or negative.

### Rolling-window validation — `support_bounce` holds in every period (2026-07-30)
The holdout was a single 12-month slice. This splits ~4.2 usable years (5y fetch minus the
200-bar warmup) into nine consecutive ~125-bar (~6 month) windows and measures the edge
**inside each window** — signal entries against random entries drawn from that same window,
so drift is matched locally and each period is a self-contained comparison.

| Window | Period | sig n | signal | random | **edge** |
|---|---|---|---|---|---|
| 0 | 2022-05..2022-11 | 1,280 | +1.03% | +0.68% | +0.34pp |
| 1 | 2022-11..2023-05 | 1,264 | +0.59% | +0.27% | +0.32pp |
| 2 | 2023-05..2023-11 | 1,143 | +1.21% | +0.83% | +0.37pp |
| 3 | 2023-11..2024-06 | 1,243 | +0.99% | +0.59% | +0.40pp |
| 4 | 2024-06..2024-12 | 1,211 | +1.22% | +0.29% | +0.93pp |
| 5 | 2024-12..2025-06 | 1,277 | +0.14% | **−0.37%** | +0.51pp |
| 6 | 2025-06..2025-12 | 1,259 | +0.20% | **−0.04%** | +0.24pp |
| 7 | 2025-12..2026-06 | 1,181 | +0.24% | **−0.10%** | +0.34pp |
| 8 | 2026-06..2026-07 | 285 | +1.46% | +0.60% | +0.86pp |

**9/9 windows positive · mean +0.480pp · sd 0.232pp · min +0.24pp · max +0.93pp**

**Read the `random` column, not the `signal` column.** In windows 5–7 random entries returned
−0.37%, −0.04% and −0.10% — a flat-to-falling market — and `support_bounce` still cleared it
by +0.51, +0.24 and +0.34pp. Its *absolute* return fell from ~1.0% to ~0.2% over those
windows. **Without the benchmark that would have read as the strategy decaying; it was the
market.** This is the clearest demonstration in this file of why absolute expectancy is not
edge.

The contrast is what justifies the gate:

| | Windows positive | Mean edge |
|---|---|---|
| `support_bounce` | **9/9** | +0.480pp |
| `rsi_oversold` | **9/9** | +1.209pp |
| `all_others` (the six gated-out) | **2/9** | **−0.175pp** |

The detectors the gate keeps are positive in every window; the six it drops are negative in
seven of nine with a negative mean. **The gate separates something real.**

Limits, so this is not over-read:
- **`rsi_oversold`'s mean (+1.21pp) contradicts its holdout figure (+0.26pp) by ~5×.** With
  n=30–190 per window and sd 0.659pp that is small-sample scatter. Trust its **sign** (9/9),
  not its magnitude — **do not quote +1.21pp**.
- **The windows are not independent samples.** Nine periods, overlapping 10-bar holds inside
  each, 148 cross-correlated symbols. The `mean/sd = 2.07` the script prints is a stability
  indicator, **not a p-value**.
- **Window 8 is a partial month** (n=285 vs ~1,200) — its +0.86pp carries little weight.

This is the one claim in this document that stands without a hedge: **on daily bars**,
`support_bounce` beat a random entry on the same stock in nine consecutive periods, including
flat and falling ones, at ~1,200 trades per window.

#### The same test on `1wk` is much weaker — the +2.55pp figure does not hold up
Run over `--range max` (19 years of weekly bars), windows keyed to **calendar half-years** so
that symbols with wildly different listing histories are compared over the same real periods:

| Window | sig n | signal | random | edge |
|---|---|---|---|---|
| 2022-H1 | 33 | +7.88% | +5.03% | +2.84pp |
| 2024-H1 | 30 | +3.76% | +1.99% | +1.77pp |
| 2025-H1 | 51 | +5.69% | +5.55% | **+0.14pp** |
| 2025-H2 | 57 | +0.48% | −0.05% | +0.52pp |
| 2026-H1 | 95 | +2.52% | +0.22% | +2.30pp |

**5/5 positive · mean +1.516pp · sd 1.030pp · min +0.14pp**

Only five windows cleared n≥30, all post-2022 — weekly bars generate few signals per period,
and earlier windows fail the threshold because fewer of today's top-300 had 60 weeks of
history then. Compare the daily test: nine windows, ~1,200 trades each, sd **0.23pp**. Here
sd is **1.03pp** and one window sits at +0.14pp, indistinguishable from zero.

**So `support_bounce` is well validated on daily and only *directionally* supported on
weekly.** The `+2.55pp` single pooled measurement (n=382) overstates it; the window-level mean
is +1.52pp ± 1.03pp. **Trust the sign, not the magnitude.**

`rsi_oversold` on `1wk`: **no window reached n≥30 at all** — it is unmeasurable on weekly
data. That independently justifies the "absent from the table ⇒ gated out" rule: it was not
excluded arbitrarily, there is not enough of it to measure.

The gate itself is strongly supported on weekly: `all_others` is **6/38 windows positive,
mean −2.78pp** across 19 years.

#### The clearest illustration in this file of why absolute expectancy is worthless
Two windows from that `all_others` table:

| Window | sig n | signal | random | edge |
|---|---|---|---|---|
| 2009-H1 | 48 | **+65.89%** | **+59.17%** | +6.72pp |
| 2008-H2 | 31 | **+23.95%** | **+40.91%** | **−16.96pp** |

In the post-crash rally the signals returned +65.89% per trade — and so did picking days at
random, +59.17%. In 2008-H2 the signals gained +23.95% while random gained +40.91%: a 17pp
**deficit** hidden inside a spectacular-looking absolute number. Any report quoting weekly
absolute expectancy in those periods was describing the market and calling it a strategy.

### What shipped from this (2026-07-30)
Three changes, all driven by the benchmark rather than absolute expectancy.

**1. A second gate: edge over random.** `SUPPRESSED_TYPES` gates on *negative absolute
expectancy* — a test `breakout` passes at +0.20% while random on the same names returns
+0.40%. `EDGE_VS_RANDOM` (`signals/contract.js`, mirrored in `engine.py`) now holds the
measured per-interval edge, and `beatsRandom()` requires **≥ `EDGE_FLOOR` (0.2pp)**:

| Interval | Detectors that survive |
|---|---|
| `1d` | `support_bounce`, `rsi_oversold` |
| `1wk` | `support_bounce` |
| `btst`, intraday | ungated — no benchmark table exists yet |

At a benchmarked interval, a type that is **absent** from the table is gated out: too few
samples to measure is *no evidence*, not a pass. That is why `1wk` keeps one detector.
`includeSuppressed: true` bypasses the gate, so **Charts still draws everything** — only the
nightly scan and the Signals lanes are filtered.

**2. `confidence` is now built on edge, not win rate.** The base term was
`baseReliability` — a win rate, which is exactly the quantity that turned out not to matter.
It is now `edge / (edge + EDGE_FLOOR)`: monotone, saturating, zero for a negative edge, and
falling back to the old win rate only where no benchmark exists.

| Measured edge | Confidence | Band |
|---|---|---|
| −0.12pp (`breakout`, 1d) | 4 | low |
| +0.26pp (`rsi_oversold`, 1d) | 60 | moderate |
| +0.35pp (`support_bounce`, 1d) | 67 | moderate |
| +1.52pp raw / **+0.32pp shrunk** (`support_bounce`, 1wk) | 65 | moderate |

#### Sample-size shrinkage (2026-07-30)
The score originally used the raw measured edge, so weekly `support_bounce` scored **92** on
five thin windows (n=266 total) while daily `support_bounce` — the best-evidenced result in
this file, 9/9 windows, n=10,143 — scored **67**. **The worse-evidenced number outranked the
better one.**

`EDGE_VS_RANDOM` now stores `{edge, n}` and every edge is shrunk toward zero by its own trade
count, the same empirical-Bayes idiom `calibrateReliabilities()` already uses:

```
shrinkEdge(edge, n) = edge × n / (n + EDGE_PRIOR_N)      EDGE_PRIOR_N = 1000
```

| Interval | Pattern | raw | n | shrunk | conf | gated |
|---|---|---|---|---|---|---|
| `1d` | `rsi_oversold` | +1.209 | 1,028 | **+0.613** | 79 | keep |
| `1d` | **`support_bounce`** | +0.48 | **10,143** | **+0.437** | **72** | keep |
| `1wk` | `support_bounce` | +1.516 | 266 | **+0.319** | 65 | keep |
| `1d` | `hammer` | +0.12 | 2,544 | +0.086 | 34 | drop |
| `1d` | `breakout` | −0.12 | 3,891 | −0.095 | 4 | drop |
| `1wk` | `breakout` | −2.22 | 258 | −0.455 | 4 | drop |

**Daily `support_bounce` (72) now outranks weekly (65)** despite a raw edge 3× smaller,
because it is measured on 38× more trades. The gate is unchanged — both survive the 0.2pp
floor, and shrinkage can only move a negative edge *toward* zero, never across the floor.

`EDGE_PRIOR_N = 1000` is **a chosen prior, not a derived one**: n=1,000 trades earns 50%
weight. It was picked because per-trade noise here is percent-level against edges of
0.3–1.5pp. Nothing validates 1000 over 500 or 2000.

#### Dispersion penalty (2026-07-30)
Sample size alone missed *period variability*. `rsi_oversold` scored **79 — highest in the
system** — because its edge is large, while being far less consistent than `support_bounce`
(cross-window sd **0.659pp vs 0.232pp**). The score now takes a one-standard-error **lower
confidence bound** across rolling windows before shrinking by `n`:

```
lowerBound(edge, sd, windows) = edge − EDGE_Z · sd / √windows      EDGE_Z = 1
effective                     = shrinkEdge(lowerBound(...), n)
```

| Interval | Pattern | raw | sd | win | lcb | shrunk | conf |
|---|---|---|---|---|---|---|---|
| `1d` | `rsi_oversold` | +1.017 | 0.659 | 9 | +0.797 | **+0.404** | 71 |
| `1d` | `support_bounce` | +0.442 | 0.232 | 9 | +0.365 | **+0.332** | 66 |
| `1wk` | `support_bounce` | +1.512 | 1.030 | 5 | +1.051 | **+0.221** | 56 |

`rsi_oversold` loses **0.613pp** of its raw edge to the two penalties; `support_bounce` loses
**0.110pp**. Patterns with no rolling `sd` recorded take no dispersion penalty (all are
gated-out negatives, where it cannot change the outcome).

**A correction to what this file previously claimed.** The earlier note said `rsi_oversold`'s
rolling mean "disagrees with its own holdout figure by ~5×", implying a broken measurement.
**That was wrong.** The holdout period *is* rolling windows 7+8, whose trade-weighted edge is
**0.268** — exactly the holdout's +0.26. There is no contradiction: `rsi_oversold` genuinely
averages ~1.0pp over nine windows and simply had a weak last twelve months (window 7 =
+0.02pp). The real property is **period variability**, which is what `sd` measures and what
this penalty now prices.

Window means are also now **trade-weighted**, not unweighted. Unweighted overstated
`rsi_oversold` at 1.210 vs 1.017, because a 30-trade window counted as much as a 190-trade one.

⚠️ **One consequence worth watching.** **Weekly `support_bounce` clears the 0.2pp floor by
only 0.021pp.** Any downward revision empties the Investment lane entirely. A test asserts
this margin so the fragility is visible rather than discovered in production.

(The other consequence — that nothing could reach `high` under the old 75 cut — was fixed by
deriving the bands from the gate floor; see *Confidence* above. Current bands: high ≥ 67,
moderate ≥ 50, and `1d` `rsi_oversold` reaches high at 71.)

The score finally says what a user assumes it says: *how much this pattern beat buying the
same stock on an arbitrary day*. Bands were re-cut to the new scale (**high ≥ 75, moderate
≥ 55**).

⚠️ **Those cut points are provisional and unvalidated** — the same fragility recorded in the
1y-vs-5y threshold sweep applies. They were chosen to fit the current edge range, not
derived from outcomes.

⚠️ **Consequence to watch:** `calibrateReliabilities()` no longer feeds confidence for any
benchmarked type — it now only affects `btst` and intraday. And **signal volume on 1d and
1wk drops sharply**, since six of eight detectors are gated off. That is the intended
trade (2.6× the edge) but it makes the category filter chips near-pointless on those lanes.

### Why this rules out an ML model for now
The obvious upgrade to the near-degenerate confidence score is a learned per-instance
model. Three measured reasons not to build one yet:

1. **The label is ~50% drift.** A model trained on these returns learns "hold high-beta
   names in a rising market" and will validate beautifully while learning nothing about
   setups. `atr_pct` is exactly the feature it would have seized on.
2. **No feature-conditional structure exists to learn.** The edge is flat across every
   bucket of every feature tested. Capacity is not the binding constraint.
3. **The edge being scored is +0.09pp.** At ~19k OOS trades with a thin, uniform effect,
   overfitting risk dominates any capacity benefit.

Revisit only after the labels are benchmark-adjusted and at least one feature shows edge
**over random** — not edge in absolute return. Note the per-pattern table above found in one
grouping what eight engineered features could not: the discriminating variable is *which
detector fired*, which the existing per-type reliability machinery already models. A learned
model would have to beat that, not the pooled average.

## Trading styles — the lanes (`STYLES` in `signals/contract.js`)
A trader picks a *style* first, not a bar size. `STYLES` is the single source of truth: each
lane declares the interval(s) that back it, and `tradeType(interval)` derives its label from
the same table so the tab and the card tag can never disagree. Signals shows one tab per
**live** lane, with a sub-picker only where a lane spans several intervals (Intraday).

| Lane | Intervals | Horizon | Live | Validated |
|---|---|---|---|---|
| Investment | `1wk` | ~10 weeks | ⚠️ | gated to `support_bounce`: 5/5 windows but thin (**+1.5pp ± 1.0**, n=30–95, table value 1.5); ungated the lane is **−0.14pp** |
| Swing | `1d` | ~6 days | ✅ | gated: `support_bounce` **+0.48pp vs random, 9/9 windows** |
| BTST | `btst` | next day | ✅ | own detector + next-day grading |
| Intraday | `1h` `15m` `5m` | intra-session | ❌ | **swept and rejected** — see below |
| Scalping | `1m` | minutes | ❌ | **swept and rejected** — see below |

`live: false` lanes are **not rendered**. This is deliberate: before this change the UI
offered a `1m` tab that the batch never scanned, so it was permanently empty. A test now
asserts **no live lane points at an interval the batch never scans**, which is exactly the
defect that shipped unnoticed.

> ⚠️ **The verdict below was overturned on 2026-07-29.** Benchmarked against a random entry
> on the same symbol, the 1wk lane returns **signal +2.252% vs random +2.395% — edge
> −0.144pp**. Holding those stocks for ~10 weeks *at all* beat the signals; the +1.6% is
> market drift, and this lane holds longest so it was the most exposed. Every check below
> (Spearman +0.86, monotone terciles, downtrend survival) passed on a lane that trails a
> coin flip — they measure ranking and consistency, never whether the entry beat chance.
> The one exception is `support_bounce`: **+4.18% vs +1.64% random, edge +2.55pp** (n=382) —
> though rolling windows put the weekly edge nearer **+1.5pp ± 1.0** on thin samples.
> Four of the lane's five detectors subtract value. See *Benchmarking — edge over random*.

### Investment lane (`1wk`) — validated 2026-07-28, **overturned 2026-07-29**
`backtest.py --interval 1wk --walkforward --range 5y`, 288 symbols, 4,210 gated OOS trades:

| | Trades | Hit | Expectancy | Payoff |
|---|---|---|---|---|
| before gating | 6,290 | 30.0% | +0.1% | 1.27 |
| **after gating** | **4,210** | **34.9%** | **+1.6%** | **1.36** |

Confidence is monotonic (high 39.4% / moderate 38.4% / low 25.1%), train→OOS Spearman
**+0.86 [GENERALIZES]**, train-expectancy terciles monotonic OOS (+2.9% / −0.5% / −3.3%),
and the edge holds in downtrends (+1.6%). Bullish +2.7% vs bearish −1.2% — long-only again.

**Do not read +1.6% as "5× better than Swing."** The weekly lane holds ~10 weeks per trade
versus ~6 days daily, with much larger moves (avg win 13.8%, avg loss −10.9%). It is a bigger
edge *per trade*, not necessarily per unit of time or capital deployed. Turnover-adjusted
comparison across lanes is not something this harness measures yet.

### Intraday lane (`1h`/`15m`/`5m`) — swept and rejected 2026-07-28
Walk-forward 70/30, long-only gated, full universe: `1h` −0.1%/trade (payoff 1.13, 123k
trades), `15m` −0.1% (payoff 0.96, 37k), `5m` −0.2% (payoff 0.74, 103k). **No pattern is
profitable in any of the three.**

A tempting story fit the payoff ladder across lanes (1.36 weekly → 0.23 at 1m): `horizon: 10`
is a daily-shaped default applied to every interval, so at 15m it grades "does a 2-ATR move
complete in 2.5 hours". **A horizon × target grid refuted it.** On `15m` and `1h`, sweeping
horizon 10 → 26 → 52 (up to 8.7 sessions) lifts hit rate a lot — 1h goes 34.9% → 44.7% — and
moves expectancy **not at all** (−0.1% throughout, payoff flat at ~1.15). More time reaches
more targets *and* absorbs proportionally bigger losses. **Hit rate and expectancy are
decoupled; do not tune horizon expecting expectancy to follow.**

Shrinking targets to fit inside a session is *strictly worse*, not better — 1h payoff
1.15 → 0.96 (1/0.75) → 0.63 (0.5/0.4) — because a fixed 15bps takes a larger bite of a
smaller target. At 0.5 ATR on 15m the avg win is 0.1% against an 0.3% avg loss: friction has
eaten the entire target.

The zero-cost column is what actually separates the lanes:

| Lane | Gross (0bps) | Net (15bps) | Diagnosis |
|---|---|---|---|
| `1h` | **+0.1%**, payoff 1.38 | −0.1%, payoff 1.15 | thin real edge, fully consumed by friction |
| `15m` | **0.0%**, payoff 1.42 | −0.1%, payoff 1.00 | edgeless — nothing for costs to eat |

So `1h` break-even is ~10bps all-in, which must cover brokerage, STT, exchange charges, GST,
stamp duty *and* slippage on a ~10-hour hold. +0.1% gross with perfect fills is not a
business. All three intervals ship `live: false`.

**Always run the zero-cost column.** It is one extra config and it is the only thing that
distinguishes "no edge" from "edge destroyed by friction" — a distinction that decides whether
a better feed or cheaper broker could ever rescue a lane. Earlier lane verdicts in this file
were made without it.

### Scalping lane (`1m`) — swept and rejected 2026-07-28
`backtest.py --interval 1m --walkforward --range 7d`, 299 symbols, **57,948 gated OOS trades**.
**Every pattern is negative** (−0.1% to −0.3%); bullish −0.2%, bearish −0.2%, and identical in
up- and down-trends. The cause is the payoff ratio: **0.23–0.44** versus 1.32 on daily bars.
At 1-minute scale the ATR target/stop shrink with volatility but the 15bps round-trip cost
does not, so wins are a fraction of losses. At −0.2%/trade against 0.15% cost, **gross is
about −0.05% — flat**; there is no edge for costs to eat. The `high` band has **n=0**: the
confidence scale collapses entirely at this resolution.

So `scalping` stays `live: false` and the lane is not rendered. Revisit only with a real
intraday feed (Yahoo caps 1m at 7 days) *and* a cost model built for that horizon — but note
a payoff of 0.30 is not a data-volume problem.

**Caveat on the attribution above:** the "gross is about −0.05% — flat" line was inferred by
subtracting the cost from net, not measured. `1m` was never re-run with `costBps: 0`, so
whether it is edgeless (like `15m`) or friction-bound (like `1h`) is *not* established. The
rejection stands either way — a 0.23–0.44 payoff fails at any realistic cost — but the stated
mechanism is an inference, not a result.

**A trap this exposed in our own harness:** that run printed `confidence IS monotonic
(calibrated)`, `Spearman +0.67 [GENERALIZES]` and `terciles MONOTONIC` — all three PASS flags
firing on a lane where every single pattern loses money. Ranking losers in the right order is
not an edge. **Never read those flags without the expectancy column beside them.**

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

## Per-symbol bias — the symbol-level counterpart to VIX
VIX is one number for the whole market; it says nothing about the symbol in front of you.
`symbolBias(candles)` (`signals/bias.js`, mirrored as `engine.symbol_bias`) reads a per-symbol
lean from the OHLCV we already have — **four components**, each clamped to `[-1, 1]` and
averaged:

| Part | Reads | Full scale at |
|---|---|---|
| Trend | close vs its 200-bar SMA (50 or 20 if shorter history) | ±15% from the MA |
| Momentum | 20-bar return | ±12% |
| Money flow | volume on up bars minus down bars, over total | ±50% net imbalance |
| Range position | where close sits in the 52-bar high–low range | at the extremes |

`≥ +0.3` bullish, `≤ −0.3` bearish, else neutral. Needs 30 bars; returns `null` below that.

Two surfaces: **Charts** computes it client-side from the loaded candles and shows the chip
plus the four part bars under the quote; **Signals** reads it from the row — `collect_signals`
stamps `bias` on every signal of that symbol (migration `2026-07-28_symbol_bias.sql`) and each
card shows the compact chip, flagging **"setup fights the symbol"** when a bullish signal fires
on a bearish symbol (or the reverse).

This is **not news or social sentiment** — it is a price-and-volume read; the genuine
per-symbol fear gauge is per-stock option IV, which our free data does not carry.

### Agreement sweep — bias does **not** predict outcome (measured, 2026-07-28)
Before letting the chip gate anything, we tested it: 296 symbols × 5y, walk-forward 70/30,
bias recomputed **point-in-time** as `symbol_bias(candles[:i+1])` at each signal's own bar
(using the shipped last-bar value would leak the future). Long-only population — 18,977 OOS
graded signals, baseline **34.0% hit / +0.3% per trade**, which reconciles with the 5y figure
above and so validates the harness.

| Stance at entry | n | Hit | Exp |
|---|---|---|---|
| bias agrees with the call | 7,627 | 34.2% | +0.3% |
| neutral | 6,665 | 33.8% | +0.2% |
| bias conflicts | 4,685 | 33.8% | **+0.4%** |

Signed-bias deciles (D1 = bias most *against* the signal) wander between 32.3% and 36.3% hit
with **no monotonic trend**, and the single best decile is **D1** at +0.7%. Every filter —
"not conflicting" (keeps 75%), "agrees only" (40%), "signed ≥ 0.4" (34%), "trend agrees"
(54%) — lands within ±0.0% of baseline expectancy. Per-part edges: trend −0.0pp, momentum
−0.2pp, flow −0.1pp, position +0.2pp. Per-type signs are inconsistent (`morning_star` +0.3%
agree vs −0.2% conflict, but `hammer` −0.2% vs +0.7% and `support_bounce` +0.5% vs +0.7%).
The same sweep on all signals including suppressed types (38,273 rows) is equally flat.

Not a broken measurement: the deciles span −1.00 to +1.00 at even 10% fills, so the score has
full dispersion and simply carries no information about the outcome.

**So the bias stays displayed context and nothing more** — it does not enter `confidence`, does
not gate, does not reweight. The "setup fights the symbol" flag is an honest *description* of
the disagreement, not a warning that the trade is worse; on this evidence it isn't. If it ever
becomes a filter it needs a fresh sweep, not this one.

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
- **"Some of it is drift" is now measured, and it is about half.** Against a random entry
  on the same symbol over the same holding period, the pattern edge is **+0.09pp/trade**
  (signal +0.187% vs random +0.099%). Absolute expectancy figures in this file are *not*
  edge — see *Benchmarking — edge over random entry*. Every future claim of improvement
  must clear the random-entry benchmark, not just zero.
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
