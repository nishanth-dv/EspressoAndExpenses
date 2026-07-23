import assert from "node:assert";
import { readWatchlist, isWatched, toggleWatch, watchlistMatches } from "./watchlist.js";

assert.deepStrictEqual(readWatchlist(null), [], "missing prefs -> empty");
assert.deepStrictEqual(readWatchlist({ growWatchlist: "x" }), [], "non-array -> empty");
assert.deepStrictEqual(readWatchlist({ growWatchlist: ["A.NS"] }), ["A.NS"]);

const p0 = {};
assert.strictEqual(isWatched(p0, "A.NS"), false);
const p1 = { growWatchlist: toggleWatch(p0, "A.NS") };
assert.deepStrictEqual(p1.growWatchlist, ["A.NS"], "toggle adds");
assert.strictEqual(isWatched(p1, "A.NS"), true);
const p2 = { growWatchlist: toggleWatch(p1, "A.NS") };
assert.deepStrictEqual(p2.growWatchlist, [], "toggle removes");

const sigs = [
  { symbol: "A.NS", symbol_name: "A" },
  { symbol: "B.NS", symbol_name: "B" },
  { symbol: "C.NS", symbol_name: "C" },
];
assert.deepStrictEqual(watchlistMatches(sigs, []), [], "empty watchlist -> no matches");
assert.deepStrictEqual(
  watchlistMatches(sigs, ["A.NS", "C.NS"]).map((s) => s.symbol),
  ["A.NS", "C.NS"],
  "matches only watched symbols",
);
assert.deepStrictEqual(watchlistMatches(null, ["A.NS"]), [], "null signals -> empty");

console.log("ok — watchlist read/toggle/matches");
