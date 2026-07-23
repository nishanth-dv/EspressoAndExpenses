import csv
import datetime
import io
import json
import os
import sys
import time
import urllib.request

from engine import run_signals, avg_volume, detect_all, pivots, rsi_series, grade_signal, atr_series, btst_signals

NIFTY200_CSV = "https://niftyindices.com/IndexConstituent/ind_nifty200list.csv"
BANDRANK = {"high": 2, "moderate": 1, "low": 0}
RECENCY_MAX = 2

INTERVAL_RANGE = {
    "1m": "7d",
    "2m": "60d",
    "5m": "60d",
    "15m": "60d",
    "30m": "60d",
    "60m": "730d",
    "90m": "60d",
    "1h": "730d",
    "1d": "1y",
    "1wk": "5y",
    "1mo": "max",
}

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


def load_universe(top=300):
    try:
        from bhavcopy import bhavcopy_universe
        syms = bhavcopy_universe(top=top)
        if len(syms) >= 50:
            print(f"universe: NSE bhavcopy, top {len(syms)} by turnover")
            return syms
        raise ValueError("bhavcopy returned too few names")
    except Exception as e:
        print(f"bhavcopy universe failed ({e}); trying Nifty200 CSV")
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


def fetch_all(symbols, interval="1d", rng="1y", limit=None):
    if limit:
        symbols = symbols[:limit]
    cache = []
    for sym in symbols:
        try:
            candles = yahoo(sym, interval, rng)
            if len(candles) >= 30:
                cache.append((sym, candles))
        except Exception as e:
            print(f"skip {sym}: {e}")
        time.sleep(0.3)
    return cache


def pooled_reliabilities(cache, k=8, grade_opts=None, mode=None):
    stat = {}
    tot_wins = tot_resolved = 0
    for _sym, candles in cache:
        closes = [c["close"] for c in candles]
        rsi = rsi_series(closes, 14)
        piv = pivots(candles, 3, 3)
        raw = btst_signals(candles, closes) if mode == "btst" else detect_all(candles, closes, rsi, piv)
        idx = {c["time"]: i for i, c in enumerate(candles)}
        atr = atr_series(candles, 14)
        for s in raw:
            v = stat.setdefault(s["type"], {"wins": 0, "resolved": 0})
            g = grade_signal(s, candles, idx, {**(grade_opts or {}), "atr": atr})
            if g["status"] == "pending":
                continue
            v["resolved"] += 1
            tot_resolved += 1
            if g["status"] == "win":
                v["wins"] += 1
                tot_wins += 1
    base = tot_wins / tot_resolved if tot_resolved else 0.4
    return {t: (v["wins"] + k * base) / (v["resolved"] + k) for t, v in stat.items()}


def collect_signals(cache, today, reliabilities, interval="1d", long_only=True, mode=None):
    collected = []
    for sym, candles in cache:
        rep = run_signals(candles, {"symbol": sym, "interval": interval, "timeframe": interval, "reliabilities": reliabilities, "longOnly": long_only, "mode": mode})
        liquidity = round(avg_volume(candles, len(candles) - 1, 20) * candles[-1]["close"])
        display = sym.replace(".NS", "")
        for s in rep["signals"]:
            if s["factors"]["recencyBars"] > RECENCY_MAX:
                continue
            collected.append({
                "id": s["id"], "scan_date": today, "interval": interval, "symbol": sym, "symbol_name": display,
                "type": s["type"], "name": s["name"], "category": s["category"], "direction": s["direction"],
                "bar_time": s["time"], "price": s["price"], "title": s["title"],
                "confidence": s["confidence"], "band": s["confidenceBreakdown"]["band"], "sort_value": s["sortValue"],
                "liquidity": liquidity, "factors": s["factors"], "meta": s.get("meta", {}),
                "breakdown": s["confidenceBreakdown"], "plan": s.get("plan"), "trade_type": s.get("tradeType"),
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


def grade_past(cache, today, interval="1d", grade_opts=None):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    by_sym = {sym: candles for sym, candles in cache}
    atr_by_sym = {sym: atr_series(candles, 14) for sym, candles in cache}
    rows = sb_get(f"grow_signals?outcome=is.null&interval=eq.{interval}&scan_date=lt.{today}&select=id,scan_date,symbol,direction,bar_time&limit=5000")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    updates = []
    for r in rows:
        candles = by_sym.get(r["symbol"])
        if not candles:
            continue
        idx = {c["time"]: i for i, c in enumerate(candles)}
        oc = grade_signal({"time": r["bar_time"], "direction": r["direction"]}, candles, idx, {**(grade_opts or {}), "atr": atr_by_sym[r["symbol"]]})
        if oc["status"] == "pending":
            continue
        updates.append({
            "id": r["id"], "scan_date": r["scan_date"], "outcome": oc["status"],
            "outcome_return": round(oc["returnPct"], 4), "outcome_bars": oc["bars"], "graded_at": now,
        })
    for i in range(0, len(updates), 500):
        sb("POST", "grow_signals?on_conflict=id,scan_date", updates[i : i + 500], upsert=True)
    print(f"forward-graded {len(updates)} past {interval} signals")


def write(collected, universe_size, today, interval="1d", vix=None, sentiment=None):
    if not SUPABASE_URL or not SUPABASE_KEY:
        print(f"\nDRY RUN — no Supabase creds set. Top 20 ranked ({interval}):")
        for r in collected[:20]:
            print(f"  {str(r['confidence']).rjust(3)} {r['band'][:3]}  {r['symbol'].ljust(14)} {r['name']} ({r['direction']})")
        print(f"\n{len(collected)} recent (<= {RECENCY_MAX} bars) {interval} signals across {universe_size} names")
        return
    ids = [r["id"] for r in collected]
    print(f"writing {len(collected)} rows ({len(set(ids))} unique ids) for {today} {interval}")
    sb("DELETE", f"grow_signals?scan_date=eq.{today}&interval=eq.{interval}")
    for i in range(0, len(collected), 500):
        sb("POST", "grow_signals?on_conflict=id,scan_date", collected[i : i + 500], upsert=True)
    sb("POST", "grow_scans?on_conflict=scan_date,interval", {"scan_date": today, "interval": interval, "universe_size": universe_size, "signal_count": len(collected), "vix": vix, "sentiment": sentiment}, upsert=True)
    print(f"wrote {len(collected)} {interval} signals for {today} ({universe_size} names)")


def candle_rows(bhav_rows, date, interval="1d"):
    t = int(datetime.datetime(date.year, date.month, date.day).timestamp())
    return [{
        "symbol": r["symbol"], "interval": interval, "bar_time": t,
        "open": r["open"], "high": r["high"], "low": r["low"], "close": r["close"],
        "volume": r["volume"], "deliv_per": r.get("deliv_per"),
    } for r in bhav_rows]


def ingest_bhavcopy(interval="1d", max_back=7):
    from bhavcopy import fetch_bhavcopy
    d = datetime.date.today()
    rows, used = [], None
    for _ in range(max_back):
        if d.weekday() < 5:
            try:
                r = fetch_bhavcopy(d)
                if r:
                    rows, used = r, d
                    break
            except Exception as e:
                print(f"bhavcopy {d} failed: {e}")
        d -= datetime.timedelta(days=1)
    if not rows:
        print("bhavcopy ingest: no data found")
        return 0
    payload = candle_rows(rows, used, interval)
    if not (SUPABASE_URL and SUPABASE_KEY):
        print(f"DRY RUN — would upsert {len(payload)} candles for {used}")
        return len(payload)
    for i in range(0, len(payload), 500):
        sb("POST", "grow_candles?on_conflict=symbol,interval,bar_time", payload[i : i + 500], upsert=True)
    print(f"ingested {len(payload)} bhavcopy candles for {used}")
    return len(payload)


def _db_to_cache(rows, min_days=60, top=None):
    series = {}
    for r in rows:
        series.setdefault(r["symbol"], []).append({
            "time": int(r["bar_time"]), "open": float(r["open"]), "high": float(r["high"]),
            "low": float(r["low"]), "close": float(r["close"]), "volume": float(r["volume"] or 0),
        })
    cache = []
    for s, cs in series.items():
        cs.sort(key=lambda c: c["time"])
        if len(cs) >= min_days:
            cache.append((s, cs))
    if top:
        cache.sort(key=lambda x: sum(c["volume"] for c in x[1]), reverse=True)
        cache = cache[:top]
    return cache


def market_sentiment():
    try:
        candles = yahoo("^INDIAVIX", "1d", "1mo")
    except Exception:
        return None, None
    if not candles:
        return None, None
    vix = round(candles[-1]["close"], 2)
    regime = "fear" if vix > 20 else "calm" if vix < 14 else "normal"
    return vix, regime


def enrich_delivery(cache):
    try:
        from bhavcopy import latest_bhavcopy
        rows = latest_bhavcopy()
    except Exception as e:
        print(f"btst: bhavcopy delivery fetch failed ({e}); scanning without delivery filter")
        return 0
    if not rows:
        print("btst: no bhavcopy delivery data; scanning without delivery filter")
        return 0
    deliv = {r["symbol"]: r["deliv_per"] for r in rows if r.get("deliv_per") is not None}
    n = 0
    for sym, candles in cache:
        if candles and sym in deliv:
            candles[-1]["deliv_per"] = deliv[sym]
            n += 1
    print(f"btst: attached delivery % to {n} symbols' latest bar")
    return n


def load_candles_db(interval="1d", min_days=60, top=300):
    if not (SUPABASE_URL and SUPABASE_KEY):
        return []
    rows = sb_get(f"grow_candles?interval=eq.{interval}&select=symbol,bar_time,open,high,low,close,volume&order=bar_time.asc")
    cache = _db_to_cache(rows, min_days, top)
    if interval == "1d" and cache:
        from bhavcopy import fetch_corp_actions, adjust_candles
        actions = fetch_corp_actions()
        if actions:
            cache = [(sym, adjust_candles(cs, actions.get(sym, []))) for sym, cs in cache]
            print(f"corporate-action adjusted: {sum(len(v) for v in actions.values())} splits/bonuses across {len(actions)} symbols")
    return cache


def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    interval = "1d"
    if "--interval" in sys.argv:
        interval = sys.argv[sys.argv.index("--interval") + 1]
    if "--ingest" in sys.argv:
        ingest_bhavcopy(interval)
        return
    if interval not in INTERVAL_RANGE:
        supported = ", ".join(INTERVAL_RANGE)
        print(f"unsupported interval '{interval}'. Yahoo supports: {supported}.")
        print("Sub-minute bars (1s) are not available from Yahoo — they need the production feed.")
        sys.exit(1)
    rng = INTERVAL_RANGE[interval]
    if "--range" in sys.argv:
        rng = sys.argv[sys.argv.index("--range") + 1]
    long_only = "--allow-shorts" not in sys.argv
    source = sys.argv[sys.argv.index("--source") + 1] if "--source" in sys.argv else "yahoo"
    mode = "btst" if "--btst" in sys.argv else None
    scan_interval = "btst" if mode == "btst" else interval
    grade_opts = {"horizon": 1, "exit": "nextday"} if mode == "btst" else None
    today = datetime.date.today().isoformat()
    if source == "db":
        cache = load_candles_db(interval, top=300)
        universe = [s for s, _ in cache]
        print(f"source: bhavcopy DB store · {len(cache)} symbols · {scan_interval} · {'long-only' if long_only else 'long+short'}")
    else:
        universe = load_universe()
        cache = fetch_all(universe, interval, rng, limit)
        print(f"universe: {len(universe)} · fetched {len(cache)} · {scan_interval} · {rng} · {'long-only' if long_only else 'long+short'}")
    if not cache:
        print("no candles to scan")
        return
    if mode == "btst" and source != "db":
        enrich_delivery(cache)
    pooled = pooled_reliabilities(cache, grade_opts=grade_opts, mode=mode)
    print("pooled reliabilities:", {t: round(r, 2) for t, r in sorted(pooled.items(), key=lambda x: -x[1])})
    collected = collect_signals(cache, today, pooled, scan_interval, long_only=long_only, mode=mode)
    collected.sort(key=lambda r: (BANDRANK[r["band"]], r["confidence"], r["liquidity"]), reverse=True)
    seen = set()
    unique = []
    for r in collected:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        unique.append(r)
    collected = unique[:200]
    vix, sentiment = market_sentiment()
    if vix is not None:
        print(f"market sentiment: {sentiment} (India VIX {vix})")
    write(collected, len(universe), today, scan_interval, vix, sentiment)
    grade_past(cache, today, scan_interval, grade_opts)


if __name__ == "__main__":
    main()
