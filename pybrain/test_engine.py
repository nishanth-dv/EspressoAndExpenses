from engine import run_signals, grade_signal, atr_series, SUPPRESSED_TYPES

DAY = 86400
T0 = 1700000000


def candle(t, o, h, l, c, v=1000):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v}


candles = []
for i in range(30):
    p = 100 - i * 0.5
    candles.append(candle(T0 + i * DAY, p, p + 0.5, p - 1, p - 0.4, 1000))
i = len(candles)
candles.append(candle(T0 + i * DAY, 85.5, 85.7, 84.8, 85.0, 1000))
candles.append(candle(T0 + (i + 1) * DAY, 84.9, 88.5, 84.7, 88.2, 3000))

rep = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M", "includeSuppressed": True})
be = next((s for s in rep["signals"] if s["type"] == "bullish_engulfing"), None)
assert be, "expected a bullish_engulfing signal"
gated = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M"})
assert all(s["type"] not in SUPPRESSED_TYPES for s in gated["signals"]), "default run excludes suppressed patterns"
assert len(gated["signals"]) <= len(rep["signals"]), "gating is a subset of includeSuppressed"

tf = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M", "includeSuppressed": True, "trendFilter": True, "trendPeriod": 20})
assert not any(s["type"] == "bullish_engulfing" for s in tf["signals"]), "trend filter drops a bullish signal in a downtrend"

lo = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M", "includeSuppressed": True, "longOnly": True})
assert all(s["direction"] != "bearish" for s in lo["signals"]), "long-only drops bearish signals"
assert be["time"] == candles[-1]["time"], "engulfing on the last bar"
assert 0 <= be["confidence"] <= 100
assert sum(r["points"] for r in be["confidenceBreakdown"]["rows"]) == be["confidence"], "breakdown sums to confidence"
assert be["id"] == f"TEST.NS:1d:bullish_engulfing:{be['time']}"

rising = []
for k in range(15):
    p = 100 if k < 3 else 100 + (k - 2)
    rising.append(candle(T0 + k * DAY, p, p + 0.5, p - 0.5, p))
idx = {c["time"]: k for k, c in enumerate(rising)}
sig = {"time": rising[2]["time"], "direction": "bullish"}
oc = grade_signal(sig, rising, idx, {"horizon": 10, "target": 0.04, "stop": 0.03})
assert oc["status"] == "win", "a bullish signal into a rising trend should win"

rise2 = []
for k in range(30):
    p = 100 + 2 * k
    rise2.append(candle(T0 + k * DAY, p - 2, p + 0.5, p - 0.6, p))
r2idx = {c["time"]: k for k, c in enumerate(rise2)}
atr2 = atr_series(rise2, 14)
si = 20
assert atr2[si] and atr2[si] > 0, "atr defined at the signal index"
oc_atr = grade_signal({"time": rise2[si]["time"], "direction": "bullish"}, rise2, r2idx, {"atr": atr2})
assert oc_atr["status"] == "win", "ATR-graded bullish into a strong uptrend wins"
cost_pct = 15 / 10000
expected = (2 * atr2[si]) / rise2[si]["close"] - cost_pct
assert abs(oc_atr["returnPct"] - expected) < 1e-9, "ATR win return = 2x ATR/entry minus round-trip cost"

strad = [candle(T0, 100, 100.5, 99.5, 100), candle(T0 + DAY, 100, 105, 96, 100)]
strad_idx = {c["time"]: k for k, c in enumerate(strad)}
oc_strad = grade_signal({"time": strad[0]["time"], "direction": "bullish"}, strad, strad_idx, {"horizon": 10, "target": 0.04, "stop": 0.03})
assert oc_strad["status"] == "loss", "a bar hitting BOTH target and stop is booked a loss (worst-case)"

print(f"ok — {len(rep['signals'])} signals; bullish_engulfing confidence {be['confidence']}; grade {oc['status']}; ATR grade win {round(expected*100,1)}% net; straddle -> loss")

all_ids = [s["id"] for s in rep["signals"]]
assert len(all_ids) == len(set(all_ids)), "signal ids must be unique"
assert run_signals([], {"symbol": "X"})["signals"] == [], "empty candles -> no signals, no throw"

rep_hi = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M", "reliabilities": {"bullish_engulfing": 0.95}, "includeSuppressed": True})
be_hi = next(s for s in rep_hi["signals"] if s["type"] == "bullish_engulfing")
assert be_hi["confidence"] > be["confidence"], "reliability override should raise confidence"

falling = []
for k in range(15):
    p = 100 if k < 3 else 100 - (k - 2)
    falling.append(candle(T0 + k * DAY, p, p + 0.5, p - 0.5, p))
fidx = {c["time"]: k for k, c in enumerate(falling)}
assert grade_signal({"time": falling[2]["time"], "direction": "bearish"}, falling, fidx)["status"] == "win", "bearish into falling wins"
assert grade_signal({"time": falling[2]["time"], "direction": "bullish"}, falling, fidx)["status"] == "loss", "bullish into falling loses"

for s in rep["signals"]:
    assert s["confidenceBreakdown"]["band"] in ("high", "moderate", "low")
    assert sum(r["points"] for r in s["confidenceBreakdown"]["rows"]) == s["confidence"]

print("ok — invariants: unique ids, empty-safe, override, bearish/loss grade, band sums")
