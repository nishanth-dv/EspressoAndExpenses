# pybrain — Grow signal brain (Python)

Faithful Python port of the JS signal engine (`src/utils/grow/signals/`). Emits the
same locked signal JSON contract. This is the foundation of Phase 4 — the single
"brain" that will eventually run the whole-market breadth scan and, later, the ML
models. Stdlib only, no dependencies.

- `engine.py` — indicators, detectors (candlestick + structure + geometric),
  confidence scoring (calibrated pattern reliability + volume + strength + recency;
  confluence & trend dropped per the 2026-07-17 calibration), walk-forward grading,
  per-pattern reliability calibration, and `run_signals(candles, ctx)`.
- `test_engine.py` — deterministic no-network self-check. Run: `python test_engine.py`
- `validate.py` — parity check vs the JS engine over real Yahoo data. Run: `python validate.py`

Parity (2026-07-17, 16 NSE symbols): moderate band 63% / low band 33%, matching the
JS engine within float/fetch noise.

## Not yet built (Phase 4 remainder)
Bhavcopy universe ingestion · Supabase storage of ranked signals · an HTTP endpoint
(FastAPI) the frontend calls · a nightly schedule · the Grow "Signals" tab.
