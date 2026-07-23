export function readWatchlist(prefs) {
  const w = prefs?.growWatchlist;
  return Array.isArray(w) ? w : [];
}

export function isWatched(prefs, symbol) {
  return readWatchlist(prefs).includes(symbol);
}

export function toggleWatch(prefs, symbol) {
  const w = readWatchlist(prefs);
  return w.includes(symbol) ? w.filter((s) => s !== symbol) : [...w, symbol];
}

export function watchlistMatches(signals, watchlist) {
  if (!watchlist?.length) return [];
  const set = new Set(watchlist);
  return (signals ?? []).filter((s) => set.has(s.symbol));
}
