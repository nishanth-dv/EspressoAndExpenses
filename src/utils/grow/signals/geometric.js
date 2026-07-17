import { CATEGORY, DIRECTION } from "./contract.js";
import { trendAt, avgVolume } from "./indicators.js";

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function volConfirm(candles, i) {
  const a = avgVolume(candles, i - 1, 20);
  if (!a) return 0;
  return clamp01(((candles[i].volume || 0) / a - 1) / 1.2);
}

function mkAt(candles, closes, i, s) {
  const t = trendAt(closes, i);
  const align = s.direction === DIRECTION.BEAR ? -t : t;
  return {
    type: s.type,
    name: s.name,
    category: CATEGORY.CHART,
    direction: s.direction,
    time: candles[i].time,
    price: candles[i].close,
    title: s.title,
    code: s.code,
    fromTime: s.fromTime,
    toTime: candles[i].time,
    meta: s.meta || {},
    factors: {
      baseReliability: s.baseReliability,
      signalStrength: clamp01(s.signalStrength),
      trendAlignment: align,
      volumeConfirm: volConfirm(candles, i),
    },
  };
}

function firstCloseAbove(candles, start, level) {
  for (let i = start; i < candles.length; i++) if (candles[i].close > level) return i;
  return -1;
}
function firstCloseBelow(candles, start, level) {
  for (let i = start; i < candles.length; i++) if (candles[i].close < level) return i;
  return -1;
}
function maxHighBetween(candles, a, b) {
  let m = -Infinity;
  for (let i = a; i <= b; i++) m = Math.max(m, candles[i].high);
  return m;
}
function minLowBetween(candles, a, b) {
  let m = Infinity;
  for (let i = a; i <= b; i++) m = Math.min(m, candles[i].low);
  return m;
}

function doubleBottoms(candles, closes, lows) {
  const out = [];
  for (let k = 1; k < lows.length; k++) {
    const a = lows[k - 1];
    const b = lows[k];
    const gap = b.index - a.index;
    if (gap < 5 || gap > 80) continue;
    const diff = Math.abs(a.price - b.price) / Math.min(a.price, b.price);
    if (diff > 0.03) continue;
    const neck = maxHighBetween(candles, a.index, b.index);
    const conf = firstCloseAbove(candles, b.index + 1, neck);
    if (conf < 0) continue;
    out.push(
      mkAt(candles, closes, conf, {
        type: "double_bottom",
        name: "Double Bottom",
        direction: DIRECTION.BULL,
        title: `Double bottom near ₹${Math.round((a.price + b.price) / 2)}`,
        code: "W",
        fromTime: candles[a.index].time,
        baseReliability: 0.62,
        signalStrength: (1 - diff / 0.03) * 0.6 + ((candles[conf].close / neck - 1) / 0.03) * 0.4,
        meta: { level: Math.round((a.price + b.price) / 2) },
      }),
    );
    k++;
  }
  return out;
}

function doubleTops(candles, closes, highs) {
  const out = [];
  for (let k = 1; k < highs.length; k++) {
    const a = highs[k - 1];
    const b = highs[k];
    const gap = b.index - a.index;
    if (gap < 5 || gap > 80) continue;
    const diff = Math.abs(a.price - b.price) / Math.min(a.price, b.price);
    if (diff > 0.03) continue;
    const neck = minLowBetween(candles, a.index, b.index);
    const conf = firstCloseBelow(candles, b.index + 1, neck);
    if (conf < 0) continue;
    out.push(
      mkAt(candles, closes, conf, {
        type: "double_top",
        name: "Double Top",
        direction: DIRECTION.BEAR,
        title: `Double top near ₹${Math.round((a.price + b.price) / 2)}`,
        code: "M",
        fromTime: candles[a.index].time,
        baseReliability: 0.62,
        signalStrength: (1 - diff / 0.03) * 0.6 + ((1 - candles[conf].close / neck) / 0.03) * 0.4,
        meta: { level: Math.round((a.price + b.price) / 2) },
      }),
    );
    k++;
  }
  return out;
}

function headShoulders(candles, closes, highs) {
  const out = [];
  for (let k = 2; k < highs.length; k++) {
    const l = highs[k - 2];
    const h = highs[k - 1];
    const r = highs[k];
    if (!(h.price > l.price && h.price > r.price)) continue;
    if (h.price < Math.max(l.price, r.price) * 1.01) continue;
    const shoulderDiff = Math.abs(l.price - r.price) / Math.min(l.price, r.price);
    if (shoulderDiff > 0.05) continue;
    const neck = Math.min(minLowBetween(candles, l.index, h.index), minLowBetween(candles, h.index, r.index));
    const conf = firstCloseBelow(candles, r.index + 1, neck);
    if (conf < 0) continue;
    out.push(
      mkAt(candles, closes, conf, {
        type: "head_shoulders",
        name: "Head & Shoulders",
        direction: DIRECTION.BEAR,
        title: "Head & shoulders top",
        code: "HS",
        fromTime: candles[l.index].time,
        baseReliability: 0.66,
        signalStrength: (1 - shoulderDiff / 0.05) * 0.5 + ((h.price / Math.max(l.price, r.price) - 1) / 0.05) * 0.5,
        meta: { neckline: Math.round(neck) },
      }),
    );
  }
  return out;
}

function invHeadShoulders(candles, closes, lows) {
  const out = [];
  for (let k = 2; k < lows.length; k++) {
    const l = lows[k - 2];
    const h = lows[k - 1];
    const r = lows[k];
    if (!(h.price < l.price && h.price < r.price)) continue;
    if (h.price > Math.min(l.price, r.price) * 0.99) continue;
    const shoulderDiff = Math.abs(l.price - r.price) / Math.min(l.price, r.price);
    if (shoulderDiff > 0.05) continue;
    const neck = Math.max(maxHighBetween(candles, l.index, h.index), maxHighBetween(candles, h.index, r.index));
    const conf = firstCloseAbove(candles, r.index + 1, neck);
    if (conf < 0) continue;
    out.push(
      mkAt(candles, closes, conf, {
        type: "inverse_head_shoulders",
        name: "Inverse Head & Shoulders",
        direction: DIRECTION.BULL,
        title: "Inverse head & shoulders",
        code: "iHS",
        fromTime: candles[l.index].time,
        baseReliability: 0.66,
        signalStrength: (1 - shoulderDiff / 0.05) * 0.5 + ((Math.min(l.price, r.price) / h.price - 1) / 0.05) * 0.5,
        meta: { neckline: Math.round(neck) },
      }),
    );
  }
  return out;
}

export function geometricSignals(candles, closes, piv) {
  return [
    ...doubleBottoms(candles, closes, piv.lows),
    ...doubleTops(candles, closes, piv.highs),
    ...headShoulders(candles, closes, piv.highs),
    ...invHeadShoulders(candles, closes, piv.lows),
  ];
}
