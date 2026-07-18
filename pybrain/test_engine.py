from engine import run_signals, grade_signal

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

rep = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M"})
be = next((s for s in rep["signals"] if s["type"] == "bullish_engulfing"), None)
assert be, "expected a bullish_engulfing signal"
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

print(f"ok — {len(rep['signals'])} signals; bullish_engulfing confidence {be['confidence']}; grade {oc['status']}")

all_ids = [s["id"] for s in rep["signals"]]
assert len(all_ids) == len(set(all_ids)), "signal ids must be unique"
assert run_signals([], {"symbol": "X"})["signals"] == [], "empty candles -> no signals, no throw"

rep_hi = run_signals(candles, {"symbol": "TEST.NS", "interval": "1d", "timeframe": "6M", "reliabilities": {"bullish_engulfing": 0.95}})
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
