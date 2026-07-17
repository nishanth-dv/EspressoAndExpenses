import { CATEGORY, DIRECTION } from "./contract.js";
import { avgBody, avgVolume, trendAt } from "./indicators.js";
import { geometricSignals } from "./geometric.js";

const green = (c) => c.close > c.open;
const red = (c) => c.close < c.open;
const bodyOf = (c) => Math.abs(c.close - c.open);
const rangeOf = (c) => c.high - c.low || 1e-9;
const upperWick = (c) => c.high - Math.max(c.open, c.close);
const lowerWick = (c) => Math.min(c.open, c.close) - c.low;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

function volConfirm(candles, i) {
  const a = avgVolume(candles, i - 1, 20);
  if (!a) return 0;
  return clamp01(((candles[i].volume || 0) / a - 1) / 1.2);
}

function mk(candles, closes, i, s) {
  const t = trendAt(closes, i);
  const align = s.direction === DIRECTION.BEAR ? -t : t;
  return {
    type: s.type,
    name: s.name,
    category: s.category,
    direction: s.direction,
    time: candles[i].time,
    price: candles[i].close,
    title: s.title,
    code: s.code,
    meta: s.meta || {},
    factors: {
      baseReliability: s.baseReliability,
      signalStrength: clamp01(s.signalStrength),
      trendAlignment: align,
      volumeConfirm: volConfirm(candles, i),
    },
  };
}

function engulfing(candles, closes) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    const ab = avgBody(candles, i, 14) || rangeOf(c);
    const strength = clamp01(bodyOf(c) / (ab * 1.5));
    if (red(p) && green(c) && c.close >= p.open && c.open <= p.close && bodyOf(c) > bodyOf(p)) {
      out.push(mk(candles, closes, i, { type: "bullish_engulfing", name: "Bullish Engulfing", category: CATEGORY.CANDLESTICK, direction: DIRECTION.BULL, title: "Bullish Engulfing", code: "BE", baseReliability: 0.62, signalStrength: strength }));
    } else if (green(p) && red(c) && c.open >= p.close && c.close <= p.open && bodyOf(c) > bodyOf(p)) {
      out.push(mk(candles, closes, i, { type: "bearish_engulfing", name: "Bearish Engulfing", category: CATEGORY.CANDLESTICK, direction: DIRECTION.BEAR, title: "Bearish Engulfing", code: "BE", baseReliability: 0.62, signalStrength: strength }));
    }
  }
  return out;
}

function hammerStar(candles, closes) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const b = bodyOf(c) || rangeOf(c) * 0.05;
    const lw = lowerWick(c);
    const uw = upperWick(c);
    if (lw >= b * 2 && uw <= b * 0.6) {
      out.push(mk(candles, closes, i, { type: "hammer", name: "Hammer", category: CATEGORY.CANDLESTICK, direction: DIRECTION.BULL, title: "Hammer", code: "H", baseReliability: 0.55, signalStrength: clamp01(lw / rangeOf(c)) }));
    } else if (uw >= b * 2 && lw <= b * 0.6) {
      out.push(mk(candles, closes, i, { type: "shooting_star", name: "Shooting Star", category: CATEGORY.CANDLESTICK, direction: DIRECTION.BEAR, title: "Shooting Star", code: "SS", baseReliability: 0.55, signalStrength: clamp01(uw / rangeOf(c)) }));
    }
  }
  return out;
}

function stars(candles, closes) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const c = candles[i];
    const ab = avgBody(candles, i, 14) || rangeOf(c);
    const smallMid = bodyOf(b) < ab * 0.5;
    const mid = (a.open + a.close) / 2;
    if (red(a) && smallMid && green(c) && c.close > mid && bodyOf(a) > ab * 0.6) {
      out.push(mk(candles, closes, i, { type: "morning_star", name: "Morning Star", category: CATEGORY.CANDLESTICK, direction: DIRECTION.BULL, title: "Morning Star", code: "MS", baseReliability: 0.68, signalStrength: clamp01(bodyOf(c) / (ab * 1.5)) }));
    } else if (green(a) && smallMid && red(c) && c.close < mid && bodyOf(a) > ab * 0.6) {
      out.push(mk(candles, closes, i, { type: "evening_star", name: "Evening Star", category: CATEGORY.CANDLESTICK, direction: DIRECTION.BEAR, title: "Evening Star", code: "ES", baseReliability: 0.68, signalStrength: clamp01(bodyOf(c) / (ab * 1.5)) }));
    }
  }
  return out;
}

function rsiExtremes(candles, closes, rsi) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = rsi[i];
    const prev = rsi[i - 1];
    if (cur == null || prev == null) continue;
    if (cur < 30 && prev >= 30) {
      out.push(mk(candles, closes, i, { type: "rsi_oversold", name: "RSI Oversold", category: CATEGORY.INDICATOR, direction: DIRECTION.BULL, title: "RSI crossed into oversold", code: "RSI", baseReliability: 0.5, signalStrength: clamp01((30 - cur) / 15), meta: { rsi: Math.round(cur * 10) / 10 } }));
    } else if (cur > 70 && prev <= 70) {
      out.push(mk(candles, closes, i, { type: "rsi_overbought", name: "RSI Overbought", category: CATEGORY.INDICATOR, direction: DIRECTION.BEAR, title: "RSI crossed into overbought", code: "RSI", baseReliability: 0.5, signalStrength: clamp01((cur - 70) / 15), meta: { rsi: Math.round(cur * 10) / 10 } }));
    }
  }
  return out;
}

function levels(pivotArr, tol) {
  const sorted = [...pivotArr].sort((a, b) => a.price - b.price);
  const groups = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(p.price - g.price) / g.price <= tol) {
      g.price = (g.price * g.count + p.price) / (g.count + 1);
      g.count++;
    } else {
      groups.push({ price: p.price, count: 1 });
    }
  }
  return groups.filter((g) => g.count >= 2);
}

function supportResistance(candles, closes, piv) {
  const out = [];
  const sup = levels(piv.lows, 0.01);
  const res = levels(piv.highs, 0.01);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    for (const s of sup) {
      if (c.low <= s.price * 1.005 && c.low >= s.price * 0.985 && c.close > s.price) {
        out.push(mk(candles, closes, i, { type: "support_bounce", name: "Support Bounce", category: CATEGORY.STRUCTURE, direction: DIRECTION.BULL, title: `Bounce off ₹${Math.round(s.price)} support`, code: "S", baseReliability: 0.58, signalStrength: clamp01(s.count / 4), meta: { level: Math.round(s.price) } }));
        break;
      }
    }
    for (const s of res) {
      if (c.high >= s.price * 0.995 && c.high <= s.price * 1.015 && c.close < s.price) {
        out.push(mk(candles, closes, i, { type: "resistance_reject", name: "Resistance Rejection", category: CATEGORY.STRUCTURE, direction: DIRECTION.BEAR, title: `Rejected at ₹${Math.round(s.price)} resistance`, code: "R", baseReliability: 0.58, signalStrength: clamp01(s.count / 4), meta: { level: Math.round(s.price) } }));
        break;
      }
    }
  }
  return out;
}

function breakout(candles, closes, look = 20) {
  const out = [];
  for (let i = look; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - look; j < i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    const c = candles[i];
    const v = volConfirm(candles, i);
    if (c.close > hi) {
      out.push(mk(candles, closes, i, { type: "breakout", name: "Range Breakout", category: CATEGORY.STRUCTURE, direction: DIRECTION.BULL, title: `Broke above ${look}-bar high`, code: "BO", baseReliability: 0.6, signalStrength: clamp01((c.close / hi - 1) / 0.03 * 0.6 + v * 0.4), meta: { level: Math.round(hi) } }));
    } else if (c.close < lo) {
      out.push(mk(candles, closes, i, { type: "breakdown", name: "Range Breakdown", category: CATEGORY.STRUCTURE, direction: DIRECTION.BEAR, title: `Broke below ${look}-bar low`, code: "BD", baseReliability: 0.6, signalStrength: clamp01((1 - c.close / lo) / 0.03 * 0.6 + v * 0.4), meta: { level: Math.round(lo) } }));
    }
  }
  return out;
}

export function detectAll(candles, closes, helpers) {
  return [
    ...engulfing(candles, closes),
    ...hammerStar(candles, closes),
    ...stars(candles, closes),
    ...rsiExtremes(candles, closes, helpers.rsi),
    ...supportResistance(candles, closes, helpers.piv),
    ...breakout(candles, closes),
    ...geometricSignals(candles, closes, helpers.piv),
  ];
}
