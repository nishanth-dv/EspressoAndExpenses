// Investment Review engine — grades every current holding and the portfolio,
// issuing a verdict (Keep / Watch / Switch / Trim / Exit) with plain reasons and
// a transparent confidence score. Deterministic, no LLM. Reuses the same return
// math, asset-class map and confidence engine as the rest of the app.

import {
  calcReturns,
  getTypeInfo,
  isPortfolioAffecting,
} from "../investmentUtils";
import { assetClassOf, assetLabel } from "./profile";
import { withConfidence } from "./confidence";

// Rough long-run expectations per asset class (annualised). Equity is replaced
// by the actual Nifty return over the matching horizon when market data exists.
const BENCH = { equity: 0.12, debt: 0.07, gold: 0.08, alt: 0.1 };

// Trailing return of an index (nifty_ret / gold_ret) for the matching horizon.
function indexReturn(market, prefix, years) {
  const r = market?.rates;
  const pick =
    years >= 4
      ? r?.[`${prefix}_5y`]
      : years >= 2
        ? r?.[`${prefix}_3y`]
        : r?.[`${prefix}_1y`];
  const v = pick && typeof pick.value === "number" ? pick.value : null;
  return v != null ? v / 100 : null;
}

// The live market benchmark for an asset class (null → fall back to a fixed
// expectation): equity vs Nifty, gold vs gold ETF, debt vs the 10-yr G-Sec.
function classBench(market, cls, years) {
  if (cls === "equity") return indexReturn(market, "nifty_ret", years);
  if (cls === "gold") return indexReturn(market, "gold_ret", years);
  if (cls === "debt") {
    const g = market?.rates?.gsec_10y;
    return g && typeof g.value === "number" ? g.value / 100 : null;
  }
  return null;
}

const BENCH_NAME = { equity: "the Nifty", gold: "gold", debt: "G-Secs" };

export const VERDICTS = {
  keep: { label: "Keep", icon: "fa-circle-check", rank: 1 },
  watch: { label: "Watch", icon: "fa-eye", rank: 2 },
  trim: { label: "Trim", icon: "fa-scissors", rank: 3 },
  switch: { label: "Switch", icon: "fa-arrows-rotate", rank: 4 },
  exit: { label: "Exit", icon: "fa-arrow-right-from-bracket", rank: 5 },
};

function holdYears(inv) {
  const s = inv.startDate || inv.purchaseDate || inv.createdAt;
  if (!s) return 0;
  const y = (Date.now() - new Date(s).getTime()) / (365 * 86_400_000);
  return Number.isFinite(y) && y > 0 ? y : 0;
}

function annualise(returnPct, years) {
  const r = (returnPct || 0) / 100;
  if (years >= 1) return Math.pow(1 + r, 1 / years) - 1;
  return r; // < 1 year: use the raw return, don't over-annualise noise
}

export function runReview(data, profile = {}, market = {}) {
  const types = data.investmentTypes ?? [];
  const txns = data.transactions ?? [];
  const investments = (data.investments ?? []).filter((i) => !i.inHistory);

  // First pass: value each holding to get the portfolio total for %-of-book.
  // A holding with no current price/value still belongs to the portfolio — fall
  // back to its invested amount so it isn't silently dropped from the review.
  let total = 0;
  const valued = investments.map((inv) => {
    const r = calcReturns(inv, types, txns);
    const value = r.currentValue || 0;
    const invested = r.investedAmount || 0;
    const displayValue = value > 0 ? value : invested;
    total += displayValue;
    return { inv, invested, value, displayValue, returnPct: r.returnPct };
  });

  const holdings = [];
  const classTotals = { equity: 0, debt: 0, gold: 0, alt: 0 };
  let paValue = 0; // portfolio-affecting value (for the blended return)
  let paReturn = 0;
  let paBench = 0;
  let equityFundCount = 0;

  for (const h of valued) {
    const { inv, invested, value, displayValue, returnPct } = h;
    if (displayValue <= 0) continue; // genuinely empty holding
    const noValue = value <= 0; // no current price/value recorded
    const info = getTypeInfo(inv.type);
    const cls = assetClassOf(inv.type, types);
    const years = holdYears(inv);
    const marketB = classBench(market, cls, years);
    const bench = marketB != null ? marketB : (BENCH[cls] ?? 0.08);
    const pct = total > 0 ? displayValue / total : 0;
    const ann = annualise(returnPct, years);
    const pa = isPortfolioAffecting(inv, types);
    const nameLc = `${inv.type || ""} ${inv.name || ""}`.toLowerCase();

    classTotals[cls] += displayValue;
    if (pa && !noValue) {
      paValue += value;
      paReturn += value * ann;
      paBench += value * bench;
      if (/mf|sip|fund|etf|elss/.test(nameLc)) equityFundCount += cls === "equity" ? 1 : 0;
    }

    const reasons = [];
    let verdict = "keep";
    const bump = (v) => {
      if (VERDICTS[v].rank > VERDICTS[verdict].rank) verdict = v;
    };

    // Unpriced holding — can't grade the return yet.
    if (noValue) {
      reasons.push(
        "No current value on record — refresh its price (or set a current value) so it can be graded.",
      );
      bump("watch");
    }

    // 1. Regular plan cost drag
    if (!noValue && /regular/.test(nameLc) && !/direct/.test(nameLc)) {
      reasons.push(
        "Regular plan — a distributor commission (∼1%/yr) drags returns. The Direct plan is the same fund, cheaper.",
      );
      bump("switch");
    }
    // 2. Insurance-linked investment
    if (
      /lic|endowment|money.?back|ulip|traditional/.test(nameLc) &&
      !/term/.test(nameLc)
    ) {
      reasons.push(
        "Insurance-linked plan — typically ∼4–6% returns. Compare making it paid-up and redirecting to term cover + an index fund.",
      );
      bump("switch");
    }
    // 3. Underperformance vs its asset class (needs ≥1yr history + a price)
    if (!noValue && pa && years >= 1 && invested > 0 && ann < bench - 0.03) {
      const vs =
        marketB != null
          ? `${BENCH_NAME[cls]}'s ∼${(bench * 100).toFixed(0)}%`
          : `∼${(bench * 100).toFixed(0)}% expected for ${assetLabel(cls)}`;
      reasons.push(
        `Underperforming — about ${(ann * 100).toFixed(1)}%/yr vs ${vs} over ${years.toFixed(1)}y.`,
      );
      bump("watch");
      if (ann < bench - 0.06) bump("switch");
      // Cost angle: an actively-managed equity fund that can't beat its own
      // index would have done better (and cheaper) in a plain index fund.
      if (cls === "equity" && /mf|sip|fund/.test(nameLc) && !/index|nifty|sensex/.test(nameLc)) {
        reasons.push(
          "A low-cost Nifty index fund would have beaten this — worth considering the switch.",
        );
      }
    }
    // 4. FD below the best market rate
    if (/fd|fixed.?deposit|deposit/.test(nameLc) && market?.rates?.fd_1y?.value) {
      const rate = parseFloat(inv.interestRate ?? inv.rate);
      const best = market.rates.fd_1y.value;
      if (Number.isFinite(rate) && best > rate + 0.3) {
        reasons.push(
          `Booked at ${rate}% vs ∼${best}% best 1-yr FD now — switch on renewal.`,
        );
        bump("switch");
      }
    }
    // 5. Concentration
    if (pct > 0.25) {
      reasons.push(
        `${(pct * 100).toFixed(0)}% of your portfolio — single-holding risk. Trim toward ∼20%.`,
      );
      bump("trim");
    }
    // 6. Stale price (unit-type holdings)
    if (info.subtype === "unit" && inv.priceUpdatedAt) {
      const days = (Date.now() - new Date(inv.priceUpdatedAt).getTime()) / 86_400_000;
      if (days > 45) {
        reasons.push(
          `Price last refreshed ${Math.round(days)}d ago — update it to trust this number.`,
        );
        bump("watch");
      }
    }
    // 7. Paused SIP
    if (inv.type === "sip" && inv.paused) {
      reasons.push("SIP is paused — resume it or redeploy the money.");
      bump("watch");
    }
    // 8. Fit vs risk profile
    if (profile.riskAppetite === "conservative" && cls === "alt" && pct > 0.05) {
      reasons.push(
        "High-volatility asset for a conservative profile — keep the position small.",
      );
      bump("watch");
    }

    if (verdict === "keep") {
      reasons.push(
        pa
          ? `On track — about ${(ann * 100).toFixed(1)}%/yr, in line with expectations.`
          : "Steady contribution-based holding — nothing to change.",
      );
    }

    holdings.push(
      withConfidence({
        id: `review-${inv.id}`,
        invId: inv.id,
        name: inv.name || inv.ticker || info.label,
        typeLabel: info.label,
        icon: info.icon,
        color: info.color,
        cls,
        value: displayValue,
        invested,
        returnPct: noValue ? null : returnPct,
        annualised: ann,
        pct,
        verdict,
        reasons,
        href: `/Invest?highlight=${inv.id}`,
        factors: {
          kind: "fact",
          signalStrength: verdict === "keep" ? 0.4 : 0.7,
        },
      }),
    );
  }

  holdings.sort(
    (a, b) =>
      VERDICTS[b.verdict].rank - VERDICTS[a.verdict].rank || b.value - a.value,
  );

  // ── Portfolio X-ray ──
  const byClass = ["equity", "debt", "gold", "alt"]
    .map((cls) => ({
      cls,
      label: assetLabel(cls),
      amount: classTotals[cls],
      pct: total > 0 ? classTotals[cls] / total : 0,
    }))
    .filter((c) => c.amount > 0);

  const target = profile.targetAllocation || {};
  const missing = ["equity", "debt", "gold", "alt"]
    .filter((cls) => (target[cls] ?? 0) >= 10 && (classTotals[cls] || 0) / (total || 1) < 0.03)
    .map((cls) => assetLabel(cls));

  const blendedReturn = paValue > 0 ? paReturn / paValue : null;
  const blendedBench = paValue > 0 ? paBench / paValue : null;
  const needAttention = holdings.filter((h) => h.verdict !== "keep").length;

  return {
    holdings,
    xray: {
      total,
      count: holdings.length,
      needAttention,
      byClass,
      blendedReturn,
      blendedBench,
      niftyReturn: indexReturn(market, "nifty_ret", 3),
      equityFundCount,
      sprawl: equityFundCount > 6,
      missing,
    },
  };
}
