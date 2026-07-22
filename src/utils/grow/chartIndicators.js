import { rsiSeries, atrSeries } from "./signals/indicators.js";

export { rsiSeries, atrSeries };

export function smaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === period - 1) {
      let s = 0;
      for (let j = 0; j < period; j++) s += closes[j];
      ema = s / period;
      out[i] = ema;
    } else if (i >= period) {
      ema = closes[i] * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

export function bollinger(closes, period = 20, mult = 2) {
  const middle = smaSeries(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - middle[i];
      s += d * d;
    }
    const sd = Math.sqrt(s / period);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
  }
  return { middle, upper, lower };
}

export function toLine(candles, series) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    if (series[i] != null) out.push({ time: candles[i].time, value: series[i] });
  }
  return out;
}

function highest(arr, i, p) {
  let m = -Infinity;
  for (let j = i - p + 1; j <= i; j++) m = Math.max(m, arr[j]);
  return m;
}
function lowest(arr, i, p) {
  let m = Infinity;
  for (let j = i - p + 1; j <= i; j++) m = Math.min(m, arr[j]);
  return m;
}
function emaNullable(vals, period) {
  const out = new Array(vals.length).fill(null);
  const k = 2 / (period + 1);
  let ema = null;
  let count = 0;
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v == null) continue;
    if (ema == null) {
      sum += v;
      count++;
      if (count === period) {
        ema = sum / period;
        out[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}
function smaNullable(vals, period) {
  const out = new Array(vals.length).fill(null);
  const q = [];
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v == null) {
      q.length = 0;
      sum = 0;
      out[i] = null;
      continue;
    }
    q.push(v);
    sum += v;
    if (q.length > period) sum -= q.shift();
    if (q.length === period) out[i] = sum / period;
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalP = 9) {
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const signal = emaNullable(line, signalP);
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

export function stochastic(candles, kP = 14, dP = 3) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const k = new Array(candles.length).fill(null);
  for (let i = kP - 1; i < candles.length; i++) {
    const hh = highest(highs, i, kP);
    const ll = lowest(lows, i, kP);
    const rng = hh - ll || 1e-9;
    k[i] = ((candles[i].close - ll) / rng) * 100;
  }
  return { k, d: smaNullable(k, dP) };
}

export function supertrend(candles, atrP = 10, mult = 3) {
  const atr = atrSeries(candles, atrP);
  const st = new Array(candles.length).fill(null);
  const dir = new Array(candles.length).fill(0);
  let prevFU = null;
  let prevFL = null;
  let prevST = null;
  for (let i = 0; i < candles.length; i++) {
    if (atr[i] == null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const bU = hl2 + mult * atr[i];
    const bL = hl2 - mult * atr[i];
    if (prevST == null) {
      prevFU = bU;
      prevFL = bL;
      prevST = bU;
      st[i] = bU;
      dir[i] = -1;
      continue;
    }
    const pClose = candles[i - 1].close;
    const fu = bU < prevFU || pClose > prevFU ? bU : prevFU;
    const fl = bL > prevFL || pClose < prevFL ? bL : prevFL;
    let curST;
    let curDir;
    if (prevST === prevFU) {
      if (candles[i].close > fu) {
        curST = fl;
        curDir = 1;
      } else {
        curST = fu;
        curDir = -1;
      }
    } else if (candles[i].close < fl) {
      curST = fu;
      curDir = -1;
    } else {
      curST = fl;
      curDir = 1;
    }
    st[i] = curST;
    dir[i] = curDir;
    prevFU = fu;
    prevFL = fl;
    prevST = curST;
  }
  return { st, dir };
}

export function adx(candles, period = 14) {
  const len = candles.length;
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const adxArr = new Array(len).fill(null);
  if (len < period * 2) return { adx: adxArr, plusDI, minusDI };
  const tr = new Array(len).fill(0);
  const pDM = new Array(len).fill(0);
  const mDM = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    pDM[i] = up > down && up > 0 ? up : 0;
    mDM[i] = down > up && down > 0 ? down : 0;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - pc), Math.abs(candles[i].low - pc));
  }
  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += pDM[i];
    mS += mDM[i];
  }
  const dxArr = new Array(len).fill(null);
  for (let i = period; i < len; i++) {
    if (i > period) {
      trS = trS - trS / period + tr[i];
      pS = pS - pS / period + pDM[i];
      mS = mS - mS / period + mDM[i];
    }
    const pdi = trS ? (pS / trS) * 100 : 0;
    const mdi = trS ? (mS / trS) * 100 : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const s = pdi + mdi;
    dxArr[i] = s ? (Math.abs(pdi - mdi) / s) * 100 : 0;
  }
  let sumDX = 0;
  let cnt = 0;
  for (let i = period; i < len; i++) {
    if (dxArr[i] == null) continue;
    if (cnt < period) {
      sumDX += dxArr[i];
      cnt++;
      if (cnt === period) adxArr[i] = sumDX / period;
    } else {
      adxArr[i] = (adxArr[i - 1] * (period - 1) + dxArr[i]) / period;
    }
  }
  return { adx: adxArr, plusDI, minusDI };
}

export function obv(candles) {
  const out = new Array(candles.length).fill(null);
  let v = 0;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    v += d > 0 ? candles[i].volume || 0 : d < 0 ? -(candles[i].volume || 0) : 0;
    out[i] = v;
  }
  return out;
}

export function vwap(candles) {
  const out = new Array(candles.length).fill(null);
  let day = null;
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const d = Math.floor(candles[i].time / 86400);
    if (d !== day) {
      day = d;
      cumPV = 0;
      cumV = 0;
    }
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const vol = candles[i].volume || 0;
    cumPV += tp * vol;
    cumV += vol;
    out[i] = cumV ? cumPV / cumV : null;
  }
  return out;
}

export function ichimoku(candles, conv = 9, base = 26, spanB = 52, disp = 26) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const len = candles.length;
  const tenkan = new Array(len).fill(null);
  const kijun = new Array(len).fill(null);
  const spanBraw = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (i >= conv - 1) tenkan[i] = (highest(highs, i, conv) + lowest(lows, i, conv)) / 2;
    if (i >= base - 1) kijun[i] = (highest(highs, i, base) + lowest(lows, i, base)) / 2;
    if (i >= spanB - 1) spanBraw[i] = (highest(highs, i, spanB) + lowest(lows, i, spanB)) / 2;
  }
  return { tenkan, kijun, spanBraw, disp };
}

function shifted(candles, arr, shift) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    if (arr[i] == null) continue;
    const t = candles[i + shift]?.time;
    if (t == null) continue;
    out.push({ time: t, value: arr[i] });
  }
  return out;
}

export const INDICATORS = [
  {
    key: "ma",
    label: "MA 20/50",
    pane: "price",
    build: (candles) => {
      const c = candles.map((x) => x.close);
      return [
        { data: toLine(candles, emaSeries(c, 20)), color: "#3b82f6", width: 2 },
        { data: toLine(candles, smaSeries(c, 50)), color: "#a855f7", width: 2 },
      ];
    },
  },
  {
    key: "ma200",
    label: "MA 200",
    pane: "price",
    build: (candles) => [
      { data: toLine(candles, smaSeries(candles.map((x) => x.close), 200)), color: "#eab308", width: 2 },
    ],
  },
  {
    key: "boll",
    label: "Bollinger",
    pane: "price",
    build: (candles) => {
      const bb = bollinger(candles.map((x) => x.close), 20, 2);
      return [
        { data: toLine(candles, bb.upper), color: "#94a3b8", width: 1, style: 2 },
        { data: toLine(candles, bb.middle), color: "#94a3b8", width: 1 },
        { data: toLine(candles, bb.lower), color: "#94a3b8", width: 1, style: 2 },
      ];
    },
  },
  {
    key: "vwap",
    label: "VWAP",
    pane: "price",
    build: (candles) => [{ data: toLine(candles, vwap(candles)), color: "#f59e0b", width: 2 }],
  },
  {
    key: "supertrend",
    label: "Supertrend",
    pane: "price",
    build: (candles) => {
      const { st, dir } = supertrend(candles);
      const up = candles.map((c, i) => (st[i] != null && dir[i] === 1 ? { time: c.time, value: st[i] } : { time: c.time }));
      const down = candles.map((c, i) => (st[i] != null && dir[i] === -1 ? { time: c.time, value: st[i] } : { time: c.time }));
      return [
        { data: up, color: "#16a34a", width: 2 },
        { data: down, color: "#ef4444", width: 2 },
      ];
    },
  },
  {
    key: "ichimoku",
    label: "Ichimoku",
    pane: "price",
    build: (candles) => {
      const ich = ichimoku(candles);
      const senkouA = candles.map((_, i) =>
        ich.tenkan[i] != null && ich.kijun[i] != null ? (ich.tenkan[i] + ich.kijun[i]) / 2 : null,
      );
      return [
        { data: shifted(candles, ich.tenkan, 0), color: "#3b82f6", width: 1 },
        { data: shifted(candles, ich.kijun, 0), color: "#ef4444", width: 1 },
        { data: shifted(candles, senkouA, ich.disp), color: "#16a34a", width: 1, style: 2 },
        { data: shifted(candles, ich.spanBraw, ich.disp), color: "#a855f7", width: 1, style: 2 },
        { data: shifted(candles, candles.map((c) => c.close), -ich.disp), color: "#94a3b8", width: 1 },
      ];
    },
  },
  {
    key: "rsi",
    label: "RSI",
    pane: "separate",
    priceLines: [30, 70],
    build: (candles) => [
      { data: toLine(candles, rsiSeries(candles.map((x) => x.close), 14)), color: "#3b82f6", width: 2 },
    ],
  },
  {
    key: "macd",
    label: "MACD",
    pane: "separate",
    build: (candles) => {
      const m = macd(candles.map((c) => c.close));
      return [
        {
          type: "histogram",
          data: candles.map((c, i) =>
            m.hist[i] != null
              ? { time: c.time, value: m.hist[i], color: m.hist[i] >= 0 ? "#16a34a80" : "#ef444480" }
              : { time: c.time },
          ),
        },
        { data: toLine(candles, m.line), color: "#3b82f6", width: 2 },
        { data: toLine(candles, m.signal), color: "#f59e0b", width: 2 },
      ];
    },
  },
  {
    key: "stoch",
    label: "Stochastic",
    pane: "separate",
    priceLines: [20, 80],
    build: (candles) => {
      const s = stochastic(candles);
      return [
        { data: toLine(candles, s.k), color: "#3b82f6", width: 2 },
        { data: toLine(candles, s.d), color: "#f59e0b", width: 1 },
      ];
    },
  },
  {
    key: "adx",
    label: "ADX",
    pane: "separate",
    priceLines: [25],
    build: (candles) => {
      const a = adx(candles);
      return [
        { data: toLine(candles, a.adx), color: "#6366f1", width: 2 },
        { data: toLine(candles, a.plusDI), color: "#16a34a", width: 1 },
        { data: toLine(candles, a.minusDI), color: "#ef4444", width: 1 },
      ];
    },
  },
  {
    key: "atr",
    label: "ATR",
    pane: "separate",
    build: (candles) => [{ data: toLine(candles, atrSeries(candles, 14)), color: "#a855f7", width: 2 }],
  },
  {
    key: "obv",
    label: "OBV",
    pane: "separate",
    build: (candles) => [{ data: toLine(candles, obv(candles)), color: "#0ea5e9", width: 2 }],
  },
  {
    key: "volume",
    label: "Volume",
    pane: "separate",
    build: (candles) => [
      {
        type: "histogram",
        data: candles.map((c) => ({
          time: c.time,
          value: c.volume || 0,
          color: c.close >= c.open ? "#16a34a55" : "#ef444455",
        })),
      },
    ],
  },
];
