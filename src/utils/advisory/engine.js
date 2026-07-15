import { computeAggregateBalance } from "../accountUtils";
import {
  isBilling,
  subscriptionTotals,
  detectAnomaly,
  trialStatus,
} from "../subscriptionUtils";
import { computeCardOutstanding } from "../solvencyUtils";
import { resolveMonthlyIncome } from "../incomeUtils";
import { assetClassOf, assetLabel } from "./profile";
import { withConfidence } from "./confidence";
import { reconcile } from "./reconcile";
import { categoryWeight } from "./feedback";
import {
  effectiveRate,
  hasRewardInfo,
  cardSpend,
  annualRewards,
} from "./cardRewards";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function valueOf(inv) {
  if (inv.currentValue != null && inv.currentValue !== "")
    return parseFloat(inv.currentValue) || 0;
  if (inv.quantity != null && inv.currentPrice != null)
    return (parseFloat(inv.quantity) || 0) * (parseFloat(inv.currentPrice) || 0);
  return parseFloat(inv.investedAmount) || 0;
}

function avgMonthlyExpense(transactions) {
  const cutoff = Date.now() - 90 * 86_400_000;
  let sum = 0;
  for (const t of transactions ?? []) {
    if (t.transactionType !== "expense" || t.cardId) continue;
    const d = new Date(t.occurredAt || t.createdAt).getTime();
    if (Number.isFinite(d) && d >= cutoff) sum += parseFloat(t.amount) || 0;
  }
  return sum / 3;
}

function totalCash(data) {
  const accounts = data.accounts ?? [];
  const txns = data.transactions ?? [];
  if (accounts.length) return computeAggregateBalance(accounts, txns);
  return parseFloat(data.insights?.balance) || 0;
}

// Monthly take-home: user-entered profile figure wins; else the modelled
// income baseline (regular pay projected, variable averaged).
function monthlyIncomeOf(data, profile) {
  const p = parseFloat(profile?.monthlyIncome);
  if (Number.isFinite(p) && p > 0) return p;
  return resolveMonthlyIncome(data.transactions ?? []).monthly || 0;
}

function commitmentActive(c) {
  return !c.archived && !c.closed && (parseFloat(c.emiAmount) || 0) > 0;
}

// Recent-quarter vs prior-quarter average monthly spend (bank spend only).
function quarterExpenseTrend(transactions) {
  const now = Date.now();
  const d90 = 90 * 86_400_000;
  let recent = 0;
  let prev = 0;
  for (const t of transactions ?? []) {
    if (t.transactionType !== "expense" || t.cardId) continue;
    const d = new Date(t.occurredAt || t.createdAt).getTime();
    if (!Number.isFinite(d)) continue;
    if (d >= now - d90) recent += parseFloat(t.amount) || 0;
    else if (d >= now - 2 * d90) prev += parseFloat(t.amount) || 0;
  }
  if (prev <= 0) return null;
  const recentM = recent / 3;
  const prevM = prev / 3;
  return { recent: recentM, prev: prevM, up: (recentM - prevM) / prevM };
}

function portfolioByClass(investments, types) {
  const byClass = { equity: 0, debt: 0, gold: 0, alt: 0 };
  let total = 0;
  for (const inv of investments ?? []) {
    const v = valueOf(inv);
    if (v <= 0) continue;
    const cls = assetClassOf(inv.type, types);
    byClass[cls] = (byClass[cls] || 0) + v;
    total += v;
  }
  return { byClass, total };
}

// ── Modules ───────────────────────────────────────────

function allocationModule(data, profile) {
  const { byClass, total } = portfolioByClass(data.investments, data.investmentTypes);
  if (total < 10000) return [];
  const target = profile.targetAllocation || {};
  const cards = [];
  for (const cls of ["equity", "debt", "gold", "alt"]) {
    const cur = (byClass[cls] || 0) / total;
    const tgt = (target[cls] ?? 0) / 100;
    const drift = tgt - cur;
    const amount = Math.abs(drift) * total;
    if (Math.abs(drift) < 0.05 || amount < 5000) continue;
    const under = drift > 0;
    cards.push({
      id: `alloc-${cls}`,
      stream: "personalized",
      category: "allocation",
      title: `${assetLabel(cls)} is ${under ? "under" : "over"} target`,
      action: under
        ? `Add ${INR.format(amount)} to ${assetLabel(cls)} (now ${(cur * 100).toFixed(0)}%, target ${(tgt * 100).toFixed(0)}%). Prefer redirecting new SIPs over selling.`
        : `Trim ${INR.format(amount)} from ${assetLabel(cls)} (now ${(cur * 100).toFixed(0)}%, target ${(tgt * 100).toFixed(0)}%) — do it tax-aware.`,
      impactLabel: `Rebalance ${INR.format(amount)}`,
      saving: 0,
      sortValue: amount,
      factors: { kind: "rule", signalStrength: Math.min(1, Math.abs(drift) / 0.2), fit: 0.8 },
    });
  }
  return cards;
}

function idleCashModule(data, profile) {
  const cash = totalCash(data);
  const exp = avgMonthlyExpense(data.transactions);
  const emergency = exp * (profile.emergencyMonths || 6);
  const surplus = cash - emergency;
  if (surplus < Math.max(50000, exp)) return [];
  const yieldGain = surplus * 0.03; // ~liquid/arbitrage vs savings
  return [
    {
      id: "idle-cash",
      stream: "personalized",
      category: "cash",
      title: "Idle cash is napping in savings",
      action: `${INR.format(surplus)} sits beyond your ${profile.emergencyMonths || 6}-month emergency buffer. Park it in a liquid/arbitrage fund for ∼3% more.`,
      impactLabel: `Earn ∼${INR.format(yieldGain)}/yr`,
      saving: yieldGain,
      sortValue: yieldGain,
      math: `Cash ${INR.format(cash)} − buffer ${INR.format(emergency)} = ${INR.format(surplus)} surplus × ∼3% rate gap`,
      factors: { kind: "fact", signalStrength: 0.7 },
    },
  ];
}

function emergencyFundModule(data, profile) {
  const exp = avgMonthlyExpense(data.transactions);
  if (exp <= 0) return [];
  const cash = totalCash(data);
  const target = exp * (profile.emergencyMonths || 6);
  if (cash >= target * 0.9) return [];
  const months = cash / exp;
  const gap = target - cash;
  return [
    {
      id: "emergency-fund",
      stream: "personalized",
      category: "risk",
      title: "Emergency fund is short",
      action: `You have ∼${months.toFixed(1)} months of expenses in cash (target ${profile.emergencyMonths || 6}). Build ${INR.format(gap)} before locking money away.`,
      impactLabel: `Shortfall ${INR.format(gap)}`,
      saving: 0,
      sortValue: gap * 0.15,
      factors: { kind: "rule", signalStrength: Math.min(1, gap / target), fit: 0.8 },
    },
  ];
}

function concentrationModule(data) {
  const { total } = portfolioByClass(data.investments, data.investmentTypes);
  if (total < 10000) return [];
  const cards = [];
  for (const inv of data.investments ?? []) {
    const v = valueOf(inv);
    const pct = v / total;
    if (pct <= 0.25) continue;
    const excess = (pct - 0.2) * total;
    cards.push({
      id: `conc-${inv.id}`,
      stream: "personalized",
      category: "risk",
      title: `${inv.name || inv.ticker || "A holding"} is concentrated`,
      action: `It's ${(pct * 100).toFixed(0)}% of your portfolio. Trimming to ∼20% means moving ${INR.format(excess)} to reduce single-holding risk.`,
      impactLabel: `${(pct * 100).toFixed(0)}% of portfolio`,
      saving: 0,
      sortValue: excess * 0.3,
      factors: { kind: "rule", signalStrength: Math.min(1, (pct - 0.25) / 0.25), fit: 0.7 },
    });
  }
  return cards;
}

function eightyCModule(data, profile) {
  const slab = profile.taxSlab || 0;
  if (slab <= 0 || profile.taxRegime === "new") return [];
  const used = profile.used80C || 0;
  const gap = 150000 - used;
  if (gap < 5000) return [];
  const taxSaved = gap * slab;
  return [
    {
      id: "tax-80c",
      stream: "personalized",
      category: "tax",
      title: "80C headroom left",
      action: `You've used ${INR.format(used)} of the ₹1,50,000 limit. Investing ${INR.format(gap)} more (ELSS / PPF / NPS) saves about ${INR.format(taxSaved)} in tax this year.`,
      impactLabel: `Save ∼${INR.format(taxSaved)}`,
      saving: taxSaved,
      sortValue: taxSaved,
      math: `(₹1,50,000 − ${INR.format(used)} used) × ${(slab * 100).toFixed(0)}% slab`,
      factors: { kind: "rule", signalStrength: 0.8, fit: 0.7 },
    },
  ];
}

function npsModule(data, profile) {
  const slab = profile.taxSlab || 0;
  if (slab <= 0) return [];
  const left = 50000 - (profile.npsExtraUsed || 0);
  if (left < 5000) return [];
  const taxSaved = left * slab;
  return [
    {
      id: "tax-nps",
      stream: "personalized",
      category: "tax",
      title: "NPS extra deduction unused",
      action: `Add ${INR.format(left)} to NPS for the 80CCD(1B) deduction — over and above 80C — saving about ${INR.format(taxSaved)} in tax.`,
      impactLabel: `Save ∼${INR.format(taxSaved)}`,
      saving: taxSaved,
      sortValue: taxSaved,
      math: `(₹50,000 − ${INR.format(profile.npsExtraUsed || 0)}) × ${(slab * 100).toFixed(0)}% slab`,
      factors: { kind: "rule", signalStrength: 0.8, fit: 0.6 },
    },
  ];
}

function freshnessDays(rate) {
  if (!rate?.as_of) return 0;
  return Math.max(0, (Date.now() - new Date(rate.as_of).getTime()) / 86_400_000);
}

function fdRenewModule(data, profile, market) {
  const best = market?.rates?.fd_1y;
  if (!best || !best.value) return [];
  const cards = [];
  for (const inv of data.investments ?? []) {
    if (!/fd|fixed.?deposit|deposit/i.test(inv.type || "")) continue;
    const rate = parseFloat(inv.interestRate ?? inv.rate);
    if (!Number.isFinite(rate)) continue;
    if (best.value <= rate + 0.3) continue;
    const principal = valueOf(inv);
    const delta = (principal * (best.value - rate)) / 100;
    if (delta < 300) continue;
    cards.push({
      id: `fd-${inv.id}`,
      stream: "personalized",
      category: "cash",
      title: `${inv.name || "FD"} is at ${rate}% — better rates exist`,
      action: `Best 1-yr FD now is ∼${best.value}%. On renewal, moving ${INR.format(principal)} earns about ${INR.format(delta)}/yr more.`,
      impactLabel: `Earn ∼${INR.format(delta)}/yr`,
      saving: delta,
      sortValue: delta,
      factors: { kind: "fact", signalStrength: Math.min(1, (best.value - rate) / 2), freshnessDays: freshnessDays(best) },
    });
  }
  return cards;
}

function generalizedModule(data, profile, market) {
  const r = market?.rates;
  if (!r) return [];
  const age = new Date().getFullYear() - profile.birthYear;
  const cards = [];

  if (r.gsec_10y?.value >= 6.9) {
    cards.push({
      id: "opp-gsec",
      stream: "opportunity",
      category: "allocation",
      title: `10-yr G-Sec near ${r.gsec_10y.value}%`,
      action: `Yields are attractive — if you can hold, locking duration via RBI Retail Direct (free) beats most FDs post-tax. Consider a debt slice here.`,
      impactLabel: `${r.gsec_10y.value}% yield`,
      saving: 0,
      sortValue: 3000,
      factors: { kind: "fact", signalStrength: 0.7, freshnessDays: freshnessDays(r.gsec_10y) },
    });
  }

  if (age >= 58 && r.scss?.value) {
    cards.push({
      id: "opp-scss",
      stream: "opportunity",
      category: "cash",
      title: `SCSS at ${r.scss.value}%`,
      action: `As a senior, the Senior Citizens Savings Scheme pays ${r.scss.value}% with quarterly payouts (₹30L limit) — among the safest high-yield options.`,
      impactLabel: `${r.scss.value}% guaranteed`,
      saving: 0,
      sortValue: 3500,
      factors: { kind: "fact", signalStrength: 0.8, freshnessDays: freshnessDays(r.scss) },
    });
  }

  if (profile.taxSlab >= 0.2 && r.arbitrage?.value && r.liquid_fund?.value) {
    cards.push({
      id: "opp-arbitrage",
      stream: "opportunity",
      category: "cash",
      title: "Park smarter at your tax slab",
      action: `For short-term parking, arbitrage funds are taxed as equity — at your ${(profile.taxSlab * 100).toFixed(0)}% slab that usually beats liquid funds post-tax for holdings over a few months.`,
      impactLabel: "Post-tax edge",
      saving: 0,
      sortValue: 2500,
      factors: { kind: "fact", signalStrength: 0.6, freshnessDays: freshnessDays(r.arbitrage) },
    });
  }

  return cards;
}

function holdYears(inv) {
  const s = inv.startDate || inv.purchaseDate;
  if (!s) return 0;
  const y = (Date.now() - new Date(s).getTime()) / (365 * 86_400_000);
  return Number.isFinite(y) ? y : 0;
}

function gainOf(inv) {
  return valueOf(inv) - (parseFloat(inv.investedAmount) || 0);
}

function mfDirectRegularModule(data) {
  const cards = [];
  for (const inv of data.investments ?? []) {
    const name = `${inv.name || ""}`;
    const isMf = /mutual|\bmf\b|sip|elss|fund/i.test(`${inv.type || ""} ${name}`);
    if (!isMf) continue;
    if (!/regular/i.test(name) || /direct/i.test(name)) continue;
    const value = valueOf(inv);
    const saving = value * 0.01; // typical Regular-vs-Direct expense drag
    if (saving < 200) continue;
    cards.push({
      id: `mf-direct-${inv.id}`,
      stream: "personalized",
      category: "tax",
      title: `${name} looks like a Regular plan`,
      action: `Regular plans carry a distributor commission (∼1%/yr). Switching this to the Direct plan saves about ${INR.format(saving)}/yr — same fund, lower cost.`,
      impactLabel: `Save ∼${INR.format(saving)}/yr`,
      saving,
      sortValue: saving,
      factors: { kind: "fact", signalStrength: 0.5 },
    });
  }
  return cards;
}

function ltcgModule(data, profile) {
  let gains = 0;
  for (const inv of data.investments ?? []) {
    if (assetClassOf(inv.type, data.investmentTypes) !== "equity") continue;
    if (holdYears(inv) < 1) continue;
    const g = gainOf(inv);
    if (g > 0) gains += g;
  }
  const freeLeft = 125000 - (profile.ltcgRealized || 0);
  if (freeLeft < 5000 || gains < 10000) return [];
  const bookable = Math.min(freeLeft, gains);
  const futureTaxSaved = bookable * 0.125;
  return [
    {
      id: "tax-ltcg",
      stream: "personalized",
      category: "tax",
      title: "Book equity gains tax-free",
      action: `₹1.25L of long-term equity gains are tax-free each year. You can book about ${INR.format(bookable)} now (you've used ${INR.format(profile.ltcgRealized || 0)}), reset your cost basis, and save ∼${INR.format(futureTaxSaved)} in future LTCG tax. Re-buy same day to keep the position.`,
      impactLabel: `Save ∼${INR.format(futureTaxSaved)}`,
      saving: futureTaxSaved,
      sortValue: futureTaxSaved,
      factors: { kind: "rule", signalStrength: 0.7, fit: 0.7 },
    },
  ];
}

function lossHarvestModule(data) {
  let loss = 0;
  for (const inv of data.investments ?? []) {
    if (assetClassOf(inv.type, data.investmentTypes) !== "equity") continue;
    const g = gainOf(inv);
    if (g < 0) loss += -g;
  }
  if (loss < 10000) return [];
  const taxSaved = loss * 0.15;
  return [
    {
      id: "tax-harvest",
      stream: "personalized",
      category: "tax",
      title: "Harvest your unrealized losses",
      action: `You're carrying about ${INR.format(loss)} of unrealized equity losses. Booking them offsets your capital gains and can save roughly ${INR.format(taxSaved)} in tax (re-buy same day — no wash-sale rule in India).`,
      impactLabel: `Save ∼${INR.format(taxSaved)}`,
      saving: taxSaved,
      sortValue: taxSaved,
      factors: { kind: "rule", signalStrength: 0.6, fit: 0.6 },
    },
  ];
}

function licReviewModule(data) {
  const cards = [];
  for (const inv of data.investments ?? []) {
    const s = `${inv.type || ""} ${inv.name || ""}`;
    if (!/lic|endowment|money.?back|traditional|policy/i.test(s)) continue;
    if (/term/i.test(s)) continue;
    cards.push({
      id: `lic-${inv.id}`,
      stream: "personalized",
      category: "risk",
      title: `Review ${inv.name || "this policy"}'s real return`,
      action: `Traditional endowment/money-back plans typically yield ∼4–6%. Compare continuing vs making it paid-up and redirecting the premium into term insurance + an index fund — often materially better over the term.`,
      impactLabel: "Worth a review",
      saving: 0,
      sortValue: 4000,
      factors: { kind: "forecast", signalStrength: 0.5, reliability: 0.5 },
    });
  }
  return cards;
}

function goalModule(data, profile) {
  const year = new Date().getFullYear();
  const cards = [];
  for (const g of profile.goals || []) {
    const target = parseFloat(g.targetAmount) || 0;
    const years = (parseInt(g.targetYear) || 0) - year;
    if (target <= 0 || years <= 0) continue;
    const r = years >= 7 ? 0.11 : years >= 3 ? 0.09 : 0.07;
    const i = r / 12;
    const n = years * 12;
    const sip = (target * i) / (Math.pow(1 + i, n) - 1);
    cards.push({
      id: `goal-${g.id}`,
      stream: "personalized",
      category: "goal",
      title: `${g.name || "Goal"} — ${INR.format(target)} by ${g.targetYear}`,
      action: `Invest about ${INR.format(sip)}/month for ${years} years (assuming ∼${(r * 100).toFixed(0)}% returns) to get there. Step it up with your income to reach it sooner.`,
      impactLabel: `${INR.format(sip)}/mo`,
      saving: 0,
      sortValue: 6000,
      factors: { kind: "forecast", signalStrength: 0.6, fit: 0.8, reliability: 0.7 },
    });
  }
  return cards;
}

function maturityModule(data) {
  const now = Date.now();
  const horizon = now + 60 * 86_400_000;
  const cards = [];
  for (const inv of data.investments ?? []) {
    const raw = inv.maturityDate || inv.maturesOn || inv.maturity;
    if (!raw) continue;
    const d = new Date(raw).getTime();
    if (!Number.isFinite(d) || d < now || d > horizon) continue;
    const days = Math.round((d - now) / 86_400_000);
    cards.push({
      id: `maturity-${inv.id}`,
      stream: "personalized",
      category: "calendar",
      title: `${inv.name || "Investment"} matures in ${days}d`,
      action: `Decide ahead of time: renew, move to a better rate, or redeploy ${INR.format(valueOf(inv))}.`,
      impactLabel: `${days} days`,
      saving: 0,
      sortValue: 100000 / (days + 1),
      factors: { kind: "fact", signalStrength: 0.6 },
    });
  }
  return cards;
}

// ── Phase 2 modules ──────────────────────────────────

function debtModule(data, profile) {
  const commitments = (data.commitments ?? []).filter(commitmentActive);
  if (commitments.length === 0) return [];
  const income = monthlyIncomeOf(data, profile);
  const totalEmi = commitments.reduce(
    (s, c) => s + (parseFloat(c.emiAmount) || 0),
    0,
  );
  const cards = [];

  if (income > 0) {
    const dti = totalEmi / income;
    if (dti > 0.4) {
      cards.push({
        id: "debt-dti",
        stream: "personalized",
        category: "risk",
        title: "EMIs are eating your income",
        action: `Your EMIs total ${INR.format(totalEmi)}/mo — about ${(dti * 100).toFixed(0)}% of income. Over 40% is stretched: avoid new loans and prioritise paying these down.`,
        impactLabel: `${(dti * 100).toFixed(0)}% DTI`,
        saving: 0,
        sortValue: totalEmi * dti,
        factors: { kind: "rule", signalStrength: Math.min(1, (dti - 0.4) / 0.3), fit: 0.7 },
      });
    }
  }

  const withRate = commitments
    .map((c) => ({ c, rate: parseFloat(c.interestRate ?? c.rate) }))
    .filter((x) => Number.isFinite(x.rate) && x.rate > 0)
    .sort((a, b) => b.rate - a.rate);
  if (withRate.length >= 1 && withRate[0].rate >= 10) {
    const top = withRate[0];
    const next = withRate[1];
    cards.push({
      id: `debt-avalanche-${top.c.id}`,
      stream: "personalized",
      category: "risk",
      title: `Attack ${top.c.name || "your priciest loan"} first`,
      action: `At ${top.rate}%, ${top.c.name || "this loan"} is your most expensive debt. Any spare cash prepaid here (the avalanche method) saves the most interest${next ? ` — clear it before the ${next.rate}% one` : ""}.`,
      impactLabel: `${top.rate}% rate`,
      saving: 0,
      sortValue: (parseFloat(top.c.emiAmount) || 0) * (top.rate / 100) * 12,
      factors: { kind: "rule", signalStrength: Math.min(1, top.rate / 24), fit: 0.6 },
    });
  }
  return cards;
}

function subscriptionAuditModule(data, profile) {
  const subs = data.subscriptions ?? [];
  const txns = data.transactions ?? [];
  if (subs.length === 0) return [];
  const income = monthlyIncomeOf(data, profile);
  const totals = subscriptionTotals(subs);
  const cards = [];

  if (totals.count >= 3 && totals.monthly > 0) {
    const pct = income > 0 ? totals.monthly / income : 0;
    cards.push({
      id: "subs-load",
      stream: "personalized",
      category: "cash",
      title: "Audit your subscriptions",
      action: `You're paying ${INR.format(totals.monthly)}/mo (${INR.format(totals.yearly)}/yr) across ${totals.count} subscriptions${pct > 0 ? ` — ${(pct * 100).toFixed(0)}% of income` : ""}. Cancel anything you haven't used this month; even trimming a couple adds up.`,
      impactLabel: `${INR.format(totals.yearly)}/yr`,
      saving: 0,
      sortValue: totals.monthly * 2,
      factors: { kind: "fact", signalStrength: Math.min(1, (pct || 0) / 0.1) },
    });
  }

  let hikes = 0;
  for (const sub of subs) {
    if (!isBilling(sub) || hikes >= 3) continue;
    const hike = detectAnomaly(sub, txns).find((f) => f.kind === "hike");
    if (!hike) continue;
    hikes += 1;
    const delta = hike.to - hike.from;
    cards.push({
      id: `subs-hike-${sub.id}`,
      stream: "personalized",
      category: "cash",
      title: `${sub.name} got more expensive`,
      action: `${hike.message}. That's ${INR.format(delta * 12)}/yr more — check if you still need it or can downgrade.`,
      impactLabel: `+${INR.format(delta)}/mo`,
      saving: 0,
      sortValue: delta * 12,
      factors: { kind: "fact", signalStrength: 0.6 },
    });
  }

  for (const sub of subs) {
    const t = trialStatus(sub);
    if (!t || !t.soon) continue;
    cards.push({
      id: `subs-trial-${sub.id}`,
      stream: "personalized",
      category: "cash",
      title: `${sub.name} trial ends in ${t.days}d`,
      action: `It starts charging ${INR.format(t.firstCharge)} on ${t.endsOn.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. Cancel now if you don't want it.`,
      impactLabel: `Avoid ${INR.format(t.firstCharge)}`,
      saving: t.firstCharge,
      sortValue: 5000,
      factors: { kind: "fact", signalStrength: 0.8 },
    });
  }
  return cards;
}

function cardUtilizationModule(data) {
  const cards = data.cards ?? [];
  const txns = data.transactions ?? [];
  const commitments = data.commitments ?? [];
  const out = [];
  for (const card of cards) {
    const limit = parseFloat(card.limit) || 0;
    if (limit <= 0) continue;
    const outstanding = computeCardOutstanding(card, txns, commitments);
    const util = outstanding / limit;
    if (util < 0.3) continue; // under 30% is healthy — stay quiet
    const payDown = Math.max(0, outstanding - limit * 0.3);
    const sev = util >= 0.7 ? "very high" : util >= 0.5 ? "high" : "a bit high";
    out.push({
      id: `card-util-${card.id}`,
      stream: "personalized",
      category: "risk",
      title: `${card.name} is ${(util * 100).toFixed(0)}% utilised`,
      action: `Using ${INR.format(outstanding)} of your ${INR.format(limit)} limit — ${sev}. Utilisation above 30% can drag your credit score${payDown > 0 ? `; paying ${INR.format(payDown)} brings it under 30%` : ""}. Clearing the balance in full also avoids ∼36–42% p.a. interest.`,
      impactLabel: `${(util * 100).toFixed(0)}% used`,
      saving: 0,
      sortValue: outstanding * (util >= 0.5 ? 0.1 : 0.05),
      factors: {
        kind: "rule",
        signalStrength: Math.min(1, (util - 0.3) / 0.7),
        fit: 0.7,
      },
    });
  }
  return out;
}

// Best-card routing: given each card's reward profile and the user's trailing
// spend per category, flag categories where moving spend to a card they already
// own would earn materially more rewards a year.
function cardBestModule(data) {
  const cards = (data.cards ?? []).filter(hasRewardInfo);
  if (cards.length < 2) return []; // need somewhere better to route spend
  const { byCard, annualize } = cardSpend(data, 3);
  const out = [];

  const categories = new Set();
  for (const id in byCard) for (const c in byCard[id].byCat) categories.add(c);

  for (const cat of categories) {
    let best = null;
    let bestRate = -1;
    for (const card of cards) {
      const r = effectiveRate(card, cat);
      if (r > bestRate) {
        bestRate = r;
        best = card;
      }
    }
    if (!best || bestRate <= 0) continue;

    // Opportunity = spend sitting on lower-earning cards × the rate gap.
    let annualGain = 0;
    let movedSpend = 0;
    for (const card of cards) {
      if (card.id === best.id) continue;
      const s = (byCard[card.id]?.byCat[cat] || 0) * annualize;
      if (s <= 0) continue;
      const gap = bestRate - effectiveRate(card, cat);
      if (gap <= 0) continue;
      annualGain += s * gap;
      movedSpend += s;
    }
    if (annualGain < 500) continue; // not worth the hassle

    out.push({
      id: `card-best-${cat}`,
      stream: "personalized",
      category: "cash",
      title: `Use ${best.name} for ${cat}`,
      action: `You put about ${INR.format(movedSpend)}/yr of ${cat} spend on lower-earning cards. ${best.name} pays ${(bestRate * 100).toFixed(1)}% there — routing ${cat} to it is roughly ${INR.format(annualGain)}/yr more in rewards.`,
      impactLabel: `+${INR.format(annualGain)}/yr`,
      saving: Math.round(annualGain),
      sortValue: annualGain,
      factors: {
        kind: "fact",
        signalStrength: Math.min(1, annualGain / 5000),
        fit: 0.6,
      },
    });
  }
  return out;
}

// Fee-vs-benefit: for each fee-carrying card, compare the annual fee to the
// rewards it actually earns (or nudge toward the spend that waives the fee).
function cardFeeModule(data) {
  const cards = data.cards ?? [];
  const { byCard, annualize } = cardSpend(data, 3);
  const out = [];

  for (const card of cards) {
    const fee = parseFloat(card.annualFee) || 0;
    if (fee <= 0) continue;
    const rec = byCard[card.id];
    const annualSpend = (rec?.total || 0) * annualize;
    const waiver = parseFloat(card.feeWaiverSpend) || 0;

    if (waiver > 0 && annualSpend >= waiver) continue; // fee already waived

    // Close to the waiver threshold — nudge to reach it.
    if (waiver > 0 && annualSpend >= waiver * 0.8) {
      const gap = waiver - annualSpend;
      out.push({
        id: `card-fee-${card.id}`,
        stream: "personalized",
        category: "cash",
        title: `${card.name}: ${INR.format(gap)} short of waiving its fee`,
        action: `You're on pace for about ${INR.format(annualSpend)}/yr; ${INR.format(waiver)} waives the ${INR.format(fee)} annual fee. Around ${INR.format(gap)} more routed here this year clears it.`,
        impactLabel: `save ${INR.format(fee)}`,
        saving: Math.round(fee),
        sortValue: fee,
        factors: { kind: "fact", signalStrength: 0.5, fit: 0.6 },
      });
      continue;
    }

    // Otherwise weigh the fee against rewards earned (needs reward info).
    if (!hasRewardInfo(card)) continue;
    const rewards = annualRewards(card, rec, annualize);
    if (rewards >= fee) continue; // the card pays for itself
    const net = fee - rewards;
    out.push({
      id: `card-fee-${card.id}`,
      stream: "personalized",
      category: "risk",
      title: `${card.name}'s fee outweighs its rewards`,
      action: `Its ${INR.format(fee)} annual fee vs about ${INR.format(rewards)} in rewards you're earning${waiver > 0 ? ` (you're below the ${INR.format(waiver)} waiver spend)` : ""}. Consider a no-fee variant, or concentrate spend here to justify it.`,
      impactLabel: `${INR.format(net)}/yr net cost`,
      saving: Math.round(net),
      sortValue: net,
      factors: {
        kind: "fact",
        signalStrength: Math.min(1, net / Math.max(fee, 1)),
        fit: 0.6,
      },
    });
  }
  return out;
}

function savingsRateModule(data, profile) {
  const income = monthlyIncomeOf(data, profile);
  if (income <= 0) return [];
  const expense = avgMonthlyExpense(data.transactions);
  const cards = [];
  const rate = (income - expense) / income;
  if (rate < 0.2 && expense > 0) {
    const gap = 0.2 * income - (income - expense);
    cards.push({
      id: "savings-rate",
      stream: "personalized",
      category: "cash",
      title: rate < 0 ? "You're spending more than you earn" : "Savings rate is low",
      action: `You're saving about ${(Math.max(0, rate) * 100).toFixed(0)}% of income (${INR.format(Math.max(0, income - expense))}/mo of ${INR.format(income)}). Aim for 20%+ — trimming ${INR.format(Math.max(0, gap))}/mo of spending gets you there.`,
      impactLabel: `${(rate * 100).toFixed(0)}% saved`,
      saving: 0,
      sortValue: Math.max(0, gap) * 3,
      factors: { kind: "rule", signalStrength: Math.min(1, (0.2 - rate) / 0.2), fit: 0.7 },
    });
  }

  const infl = quarterExpenseTrend(data.transactions);
  if (infl && infl.up > 0.15 && expense > 0) {
    cards.push({
      id: "lifestyle-inflation",
      stream: "personalized",
      category: "cash",
      title: "Spending is creeping up",
      action: `Your average spend rose ∼${(infl.up * 100).toFixed(0)}% vs the prior quarter (${INR.format(infl.prev)} → ${INR.format(infl.recent)}/mo). Check if it's one-off or lifestyle creep before it eats your savings.`,
      impactLabel: `+${(infl.up * 100).toFixed(0)}% spend`,
      saving: 0,
      sortValue: (infl.recent - infl.prev) * 3,
      factors: { kind: "fact", signalStrength: Math.min(1, infl.up) },
    });
  }
  return cards;
}

function sipStepUpModule(data) {
  const sips = (data.investments ?? []).filter(
    (i) => i.type === "sip" && !i.inHistory && !i.paused,
  );
  const totalSip = sips.reduce((s, i) => s + (parseFloat(i.monthlyAmount) || 0), 0);
  if (totalSip <= 0) return [];
  const r = 0.11 / 12;
  const n = 120;
  const fv = (m) => m * ((Math.pow(1 + r, n) - 1) / r);
  const bump = totalSip * 0.1;
  const extra = fv(totalSip + bump) - fv(totalSip);
  return [
    {
      id: "sip-stepup",
      stream: "personalized",
      category: "goal",
      title: "Step up your SIPs with your income",
      action: `You invest ${INR.format(totalSip)}/mo via SIP. Raising it ∼10% to ${INR.format(totalSip + bump)} as your income grows could add about ${INR.format(extra)} over 10 years (at ∼11%). Automate an annual step-up.`,
      impactLabel: `+${INR.format(extra)}/10y`,
      saving: 0,
      sortValue: 5500,
      factors: { kind: "forecast", signalStrength: 0.6, fit: 0.7, reliability: 0.7 },
    },
  ];
}

// ── Phase 3 modules (light profile input) ────────────

function insuranceModule(data, profile) {
  const monthly = monthlyIncomeOf(data, profile);
  if (monthly <= 0) return [];
  const annual = monthly * 12;
  const cards = [];

  const dep = parseInt(profile?.dependents) || 0;
  const factor = dep > 0 ? 15 : 10; // more dependents → more cover
  const recommended = annual * factor;
  const have = parseFloat(profile?.termCover) || 0;
  const gap = recommended - have;
  if (gap > recommended * 0.2) {
    cards.push({
      id: "insurance-term",
      stream: "personalized",
      category: "risk",
      title: have > 0 ? "Term cover looks light" : "No term life cover on record",
      action: `A rough guide is ${factor}× annual income — about ${INR.format(recommended)}${dep > 0 ? ` for ${dep} dependent${dep > 1 ? "s" : ""}` : ""}. You've noted ${INR.format(have)}, a gap of ${INR.format(gap)}. Pure term insurance is cheap — top it up.`,
      impactLabel: `${INR.format(gap)} gap`,
      saving: 0,
      sortValue: 7000,
      factors: { kind: "rule", signalStrength: 0.7, fit: 0.6 },
    });
  }

  const health = parseFloat(profile?.healthCover) || 0;
  if (health < 500000) {
    cards.push({
      id: "insurance-health",
      stream: "personalized",
      category: "risk",
      title: health > 0 ? "Health cover may be thin" : "No health cover on record",
      action: `One hospitalisation can wipe out savings. Aim for at least a ₹5–10L family floater${health > 0 ? ` — you've noted ${INR.format(health)}` : ""}. Add or top up before you need it.`,
      impactLabel: health > 0 ? `${INR.format(health)} cover` : "No cover",
      saving: 0,
      sortValue: 6500,
      factors: { kind: "rule", signalStrength: 0.7, fit: 0.6 },
    });
  }
  return cards;
}

function retirementModule(data, profile) {
  const monthlyExp = avgMonthlyExpense(data.transactions);
  if (monthlyExp <= 0) return [];
  const age = new Date().getFullYear() - profile.birthYear;
  const retireAge = parseInt(profile?.retireAge) || 60;
  const yearsLeft = retireAge - age;
  if (yearsLeft <= 0) return [];

  const infl = 0.06;
  const futureAnnualExp = monthlyExp * 12 * Math.pow(1 + infl, yearsLeft);
  const corpusNeeded = futureAnnualExp * 25; // 4% safe-withdrawal rule
  const { total: portfolioNow } = portfolioByClass(
    data.investments,
    data.investmentTypes,
  );
  const projected = portfolioNow * Math.pow(1.1, yearsLeft);
  const gap = corpusNeeded - projected;
  if (gap <= 0) return [];
  const r = 0.11 / 12;
  const n = yearsLeft * 12;
  const sip = (gap * r) / (Math.pow(1 + r, n) - 1);
  return [
    {
      id: "retire",
      stream: "personalized",
      category: "goal",
      title: "Retirement corpus — on track?",
      action: `To retire at ${retireAge} (${yearsLeft}y away) you'd need about ${INR.format(corpusNeeded)} (25× inflated expenses). Your investments project to ∼${INR.format(projected)} — a gap of ${INR.format(gap)}. Investing about ${INR.format(sip)}/mo more closes it.`,
      impactLabel: `${INR.format(sip)}/mo`,
      saving: 0,
      sortValue: 6000,
      math: `Need ${INR.format(corpusNeeded)} − projected ${INR.format(projected)} = ${INR.format(gap)} gap`,
      factors: { kind: "forecast", signalStrength: 0.6, fit: 0.7, reliability: 0.6 },
    },
  ];
}

function taxProgressive(income, slabs) {
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of slabs) {
    if (income <= prev) break;
    tax += (Math.min(income, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}
function taxOldRegime(taxable) {
  if (taxable <= 500000) return 0; // 87A rebate
  const slabs = [
    [250000, 0],
    [500000, 0.05],
    [1000000, 0.2],
    [Infinity, 0.3],
  ];
  return Math.round(taxProgressive(taxable, slabs) * 1.04); // + 4% cess
}
function taxNewRegime(taxable) {
  if (taxable <= 700000) return 0; // 87A rebate
  const slabs = [
    [300000, 0],
    [700000, 0.05],
    [1000000, 0.1],
    [1200000, 0.15],
    [1500000, 0.2],
    [Infinity, 0.3],
  ];
  return Math.round(taxProgressive(taxable, slabs) * 1.04);
}

function taxRegimeModule(data, profile) {
  const annual = monthlyIncomeOf(data, profile) * 12;
  if (annual < 500000) return [];
  const c80 = Math.min(150000, parseFloat(profile?.used80C) || 0);
  const nps = Math.min(50000, parseFloat(profile?.npsExtraUsed) || 0);
  const oldTaxable = Math.max(0, annual - 50000 - c80 - nps); // std deduction 50k
  const newTaxable = Math.max(0, annual - 75000); // new-regime std deduction 75k
  const oldTax = taxOldRegime(oldTaxable);
  const newTax = taxNewRegime(newTaxable);
  const saving = Math.abs(oldTax - newTax);
  if (saving < 2000) return [];
  const better = newTax < oldTax ? "new" : "old";
  return [
    {
      id: "tax-regime",
      stream: "personalized",
      category: "tax",
      title: `The ${better} tax regime saves you more`,
      action: `On ∼${INR.format(annual)} income with your deductions (80C ${INR.format(c80)}, NPS ${INR.format(nps)}), the ${better} regime is about ${INR.format(saving)} cheaper this year (Old ${INR.format(oldTax)} vs New ${INR.format(newTax)}). ${better === "old" ? "Maximise 80C/NPS to widen the gap." : "You may not need those lock-in deductions."}`,
      impactLabel: `Save ∼${INR.format(saving)}`,
      saving,
      sortValue: saving,
      math: `Old ${INR.format(oldTax)} (taxable ${INR.format(oldTaxable)}) vs New ${INR.format(newTax)} (taxable ${INR.format(newTaxable)})`,
      factors: { kind: "rule", signalStrength: 0.8, fit: 0.7 },
    },
  ];
}

const MODULES = [
  allocationModule,
  debtModule,
  subscriptionAuditModule,
  cardUtilizationModule,
  cardBestModule,
  cardFeeModule,
  savingsRateModule,
  sipStepUpModule,
  insuranceModule,
  retirementModule,
  taxRegimeModule,
  idleCashModule,
  emergencyFundModule,
  concentrationModule,
  eightyCModule,
  npsModule,
  mfDirectRegularModule,
  ltcgModule,
  lossHarvestModule,
  licReviewModule,
  goalModule,
  fdRenewModule,
  generalizedModule,
  maturityModule,
];

// `feedback` is the persisted preferences.advisoryFeedback blob — categories the
// user keeps dismissing are demoted in the ranking (see feedback.js).
export function runAdvisory(data, profile, market = {}, feedback = null) {
  const cards = MODULES.flatMap((m) => {
    try {
      return m(data, profile, market) || [];
    } catch {
      return [];
    }
  }).map(withConfidence);

  // Effective rank = impact × confidence × category fatigue weight.
  const rankOf = (c) =>
    c.sortValue * (c.confidence / 100) * categoryWeight(feedback, c.category);
  cards.sort((a, b) => rankOf(b) - rankOf(a));

  const reconciled = reconcile(cards);

  const moneyFound = reconciled.reduce((s, c) => s + (c.saving || 0), 0);
  return { cards: reconciled, moneyFound };
}
