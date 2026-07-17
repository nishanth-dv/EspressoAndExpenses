from __future__ import annotations

ENGINE = {"source": "rules", "version": "grow-signals-py-0.1.0"}
WEIGHTS = {"baseMin": 25, "baseSpan": 60, "strength": 10, "volume": 8, "recency": 1.5, "recencyCap": 15}
GRADE_DEFAULTS = {"horizon": 10, "target": 0.04, "stop": 0.03}
MEANING = (
    "Confidence reflects how strong, well-tested and current this setup is — "
    "not a prediction that the trade will work."
)


def clamp01(n):
    return max(0.0, min(1.0, n))


def sma(values, period, end):
    if end < period - 1:
        return None
    return sum(values[end - period + 1 : end + 1]) / period


def rsi_series(closes, period=14):
    n = len(closes)
    out = [None] * n
    if n <= period:
        return out
    gain = loss = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gain += d
        else:
            loss -= d
    avg_gain = gain / period
    avg_loss = loss / period
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        d = closes[i] - closes[i - 1]
        g = d if d >= 0 else 0
        l = -d if d < 0 else 0
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def avg_body(candles, end, period=14):
    start = max(0, end - period + 1)
    s = sum(abs(candles[i]["close"] - candles[i]["open"]) for i in range(start, end + 1))
    n = end + 1 - start
    return s / n if n else 0


def avg_volume(candles, end, period=20):
    start = max(0, end - period + 1)
    s = sum((candles[i].get("volume") or 0) for i in range(start, end + 1))
    n = end + 1 - start
    return s / n if n else 0


def trend_at(closes, i, look=10, period=20):
    now = sma(closes, period, i)
    past = sma(closes, period, i - look)
    if now is None or past is None or past == 0:
        return 0
    return max(-1, min(1, ((now - past) / past) / 0.08))


def pivots(candles, left=3, right=3):
    highs, lows = [], []
    for i in range(left, len(candles) - right):
        ph = pl = True
        for j in range(i - left, i + right + 1):
            if j == i:
                continue
            if candles[j]["high"] >= candles[i]["high"]:
                ph = False
            if candles[j]["low"] <= candles[i]["low"]:
                pl = False
        if ph:
            highs.append({"index": i, "price": candles[i]["high"]})
        if pl:
            lows.append({"index": i, "price": candles[i]["low"]})
    return {"highs": highs, "lows": lows}


green = lambda c: c["close"] > c["open"]
red = lambda c: c["close"] < c["open"]
body_of = lambda c: abs(c["close"] - c["open"])
range_of = lambda c: (c["high"] - c["low"]) or 1e-9
upper_wick = lambda c: c["high"] - max(c["open"], c["close"])
lower_wick = lambda c: min(c["open"], c["close"]) - c["low"]


def vol_confirm(candles, i):
    a = avg_volume(candles, i - 1, 20)
    if not a:
        return 0
    return clamp01(((candles[i].get("volume") or 0) / a - 1) / 1.2)


def mk(candles, closes, i, s):
    t = trend_at(closes, i)
    align = -t if s["direction"] == "bearish" else t
    return {
        "type": s["type"], "name": s["name"], "category": s["category"], "direction": s["direction"],
        "time": candles[i]["time"], "price": candles[i]["close"], "title": s["title"], "code": s["code"],
        "meta": s.get("meta", {}),
        "factors": {
            "baseReliability": s["baseReliability"], "signalStrength": clamp01(s["signalStrength"]),
            "trendAlignment": align, "volumeConfirm": vol_confirm(candles, i),
        },
    }


def engulfing(candles, closes):
    out = []
    for i in range(1, len(candles)):
        p, c = candles[i - 1], candles[i]
        ab = avg_body(candles, i, 14) or range_of(c)
        strength = clamp01(body_of(c) / (ab * 1.5))
        if red(p) and green(c) and c["close"] >= p["open"] and c["open"] <= p["close"] and body_of(c) > body_of(p):
            out.append(mk(candles, closes, i, {"type": "bullish_engulfing", "name": "Bullish Engulfing", "category": "candlestick", "direction": "bullish", "title": "Bullish Engulfing", "code": "BE", "baseReliability": 0.62, "signalStrength": strength}))
        elif green(p) and red(c) and c["open"] >= p["close"] and c["close"] <= p["open"] and body_of(c) > body_of(p):
            out.append(mk(candles, closes, i, {"type": "bearish_engulfing", "name": "Bearish Engulfing", "category": "candlestick", "direction": "bearish", "title": "Bearish Engulfing", "code": "BE", "baseReliability": 0.62, "signalStrength": strength}))
    return out


def hammer_star(candles, closes):
    out = []
    for i in range(len(candles)):
        c = candles[i]
        b = body_of(c) or range_of(c) * 0.05
        lw, uw = lower_wick(c), upper_wick(c)
        if lw >= b * 2 and uw <= b * 0.6:
            out.append(mk(candles, closes, i, {"type": "hammer", "name": "Hammer", "category": "candlestick", "direction": "bullish", "title": "Hammer", "code": "H", "baseReliability": 0.55, "signalStrength": clamp01(lw / range_of(c))}))
        elif uw >= b * 2 and lw <= b * 0.6:
            out.append(mk(candles, closes, i, {"type": "shooting_star", "name": "Shooting Star", "category": "candlestick", "direction": "bearish", "title": "Shooting Star", "code": "SS", "baseReliability": 0.55, "signalStrength": clamp01(uw / range_of(c))}))
    return out


def stars(candles, closes):
    out = []
    for i in range(2, len(candles)):
        a, b, c = candles[i - 2], candles[i - 1], candles[i]
        ab = avg_body(candles, i, 14) or range_of(c)
        small_mid = body_of(b) < ab * 0.5
        mid = (a["open"] + a["close"]) / 2
        if red(a) and small_mid and green(c) and c["close"] > mid and body_of(a) > ab * 0.6:
            out.append(mk(candles, closes, i, {"type": "morning_star", "name": "Morning Star", "category": "candlestick", "direction": "bullish", "title": "Morning Star", "code": "MS", "baseReliability": 0.68, "signalStrength": clamp01(body_of(c) / (ab * 1.5))}))
        elif green(a) and small_mid and red(c) and c["close"] < mid and body_of(a) > ab * 0.6:
            out.append(mk(candles, closes, i, {"type": "evening_star", "name": "Evening Star", "category": "candlestick", "direction": "bearish", "title": "Evening Star", "code": "ES", "baseReliability": 0.68, "signalStrength": clamp01(body_of(c) / (ab * 1.5))}))
    return out


def rsi_extremes(candles, closes, rsi):
    out = []
    for i in range(1, len(candles)):
        cur, prev = rsi[i], rsi[i - 1]
        if cur is None or prev is None:
            continue
        if cur < 30 and prev >= 30:
            out.append(mk(candles, closes, i, {"type": "rsi_oversold", "name": "RSI Oversold", "category": "indicator", "direction": "bullish", "title": "RSI crossed into oversold", "code": "RSI", "baseReliability": 0.5, "signalStrength": clamp01((30 - cur) / 15), "meta": {"rsi": round(cur * 10) / 10}}))
        elif cur > 70 and prev <= 70:
            out.append(mk(candles, closes, i, {"type": "rsi_overbought", "name": "RSI Overbought", "category": "indicator", "direction": "bearish", "title": "RSI crossed into overbought", "code": "RSI", "baseReliability": 0.5, "signalStrength": clamp01((cur - 70) / 15), "meta": {"rsi": round(cur * 10) / 10}}))
    return out


def _levels(pivot_arr, tol):
    groups = []
    for p in sorted(pivot_arr, key=lambda x: x["price"]):
        g = groups[-1] if groups else None
        if g and abs(p["price"] - g["price"]) / g["price"] <= tol:
            g["price"] = (g["price"] * g["count"] + p["price"]) / (g["count"] + 1)
            g["count"] += 1
        else:
            groups.append({"price": p["price"], "count": 1})
    return [g for g in groups if g["count"] >= 2]


def support_resistance(candles, closes, piv):
    out = []
    sup = _levels(piv["lows"], 0.01)
    res = _levels(piv["highs"], 0.01)
    for i in range(1, len(candles)):
        c = candles[i]
        for s in sup:
            if c["low"] <= s["price"] * 1.005 and c["low"] >= s["price"] * 0.985 and c["close"] > s["price"]:
                out.append(mk(candles, closes, i, {"type": "support_bounce", "name": "Support Bounce", "category": "structure", "direction": "bullish", "title": f"Bounce off ₹{round(s['price'])} support", "code": "S", "baseReliability": 0.58, "signalStrength": clamp01(s["count"] / 4), "meta": {"level": round(s["price"])}}))
                break
        for s in res:
            if c["high"] >= s["price"] * 0.995 and c["high"] <= s["price"] * 1.015 and c["close"] < s["price"]:
                out.append(mk(candles, closes, i, {"type": "resistance_reject", "name": "Resistance Rejection", "category": "structure", "direction": "bearish", "title": f"Rejected at ₹{round(s['price'])} resistance", "code": "R", "baseReliability": 0.58, "signalStrength": clamp01(s["count"] / 4), "meta": {"level": round(s["price"])}}))
                break
    return out


def breakout(candles, closes, look=20):
    out = []
    for i in range(look, len(candles)):
        hi = max(candles[j]["high"] for j in range(i - look, i))
        lo = min(candles[j]["low"] for j in range(i - look, i))
        c = candles[i]
        v = vol_confirm(candles, i)
        if c["close"] > hi:
            out.append(mk(candles, closes, i, {"type": "breakout", "name": "Range Breakout", "category": "structure", "direction": "bullish", "title": f"Broke above {look}-bar high", "code": "BO", "baseReliability": 0.6, "signalStrength": clamp01((c["close"] / hi - 1) / 0.03 * 0.6 + v * 0.4), "meta": {"level": round(hi)}}))
        elif c["close"] < lo:
            out.append(mk(candles, closes, i, {"type": "breakdown", "name": "Range Breakdown", "category": "structure", "direction": "bearish", "title": f"Broke below {look}-bar low", "code": "BD", "baseReliability": 0.6, "signalStrength": clamp01((1 - c["close"] / lo) / 0.03 * 0.6 + v * 0.4), "meta": {"level": round(lo)}}))
    return out


def _first_close_above(candles, start, level):
    for i in range(start, len(candles)):
        if candles[i]["close"] > level:
            return i
    return -1


def _first_close_below(candles, start, level):
    for i in range(start, len(candles)):
        if candles[i]["close"] < level:
            return i
    return -1


def _max_high(candles, a, b):
    return max(candles[i]["high"] for i in range(a, b + 1))


def _min_low(candles, a, b):
    return min(candles[i]["low"] for i in range(a, b + 1))


def _mk_geo(candles, closes, i, s):
    t = trend_at(closes, i)
    align = -t if s["direction"] == "bearish" else t
    return {
        "type": s["type"], "name": s["name"], "category": "chart", "direction": s["direction"],
        "time": candles[i]["time"], "price": candles[i]["close"], "title": s["title"], "code": s["code"],
        "fromTime": s["fromTime"], "toTime": candles[i]["time"], "meta": s.get("meta", {}),
        "factors": {
            "baseReliability": s["baseReliability"], "signalStrength": clamp01(s["signalStrength"]),
            "trendAlignment": align, "volumeConfirm": vol_confirm(candles, i),
        },
    }


def geometric_signals(candles, closes, piv):
    out = []
    lows, highs = piv["lows"], piv["highs"]
    k = 1
    while k < len(lows):
        a, b = lows[k - 1], lows[k]
        gap = b["index"] - a["index"]
        diff = abs(a["price"] - b["price"]) / min(a["price"], b["price"])
        if 5 <= gap <= 80 and diff <= 0.03:
            neck = _max_high(candles, a["index"], b["index"])
            conf = _first_close_above(candles, b["index"] + 1, neck)
            if conf >= 0:
                out.append(_mk_geo(candles, closes, conf, {"type": "double_bottom", "name": "Double Bottom", "direction": "bullish", "title": f"Double bottom near ₹{round((a['price']+b['price'])/2)}", "code": "W", "fromTime": candles[a["index"]]["time"], "baseReliability": 0.62, "signalStrength": (1 - diff / 0.03) * 0.6 + ((candles[conf]["close"] / neck - 1) / 0.03) * 0.4, "meta": {"level": round((a["price"] + b["price"]) / 2)}}))
                k += 1
        k += 1
    k = 1
    while k < len(highs):
        a, b = highs[k - 1], highs[k]
        gap = b["index"] - a["index"]
        diff = abs(a["price"] - b["price"]) / min(a["price"], b["price"])
        if 5 <= gap <= 80 and diff <= 0.03:
            neck = _min_low(candles, a["index"], b["index"])
            conf = _first_close_below(candles, b["index"] + 1, neck)
            if conf >= 0:
                out.append(_mk_geo(candles, closes, conf, {"type": "double_top", "name": "Double Top", "direction": "bearish", "title": f"Double top near ₹{round((a['price']+b['price'])/2)}", "code": "M", "fromTime": candles[a["index"]]["time"], "baseReliability": 0.62, "signalStrength": (1 - diff / 0.03) * 0.6 + ((1 - candles[conf]["close"] / neck) / 0.03) * 0.4, "meta": {"level": round((a["price"] + b["price"]) / 2)}}))
                k += 1
        k += 1
    for k in range(2, len(highs)):
        l, h, r = highs[k - 2], highs[k - 1], highs[k]
        if not (h["price"] > l["price"] and h["price"] > r["price"]):
            continue
        if h["price"] < max(l["price"], r["price"]) * 1.01:
            continue
        if abs(l["price"] - r["price"]) / min(l["price"], r["price"]) > 0.05:
            continue
        neck = min(_min_low(candles, l["index"], h["index"]), _min_low(candles, h["index"], r["index"]))
        conf = _first_close_below(candles, r["index"] + 1, neck)
        if conf >= 0:
            sd = abs(l["price"] - r["price"]) / min(l["price"], r["price"])
            out.append(_mk_geo(candles, closes, conf, {"type": "head_shoulders", "name": "Head & Shoulders", "direction": "bearish", "title": "Head & shoulders top", "code": "HS", "fromTime": candles[l["index"]]["time"], "baseReliability": 0.66, "signalStrength": (1 - sd / 0.05) * 0.5 + ((h["price"] / max(l["price"], r["price"]) - 1) / 0.05) * 0.5, "meta": {"neckline": round(neck)}}))
    for k in range(2, len(lows)):
        l, h, r = lows[k - 2], lows[k - 1], lows[k]
        if not (h["price"] < l["price"] and h["price"] < r["price"]):
            continue
        if h["price"] > min(l["price"], r["price"]) * 0.99:
            continue
        if abs(l["price"] - r["price"]) / min(l["price"], r["price"]) > 0.05:
            continue
        neck = max(_max_high(candles, l["index"], h["index"]), _max_high(candles, h["index"], r["index"]))
        conf = _first_close_above(candles, r["index"] + 1, neck)
        if conf >= 0:
            sd = abs(l["price"] - r["price"]) / min(l["price"], r["price"])
            out.append(_mk_geo(candles, closes, conf, {"type": "inverse_head_shoulders", "name": "Inverse Head & Shoulders", "direction": "bullish", "title": "Inverse head & shoulders", "code": "iHS", "fromTime": candles[l["index"]]["time"], "baseReliability": 0.66, "signalStrength": (1 - sd / 0.05) * 0.5 + ((min(l["price"], r["price"]) / h["price"] - 1) / 0.05) * 0.5, "meta": {"neckline": round(neck)}}))
    return out


def detect_all(candles, closes, rsi, piv):
    return (
        engulfing(candles, closes)
        + hammer_star(candles, closes)
        + stars(candles, closes)
        + rsi_extremes(candles, closes, rsi)
        + support_resistance(candles, closes, piv)
        + breakout(candles, closes)
        + geometric_signals(candles, closes, piv)
    )


def band(s):
    if s >= 80:
        return "high"
    if s >= 55:
        return "moderate"
    return "low"


def breakdown_signal(f):
    base_rel = f.get("baseReliability", 0.5)
    strength = f.get("signalStrength", 0.5)
    volume = f.get("volumeConfirm", 0)
    recency = f.get("recencyBars", 0)
    rows = [
        {"label": "Pattern reliability", "points": round(WEIGHTS["baseMin"] + base_rel * WEIGHTS["baseSpan"])},
        {"label": "Strength", "points": round(strength * WEIGHTS["strength"])},
        {"label": "Volume confirmation", "points": round(volume * WEIGHTS["volume"])},
        {"label": "Recency", "points": -min(WEIGHTS["recencyCap"], round(recency * WEIGHTS["recency"]))},
    ]
    summed = sum(r["points"] for r in rows)
    total = max(0, min(100, summed))
    rows[-1]["points"] += total - summed
    return {"total": total, "band": band(total), "rows": rows, "meaning": MEANING}


def with_signal_confidence(sig):
    bd = breakdown_signal(sig.get("factors", {}))
    return {**sig, "confidence": bd["total"], "confidenceBreakdown": bd}


def grade_signal(sig, candles, idx_by_time, opts=None):
    o = {**GRADE_DEFAULTS, **(opts or {})}
    i = idx_by_time.get(sig["time"])
    if i is None or i >= len(candles) - 1 or sig["direction"] == "neutral":
        return {"status": "pending", "returnPct": 0, "bars": 0}
    d = -1 if sig["direction"] == "bearish" else 1
    entry = candles[i]["close"]
    target = entry * (1 + d * o["target"])
    stop = entry * (1 - d * o["stop"])
    end = min(len(candles) - 1, i + o["horizon"])
    for j in range(i + 1, end + 1):
        c = candles[j]
        if d == 1:
            if c["high"] >= target:
                return {"status": "win", "returnPct": o["target"], "bars": j - i}
            if c["low"] <= stop:
                return {"status": "loss", "returnPct": -o["stop"], "bars": j - i}
        else:
            if c["low"] <= target:
                return {"status": "win", "returnPct": o["target"], "bars": j - i}
            if c["high"] >= stop:
                return {"status": "loss", "returnPct": -o["stop"], "bars": j - i}
    ret = (d * (candles[end]["close"] - entry)) / entry
    full = end - i >= o["horizon"]
    return {"status": "flat" if full else "pending", "returnPct": ret, "bars": end - i}


def calibrate_reliabilities(raw, candles, opts=None):
    k = (opts or {}).get("k", 5)
    idx_by_time = {c["time"]: i for i, c in enumerate(candles)}
    by_type = {}
    for s in raw:
        t = by_type.setdefault(s["type"], {"prior": s["factors"].get("baseReliability", 0.5), "wins": 0, "resolved": 0})
        g = grade_signal(s, candles, idx_by_time, opts)
        if g["status"] == "pending":
            continue
        t["resolved"] += 1
        if g["status"] == "win":
            t["wins"] += 1
    return {t: (v["wins"] + k * v["prior"]) / (v["resolved"] + k) for t, v in by_type.items()}


def signal_id(symbol, interval, type_, time):
    return f"{symbol}:{interval}:{type_}:{time}"


def run_signals(candles, ctx=None):
    ctx = ctx or {}
    symbol = ctx.get("symbol", "")
    interval = ctx.get("interval", "1d")
    timeframe = ctx.get("timeframe", "")
    last = len(candles) - 1
    if len(candles) < 3:
        return {"symbol": symbol, "timeframe": timeframe, "interval": interval, "generatedAt": 0, "engine": ENGINE, "candleCount": len(candles), "signals": []}
    closes = [c["close"] for c in candles]
    rsi = rsi_series(closes, 14)
    piv = pivots(candles, 3, 3)
    raw = detect_all(candles, closes, rsi, piv)
    reliability = calibrate_reliabilities(raw, candles, ctx.get("grade"))
    idx_by_time = {c["time"]: i for i, c in enumerate(candles)}
    by_time = {}
    for r in raw:
        by_time.setdefault(r["time"], []).append(r)
    signals = []
    for r in raw:
        cluster = by_time[r["time"]]
        confluence = len(cluster) - 1
        idx = idx_by_time.get(r["time"], last)
        recency = last - idx
        factors = {**r["factors"], "baseReliability": reliability.get(r["type"], r["factors"]["baseReliability"]), "confluence": confluence, "recencyBars": recency}
        scored = with_signal_confidence({**r, "id": signal_id(symbol, interval, r["type"], r["time"]), "factors": factors})
        scored["sortValue"] = round(scored["factors"]["signalStrength"] * scored["confidence"])
        signals.append(scored)
    uniq = {}
    for s in signals:
        uniq.setdefault(s["id"], s)
    signals = list(uniq.values())
    signals.sort(key=lambda s: s["sortValue"], reverse=True)
    return {"symbol": symbol, "timeframe": timeframe, "interval": interval, "generatedAt": candles[last]["time"], "engine": ENGINE, "candleCount": len(candles), "signals": signals}
