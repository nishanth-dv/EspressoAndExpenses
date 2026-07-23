import datetime

from bhavcopy import parse_bhavcopy, bhavcopy_universe, assemble_history, bhavcopy_url

SAMPLE = """SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
RELIANCE, EQ, 01-Jan-2024, 100, 101, 105, 99, 104, 104, 102, 1000000, 10200.50, 5000, 600000, 60
TCS, EQ, 01-Jan-2024, 200, 201, 203, 198, 202, 202, 201, 500000, 10050.00, 3000, 300000, 60
GOLDBEES, EQ, 01-Jan-2024, 50, 50, 51, 49, 50, 50, 50, 200000, 100.00, 900, 100000, 50
SOMEBOND, N1, 01-Jan-2024, 100, 100, 100, 100, 100, 100, 100, 10, 1, 1, 1, 10
BADROW, EQ, 01-Jan-2024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -"""

rows = parse_bhavcopy(SAMPLE)
assert len(rows) == 3, "3 EQ rows; N1 series and zero-price row dropped"
syms = {r["symbol"] for r in rows}
assert syms == {"RELIANCE.NS", "TCS.NS", "GOLDBEES.NS"}, "symbols get .NS suffix"
rel = next(r for r in rows if r["symbol"] == "RELIANCE.NS")
assert (rel["open"], rel["high"], rel["low"], rel["close"]) == (101.0, 105.0, 99.0, 104.0), "OHLC parsed"
assert rel["volume"] == 1000000.0 and rel["turnover"] == 10200.5, "volume + turnover parsed"
assert rel["deliv_per"] == 60.0, "delivery percent parsed (for BTST later)"

badrow_symbols = [r for r in parse_bhavcopy(SAMPLE) if r["symbol"] == "BADROW.NS"]
assert not badrow_symbols, "zero-price row excluded"

uni = bhavcopy_universe(top=2, rows=rows)
assert uni == ["RELIANCE.NS", "TCS.NS"], "universe ranked by turnover, top-N"

assert bhavcopy_url(datetime.date(2024, 1, 5)).endswith("sec_bhavdata_full_05012024.csv"), "DDMMYYYY url"

print("ok — bhavcopy parse / universe / url")

d1 = datetime.date(2024, 1, 1)
d2 = datetime.date(2024, 1, 2)
rows2 = parse_bhavcopy(SAMPLE.replace("01-Jan-2024", "02-Jan-2024").replace("104", "106"))
cache = assemble_history([(d1, rows), (d2, rows2)], min_days=2)
assert {sym for sym, _ in cache} == {"RELIANCE.NS", "TCS.NS", "GOLDBEES.NS"}, "history pivots per symbol"
rel_series = next(cs for sym, cs in cache if sym == "RELIANCE.NS")
assert len(rel_series) == 2 and rel_series[0]["time"] < rel_series[1]["time"], "series assembled, time-sorted"

thin = assemble_history([(d1, rows)], min_days=2)
assert thin == [], "symbols below min_days are dropped"

topped = assemble_history([(d1, rows), (d2, rows2)], min_days=2, top=1)
assert len(topped) == 1 and topped[0][0] == "RELIANCE.NS", "top-N keeps highest-volume names"

print("ok — bhavcopy history assembly (point-in-time, survivorship-free)")

from batch import candle_rows, _db_to_cache

cr = candle_rows(rows, datetime.date(2024, 1, 3), "1d")
assert len(cr) == 3, "one candle row per EQ symbol"
t = int(datetime.datetime(2024, 1, 3).timestamp())
assert all(x["bar_time"] == t and x["interval"] == "1d" for x in cr), "date -> bar_time, interval tagged"
relcr = next(x for x in cr if x["symbol"] == "RELIANCE.NS")
assert relcr["close"] == 104.0 and relcr["deliv_per"] == 60.0, "OHLC + delivery carried to the store"

dbrows = [{"symbol": "A.NS", "bar_time": 1000 + i * 86400, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 100 + i} for i in range(70)]
dbrows += [{"symbol": "B.NS", "bar_time": 1000 + i * 86400, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 1} for i in range(40)]
cache = _db_to_cache(dbrows, min_days=60)
assert [s for s, _ in cache] == ["A.NS"], "symbols below min_days dropped"
assert len(cache[0][1]) == 70 and cache[0][1][0]["time"] < cache[0][1][-1]["time"], "series time-sorted"
topped = _db_to_cache(dbrows, min_days=30, top=1)
assert topped[0][0] == "A.NS", "top-N by volume"

print("ok — candle store transforms (bhavcopy -> rows, db -> cache)")

from bhavcopy import parse_corp_action, adjust_candles

assert abs(parse_corp_action("Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share") - 0.2) < 1e-9, "split 10->2 = 0.2 factor"
assert abs(parse_corp_action("Bonus 1:1") - 0.5) < 1e-9, "bonus 1:1 halves"
assert abs(parse_corp_action("Bonus issue in the ratio 1:2") - (2 / 3)) < 1e-9, "bonus 1:2"
assert parse_corp_action("Dividend - Rs 5 Per Share") is None, "dividend is not a price split"
assert parse_corp_action("Annual General Meeting") is None, "non-CA subject -> None"

DAY = 86400
raw = [
    {"time": 100 * DAY, "open": 200, "high": 204, "low": 196, "close": 200, "volume": 1000},
    {"time": 120 * DAY, "open": 200, "high": 204, "low": 196, "close": 200, "volume": 1000},
    {"time": 200 * DAY, "open": 100, "high": 102, "low": 98, "close": 100, "volume": 2000},
]
adj = adjust_candles(raw, [(150 * DAY, 0.5)])
assert abs(adj[0]["close"] - 100) < 1e-9 and abs(adj[1]["close"] - 100) < 1e-9, "pre-ex bars halved (bonus 1:1)"
assert abs(adj[0]["volume"] - 2000) < 1e-9, "pre-ex volume scaled inversely"
assert abs(adj[2]["close"] - 100) < 1e-9 and adj[2]["volume"] == 2000, "post-ex bar unchanged"
assert adjust_candles(raw, []) == raw, "no actions -> unchanged"

print("ok — corporate-action parse + back-adjustment")
