import { INVESTMENT_TYPES, AUTO_CATEGORY_MAP, CATEGORY_COLOR_PALETTE } from "./constants";
import { BUILTIN_INVESTMENT_TYPES } from "./investmentTypeSchemas";
import { DISCOVER_INVESTMENT_TYPES } from "../data/investmentTypesDiscover";

export function getTypeInfo(typeKey) {
  return (
    INVESTMENT_TYPES.find((t) => t.key === typeKey) ??
    INVESTMENT_TYPES.find((t) => t.key === "other")
  );
}

// ── Grace period + late penalty ───────────────────────────
// Default grace per investment type before a missed contribution is
// considered lapsed. unit: days | months | instalments. Types absent here
// have no recurring contribution and therefore no grace concept.
export const GRACE_PERIOD_DEFAULTS = {
  lic: { value: 30, unit: "days" },
  plan: { value: 30, unit: "days" },
  rd: { value: 30, unit: "days" },
  sip: { value: 3, unit: "instalments" },
  ppf: { value: 12, unit: "months" },
  nps: { value: 12, unit: "months" },
  apy: { value: 30, unit: "days" },
  chit: { value: 15, unit: "days" },
};

export function typeHasGrace(typeKey) {
  return Object.prototype.hasOwnProperty.call(GRACE_PERIOD_DEFAULTS, typeKey);
}

export function getGraceDefault(typeKey) {
  return GRACE_PERIOD_DEFAULTS[typeKey] ?? null;
}

// Effective grace for an investment: its own override, else the type default.
export function resolveGrace(inv) {
  if (inv?.gracePeriod && inv.gracePeriod.value != null) return inv.gracePeriod;
  return getGraceDefault(inv?.type);
}

// Translate a grace config onto the day axis. cadenceDays is the spacing
// between scheduled instalments (used for the "instalments" unit).
export function graceToDays(grace, cadenceDays = 30) {
  if (!grace) return 0;
  const v = parseFloat(grace.value) || 0;
  if (grace.unit === "months") return Math.round(v * 30);
  if (grace.unit === "instalments") return Math.round(v * cadenceDays);
  return v;
}

const GRACE_UNIT_LABEL = {
  days: "day",
  months: "month",
  instalments: "missed instalment",
};

export function graceLabel(grace) {
  if (!grace) return "";
  const v = parseFloat(grace.value) || 0;
  const unit = GRACE_UNIT_LABEL[grace.unit] ?? grace.unit;
  return `${v} ${unit}${v === 1 ? "" : "s"}`;
}

// Penalty charged on a missed instalment once it's past grace.
export function computeLatePenalty(penalty, instalmentAmount) {
  if (!penalty?.enabled) return 0;
  const amt = parseFloat(penalty.amount) || 0;
  if (penalty.mode === "percent") return (instalmentAmount * amt) / 100;
  return amt;
}

// Returns "unit" | "fixed" | "manual" | "cashflow" for the math engine.
// Lookup order:
//   1. userTypes — covers custom keys + user overrides
//   2. BUILTIN_INVESTMENT_TYPES — the in-code schema list
//   3. DISCOVER_INVESTMENT_TYPES — the in-code Discover catalog (APY,
//      chit fund, REIT, etc). Critical: callers that don't have a Drive
//      handle on userTypes (e.g. calcReturns) still need to identify
//      cashflow types correctly, otherwise APY gets treated as "manual"
//      and computes a phantom return of -investedAmount.
//   4. Legacy INVESTMENT_TYPES subtype field
//   5. "manual" fallback
export function getInvestmentMathProfile(typeKey, userTypes = []) {
  const userMatch = userTypes.find((t) => t.key === typeKey);
  if (userMatch?.mathProfile) return userMatch.mathProfile;
  const builtin = BUILTIN_INVESTMENT_TYPES.find((t) => t.key === typeKey);
  if (builtin?.mathProfile) return builtin.mathProfile;
  const discover = DISCOVER_INVESTMENT_TYPES.find((t) => t.key === typeKey);
  if (discover?.mathProfile) return discover.mathProfile;
  const legacy = INVESTMENT_TYPES.find((t) => t.key === typeKey);
  return legacy?.subtype ?? "manual";
}

// Cash-flow profile is excluded from portfolio totals and returns. Use this
// guard everywhere the aggregator should skip those investments.
export function isPortfolioAffecting(inv, userTypes = []) {
  return getInvestmentMathProfile(inv?.type, userTypes) !== "cashflow";
}

// Per-period contribution for an auto-deduct investment. Used by the
// scheduler (to know what to debit) and the per-holding ledger (to value
// the "Legacy Investment" aggregate for missed pre-app periods). Returns 0
// when no amount can be determined — callers should treat that as a no-op.
//
// Lookup order:
//   1. schema's auto-deduct field config (`amountFieldKey`)
//   2. convention keys (monthlyContribution → monthlyAmount → monthlyPremium → premiumAmount)
//   3. first currency field on the schema that isn't an aggregate / total
const AUTO_DEDUCT_SKIP_KEYS = new Set([
  "investedAmount",
  "withdrawals",
  "currentValue",
  "currentPrice",
  "maturityAmount",
  "buyPrice",
  "quantity",
]);

const AUTO_DEDUCT_PREFERRED_KEYS = [
  "monthlyContribution",
  "monthlyAmount",
  "monthlyPremium",
  "premiumAmount",
];

export function findAutoDeductAmount(inv, schema) {
  const allFields = (schema?.rows ?? []).flatMap((r) => r.fields ?? []);
  const adField = allFields.find((f) => f.type === "auto-deduct");
  const cfgKey = adField?.config?.amountFieldKey;
  if (cfgKey) {
    const v = parseFloat(inv[cfgKey]);
    if (!isNaN(v) && v > 0) return v;
  }
  for (const k of AUTO_DEDUCT_PREFERRED_KEYS) {
    const v = parseFloat(inv[k]);
    if (!isNaN(v) && v > 0) return v;
  }
  const currencyFields = allFields.filter(
    (f) => f.type === "currency" && !AUTO_DEDUCT_SKIP_KEYS.has(f.key),
  );
  for (const f of currencyFields) {
    const v = parseFloat(inv[f.key]);
    if (!isNaN(v) && v > 0) return v;
  }
  return 0;
}

// Returns { investedAmount, currentValue } for any investment.
// `transactions` is optional — when supplied, cash-flow holdings (chit fund,
// APY, etc.) fold their posted auto-deduct instalments into the invested
// total so the ledger stays the single source of truth (see below).
export function calcInvestmentValues(inv, userTypes = [], transactions = []) {
  const info = getTypeInfo(inv.type);
  const profile = getInvestmentMathProfile(inv.type, userTypes);

  // Cash-flow profile (APY, chit fund, etc.) — tracks contributions in and
  // withdrawals out, no return math attempted. `currentValue` falls back to
  // `invested − withdrawn` when the user hasn't entered a manual snapshot.
  //
  // The static `investedAmount` field only captures an opening figure; the
  // real corpus grows through auto-deduct instalments that are posted to the
  // ledger (tagged `autoDeductInvestmentId`) and never write back to the lot.
  // So invested = opening + every posted instalment for this lot (or, for a
  // grouped card, its underlying lots). This keeps the ledger authoritative
  // and makes deletions self-correct.
  if (profile === "cashflow") {
    const base = parseFloat(inv.investedAmount) || 0;
    const ids = inv._ids ?? [inv.id];
    let contributed = 0;
    for (const t of transactions) {
      if (t.autoDeductInvestmentId && ids.includes(t.autoDeductInvestmentId)) {
        contributed += parseFloat(t.amount) || 0;
      }
    }
    const invested = base + contributed;
    const withdrawn = parseFloat(inv.withdrawals) || 0;
    const explicit = parseFloat(inv.currentValue);
    const current = Number.isFinite(explicit)
      ? explicit
      : Math.max(0, invested - withdrawn);
    return { investedAmount: invested, currentValue: current };
  }

  if (info.subtype === "unit") {
    const qty = parseFloat(inv.quantity) || 0;
    const buy = parseFloat(inv.buyPrice) || 0;
    const cur = parseFloat(inv.currentPrice) || 0;
    return { investedAmount: qty * buy, currentValue: qty * cur };
  }

  if (info.subtype === "fixed") {
    const principal = parseFloat(inv.investedAmount) || 0;
    const rate = parseFloat(inv.interestRate) || 0;
    const tenureMonths = parseInt(inv.tenureMonths) || 0;
    const start = new Date(inv.startDate);
    const now = new Date();
    const monthsElapsed = Math.min(
      Math.max(0, (now - start) / (1000 * 60 * 60 * 24 * 30.44)),
      tenureMonths,
    );

    if (inv.type === "rd") {
      // RD: principal = monthly deposit; interest approximation
      const n = Math.floor(monthsElapsed);
      const totalDeposited = principal * n;
      const interest = ((principal * (n * (n + 1))) / 2) * (rate / 1200);
      return {
        investedAmount: totalDeposited,
        currentValue: totalDeposited + interest,
      };
    }

    if (inv.type === "plan") {
      const n = Math.floor(monthsElapsed);
      const totalDeposited = principal * n;
      const maturity = parseFloat(inv.maturityAmount) || 0;
      if (maturity > 0 && tenureMonths > 0) {
        // Prorate maturity value linearly based on progress through tenure
        const progress = Math.min(1, monthsElapsed / tenureMonths);
        return {
          investedAmount: totalDeposited,
          currentValue: maturity * progress,
        };
      }
      return { investedAmount: totalDeposited, currentValue: totalDeposited };
    }

    if (inv.type === "lic") {
      // LIC: principal is the total invested to date (not monthly).
      // Current value interpolates linearly toward maturityAmount over the
      // tenure derived from the user-entered maturity date.
      const maturity = parseFloat(inv.maturityAmount) || 0;
      if (maturity > 0 && tenureMonths > 0) {
        const progress = Math.min(1, monthsElapsed / tenureMonths);
        return {
          investedAmount: principal,
          currentValue: principal + (maturity - principal) * progress,
        };
      }
      return { investedAmount: principal, currentValue: principal };
    }

    // FD / Bond: quarterly compounding (needs interestRate set)
    const currentValue =
      principal * Math.pow(1 + rate / 400, monthsElapsed / 3);
    return { investedAmount: principal, currentValue };
  }

  // manual
  return {
    investedAmount: parseFloat(inv.investedAmount) || 0,
    currentValue: parseFloat(inv.currentValue) || 0,
  };
}

export function calcReturns(inv, userTypes = [], transactions = []) {
  const { investedAmount, currentValue } = calcInvestmentValues(
    inv,
    userTypes,
    transactions,
  );
  const absoluteReturn = currentValue - investedAmount;
  // Cash-flow investments don't carry a meaningful return % — withdrawals
  // shouldn't read as "losses". We surface invested + current honestly but
  // pin returnPct/absoluteReturn to 0 so per-card UI doesn't print a
  // misleading negative percentage.
  if (!isPortfolioAffecting(inv)) {
    return {
      investedAmount,
      currentValue,
      absoluteReturn: 0,
      returnPct: 0,
    };
  }
  const returnPct =
    investedAmount > 0 ? (absoluteReturn / investedAmount) * 100 : 0;
  return { investedAmount, currentValue, absoluteReturn, returnPct };
}

export function getPortfolioSummary(investments) {
  // Cash-flow investments (APY, chit fund, etc.) are excluded entirely —
  // they have no meaningful "return" so pulling them into the portfolio
  // total would drag the % math in misleading directions. They live in the
  // holdings list separately, with their own contribution tracking.
  let totalInvested = 0;
  let totalCurrent = 0;
  investments.forEach((inv) => {
    if (!isPortfolioAffecting(inv)) return;
    const { investedAmount, currentValue } = calcInvestmentValues(inv);
    totalInvested += investedAmount;
    totalCurrent += currentValue;
  });
  const totalReturn = totalCurrent - totalInvested;
  const returnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;
  return { totalInvested, totalCurrent, totalReturn, returnPct };
}

export function getAllocationData(investments) {
  const byType = {};
  let total = 0;
  investments.forEach((inv) => {
    if (!isPortfolioAffecting(inv)) return; // skip cash-flow types
    const { currentValue } = calcInvestmentValues(inv);
    byType[inv.type] = (byType[inv.type] || 0) + currentValue;
    total += currentValue;
  });
  return Object.entries(byType)
    .map(([typeKey, value]) => {
      const info = getTypeInfo(typeKey);
      return {
        type: typeKey,
        label: info.label,
        value: Math.round(value),
        pct: total > 0 ? Math.round((value / total) * 100) : 0,
        color: info.color,
      };
    })
    .sort((a, b) => b.value - a.value);
}

// SIP compound growth: FV = P × [(1+r)^n - 1] / r × (1+r)
export function getCompoundProjection(monthly, years, annualRate) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  const fv = (months) =>
    r > 0
      ? monthly * ((Math.pow(1 + r, months) - 1) / r) * (1 + r)
      : monthly * months;

  const corpus = Math.round(fv(n));
  const totalInvested = monthly * n;
  const gains = corpus - totalInvested;

  const yearData = Array.from({ length: Math.min(years, 30) }, (_, i) => {
    const months = (i + 1) * 12;
    const val = fv(months);
    const invested = monthly * months;
    return {
      year: `Y${i + 1}`,
      invested: Math.round(invested),
      gains: Math.round(val - invested),
    };
  });

  return { corpus, totalInvested, gains: Math.round(gains), yearData };
}

export function getInvestmentCategory(inv) {
  const auto = AUTO_CATEGORY_MAP[inv.type];
  if (auto) return auto;
  if (inv.category) {
    return { label: inv.category, color: CATEGORY_COLOR_PALETTE[inv.category] ?? "#808080" };
  }
  return { label: "Uncategorized", color: "#b0b0b0" };
}

export function getCategoryAllocationData(investments) {
  const map = {};
  let total = 0;
  investments.forEach((inv) => {
    if (!isPortfolioAffecting(inv)) return; // skip cash-flow types
    const { currentValue } = calcInvestmentValues(inv);
    if (currentValue <= 0) return;
    const { label, color } = getInvestmentCategory(inv);
    if (!map[label]) map[label] = { value: 0, color };
    map[label].value += currentValue;
    total += currentValue;
  });
  return Object.entries(map)
    .map(([label, { value, color }]) => ({
      label,
      value: Math.round(value),
      pct: total > 0 ? Math.round((value / total) * 100) : 0,
      color,
    }))
    .sort((a, b) => {
      if (a.label === "Uncategorized") return 1;
      if (b.label === "Uncategorized") return -1;
      return b.value - a.value;
    });
}

// Group unit-type investments the *same way the Investments page groups
// them for the Holdings list* — by ticker when present, else by
// type+normalized-name. Matching the page exactly ensures the
// top-performer card sees the same position the user sees in the holdings
// card. Non-unit types pass through unchanged.
export function groupInvestmentsByTicker(investments) {
  const grouped = new Map();
  for (const inv of investments) {
    const info = getTypeInfo(inv.type);
    if (info.subtype !== "unit") {
      grouped.set(inv.id, inv);
      continue;
    }
    const key = inv.ticker
      ? `t:${inv.ticker}`
      : `n:${inv.type}|${(inv.name || "").toLowerCase().trim()}`;
    if (!grouped.has(key)) {
      grouped.set(key, { ...inv, _ids: [inv.id], _lots: 1 });
    } else {
      const g = grouped.get(key);
      const totalQty = (g.quantity || 0) + (inv.quantity || 0);
      const weightedBuy =
        totalQty > 0
          ? ((g.buyPrice || 0) * (g.quantity || 0) +
              (inv.buyPrice || 0) * (inv.quantity || 0)) /
            totalQty
          : 0;
      const latestPrice =
        !g.priceUpdatedAt ||
        (inv.priceUpdatedAt && inv.priceUpdatedAt > g.priceUpdatedAt)
          ? {
              currentPrice: inv.currentPrice,
              priceUpdatedAt: inv.priceUpdatedAt,
            }
          : {
              currentPrice: g.currentPrice,
              priceUpdatedAt: g.priceUpdatedAt,
            };
      grouped.set(key, {
        ...g,
        quantity: totalQty,
        buyPrice: weightedBuy,
        ...latestPrice,
        _ids: [...g._ids, inv.id],
        _lots: g._lots + 1,
      });
    }
  }
  return [...grouped.values()];
}

// Best + worst performing holdings by return-%. `investments` should be the
// already-grouped list (i.e. legacy MF and active SIP for the same ticker
// merged into one row with `_ids`). `allInvestments` is the raw,
// pre-grouping list so we can look up each sub-record's type to decide
// whether to use the SIP ledger or the stored qty × buy.
//
// Why per-sub-record:
// • Legacy / lump-sum holdings store quantity + buyPrice directly. qty × buy
//   gives correct invested.
// • SIP records store quantity from `priceService.fetchSIPData`, which can
//   be stale (didn't run, ran months ago, or monthlyAmount changed since).
//   The truthful invested amount is the sum of monthly transactions tagged
//   with `sipInvestmentId === sub.id`.
// When a group mixes both (a legacy MF and an ongoing SIP for the same
// scheme), we sum both contributions.
export function getPerformanceExtremes(
  investments,
  allInvestments = [],
  transactions = [],
) {
  const subByIdMap = new Map(allInvestments.map((s) => [s.id, s]));

  // For a grouped position, return its invested + current.
  //
  // • Mixed or non-SIP groups: trust `calcReturns(grouped)`. The grouped
  //   row already has totalQty + weightedBuy that sums every underlying
  //   contribution — same number the holdings card shows.
  // • Pure-SIP groups: trust the transaction ledger and only use unit math
  //   for current value when the stored qty × buy matches the ledger
  //   (within 5%). This prevents the 1900%-style artifact when a SIP
  //   record's quantity is stale or legacy-shaped.
  function totalsForGroup(grouped) {
    const r = calcReturns(grouped);
    const ids = grouped._ids ?? [grouped.id];
    const subs = ids.map((id) => subByIdMap.get(id)).filter(Boolean);
    const isPureSip = subs.length > 0 && subs.every((s) => s.type === "sip");

    if (isPureSip) {
      const ledgerSum = subs.reduce(
        (acc, sub) =>
          acc +
          transactions
            .filter((t) => t.sipInvestmentId === sub.id)
            .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0),
        0,
      );
      if (ledgerSum === 0) return null;
      const reliable =
        r.investedAmount > 0 &&
        Math.abs(r.investedAmount - ledgerSum) <= ledgerSum * 0.05;
      return {
        invested: ledgerSum,
        currentValue: reliable ? r.currentValue : ledgerSum,
      };
    }

    // Mixed (SIP + legacy / MF / etc.) or pure non-SIP — calcReturns on the
    // grouped row is the source of truth, identical to the holdings card.
    return { invested: r.investedAmount, currentValue: r.currentValue };
  }

  const live = investments
    .filter((inv) => !inv.inHistory && isPortfolioAffecting(inv))
    .map((inv) => {
      const totals = totalsForGroup(inv);
      if (!totals || totals.invested <= 0) return null;
      const absoluteReturn = totals.currentValue - totals.invested;
      return {
        inv,
        investedAmount: totals.invested,
        currentValue: totals.currentValue,
        absoluteReturn,
        returnPct: (absoluteReturn / totals.invested) * 100,
      };
    })
    .filter(Boolean);

  if (live.length === 0) return null;
  if (live.length === 1) return { top: live[0], bottom: null };
  const sorted = [...live].sort((a, b) => b.returnPct - a.returnPct);
  return { top: sorted[0], bottom: sorted[sorted.length - 1] };
}

// Holdings whose currentValue exceeds `threshold` of the portfolio's total
// current value. `threshold` is a fraction (0.25 = 25%). Cash-flow types
// excluded — they have no meaningful "share of portfolio".
export function getConcentrationRisks(investments, threshold = 0.25) {
  const live = investments.filter(
    (inv) => !inv.inHistory && isPortfolioAffecting(inv),
  );
  const total = live.reduce((s, inv) => s + calcReturns(inv).currentValue, 0);
  if (total <= 0) return [];
  return live
    .map((inv) => {
      const { currentValue } = calcReturns(inv);
      return { inv, currentValue, pct: (currentValue / total) * 100 };
    })
    .filter((x) => x.pct > threshold * 100)
    .sort((a, b) => b.pct - a.pct);
}

// Fixed-income holdings (FD / RD / LIC / Plan / Bond) maturing within the
// next `days` days. Returns soonest-first.
export function getUpcomingMaturities(investments, days = 365) {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + days);
  const result = [];
  for (const inv of investments) {
    if (inv.inHistory) continue;
    const info = getTypeInfo(inv.type);
    if (info.subtype !== "fixed") continue;
    const tenureMonths = parseInt(inv.tenureMonths) || 0;
    if (!tenureMonths || !inv.startDate) continue;
    const maturity = new Date(inv.startDate);
    maturity.setMonth(maturity.getMonth() + tenureMonths);
    if (maturity <= now) continue;
    if (maturity > horizon) continue;
    const daysLeft = Math.round((maturity - now) / 86_400_000);
    result.push({ inv, maturity, daysLeft, info });
  }
  return result.sort((a, b) => a.maturity - b.maturity);
}

export function getInvestmentInsights(
  investments,
  { fdRate = 7, inflationRate = 6 } = {},
) {
  if (investments.length === 0) return [];
  const insights = [];
  const { totalInvested, totalCurrent, returnPct } =
    getPortfolioSummary(investments);

  // How long investing
  const earliest = investments.reduce((min, inv) => {
    const d = new Date(inv.startDate);
    return d < min ? d : min;
  }, new Date());
  const monthsInvesting = Math.max(
    0,
    Math.round((new Date() - earliest) / (1000 * 60 * 60 * 24 * 30.44)),
  );
  insights.push({
    label: "Investing streak",
    value:
      monthsInvesting > 0
        ? `${monthsInvesting} month${monthsInvesting !== 1 ? "s" : ""}`
        : "Just started",
    sub: monthsInvesting > 12 ? "Consistency is wealth" : "Keep it going",
    icon: "fa-fire",
    positive: true,
  });

  if (totalInvested > 0) {
    // vs FD benchmark
    const excess = returnPct - fdRate;
    insights.push({
      label: excess >= 0 ? "Beating fixed deposits" : "Behind fixed deposits",
      value: `${excess >= 0 ? "+" : ""}${excess.toFixed(1)}% vs FD`,
      sub: `Benchmark: ${fdRate}% p.a.`,
      icon: "fa-building-columns",
      positive: excess >= 0,
    });

    // vs inflation
    const realReturn = returnPct - inflationRate;
    insights.push({
      label: realReturn >= 0 ? "Preserving wealth" : "Losing to inflation",
      value: `${realReturn >= 0 ? "+" : ""}${realReturn.toFixed(1)}% real return`,
      sub: `CPI benchmark: ${inflationRate}%`,
      icon: "fa-gauge-high",
      positive: realReturn >= 0,
    });

    // Annualised return (CAGR)
    const years = monthsInvesting / 12;
    if (years >= 0.5 && totalInvested > 0) {
      const cagr =
        (Math.pow(totalCurrent / totalInvested, 1 / years) - 1) * 100;
      insights.push({
        label: "Annualised return (CAGR)",
        value: `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}% p.a.`,
        sub: `Over ${monthsInvesting} month${monthsInvesting !== 1 ? "s" : ""}`,
        icon: "fa-chart-line",
        positive: cagr >= 0,
      });
    }
  }

  return insights;
}
