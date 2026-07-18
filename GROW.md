# Grow — trading signals & breadth scanner

The "Grow your money" domain of the Advisory page. A rule-based technical-analysis
engine that detects chart patterns, scores them by confidence, self-grades against
history, and scans the Nifty 200 nightly for fresh setups.

## Surfaces (frontend)
- **Charts** (`src/pages/advisory/GrowChart.jsx`) — `lightweight-charts` candles for any
  NSE symbol, a swing-based trend line, detected signals as confidence cards, level lines
  on select, and a self-grading scorecard. Data via `src/utils/grow/growData.js` (Yahoo,
  backend-proxy-first with a CORS-proxy fallback).
- **Signals** (`src/pages/advisory/GrowSignals.jsx`) — the nightly breadth scan: ranked
  cards across the Nifty 200, filters, tap-through to Charts (`?symbol=` deep-link).
- **Overview** — the existing Money-Made ledger.

## Engine (`src/utils/grow/signals/`, JS)
`runSignals(candles, ctx)` → detectors (candlestick + structure + geometric) →
per-pattern **reliability calibration** (walk-forward hit rate) → confidence scoring →
ranked signals emitting a fixed JSON **contract**. `grade.js` walk-forward-grades signals
and builds the scorecard, incl. confidence-band calibration. Confidence is driven by
calibrated pattern reliability + strength + volume + recency; **confluence and trend
alignment were dropped** (measured anti-predictive over 5k signals).

## The Python brain (`pybrain/`, stdlib-only)
`engine.py` is a faithful port of the JS engine (parity-validated). `batch.py` is the
nightly breadth scan: fetch Nifty 200 (Yahoo) → **universe-pooled** reliability
calibration (empirical-Bayes toward the global base rate) → score → rank → upsert to
Supabase. Run `python test_engine.py` (self-check) / `python validate.py` (parity).

## Data flow (breadth scan)
```
GitHub Action (19:00 IST) → pybrain/batch.py → Supabase (grow_signals, grow_scans)
Signals tab → Cloudflare Worker GET /grow/signals → Supabase
```
- Schedule: `.github/workflows/grow-scan.yml`. Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
- Schema: `pybrain/schema.sql`. Worker read: `backend/src/index.ts` → `/grow/signals`.
- Note: GitHub "Re-run jobs" replays the old commit — use **Run workflow** to pick up new code.

## Honest caveats
- **Edge is in-sample.** The moderate-band ~63% hit rate is on one recent, mean-reverting
  period. The accumulating nightly scans are what turn it into out-of-sample proof.
- **No "high" band in the scan** — universe-pooled, no pattern has strong enough
  market-wide edge for high conviction. Moderate is the actionable tier.
- **Charts use per-symbol calibration; the scan uses pooled.** Intentional: the chart
  reflects that one symbol's history; the scan needs robustness across names.
- **Grading assumptions** — 4% target / 3% stop / 10-bar horizon (tunable in `grade.js`
  / `GRADE_DEFAULTS`). Not advice.
