from backtest import agg, group, evaluate, evaluate_walkforward, calibration_ok, spearman, pooled_expectancy
from engine import SUPPRESSED_TYPES

assert abs(spearman([1, 2, 3, 4], [1, 2, 3, 4]) - 1.0) < 1e-9, "identical ranking -> +1"
assert abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1.0) < 1e-9, "reversed ranking -> -1"
assert spearman([1], [1]) == 0.0, "too few points -> 0"

rows = [
    {"type": "a", "band": "high", "direction": "bullish", "confidence": 85, "status": "win", "ret": 0.02, "bars": 3},
    {"type": "a", "band": "high", "direction": "bullish", "confidence": 85, "status": "loss", "ret": -0.03, "bars": 2},
    {"type": "b", "band": "low", "direction": "bearish", "confidence": 40, "status": "win", "ret": 0.02, "bars": 5},
]

a = agg(rows)
assert a["n"] == 3
assert abs(a["hit"] - 2 / 3) < 1e-9, "hit rate = 2/3"
assert abs(a["exp"] - (0.02 - 0.03 + 0.02) / 3) < 1e-9, "expectancy = mean return"
assert abs(a["avg_win"] - 0.02) < 1e-9
assert abs(a["avg_loss"] - (-0.03)) < 1e-9
assert abs(a["payoff"] - (0.02 / 0.03)) < 1e-9, "payoff = avg_win / |avg_loss|"

g = group(rows, "type")
assert set(g.keys()) == {"a", "b"}
assert agg(g["a"])["n"] == 2 and agg(g["b"])["n"] == 1

assert agg([])["n"] == 0, "empty is safe"

assert calibration_ok({"high": {"hit": 0.7, "n": 10}, "moderate": {"hit": 0.5, "n": 10}, "low": {"hit": 0.3, "n": 10}})
assert not calibration_ok({"high": {"hit": 0.3, "n": 10}, "moderate": {"hit": 0.6, "n": 10}, "low": {"hit": 0.4, "n": 10}})

print("ok — agg/group/calibration math")

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
for k in range(50):
    p = 88 + (k % 12) * 1.5
    candles.append(candle(T0 + (i + 2 + k) * DAY, p, p + 1, p - 0.8, p + 0.4, 1500))

res_all = evaluate([("TEST.NS", candles)], "1d", include_suppressed=True)
assert set(res_all) == {"overall", "by_type", "by_band", "by_direction", "reliabilities", "rows"}
assert isinstance(res_all["overall"]["n"], int)
assert res_all["overall"]["n"] >= 1, "the synthetic series should resolve at least one signal"
for r in res_all["rows"]:
    assert r["status"] in ("win", "loss", "flat")

res_gated = evaluate([("TEST.NS", candles)], "1d")
assert res_gated["overall"]["n"] <= res_all["overall"]["n"], "gating never adds trades"
assert all(t not in SUPPRESSED_TYPES for t in res_gated["by_type"]), "gated view excludes suppressed patterns"

print(f"ok — evaluate() end-to-end: {res_all['overall']['n']} all / {res_gated['overall']['n']} gated on synthetic series")

te = pooled_expectancy([("TEST.NS", candles)])
assert isinstance(te, dict) and all(isinstance(v, float) for v in te.values()), "expectancy per pattern"

wf = evaluate_walkforward([("TEST.NS", candles)], "1d", 0.5, include_suppressed=True)
assert set(wf) == {"overall", "by_type", "by_band", "by_direction", "reliabilities", "train_exp", "rows"}
cut = int(len(candles) * 0.5)
for r in wf["rows"]:
    assert r.get("status") in ("win", "loss", "flat")
    assert "train_exp" in r, "each test row carries its pattern's train expectancy"
assert wf["overall"]["n"] <= res_all["overall"]["n"], "test window is a subset of the full series"

print(f"ok — walk-forward: {wf['overall']['n']} out-of-sample trades (test window from bar {cut})")
