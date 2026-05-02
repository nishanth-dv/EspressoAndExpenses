import { INVESTMENT_TYPES } from "./constants";

export function getTypeInfo(typeKey) {
  return INVESTMENT_TYPES.find((t) => t.key === typeKey) ?? INVESTMENT_TYPES.find((t) => t.key === "other");
}

// Returns { investedAmount, currentValue } for any investment
export function calcInvestmentValues(inv) {
  const info = getTypeInfo(inv.type);

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
      tenureMonths
    );

    if (inv.type === "rd") {
      // RD: principal = monthly deposit; interest approximation
      const n = Math.floor(monthsElapsed);
      const totalDeposited = principal * n;
      const interest = principal * (n * (n + 1)) / 2 * (rate / 1200);
      return { investedAmount: totalDeposited, currentValue: totalDeposited + interest };
    }

    // FD / Bond: quarterly compounding
    const currentValue = principal * Math.pow(1 + rate / 400, monthsElapsed / 3);
    return { investedAmount: principal, currentValue };
  }

  // manual
  return {
    investedAmount: parseFloat(inv.investedAmount) || 0,
    currentValue: parseFloat(inv.currentValue) || 0,
  };
}

export function calcReturns(inv) {
  const { investedAmount, currentValue } = calcInvestmentValues(inv);
  const absoluteReturn = currentValue - investedAmount;
  const returnPct = investedAmount > 0 ? (absoluteReturn / investedAmount) * 100 : 0;
  return { investedAmount, currentValue, absoluteReturn, returnPct };
}

export function getPortfolioSummary(investments) {
  let totalInvested = 0;
  let totalCurrent = 0;
  investments.forEach((inv) => {
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
    return { year: `Y${i + 1}`, invested: Math.round(invested), gains: Math.round(val - invested) };
  });

  return { corpus, totalInvested, gains: Math.round(gains), yearData };
}

export function getInvestmentInsights(investments) {
  if (investments.length === 0) return [];
  const insights = [];
  const { totalInvested, totalCurrent, returnPct } = getPortfolioSummary(investments);

  // How long investing
  const earliest = investments.reduce((min, inv) => {
    const d = new Date(inv.startDate);
    return d < min ? d : min;
  }, new Date());
  const monthsInvesting = Math.max(0, Math.round((new Date() - earliest) / (1000 * 60 * 60 * 24 * 30.44)));
  insights.push({
    label: "Investing streak",
    value: monthsInvesting > 0 ? `${monthsInvesting} month${monthsInvesting !== 1 ? "s" : ""}` : "Just started",
    sub: monthsInvesting > 12 ? "Consistency is wealth" : "Keep it going",
    icon: "fa-fire",
    positive: true,
  });

  if (totalInvested > 0) {
    // vs FD benchmark
    const FD_RATE = 7.0;
    const excess = returnPct - FD_RATE;
    insights.push({
      label: excess >= 0 ? "Beating fixed deposits" : "Behind fixed deposits",
      value: `${excess >= 0 ? "+" : ""}${excess.toFixed(1)}% vs FD`,
      sub: `Benchmark: ${FD_RATE}% p.a.`,
      icon: "fa-building-columns",
      positive: excess >= 0,
    });

    // vs inflation
    const INFLATION = 6.0;
    const realReturn = returnPct - INFLATION;
    insights.push({
      label: realReturn >= 0 ? "Preserving wealth" : "Losing to inflation",
      value: `${realReturn >= 0 ? "+" : ""}${realReturn.toFixed(1)}% real return`,
      sub: `CPI benchmark: ${INFLATION}%`,
      icon: "fa-gauge-high",
      positive: realReturn >= 0,
    });

    // Annualised return (CAGR)
    const years = monthsInvesting / 12;
    if (years >= 0.5 && totalInvested > 0) {
      const cagr = (Math.pow(totalCurrent / totalInvested, 1 / years) - 1) * 100;
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
