import {
  calcOutstanding,
  calcOutstandingFromSnapshot,
  calcPrincipalFromEMI,
  commitmentIsActive,
  isCardFundedEmi,
} from "./solvencyUtils";

function monthsSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.max(
    0,
    (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()),
  );
}

// Amortized outstanding for one commitment — mirrors the per-card EMI math in
// SolvencyPage's enrichedCards, so totals here agree with the card view.
export function commitmentOutstanding(c) {
  const emi = parseFloat(c.emiAmount) || 0;
  if (c.currentOutstanding != null) {
    return calcOutstandingFromSnapshot(
      c.currentOutstanding,
      c.interestRate || 0,
      emi,
      monthsSince(c.currentOutstandingDate || c.startDate),
    );
  }
  const tenure = parseInt(c.tenureMonths) || 0;
  const principal = calcPrincipalFromEMI(emi, c.interestRate || 0, tenure);
  if (!principal || !tenure) return emi;
  const paid = Math.min(monthsSince(c.startDate), tenure);
  return calcOutstanding(principal, c.interestRate || 0, tenure, paid);
}

// Estimated months left on a commitment (from tenure, else outstanding/EMI).
export function commitmentRemainingMonths(c) {
  const emi = parseFloat(c.emiAmount) || 0;
  const tenure = parseInt(c.tenureMonths) || 0;
  if (tenure) return Math.max(0, tenure - monthsSince(c.startDate));
  const out = commitmentOutstanding(c);
  return emi > 0 ? Math.ceil(out / emi) : 0;
}

// Pool-aware total credit limit (cards sharing a creditGroupId count once).
function totalCreditLimit(cards) {
  const seen = new Set();
  let total = 0;
  for (const c of cards) {
    if (c.creditGroupId) {
      if (seen.has(c.creditGroupId)) continue;
      seen.add(c.creditGroupId);
      total += parseFloat(c.poolLimit) || parseFloat(c.limit) || 0;
    } else {
      total += parseFloat(c.limit) || 0;
    }
  }
  return total;
}

// One aggregation pass for the hero + health gauge. `cards` must be enriched
// (carry `.outstanding`). Card-funded EMIs are already inside card.outstanding,
// so only NON-card commitments are added — no double count.
export function solvencyTotals(cards = [], commitments = [], lendings = []) {
  const active = commitments.filter(commitmentIsActive);
  const totalCardOutstanding = cards.reduce(
    (s, c) => s + (parseFloat(c.outstanding) || 0),
    0,
  );
  const loanOutstanding = active
    .filter((c) => !isCardFundedEmi(c))
    .reduce((s, c) => s + commitmentOutstanding(c), 0);
  const totalOwed = totalCardOutstanding + loanOutstanding;
  const monthlyEMI = active.reduce(
    (s, c) => s + (parseFloat(c.emiAmount) || 0),
    0,
  );
  const totalLimit = totalCreditLimit(cards);
  const utilization =
    totalLimit > 0 ? totalCardOutstanding / totalLimit : null;
  const netLent =
    lendings
      .filter((l) => l.direction === "lent")
      .reduce((s, l) => s + (parseFloat(l.outstanding) || 0), 0) -
    lendings
      .filter((l) => l.direction === "borrowed")
      .reduce((s, l) => s + (parseFloat(l.outstanding) || 0), 0);

  let debtFreeDate = null;
  for (const c of active) {
    const rem = commitmentRemainingMonths(c);
    if (rem > 0) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() + rem);
      if (!debtFreeDate || d > debtFreeDate) debtFreeDate = d;
    }
  }

  return {
    totalOwed,
    totalCardOutstanding,
    loanOutstanding,
    monthlyEMI,
    totalLimit,
    utilization,
    netLent,
    debtFreeDate,
  };
}

// Heuristic solvency score (NOT a credit score) — 100 minus factor deductions.
// `flags` = { overdue, stale } counts (from solvencyInsights) fold in as factors.
export function computeSolvencyHealth(totals, monthlyIncome = 0, flags = {}) {
  const deductions = [];
  const { utilization, monthlyEMI } = totals;

  if (flags.overdue) {
    deductions.push({
      reason: `${flags.overdue} overdue payment${flags.overdue > 1 ? "s" : ""}`,
      points: Math.min(30, flags.overdue * 15),
    });
  }

  if (utilization != null) {
    if (utilization >= 0.6)
      deductions.push({ reason: "Credit utilization over 60%", points: 26 });
    else if (utilization >= 0.3)
      deductions.push({ reason: "Credit utilization 30–60%", points: 12 });
  }

  if (monthlyIncome > 0) {
    const dti = monthlyEMI / monthlyIncome;
    if (dti >= 0.5)
      deductions.push({ reason: "EMIs over 50% of income", points: 26 });
    else if (dti >= 0.35)
      deductions.push({ reason: "EMIs 35–50% of income", points: 15 });
    else if (dti >= 0.2)
      deductions.push({ reason: "EMIs 20–35% of income", points: 6 });
  }

  if (flags.stale) {
    deductions.push({
      reason: `${flags.stale} stale lending${flags.stale > 1 ? "s" : ""}`,
      points: Math.min(12, flags.stale * 6),
    });
  }

  const score = Math.max(0, 100 - deductions.reduce((s, d) => s + d.points, 0));
  const grade =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";
  const color =
    score >= 70
      ? "var(--amount-income)"
      : score >= 45
        ? "#d4a35a"
        : "var(--amount-expense)";
  return { score, grade, color, deductions };
}
