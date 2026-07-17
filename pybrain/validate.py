import json
import urllib.request

from engine import run_signals, grade_signal


def yahoo(symbol, interval="1d", rng="1y"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={rng}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    res = data["chart"]["result"][0]
    ts = res["timestamp"]
    q = res["indicators"]["quote"][0]
    out = []
    for i in range(len(ts)):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None in (o, h, l, c):
            continue
        out.append({"time": ts[i], "open": o, "high": h, "low": l, "close": c, "volume": q["volume"][i] or 0})
    return out


SYMBOLS = [
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS",
    "AXISBANK.NS", "ITC.NS", "LT.NS", "BHARTIARTL.NS", "HINDUNILVR.NS", "KOTAKBANK.NS",
    "MARUTI.NS", "SUNPHARMA.NS", "TITAN.NS", "ASIANPAINT.NS",
]

pooled = []
for s in SYMBOLS:
    try:
        candles = yahoo(s)
        rep = run_signals(candles, {"symbol": s, "interval": "1d", "timeframe": "1Y"})
        idx = {c["time"]: i for i, c in enumerate(candles)}
        for sig in rep["signals"]:
            oc = grade_signal(sig, candles, idx)
            if oc["status"] != "pending":
                pooled.append((sig, oc))
    except Exception as e:
        print(f"skip {s}: {e}")


def win(arr):
    return sum(1 for _, o in arr if o["status"] == "win") / len(arr) if arr else 0


def pct(n):
    return f"{round(n*100)}%".rjust(4)


print(f"\nPY POOLED: {len(pooled)} resolved signals across {len(SYMBOLS)} symbols")
print(f"overall win rate: {pct(win(pooled))}\n")

by_type = {}
for sig, oc in pooled:
    by_type.setdefault(sig["type"], []).append((sig, oc))
print("-- by pattern --")
rows = [(t, win(a), sum(o["returnPct"] for _, o in a) / len(a), len(a)) for t, a in by_type.items()]
for t, w, r, n in sorted(rows, key=lambda x: -x[1]):
    print(f"  {pct(w)}  {r*100:5.1f}%  n={str(n).rjust(4)}  {t}")

print("\n-- CONFIDENCE BAND --")
for b in ("high", "moderate", "low"):
    a = [x for x in pooled if x[0]["confidenceBreakdown"]["band"] == b]
    print(f"  {b.ljust(9)} {pct(win(a))}  n={str(len(a)).rjust(4)}")
