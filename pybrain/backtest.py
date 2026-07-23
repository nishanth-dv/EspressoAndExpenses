import sys
from collections import defaultdict

from engine import run_signals, atr_series, grade_signal, detect_all, btst_signals, pivots, rsi_series, sma, SUPPRESSED_TYPES
from batch import load_universe, fetch_all, pooled_reliabilities, INTERVAL_RANGE


def pooled_expectancy(cache, grade_opts=None, k=20, mode=None):
    by_type = {}
    tot_ret = 0.0
    tot_n = 0
    for _sym, candles in cache:
        closes = [c["close"] for c in candles]
        rsi = rsi_series(closes, 14)
        piv = pivots(candles, 3, 3)
        raw = btst_signals(candles, closes) if mode == "btst" else detect_all(candles, closes, rsi, piv)
        idx = {c["time"]: i for i, c in enumerate(candles)}
        atr = atr_series(candles, 14)
        for s in raw:
            g = grade_signal(s, candles, idx, {**(grade_opts or {}), "atr": atr})
            if g["status"] == "pending":
                continue
            e = by_type.setdefault(s["type"], [0.0, 0])
            e[0] += g["returnPct"]
            e[1] += 1
            tot_ret += g["returnPct"]
            tot_n += 1
    gm = tot_ret / tot_n if tot_n else 0.0
    return {t: (sr + k * gm) / (n + k) for t, (sr, n) in by_type.items()}


def _rank(vals):
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    ranks = [0] * len(vals)
    for r, i in enumerate(order):
        ranks[i] = r
    return ranks


def spearman(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0
    rx, ry = _rank(xs), _rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    den = (sum((rx[i] - mx) ** 2 for i in range(n)) * sum((ry[i] - my) ** 2 for i in range(n))) ** 0.5
    return num / den if den else 0.0


def grade_all(cache, reliabilities, interval, grade_opts=None, include_suppressed=False, split=None, trend_filter=False, long_only=False, mode=None):
    rows = []
    for sym, candles in cache:
        cut = int(len(candles) * split) if split else 0
        closes = [c["close"] for c in candles]
        rep = run_signals(candles, {
            "symbol": sym, "interval": interval, "timeframe": interval,
            "reliabilities": reliabilities, "includeSuppressed": include_suppressed,
            "trendFilter": trend_filter, "longOnly": long_only, "mode": mode,
        })
        idx = {c["time"]: i for i, c in enumerate(candles)}
        atr = atr_series(candles, 14)
        for s in rep["signals"]:
            i = idx.get(s["time"], 0)
            if i < cut:
                continue
            oc = grade_signal(s, candles, idx, {**(grade_opts or {}), "atr": atr})
            if oc["status"] == "pending":
                continue
            m200 = sma(closes, 200, i)
            regime = "n/a" if m200 is None else ("up" if closes[i] > m200 else "down")
            rows.append({
                "type": s["type"],
                "band": s["confidenceBreakdown"]["band"],
                "direction": s["direction"],
                "confidence": s["confidence"],
                "status": oc["status"],
                "ret": oc["returnPct"],
                "bars": oc["bars"],
                "regime": regime,
            })
    return rows


def agg(rows):
    n = len(rows)
    if n == 0:
        return {"n": 0, "hit": 0.0, "exp": 0.0, "avg_win": 0.0, "avg_loss": 0.0, "payoff": 0.0, "bars": 0.0}
    wins = [r for r in rows if r["status"] == "win"]
    losses = [r for r in rows if r["status"] == "loss"]
    aw = sum(r["ret"] for r in wins) / len(wins) if wins else 0.0
    al = sum(r["ret"] for r in losses) / len(losses) if losses else 0.0
    return {
        "n": n,
        "hit": len(wins) / n,
        "exp": sum(r["ret"] for r in rows) / n,
        "avg_win": aw,
        "avg_loss": al,
        "payoff": (aw / abs(al)) if al else 0.0,
        "bars": sum(r["bars"] for r in rows) / n,
    }


def group(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[r[key]].append(r)
    return g


def summarize(rows):
    return {
        "overall": agg(rows),
        "by_type": {k: agg(v) for k, v in group(rows, "type").items()},
        "by_band": {k: agg(v) for k, v in group(rows, "band").items()},
        "by_direction": {k: agg(v) for k, v in group(rows, "direction").items()},
    }


def evaluate(cache, interval="1d", grade_opts=None, include_suppressed=False, mode=None):
    reliabilities = pooled_reliabilities(cache, grade_opts=grade_opts, mode=mode)
    rows = grade_all(cache, reliabilities, interval, grade_opts, include_suppressed, mode=mode)
    return {**summarize(rows), "reliabilities": reliabilities, "rows": rows}


def evaluate_walkforward(cache, interval="1d", split=0.7, grade_opts=None, include_suppressed=False, trend_filter=False, long_only=False, mode=None):
    train_cache = []
    for sym, candles in cache:
        cut = int(len(candles) * split)
        if cut >= 30:
            train_cache.append((sym, candles[:cut]))
    reliabilities = pooled_reliabilities(train_cache, grade_opts=grade_opts, mode=mode)
    train_exp = pooled_expectancy(train_cache, grade_opts=grade_opts, mode=mode)
    rows = grade_all(cache, reliabilities, interval, grade_opts, include_suppressed, split=split, trend_filter=trend_filter, long_only=long_only, mode=mode)
    for r in rows:
        r["train_exp"] = train_exp.get(r["type"], 0.0)
    return {**summarize(rows), "reliabilities": reliabilities, "train_exp": train_exp, "rows": rows}


def pct(x):
    return f"{x * 100:5.1f}%"


def calibration_ok(by_band):
    hits = [by_band[b]["hit"] for b in ("high", "moderate", "low") if by_band.get(b, {}).get("n", 0) > 0]
    return all(hits[i] >= hits[i + 1] for i in range(len(hits) - 1))


def line(label, a):
    return (f"{label} {str(a['n']).rjust(6)} trades · hit {pct(a['hit'])} · exp {pct(a['exp'])}/trade"
            f" · payoff {a['payoff']:.2f} · avg win {pct(a['avg_win'])} · avg loss {pct(a['avg_loss'])}")


def report(all_rows, interval, nsym, header="BACKTEST"):
    gated_rows = [r for r in all_rows if r["type"] not in SUPPRESSED_TYPES]
    print(f"\n{header} — {interval} · {nsym} symbols")
    print(line("BEFORE (all patterns) ", agg(all_rows)))
    print(line("AFTER  (gated)        ", agg(gated_rows)))

    g = summarize(gated_rows)
    print("\n-- gated: confidence calibration (hit rate should fall high > moderate > low) --")
    for b in ("high", "moderate", "low"):
        a = g["by_band"].get(b)
        if a and a["n"]:
            print(f"  {b.ljust(9)} hit {pct(a['hit'])}  exp {pct(a['exp'])}  n={str(a['n']).rjust(5)}")
    print(f"  -> confidence {'IS monotonic (calibrated)' if calibration_ok(g['by_band']) else 'is NOT monotonic (miscalibrated)'}")

    print("\n-- gated: by direction --")
    for d in ("bullish", "bearish"):
        a = g["by_direction"].get(d)
        if a and a["n"]:
            print(f"  {d.ljust(8)} hit {pct(a['hit'])}  exp {pct(a['exp'])}  n={str(a['n']).rjust(5)}")

    print("\n-- gated: by market regime (symbol vs its 200-DMA at entry — does the edge survive downtrends?) --")
    for rg in ("up", "down", "n/a"):
        a = agg([r for r in gated_rows if r.get("regime") == rg])
        if a["n"]:
            label = {"up": "uptrend", "down": "downtrend", "n/a": "no-200DMA"}[rg]
            print(f"  {label.ljust(10)} exp {pct(a['exp'])}  hit {pct(a['hit'])}  n={str(a['n']).rjust(6)}")

    print("\n-- by pattern (all, sorted by expectancy; (GATED) = suppressed from calls) --")
    by_type = {k: agg(v) for k, v in group(all_rows, "type").items()}
    for t, a in sorted(by_type.items(), key=lambda x: -x[1]["exp"]):
        mark = " (GATED)" if t in SUPPRESSED_TYPES else ""
        print(f"  exp {pct(a['exp'])}  hit {pct(a['hit'])}  payoff {a['payoff']:.2f}  n={str(a['n']).rjust(4)}  {t}{mark}")


def report_ranking(wf, min_n=20):
    rows = wf["rows"]
    train_exp = wf["train_exp"]
    by_type = group(rows, "type")
    tbl = sorted(
        [(t, train_exp.get(t, 0.0), agg(rs)["exp"], len(rs)) for t, rs in by_type.items()],
        key=lambda x: -x[1],
    )
    print("\n-- rank generalization: TRAIN pattern expectancy -> OUT-OF-SAMPLE expectancy (sorted by train) --")
    for t, te, oe, n in tbl:
        gate = " (GATED)" if t in SUPPRESSED_TYPES else ""
        print(f"  train {pct(te)}  ->  OOS {pct(oe)}   n={str(n).rjust(4)}  {t}{gate}")

    sig = [(te, oe) for _t, te, oe, n in tbl if n >= min_n]
    if len(sig) >= 3:
        rho = spearman([x[0] for x in sig], [x[1] for x in sig])
        verdict = "GENERALIZES" if rho >= 0.4 else "weak" if rho >= 0.2 else "does NOT generalize"
        print(f"  -> Spearman(train_exp, OOS_exp) over {len(sig)} patterns (n>={min_n}) = {rho:+.2f}  [{verdict}]")

    vals = sorted(r["train_exp"] for r in rows)
    if vals:
        lo, hi = vals[len(vals) // 3], vals[2 * len(vals) // 3]
        tiers = [
            ("T1 (best train)", [r for r in rows if r["train_exp"] >= hi]),
            ("T2 (mid)", [r for r in rows if lo <= r["train_exp"] < hi]),
            ("T3 (worst train)", [r for r in rows if r["train_exp"] < lo]),
        ]
        print("\n-- OOS by train-expectancy tercile (should fall T1 > T2 > T3) --")
        exps = []
        for label, rs in tiers:
            a = agg(rs)
            exps.append(a["exp"])
            print(f"  {label.ljust(18)} OOS exp {pct(a['exp'])}  hit {pct(a['hit'])}  n={str(a['n']).rjust(5)}")
        mono = exps[0] >= exps[1] >= exps[2]
        print(f"  -> train-expectancy ranking is {'MONOTONIC out-of-sample' if mono else 'not monotonic out-of-sample'}")


def main():
    interval = "1d"
    limit = None
    split = 0.7
    if "--interval" in sys.argv:
        interval = sys.argv[sys.argv.index("--interval") + 1]
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    if "--split" in sys.argv:
        split = float(sys.argv[sys.argv.index("--split") + 1])
    walkforward = "--walkforward" in sys.argv
    if interval not in INTERVAL_RANGE:
        print(f"unsupported interval '{interval}'. Supported: {', '.join(INTERVAL_RANGE)}.")
        sys.exit(1)
    rng = INTERVAL_RANGE[interval]
    if "--range" in sys.argv:
        rng = sys.argv[sys.argv.index("--range") + 1]
    universe = load_universe()
    print(f"universe: {len(universe)} symbols · interval {interval} · range {rng}")
    cache = fetch_all(universe, interval, rng, limit)
    print(f"fetched {len(cache)} symbols")

    if "--btst" in sys.argv:
        opts = {"horizon": 1, "exit": "nextday"}
        if walkforward:
            wf = evaluate_walkforward(cache, "btst", split, grade_opts=opts, mode="btst")
            report(wf["rows"], "btst", len(cache), header=f"BTST OUT-OF-SAMPLE (next-day exit · {int(split * 100)}/{int((1 - split) * 100)})")
        else:
            res = evaluate(cache, "btst", grade_opts=opts, mode="btst")
            report(res["rows"], "btst", len(cache), header="BTST IN-SAMPLE (next-day exit)")
        return

    trendfilter = "--trendfilter" in sys.argv
    if not walkforward:
        res = evaluate(cache, interval, include_suppressed=True)
        report(res["rows"], interval, len(cache), header="IN-SAMPLE")
        return

    longonly = "--longonly" in sys.argv
    train_cache = [(sym, candles[: int(len(candles) * split)]) for sym, candles in cache if int(len(candles) * split) >= 30]
    reliabilities = pooled_reliabilities(train_cache)
    train_exp = pooled_expectancy(train_cache)

    def wf_rows(tf=False, lo=False):
        rows = grade_all(cache, reliabilities, interval, None, True, split=split, trend_filter=tf, long_only=lo)
        for r in rows:
            r["train_exp"] = train_exp.get(r["type"], 0.0)
        return rows

    span = f"train {int(split * 100)}% / test {int((1 - split) * 100)}%"
    rows_off = wf_rows()
    if not (trendfilter or longonly):
        report(rows_off, interval, len(cache), header=f"OUT-OF-SAMPLE ({span})")
        report_ranking({"rows": rows_off, "train_exp": train_exp})
        return

    mods = ([" trend-filter"] if trendfilter else []) + ([" long-only"] if longonly else [])
    label = "+".join(m.strip() for m in mods)
    rows_on = wf_rows(tf=trendfilter, lo=longonly)
    g_off = [r for r in rows_off if r["type"] not in SUPPRESSED_TYPES]
    g_on = [r for r in rows_on if r["type"] not in SUPPRESSED_TYPES]
    print(f"\n=== BASELINE vs {label.upper()} (out-of-sample, gated · {span}) ===")
    print(line("baseline    ", agg(g_off)))
    print(line((label + " ").ljust(12), agg(g_on)))
    print("\n-- by direction --")
    for lbl, rs in (("base", g_off), ("mod ", g_on)):
        for d in ("bullish", "bearish"):
            a = agg([r for r in rs if r["direction"] == d])
            print(f"  {lbl} {d.ljust(8)} exp {pct(a['exp'])}  hit {pct(a['hit'])}  n={str(a['n']).rjust(6)}")
    report(rows_on, interval, len(cache), header=f"OUT-OF-SAMPLE ({label})")
    report_ranking({"rows": rows_on, "train_exp": train_exp})


if __name__ == "__main__":
    main()
