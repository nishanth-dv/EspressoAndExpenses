# pybrain — Grow signal brain (Python)

Faithful Python port of the JS signal engine (`src/utils/grow/signals/`). Emits the
same locked signal JSON contract. This is the foundation of Phase 4 — the single
"brain" that will eventually run the whole-market breadth scan and, later, the ML
models. Stdlib only, no dependencies.

- `engine.py` — indicators, detectors (candlestick + structure + geometric),
  confidence scoring (calibrated pattern reliability + volume + strength + recency;
  confluence & trend dropped per the 2026-07-17 calibration), walk-forward grading
  (ATR-sized target/stop, worst-case intrabar fills, net of costs), per-pattern
  reliability calibration, and `run_signals(candles, ctx)`.
- `batch.py` — nightly breadth scan: fetch universe → pooled reliabilities →
  run + rank signals → upsert Supabase (`grow_signals`/`grow_scans`) → forward-grade
  past signals. Interval-aware (`--interval 5m`) and **long-only by default** (the
  walk-forward-validated config; `--allow-shorts` to include bearish calls).
  `--ingest` appends the latest bhavcopy to the `grow_candles` store (run daily);
  `--source db` scans that survivorship-free store instead of Yahoo.
- `bhavcopy.py` — NSE `sec_bhavdata_full` parser/fetcher: full-market universe
  (turnover-ranked, feeds `load_universe`) and point-in-time history assembly.
- `backtest.py` — evaluation harness. Runs the engine over the universe's history,
  grades every signal with the honest grader, and reports hit rate / expectancy /
  payoff per pattern, per confidence band (calibration check), and per direction.
  The yardstick for accepting/rejecting any detector or confidence change.
  `--walkforward` trains pooled reliabilities on the first `--split` (default 0.7)
  of each series and evaluates only the held-out tail — the out-of-sample check.
  Run: `python backtest.py [--interval 1d] [--limit N] [--walkforward] [--split 0.7]`.
- `schema.sql` — Supabase tables + `grow_track(p_interval)` aggregation.
- `test_engine.py` / `test_backtest.py` — deterministic no-network self-checks.
- `validate.py` — parity check vs the JS engine over real Yahoo data.

Parity (2026-07-17, 16 NSE symbols): moderate band 63% / low band 33%, matching the
JS engine within float/fetch noise.

## Not yet built (Phase 4 remainder)
Cut over the scan to `--source db` once the `grow_candles` store has ~60+ trading
days ingested (it's growing daily via the workflow; the scan defaults to Yahoo
until then) · bear-market / longer-history validation (the long-only edge is
validated on one bull year; magnitude is regime-flattered until stress-tested).
