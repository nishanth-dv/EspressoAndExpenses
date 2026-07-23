import csv
import datetime
import http.cookiejar
import io
import json
import re
import time
import urllib.request

BASE = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{date}.csv"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Accept": "text/csv,application/csv,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
_JAR = http.cookiejar.CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))
_primed = False


def _prime():
    global _primed
    if _primed:
        return
    try:
        _OPENER.open(urllib.request.Request("https://www.nseindia.com/", headers=_HEADERS), timeout=20).read()
        _primed = True
    except Exception:
        pass


def _nse_get(url):
    _prime()
    req = urllib.request.Request(url, headers=_HEADERS)
    with _OPENER.open(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def _f(x):
    try:
        return float(str(x).strip())
    except (TypeError, ValueError):
        return None


def parse_bhavcopy(text, series=("EQ",)):
    out = []
    for raw in csv.DictReader(io.StringIO(text)):
        r = {(k.strip() if k else k): (v.strip() if isinstance(v, str) else v) for k, v in raw.items()}
        if r.get("SERIES") not in series:
            continue
        o, h, l, c = _f(r.get("OPEN_PRICE")), _f(r.get("HIGH_PRICE")), _f(r.get("LOW_PRICE")), _f(r.get("CLOSE_PRICE"))
        if None in (o, h, l, c) or not (o > 0 and h > 0 and l > 0 and c > 0):
            continue
        out.append({
            "symbol": r["SYMBOL"].strip() + ".NS",
            "open": o, "high": h, "low": l, "close": c,
            "volume": _f(r.get("TTL_TRD_QNTY")) or 0,
            "turnover": _f(r.get("TURNOVER_LACS")) or 0,
            "deliv_per": _f(r.get("DELIV_PER")),
        })
    return out


def bhavcopy_url(date):
    return BASE.format(date=date.strftime("%d%m%Y"))


def fetch_bhavcopy(date):
    return parse_bhavcopy(_nse_get(bhavcopy_url(date)))


def latest_bhavcopy(max_back=7):
    d = datetime.date.today()
    for _ in range(max_back):
        if d.weekday() < 5:
            try:
                rows = fetch_bhavcopy(d)
                if rows:
                    return rows
            except Exception:
                pass
        d -= datetime.timedelta(days=1)
    return []


def bhavcopy_universe(top=300, rows=None):
    rows = rows if rows is not None else latest_bhavcopy()
    ranked = sorted(rows, key=lambda r: r.get("turnover") or 0, reverse=True)
    return [r["symbol"] for r in ranked[:top]]


def assemble_history(daily, min_days=30, top=None):
    series = {}
    for d, rows in daily:
        t = int(datetime.datetime(d.year, d.month, d.day).timestamp())
        for r in rows:
            series.setdefault(r["symbol"], []).append({
                "time": t, "open": r["open"], "high": r["high"], "low": r["low"], "close": r["close"], "volume": r["volume"],
            })
    cache = []
    for sym, cs in series.items():
        cs.sort(key=lambda c: c["time"])
        if len(cs) >= min_days:
            cache.append((sym, cs))
    if top:
        cache.sort(key=lambda x: sum(c["volume"] for c in x[1]), reverse=True)
        cache = cache[:top]
    return cache


def build_history(days_back=120, end=None, min_days=30, top=None, sleep=0.4):
    end = end or datetime.date.today()
    daily = []
    d = end
    fetched = 0
    misses = 0
    while fetched < days_back and misses < days_back:
        if d.weekday() < 5:
            try:
                rows = fetch_bhavcopy(d)
                if rows:
                    daily.append((d, rows))
                    fetched += 1
                else:
                    misses += 1
                time.sleep(sleep)
            except Exception:
                misses += 1
        d -= datetime.timedelta(days=1)
    return assemble_history(daily, min_days=min_days, top=top)


def parse_corp_action(subject):
    s = (subject or "").lower()
    if "split" in s or "sub-division" in s or "sub division" in s:
        m = re.search(r"from\s*rs\.?\s*([\d.]+).*?to\s*rs\.?\s*([\d.]+)", s)
        if m:
            old_fv, new_fv = float(m.group(1)), float(m.group(2))
            if old_fv > 0 and new_fv > 0:
                return new_fv / old_fv
    if "bonus" in s:
        b = re.search(r"(\d+)\s*:\s*(\d+)", s)
        if b:
            new_sh, held = float(b.group(1)), float(b.group(2))
            if new_sh + held > 0:
                return held / (new_sh + held)
    return None


def fetch_corp_actions(from_date=None, to_date=None):
    to_d = to_date or datetime.date.today()
    from_d = from_date or (to_d - datetime.timedelta(days=1500))
    url = (
        "https://www.nseindia.com/api/corporates-corporateActions?index=equities"
        f"&from_date={from_d.strftime('%d-%m-%Y')}&to_date={to_d.strftime('%d-%m-%Y')}"
    )
    try:
        data = json.loads(_nse_get(url))
    except Exception:
        return {}
    records = data if isinstance(data, list) else (data.get("data") or [])
    out = {}
    for r in records:
        sym = (r.get("symbol") or "").strip()
        subject = r.get("subject") or r.get("purpose") or ""
        ex = r.get("exDate") or r.get("ex_date") or ""
        factor = parse_corp_action(subject)
        if not sym or factor is None or not ex:
            continue
        try:
            ex_dt = datetime.datetime.strptime(ex.strip(), "%d-%b-%Y")
        except ValueError:
            continue
        key = (int(ex_dt.timestamp()), factor)
        lst = out.setdefault(sym + ".NS", [])
        if key not in lst:
            lst.append(key)
    return out


def adjust_candles(candles, actions):
    if not actions:
        return candles
    acts = sorted(actions, key=lambda a: a[0])
    out = []
    for c in candles:
        f = 1.0
        for ex_t, fac in acts:
            if c["time"] < ex_t:
                f *= fac
        if f == 1.0:
            out.append(c)
            continue
        adj = dict(c)
        for k in ("open", "high", "low", "close"):
            if adj.get(k) is not None:
                adj[k] = adj[k] * f
        if adj.get("volume"):
            adj["volume"] = adj["volume"] / f
        out.append(adj)
    return out


if __name__ == "__main__":
    u = bhavcopy_universe(top=20)
    print(f"bhavcopy universe (top 20 by turnover): {len(u)} names")
    for s in u:
        print("  " + s)
