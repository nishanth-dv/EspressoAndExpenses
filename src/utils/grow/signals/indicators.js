export function sma(values, period, end) {
  if (end < period - 1) return null;
  let s = 0;
  for (let i = end - period + 1; i <= end; i++) s += values[i];
  return s / period;
}

export function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function avgBody(candles, end, period = 14) {
  const start = Math.max(0, end - period + 1);
  let s = 0;
  let n = 0;
  for (let i = start; i <= end; i++) {
    s += Math.abs(candles[i].close - candles[i].open);
    n++;
  }
  return n ? s / n : 0;
}

export function avgVolume(candles, end, period = 20) {
  const start = Math.max(0, end - period + 1);
  let s = 0;
  let n = 0;
  for (let i = start; i <= end; i++) {
    s += candles[i].volume || 0;
    n++;
  }
  return n ? s / n : 0;
}

export function trendAt(closes, i, look = 10, period = 20) {
  const now = sma(closes, period, i);
  const past = sma(closes, period, i - look);
  if (now == null || past == null || past === 0) return 0;
  return Math.max(-1, Math.min(1, ((now - past) / past) / 0.08));
}

export function pivots(candles, left = 3, right = 3) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let ph = true;
    let pl = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) ph = false;
      if (candles[j].low <= candles[i].low) pl = false;
    }
    if (ph) highs.push({ index: i, price: candles[i].high });
    if (pl) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}
