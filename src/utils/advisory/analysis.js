import { computeAggregateBalance, computeAccountBalance } from "../accountUtils";
import { assetClassOf } from "./profile";
import { computeCardOutstanding, getCardDue } from "../solvencyUtils";
import {
  monthlyEquivalent,
  isBilling,
  isRecurring,
} from "../subscriptionUtils";
import {
  calcInvestmentValues,
  getTypeInfo,
  groupInvestmentsByTicker,
} from "../investmentUtils";

const DAY = 86_400_000;

function txTime(t) {
  return new Date(t.occurredAt || t.createdAt).getTime();
}

function monthBounds(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  return {
    start: new Date(y, m, 1).getTime(),
    end: new Date(y, m + 1, 1).getTime(),
    prevStart: new Date(y, m - 1, 1).getTime(),
  };
}

function cashflowTrend(txns, eligible, months = 6) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      label: d.toLocaleString("en-IN", { month: "short" }),
      start: d.getTime(),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
      income: 0,
      outflow: 0,
    });
  }
  for (const t of txns) {
    const d = txTime(t);
    if (!Number.isFinite(d)) continue;
    const b = buckets.find((x) => d >= x.start && d < x.end);
    if (!b || !eligible(t)) continue;
    const amt = parseFloat(t.amount) || 0;
    if (t.transactionType === "income") b.income += amt;
    else if (t.transactionType === "investment") b.outflow += amt;
    else if (t.transactionType === "expense" && !t.cardId) b.outflow += amt;
  }
  return buckets.map((b) => ({
    label: b.label,
    income: b.income,
    outflow: b.outflow,
    net: b.income - b.outflow,
  }));
}

function netWorthComposition(data, txns, closing, multiBank) {
  const accounts = data.accounts ?? [];
  const cards = data.cards ?? [];
  const commitments = data.commitments ?? [];
  const lendings = data.lendings ?? [];
  const types = data.investmentTypes;

  const invByClass = { equity: 0, debt: 0, gold: 0, alt: 0 };
  const itemsByClass = { equity: [], debt: [], gold: [], alt: [] };
  const typeById = new Map(
    (data.investments ?? []).map((i) => [i.id, i.type]),
  );
  const typeInfoOf = (typeKey) =>
    (types || []).find((t) => t.key === typeKey || t.id === typeKey) ||
    getTypeInfo(typeKey);
  for (const group of groupInvestmentsByTicker(data.investments ?? [])) {
    const { currentValue } = calcInvestmentValues(group, types);
    const v = currentValue || 0;
    if (v <= 0) continue;
    const cls = assetClassOf(group.type, types);
    const ids = group._ids ?? [group.id];
    const memberTypes = [
      ...new Set(ids.map((id) => typeById.get(id)).filter(Boolean)),
    ].sort((a, b) => (a === "sip" ? 1 : 0) - (b === "sip" ? 1 : 0));
    const hasSip = memberTypes.includes("sip");
    const combo = memberTypes.length > 1;
    const primaryType = memberTypes.find((t) => t !== "sip") || group.type;
    const info = typeInfoOf(primaryType);
    invByClass[cls] += v;
    itemsByClass[cls].push({
      label: group.name || info?.label || group.type,
      amount: v,
      typeLabel: combo
        ? memberTypes.map((t) => typeInfoOf(t)?.label || t).join(" + ")
        : info?.label,
      icon: info?.icon,
      color: info?.color,
      hasSip,
      combo,
    });
  }
  for (const cls of Object.keys(itemsByClass))
    itemsByClass[cls].sort((a, b) => b.amount - a.amount);

  const cashItems = multiBank
    ? accounts
        .map((a) => ({ label: a.bank, amount: computeAccountBalance(a, txns) }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount)
    : [];

  const lentItems = lendings
    .filter((l) => l.direction !== "borrowed" && (parseFloat(l.outstanding) || 0) > 0)
    .map((l) => ({ label: l.name, amount: parseFloat(l.outstanding) || 0 }));
  const borrowedItems = lendings
    .filter((l) => l.direction === "borrowed" && (parseFloat(l.outstanding) || 0) > 0)
    .map((l) => ({ label: l.name, amount: parseFloat(l.outstanding) || 0 }));
  const cardItems = cards
    .map((c) => ({
      label: c.name || c.bank || "Card",
      amount: computeCardOutstanding(c, txns, commitments),
    }))
    .filter((x) => x.amount > 0);
  const loanItems = commitments
    .filter((c) => c.type === "emi" && (parseFloat(c.outstanding) || 0) > 0)
    .map((c) => ({ label: c.name, amount: parseFloat(c.outstanding) || 0 }));

  const sum = (arr) => arr.reduce((s, x) => s + x.amount, 0);

  const assets = [
    { label: "Cash", amount: closing, cls: "cash", items: cashItems },
    { label: "Equity", amount: invByClass.equity, cls: "equity", items: itemsByClass.equity },
    { label: "Fixed income", amount: invByClass.debt, cls: "debt", items: itemsByClass.debt },
    { label: "Gold", amount: invByClass.gold, cls: "gold", items: itemsByClass.gold },
    { label: "Alternatives", amount: invByClass.alt, cls: "alt", items: itemsByClass.alt },
    { label: "Lent out", amount: sum(lentItems), cls: "lent", items: lentItems },
  ].filter((a) => a.amount > 0);
  const liabilities = [
    { label: "Money borrowed", amount: sum(borrowedItems), items: borrowedItems },
    { label: "Card dues", amount: sum(cardItems), items: cardItems },
    { label: "Loans outstanding", amount: sum(loanItems), items: loanItems },
  ].filter((l) => l.amount > 0);

  const grossAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiab = liabilities.reduce((s, l) => s + l.amount, 0);
  return {
    netWorth: grossAssets - totalLiab,
    grossAssets,
    totalLiab,
    assets,
    liabilities,
  };
}

function resolveTypeInfo(typeKey, types) {
  return (
    (types || []).find((t) => t.key === typeKey || t.id === typeKey) ||
    getTypeInfo(typeKey)
  );
}

const MONTHLY_AMOUNT_KEYS = [
  "monthlyContribution",
  "monthlyAmount",
  "monthlyPremium",
];

function isPastTenure(inv) {
  const tenure = parseInt(inv.tenureMonths) || 0;
  if (tenure > 0 && inv.startDate) {
    const elapsed =
      (Date.now() - new Date(inv.startDate).getTime()) / (30.44 * DAY);
    if (elapsed >= tenure) return true;
  }
  return false;
}

// Types whose periodic contribution genuinely varies each cycle (chit-fund
// auctions, etc.) — surfaced with a "varies" indicator since the figure shown
// is only the latest/expected amount.
const VARIABLE_CONTRIBUTION = new Set(["chit_fund"]);

// The contribution actually due in the target calendar month — math-type
// agnostic. Periodic premiums (LIC) land at full amount only in their due
// months; everything with a recurring monthly field is due every month.
function investmentObligation(inv, monthNum) {
  if (isPastTenure(inv)) return 0;
  if (inv.type === "lic") {
    const prem = parseFloat(inv.premiumAmount) || 0;
    if (prem <= 0) return 0;
    const months = Array.isArray(inv.premiumMonths) ? inv.premiumMonths : [];
    if (months.length) return months.includes(monthNum) ? prem : 0;
    const freq = parseFloat(inv.frequency) || 1;
    return (prem * freq) / 12;
  }
  for (const k of MONTHLY_AMOUNT_KEYS) {
    const v = parseFloat(inv[k]);
    if (!isNaN(v) && v > 0) return v;
  }
  if (inv.type === "rd" || inv.type === "plan") {
    const v = parseFloat(inv.investedAmount) || 0;
    if (v > 0) return v;
  }
  return 0;
}

function recurringLoad(data, txns) {
  const subs = data.subscriptions ?? [];
  const commitments = data.commitments ?? [];
  const cards = data.cards ?? [];
  const investments = data.investments ?? [];
  const types = data.investmentTypes;
  const byAmt = (a, b) => b.amount - a.amount;
  const sum = (arr) => arr.reduce((s, x) => s + x.amount, 0);

  const n = new Date();
  const target = new Date(n.getFullYear(), n.getMonth() + 1, 1);
  const monthNum = target.getMonth() + 1;

  const emiItems = commitments
    .filter((c) => c.type === "emi" && (parseFloat(c.outstanding) || 0) > 0)
    .map((c) => ({ label: c.name, amount: parseFloat(c.emiAmount) || 0 }))
    .filter((x) => x.amount > 0)
    .sort(byAmt);
  const subItems = subs
    .filter((s) => isBilling(s) && isRecurring(s))
    .map((s) => ({ label: s.name, amount: monthlyEquivalent(s) }))
    .filter((x) => x.amount > 0)
    .sort(byAmt);
  const investItems = investments
    .map((inv) => ({ inv, amount: investmentObligation(inv, monthNum) }))
    .filter((x) => x.amount > 0)
    .map(({ inv, amount }) => {
      const info = resolveTypeInfo(inv.type, types);
      return {
        label: inv.name || info?.label || inv.type,
        amount,
        icon: info?.icon,
        color: info?.color,
        typeLabel: info?.label,
        variable: VARIABLE_CONTRIBUTION.has(inv.type),
      };
    })
    .sort(byAmt);
  // Card bills only load the target month once the statement has actually been
  // generated (the bill has arrived). getCardDue is statement-cycle aware — it
  // counts only charges billed on/before the latest statement (billed charges +
  // billed EMIs − repayments), so unbilled / post-statement purchases don't get
  // pulled forward. We include a card's bill when it's payable in the target
  // month OR it's already overdue (a past-due bill still has to be cleared, so
  // it carries into the upcoming load — flagged so it reads as overdue).
  const cardItems = cards
    .map((c) => {
      const due = getCardDue(c, txns, commitments);
      if (!due || due.amount <= 0) return null;
      const dd = due.dueDate;
      const dueInTarget =
        dd.getFullYear() === target.getFullYear() &&
        dd.getMonth() === target.getMonth();
      const overdue = due.diffDays < 0;
      if (!dueInTarget && !overdue) return null;
      return { label: c.name || c.bank || "Card", amount: due.amount, overdue };
    })
    .filter((x) => x && x.amount > 0)
    .sort(byAmt);

  const emi = sum(emiItems);
  const subscriptions = sum(subItems);
  const investMonthly = sum(investItems);
  const cardDues = sum(cardItems);
  const fixedTotal = emi + subscriptions + investMonthly;
  const total = fixedTotal + cardDues;

  const cutoff = Date.now() - 365 * DAY;
  let income12 = 0;
  const incomeMonthsSet = new Set();
  for (const t of txns) {
    if (t.transactionType !== "income" || t.lendingId) continue;
    const d = txTime(t);
    if (Number.isFinite(d) && d >= cutoff) {
      income12 += parseFloat(t.amount) || 0;
      const dt = new Date(d);
      incomeMonthsSet.add(`${dt.getFullYear()}-${dt.getMonth()}`);
    }
  }
  const incomeMonths = Math.min(12, Math.max(1, incomeMonthsSet.size));
  const override = parseFloat(data.preferences?.advisoryProfile?.monthlyIncome);
  const incomeFromProfile = Number.isFinite(override) && override > 0;
  const monthlyIncome = incomeFromProfile ? override : income12 / incomeMonths;

  const categories = [
    { key: "emi", label: "Loan EMIs", amount: emi, items: emiItems },
    { key: "subs", label: "Subscriptions", amount: subscriptions, items: subItems },
    {
      key: "inv",
      label: "Recurring investments",
      amount: investMonthly,
      items: investItems,
    },
    {
      key: "card",
      label: "Card bill",
      amount: cardDues,
      items: cardItems,
    },
  ].filter((c) => c.amount > 0);

  return {
    month: target.toLocaleString("en-IN", { month: "long" }),
    monthLabel: target.toLocaleString("en-IN", { month: "long", year: "numeric" }),
    total,
    fixed: { emi, subscriptions, investments: investMonthly, total: fixedTotal },
    cardDues,
    monthlyIncome,
    incomeMonths,
    incomeFromProfile,
    pct: monthlyIncome > 0 ? total / monthlyIncome : null,
    categories,
  };
}

export function runAnalysis(data = {}) {
  const txns = data.transactions ?? [];
  const accounts = data.accounts ?? [];
  const cards = data.cards ?? [];
  const multiBank =
    (data.preferences?.multiBankEnabled ?? false) && accounts.length > 0;
  const eligible = (t) =>
    !multiBank || t.transactionType === "self_transfer" || !!t.accountId;

  const now = new Date();
  const { start, end, prevStart } = monthBounds(now);
  const prevEnd = start;

  const closing = multiBank
    ? computeAggregateBalance(accounts, txns)
    : parseFloat(data.insights?.balance) || 0;

  let income = 0;
  let expensesOut = 0;
  let investOut = 0;
  let cardSpend = 0;
  for (const t of txns) {
    const d = txTime(t);
    if (!Number.isFinite(d) || d < start || d >= end) continue;
    const amt = parseFloat(t.amount) || 0;
    if (t.transactionType === "income") {
      if (eligible(t)) income += amt;
    } else if (t.transactionType === "investment") {
      if (eligible(t)) investOut += amt;
    } else if (t.transactionType === "expense") {
      if (t.cardId) cardSpend += amt;
      else if (eligible(t)) expensesOut += amt;
    }
  }
  const netFlow = income - expensesOut - investOut;
  const opening = closing - netFlow;
  const waterfall = {
    opening,
    income,
    expenses: expensesOut,
    investments: investOut,
    closing,
    cardSpend,
    netFlow,
  };

  const catNow = new Map();
  const catPrev = new Map();
  const srcNow = new Map();
  let spendTotal = 0;
  let spendPrev = 0;
  for (const t of txns) {
    if (t.transactionType !== "expense") continue;
    const d = txTime(t);
    if (!Number.isFinite(d)) continue;
    const amt = parseFloat(t.amount) || 0;
    const cat = t.category || "Uncategorised";
    if (d >= start && d < end) {
      catNow.set(cat, (catNow.get(cat) || 0) + amt);
      spendTotal += amt;
      const srcKey = t.cardId
        ? `card:${t.cardId}`
        : t.accountId
          ? `acct:${t.accountId}`
          : "untagged";
      srcNow.set(srcKey, (srcNow.get(srcKey) || 0) + amt);
    } else if (d >= prevStart && d < prevEnd) {
      catPrev.set(cat, (catPrev.get(cat) || 0) + amt);
      spendPrev += amt;
    }
  }
  const byCategory = [...catNow.entries()]
    .map(([label, amount]) => ({
      label,
      amount,
      prev: catPrev.get(label) || 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const bySource = [...srcNow.entries()]
    .map(([key, amount]) => {
      if (key.startsWith("card:")) {
        const c = cardById.get(key.slice(5));
        return { label: c?.name || "Credit card", amount, kind: "card", bank: c?.bank };
      }
      if (key.startsWith("acct:")) {
        const a = acctById.get(key.slice(5));
        return {
          label: a?.bank || "Bank",
          amount,
          kind: "bank",
          bank: a?.bank,
          color: a?.color,
        };
      }
      return { label: "Untagged", amount, kind: "untagged" };
    })
    .sort((a, b) => b.amount - a.amount);

  const spending = { total: spendTotal, prevTotal: spendPrev, byCategory, bySource };

  const cutoff = Date.now() - 90 * DAY;
  let exp90 = 0;
  for (const t of txns) {
    if (t.transactionType !== "expense" || t.cardId) continue;
    const d = txTime(t);
    if (Number.isFinite(d) && d >= cutoff) exp90 += parseFloat(t.amount) || 0;
  }
  const monthlyExpense = exp90 / 3;
  const months = monthlyExpense > 0 ? closing / monthlyExpense : null;
  const runway = { cash: closing, monthlyExpense, months };

  const trend = cashflowTrend(txns, eligible);
  const netWorth = netWorthComposition(data, txns, closing, multiBank);
  const recurring = recurringLoad(data, txns);

  return {
    period: {
      label: now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
      start,
      end,
    },
    waterfall,
    spending,
    runway,
    trend,
    netWorth,
    recurring,
    hasData: txns.length > 0,
  };
}
