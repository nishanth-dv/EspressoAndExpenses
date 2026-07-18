import csv
import datetime
import io
import json
import os
import sys
import time
import urllib.request

from engine import run_signals, avg_volume, detect_all, pivots, rsi_series, grade_signal

NIFTY200_CSV = "https://niftyindices.com/IndexConstituent/ind_nifty200list.csv"
BANDRANK = {"high": 2, "moderate": 1, "low": 0}
RECENCY_MAX = 2

FALLBACK = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN", "BHARTIARTL", "ITC", "LT", "KOTAKBANK",
    "AXISBANK", "HINDUNILVR", "BAJFINANCE", "MARUTI", "SUNPHARMA", "TITAN", "ASIANPAINT", "NESTLEIND",
    "ULTRACEMCO", "WIPRO", "ONGC", "NTPC", "POWERGRID", "TATASTEEL", "TATAMOTORS", "ADANIENT", "COALINDIA",
    "HCLTECH", "JSWSTEEL", "GRASIM", "BAJAJFINSV", "TECHM", "DRREDDY", "CIPLA", "HINDALCO", "BRITANNIA",
    "EICHERMOT", "HEROMOTOCO", "BPCL", "DIVISLAB", "INDUSINDBK", "M&M", "SBILIFE", "HDFCLIFE", "APOLLOHOSP",
    "TATACONSUM", "BAJAJ-AUTO", "ADANIPORTS", "UPL", "VEDL",
]

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def load_universe():
    try:
        req = urllib.request.Request(NIFTY200_CSV, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8", "ignore")
        rows = list(csv.reader(io.StringIO(text)))
        si = rows[0].index("Symbol")
        syms = [row[si].strip() + ".NS" for row in rows[1:] if len(row) > si and row[si].strip()]
        if len(syms) >= 50:
            return syms
        raise ValueError("too few rows")
    except Exception as e:
        print(f"universe fetch failed ({e}); using {len(FALLBACK)}-name fallback")
        return [s + ".NS" for s in FALLBACK]


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


def fetch_all(symbols, limit=None):
    if limit:
        symbols = symbols[:limit]
    cache = []
    for sym in symbols:
        try:
            candles = yahoo(sym)
            if len(candles) >= 30:
                cache.append((sym, candles))
        except Exception as e:
            print(f"skip {sym}: {e}")
        time.sleep(0.3)
    return cache


def pooled_reliabilities(cache, k=8):
    stat = {}
    tot_wins = tot_resolved = 0
    for _sym, candles in cache:
        closes = [c["close"] for c in candles]
        rsi = rsi_series(closes, 14)
        piv = pivots(candles, 3, 3)
        raw = detect_all(candles, closes, rsi, piv)
        idx = {c["time"]: i for i, c in enumerate(candles)}
        for s in raw:
            v = stat.setdefault(s["type"], {"wins": 0, "resolved": 0})
            g = grade_signal(s, candles, idx)
            if g["status"] == "pending":
                continue
            v["resolved"] += 1
            tot_resolved += 1
            if g["status"] == "win":
                v["wins"] += 1
                tot_wins += 1
    base = tot_wins / tot_resolved if tot_resolved else 0.4
    return {t: (v["wins"] + k * base) / (v["resolved"] + k) for t, v in stat.items()}


def collect_signals(cache, today, reliabilities):
    collected = []
    for sym, candles in cache:
        rep = run_signals(candles, {"symbol": sym, "interval": "1d", "timeframe": "1Y", "reliabilities": reliabilities})
        liquidity = round(avg_volume(candles, len(candles) - 1, 20) * candles[-1]["close"])
        display = sym.replace(".NS", "")
        for s in rep["signals"]:
            if s["factors"]["recencyBars"] > RECENCY_MAX:
                continue
            collected.append({
                "id": s["id"], "scan_date": today, "symbol": sym, "symbol_name": display,
                "type": s["type"], "name": s["name"], "category": s["category"], "direction": s["direction"],
                "bar_time": s["time"], "price": s["price"], "title": s["title"],
                "confidence": s["confidence"], "band": s["confidenceBreakdown"]["band"], "sort_value": s["sortValue"],
                "liquidity": liquidity, "factors": s["factors"], "meta": s.get("meta", {}),
                "breakdown": s["confidenceBreakdown"],
            })
    return collected


def sb(method, path, body=None, upsert=False):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    prefer = "return=minimal"
    if upsert:
        prefer += ",resolution=merge-duplicates"
    headers = {
        "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json", "Prefer": prefer,
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:600]
        print(f"Supabase {method} {path.split('?')[0]} -> {e.code}: {detail}")
        raise


def sb_get(path):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def grade_past(cache, today):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    by_sym = {sym: candles for sym, candles in cache}
    rows = sb_get(f"grow_signals?outcome=is.null&scan_date=lt.{today}&select=id,scan_date,symbol,direction,bar_time&limit=5000")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    updates = []
    for r in rows:
        candles = by_sym.get(r["symbol"])
        if not candles:
            continue
        idx = {c["time"]: i for i, c in enumerate(candles)}
        oc = grade_signal({"time": r["bar_time"], "direction": r["direction"]}, candles, idx)
        if oc["status"] == "pending":
            continue
        updates.append({
            "id": r["id"], "scan_date": r["scan_date"], "outcome": oc["status"],
            "outcome_return": round(oc["returnPct"], 4), "outcome_bars": oc["bars"], "graded_at": now,
        })
    for i in range(0, len(updates), 500):
        sb("POST", "grow_signals?on_conflict=id,scan_date", updates[i : i + 500], upsert=True)
    print(f"forward-graded {len(updates)} past signals")


def write(collected, universe_size, today):
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("\nDRY RUN — no Supabase creds set. Top 20 ranked:")
        for r in collected[:20]:
            print(f"  {str(r['confidence']).rjust(3)} {r['band'][:3]}  {r['symbol'].ljust(14)} {r['name']} ({r['direction']})")
        print(f"\n{len(collected)} recent (<= {RECENCY_MAX} bars) signals across {universe_size} names")
        return
    ids = [r["id"] for r in collected]
    print(f"writing {len(collected)} rows ({len(set(ids))} unique ids) for {today}")
    sb("DELETE", f"grow_signals?scan_date=eq.{today}")
    for i in range(0, len(collected), 500):
        sb("POST", "grow_signals?on_conflict=id,scan_date", collected[i : i + 500], upsert=True)
    sb("POST", "grow_scans?on_conflict=scan_date", {"scan_date": today, "universe_size": universe_size, "signal_count": len(collected)}, upsert=True)
    print(f"wrote {len(collected)} signals for {today} ({universe_size} names)")


def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    today = datetime.date.today().isoformat()
    universe = load_universe()
    print(f"universe: {len(universe)} symbols")
    cache = fetch_all(universe, limit)
    print(f"fetched {len(cache)} symbols")
    pooled = pooled_reliabilities(cache)
    print("pooled reliabilities:", {t: round(r, 2) for t, r in sorted(pooled.items(), key=lambda x: -x[1])})
    collected = collect_signals(cache, today, pooled)
    collected.sort(key=lambda r: (BANDRANK[r["band"]], r["confidence"], r["liquidity"]), reverse=True)
    seen = set()
    unique = []
    for r in collected:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        unique.append(r)
    collected = unique[:200]
    write(collected, len(universe), today)
    grade_past(cache, today)


if __name__ == "__main__":
    main()
