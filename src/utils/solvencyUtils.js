export function calcPrincipalFromEMI(emi, annualRate, tenureMonths) {
  if (!emi || !tenureMonths) return 0;
  if (!annualRate) return emi * tenureMonths;
  const R = annualRate / 1200;
  return emi * ((Math.pow(1 + R, tenureMonths) - 1) / (R * Math.pow(1 + R, tenureMonths)));
}

export function calcEMI(principal, annualRate, tenureMonths) {
  if (!principal || !tenureMonths) return 0;
  if (!annualRate) return Math.round((principal / tenureMonths) * 100) / 100;
  const R = annualRate / 1200;
  const emi =
    (principal * R * Math.pow(1 + R, tenureMonths)) /
    (Math.pow(1 + R, tenureMonths) - 1);
  return Math.round(emi * 100) / 100;
}

// Projects outstanding forward from a known snapshot value
export function calcOutstandingFromSnapshot(snapshot, annualRate, emi, monthsElapsed) {
  if (monthsElapsed <= 0) return Math.max(0, snapshot);
  if (!annualRate) return Math.max(0, snapshot - emi * monthsElapsed);
  const R = annualRate / 1200;
  const result =
    snapshot * Math.pow(1 + R, monthsElapsed) -
    emi * ((Math.pow(1 + R, monthsElapsed) - 1) / R);
  return Math.max(0, Math.round(result * 100) / 100);
}

export function calcOutstanding(principal, annualRate, tenureMonths, paidMonths) {
  if (!principal || !tenureMonths) return 0;
  if (!annualRate) {
    return Math.max(0, principal - (principal / tenureMonths) * paidMonths);
  }
  const R = annualRate / 1200;
  const emi = calcEMI(principal, annualRate, tenureMonths);
  const outstanding =
    principal * Math.pow(1 + R, paidMonths) -
    emi * ((Math.pow(1 + R, paidMonths) - 1) / R);
  return Math.max(0, Math.round(outstanding * 100) / 100);
}

export function cardUtilization(card) {
  const limit = parseFloat(card.limit) || 0;
  const outstanding = parseFloat(card.outstanding) || 0;
  if (limit === 0) return 0;
  return Math.min(1, outstanding / limit);
}

// Live outstanding for a card — cumulative pre-today charges + EMI
// instalments billed up to now, minus all repayments tagged for this
// card. Same recipe used inside getUpcomingDues; extracted so the
// repayment picker can filter cards the user actually owes money on
// without duplicating the formula.
export function computeCardOutstanding(
  card,
  allTransactions = [],
  commitments = [],
  today = new Date(),
) {
  if (!card?.id) return 0;
  const txOutstanding = allTransactions
    .filter((t) => t.cardId === card.id)
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const repayments = allTransactions
    .filter((t) => t.repaymentFor === card.id)
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const billedEmis = getBilledCardEmiTotal(card.id, commitments, today);
  return Math.max(0, txOutstanding + billedEmis - repayments);
}

export function commitmentProgress(commitment) {
  const total = parseFloat(commitment.totalAmount) || 0;
  const outstanding = parseFloat(commitment.outstanding) || 0;
  if (total === 0) return 0;
  return Math.min(100, Math.round(((total - outstanding) / total) * 100));
}

export function monthsRemaining(commitment) {
  const outstanding = parseFloat(commitment.outstanding) || 0;
  const emi = parseFloat(commitment.emiAmount) || 0;
  if (emi === 0) return 0;
  return Math.ceil(outstanding / emi);
}

// True when the card's bill for `dueDate` still has unsettled charges.
// Mirrors the dashboard's overdueCount model: cumulative pre-due charges
// minus all repayments tagged for this card. We use the cumulative-repayment
// view rather than "any repayment this month" so partial payments and
// out-of-cycle payments (e.g., paid in late April for a May 1 due) are
// correctly accounted for.
//
// Commitments paid via this card (EMIs, subscriptions billed to the card)
// don't show up as `cardId` transactions, but they ARE part of the card's
// bill — paying the card settles them too. Each active commitment routed
// through this card contributes one `emiAmount` per cycle that has already
// elapsed up to `dueDate`.
function cardBillUnpaid(card, allTransactions, commitments, dueDate) {
  const oldCharges = allTransactions
    .filter((t) => t.cardId === card.id && new Date(t.occurredAt) < dueDate)
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const repayments = allTransactions
    .filter((t) => t.repaymentFor === card.id)
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  let cardPaidEmis = 0;
  for (const c of commitments ?? []) {
    if (c?.paymentMedium !== "credit_card") continue;
    if (c?.cardId !== card.id) continue;
    if (!commitmentIsActive(c)) continue;
    // Only count EMIs that have actually started billing by this cycle.
    // A loan disbursed in March with first-payment April should not appear
    // on March's card bill.
    if (!isEmiBilledByMonth(c, dueDate.getFullYear(), dueDate.getMonth())) continue;
    cardPaidEmis += parseFloat(c.emiAmount) || 0;
  }
  return oldCharges + cardPaidEmis - repayments > 0;
}

// True when an EMI commitment has a repayment logged this calendar month
// (either against the commitment directly, or via the card it's billed to).
function commitmentPaidThisMonth(commitment, allTransactions) {
  const now = new Date();
  return allTransactions.some((t) => {
    if (t.repaymentFor !== commitment.id && t.repaymentFor !== commitment.cardId)
      return false;
    const d = new Date(t.occurredAt ?? t.createdAt);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  });
}

// Days until the card's next due date, payment-aware. Negative means the
// current cycle's bill is unpaid and overdue — and it stays negative until
// the user logs a repayment. Only rolls to the next cycle once the current
// bill is settled. This is the correct fix for the silent-rollforward bug
// where a card with an unpaid May 1 bill was showing "28d left" on May 5.
export function daysUntilCardDue(card, allTransactions = [], commitments = []) {
  const day = parseInt(card?.dueDay);
  if (!day) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonthDue = new Date(now.getFullYear(), now.getMonth(), day);
  const nextMonthDue = new Date(now.getFullYear(), now.getMonth() + 1, day);

  if (thisMonthDue >= today) {
    return Math.round((thisMonthDue - today) / 86_400_000);
  }
  if (cardBillUnpaid(card, allTransactions, commitments, thisMonthDue)) {
    return -Math.round((today - thisMonthDue) / 86_400_000);
  }
  return Math.round((nextMonthDue - today) / 86_400_000);
}

// Days until the EMI commitment's next due date, payment-aware. Stays
// negative (overdue) until a repayment is logged for the current cycle.
export function daysUntilCommitmentDue(commitment, allTransactions = []) {
  const day = parseInt(commitment?.dueDay);
  if (!day) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonthDue = new Date(now.getFullYear(), now.getMonth(), day);
  const nextMonthDue = new Date(now.getFullYear(), now.getMonth() + 1, day);

  if (thisMonthDue >= today) {
    return Math.round((thisMonthDue - today) / 86_400_000);
  }
  if (commitmentPaidThisMonth(commitment, allTransactions)) {
    return Math.round((nextMonthDue - today) / 86_400_000);
  }
  return -Math.round((today - thisMonthDue) / 86_400_000);
}

// Defaults match the original hardcoded behaviour — passing no config keeps
// existing callers working.
const HEALTH_SCORE_DEFAULTS = {
  utilThresholds: [
    { upTo: 0.3, penalty: 0 },
    { upTo: 0.5, penalty: 10 },
    { upTo: 0.7, penalty: 20 },
    { upTo: 0.9, penalty: 30 },
    { upTo: 1.01, penalty: 40 },
  ],
  borrowingChunk: 10000,
  borrowingStep: 2,
  borrowingCap: 25,
  overdueDays: 3,
  commitmentOverduePerItem: 7,
  commitmentOverdueCap: 20,
  cardOverduePerItem: 7,
  cardOverdueCap: 15,
  grades: [
    { atLeast: 80, label: "Excellent", color: "#34d17b" },
    { atLeast: 65, label: "Good", color: "#a8c55a" },
    { atLeast: 50, label: "Fair", color: "#d4a35a" },
    { atLeast: 30, label: "Poor", color: "#d4735a" },
    { atLeast: 0, label: "Critical", color: "#c45858" },
  ],
};

export function calcHealthScore(cards, commitments, lendings, config = {}) {
  const cfg = { ...HEALTH_SCORE_DEFAULTS, ...config };
  let score = 100;
  const deductions = [];

  // Credit utilization
  if (cards.length > 0) {
    const avgUtil =
      cards.reduce((s, c) => s + cardUtilization(c), 0) / cards.length;
    const bracket = cfg.utilThresholds.find((t) => avgUtil < t.upTo) ??
      cfg.utilThresholds[cfg.utilThresholds.length - 1];
    const utilPenalty = bracket.penalty;
    score -= utilPenalty;
    if (utilPenalty > 0)
      deductions.push({
        reason: `Avg credit utilization ${(avgUtil * 100).toFixed(0)}%`,
        points: utilPenalty,
      });
  }

  // Net borrowing position
  const totalBorrowed = lendings
    .filter((l) => l.direction === "borrowed")
    .reduce((s, l) => s + (parseFloat(l.outstanding) || 0), 0);
  const totalLent = lendings
    .filter((l) => l.direction === "lent")
    .reduce((s, l) => s + (parseFloat(l.outstanding) || 0), 0);
  if (totalBorrowed > totalLent) {
    const net = totalBorrowed - totalLent;
    const penalty = Math.min(
      cfg.borrowingCap,
      Math.floor(net / cfg.borrowingChunk) * cfg.borrowingStep,
    );
    score -= penalty;
    if (penalty > 0)
      deductions.push({ reason: "Net outstanding borrowings", points: penalty });
  }

  // Commitment overdue
  const now = new Date();
  const overdueCommitments = commitments.filter((c) => {
    if (!commitmentIsActive(c)) return false;
    const dueDay = parseInt(c.dueDay);
    if (!dueDay) return false;
    const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
    if (dueDate > now) return false;
    return (now - dueDate) / 86_400_000 > cfg.overdueDays;
  });
  const commitmentPenalty = Math.min(
    cfg.commitmentOverdueCap,
    overdueCommitments.length * cfg.commitmentOverduePerItem,
  );
  score -= commitmentPenalty;
  if (commitmentPenalty > 0)
    deductions.push({
      reason: `${overdueCommitments.length} overdue commitment${overdueCommitments.length !== 1 ? "s" : ""}`,
      points: commitmentPenalty,
    });

  // Card past due
  const overdueCards = cards.filter((c) => {
    if (!(parseFloat(c.outstanding) > 0)) return false;
    const dueDay = parseInt(c.dueDay);
    if (!dueDay) return false;
    const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
    if (dueDate > now) return false;
    return (now - dueDate) / 86_400_000 > cfg.overdueDays;
  });
  const cardPenalty = Math.min(
    cfg.cardOverdueCap,
    overdueCards.length * cfg.cardOverduePerItem,
  );
  score -= cardPenalty;
  if (cardPenalty > 0)
    deductions.push({
      reason: `${overdueCards.length} card${overdueCards.length !== 1 ? "s" : ""} past due`,
      points: cardPenalty,
    });

  const finalScore = Math.max(0, Math.round(score));
  const grade =
    cfg.grades.find((g) => finalScore >= g.atLeast) ??
    cfg.grades[cfg.grades.length - 1];

  return { score: finalScore, grade: grade.label, color: grade.color, deductions };
}

// First-billed month for an EMI, as a "YYYY-MM" string. Either the user's
// explicit `firstPaymentMonth` or the month after `startDate` (the standard
// banking convention: loan disbursed in March, first EMI billed in April).
export function getEmiFirstPaymentMonth(c) {
  if (c?.firstPaymentMonth) return c.firstPaymentMonth;
  if (!c?.startDate) return null;
  const d = new Date(c.startDate);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Date object at the 1st of the first-billed month for an EMI.
export function getEmiFirstPaymentDate(c) {
  const ym = getEmiFirstPaymentMonth(c);
  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

// True if this EMI has been billed at least once by the given calendar month.
export function isEmiBilledByMonth(c, year, month /* 0-indexed */) {
  const ym = getEmiFirstPaymentMonth(c);
  if (!ym) return true; // no info — preserve legacy behaviour
  const [fy, fm] = ym.split("-").map(Number);
  if (year > fy) return true;
  if (year < fy) return false;
  return month >= fm - 1;
}

// True if this EMI is on its first-billed month or later. Used to filter
// "is the EMI active right now" checks that should ignore future-dated EMIs.
function isEmiBilledNow(c) {
  const now = new Date();
  return isEmiBilledByMonth(c, now.getFullYear(), now.getMonth());
}

// Total of EMI installments billed by `today` across all credit-card-paid
// commitments routed to the given card. Each installment is counted only if
// its calendar date (commitment dueDay of that month) is on or before today.
// This represents the cumulative EMI portion that the card has been charged.
export function getBilledCardEmiTotal(cardId, commitments, today = new Date()) {
  let total = 0;
  for (const c of commitments) {
    if (c?.paymentMedium !== "credit_card") continue;
    if (c?.cardId !== cardId) continue;
    if (!commitmentIsActive(c)) continue;
    const amt = parseFloat(c.emiAmount) || 0;
    if (amt <= 0) continue;
    const first = getEmiFirstPaymentDate(c);
    if (!first) continue;
    const dueDay =
      parseInt(c.dueDay) ||
      (c.startDate ? new Date(c.startDate).getDate() : 1) ||
      1;
    const tenure = parseInt(c.tenureMonths) || 0;
    const cap = tenure > 0 ? tenure : 240; // safety cap for open-ended recurring
    for (let i = 0; i < cap; i++) {
      const y = first.getFullYear();
      const m = first.getMonth() + i;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const day = Math.min(dueDay, lastDay);
      const d = new Date(y, m, day);
      if (d > today) break;
      total += amt;
    }
  }
  return total;
}

export function commitmentIsActive(c) {
  if ((parseFloat(c.emiAmount) || 0) <= 0) return false;
  if (c.type !== "emi") return true;
  if (c.currentOutstanding != null) {
    const refDate = c.currentOutstandingDate || c.startDate;
    if (!refDate) return c.currentOutstanding > 0;
    const d = new Date(refDate);
    const now = new Date();
    const elapsed = Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
    return calcOutstandingFromSnapshot(c.currentOutstanding, c.interestRate || 0, parseFloat(c.emiAmount), elapsed) > 0;
  }
  if (!c.startDate || !c.tenureMonths) return true;
  // Future-dated EMI (e.g., disbursed today, first bill next month) is still
  // "active" — it just hasn't been billed yet. Count installments from the
  // first-billed month, not the disbursement date, so a 12-month EMI starting
  // April runs April → next March instead of finishing one month early.
  const first = getEmiFirstPaymentDate(c);
  const now = new Date();
  if (!first) return true;
  const monthsBilled = Math.max(
    0,
    (now.getFullYear() - first.getFullYear()) * 12 +
      (now.getMonth() - first.getMonth()) +
      1, // include the current month if it's on/after first-billed
  );
  if (!isEmiBilledNow(c)) return true; // not started billing yet → still active
  return Math.max(0, parseInt(c.tenureMonths) - (monthsBilled - 1)) > 0;
}

export function getUpcomingDues(cards, commitments, lendings, days = 30, allTransactions = []) {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth();

  // Returns true if a repayment for the obligation (or any of the fallback IDs)
  // was recorded this calendar month. For an EMI commitment paid via credit card,
  // paying the card bill counts as settling the EMI too.
  function paidThisMonth(id, ...fallbackIds) {
    const valid = new Set([id, ...fallbackIds].filter(Boolean));
    return allTransactions.some((t) => {
      if (!valid.has(t.repaymentFor)) return false;
      const d = new Date(t.occurredAt ?? t.createdAt);
      return d.getFullYear() === yr && d.getMonth() === mo;
    });
  }

  const result = [];

  cards.forEach((card) => {
    // Card bill = total ever charged (transactions + EMI installments billed
    // so far) minus total repayments. Treating txns and EMI as one shared
    // liability against which repayments are applied is the only way to get
    // the right answer when the user pays the card bill (which historically
    // covered both at once). Using a max-of-zero floor on txns alone would
    // hide unpaid balance whenever cumulative repayments exceeded card-tagged
    // transactions because past EMIs were also being paid through them.
    const txOutstanding = allTransactions
      .filter((t) => t.cardId === card.id)
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const repayments = allTransactions
      .filter((t) => t.repaymentFor === card.id)
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const billedEmis = getBilledCardEmiTotal(card.id, commitments, now);
    const amount = Math.max(0, txOutstanding + billedEmis - repayments);
    if (!(amount > 0)) return;
    const dueDay = parseInt(card.dueDay);
    const thisMonthDue = new Date(yr, mo, dueDay);
    // Stay anchored on this month's due date until the bill is actually
    // settled. Rolling to next month silently is what masked overdue bills.
    let due;
    if (thisMonthDue >= now) {
      due = thisMonthDue;
    } else if (cardBillUnpaid(card, allTransactions, commitments, thisMonthDue)) {
      due = thisMonthDue;
    } else {
      due = new Date(yr, mo + 1, dueDay);
    }
    const diff = Math.round((due - now) / 86_400_000);
    if (diff <= days)
      result.push({
        type: "card",
        id: card.id,
        name: card.name,
        amount,
        dueDate: due,
        diffDays: diff,
      });
  });

  commitments.forEach((c) => {
    if (!commitmentIsActive(c) || !c.dueDay) return;
    // Credit-card-paid commitments are already folded into the card row above.
    // Listing them separately would mean the user sees two due dates for the
    // same money (and on the wrong calendar day).
    if (c.paymentMedium === "credit_card" && c.cardId) return;
    const dueDay = parseInt(c.dueDay);
    const thisMonthDue = new Date(yr, mo, dueDay);
    const paid = paidThisMonth(c.id, c.cardId);
    let due;
    if (thisMonthDue >= now) {
      due = thisMonthDue;
    } else if (paid) {
      due = new Date(yr, mo + 1, dueDay);
    } else {
      due = thisMonthDue; // stay overdue until repayment is logged
    }
    const diff = Math.round((due - now) / 86_400_000);
    if (diff <= days)
      result.push({
        type: "commitment",
        id: c.id,
        name: c.name,
        amount: parseFloat(c.emiAmount) || 0,
        dueDate: due,
        diffDays: diff,
        cardId: null,
      });
  });

  lendings
    .filter((l) => l.direction === "borrowed" && l.expectedReturn)
    .forEach((l) => {
      if (!(parseFloat(l.outstanding) > 0)) return;
      const due = new Date(l.expectedReturn);
      const diff = Math.round((due - now) / 86_400_000);
      if (diff <= days)
        result.push({
          type: "lending",
          id: l.id,
          name: `Return to ${l.name}`,
          amount: parseFloat(l.outstanding),
          dueDate: due,
          diffDays: diff,
        });
    });

  return result.sort((a, b) => a.dueDate - b.dueDate);
}

// Returns array[31] where index i = day (i+1), each with an items array
export function getDueCalendar(cards, commitments) {
  const calendar = Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    items: [],
  }));

  cards.forEach((card) => {
    const day = parseInt(card.dueDay);
    if (day >= 1 && day <= 31 && parseFloat(card.outstanding) > 0)
      calendar[day - 1].items.push({
        type: "card",
        name: card.name,
        amount: parseFloat(card.outstanding),
        color: card.color || "#4a90d9",
      });
  });

  commitments.forEach((c) => {
    // Credit-card-paid commitments are part of the card's bill — already
    // represented by the card item above. Don't mark them on their own day.
    if (c.paymentMedium === "credit_card" && c.cardId) return;
    const day = parseInt(c.dueDay);
    if (day >= 1 && day <= 31 && commitmentIsActive(c))
      calendar[day - 1].items.push({
        type: "commitment",
        name: c.name,
        amount: parseFloat(c.emiAmount) || 0,
        color: COMMITMENT_TYPES.find((t) => t.key === c.type)?.color ?? "#808080",
      });
  });

  return calendar;
}

export const COMMITMENT_TYPES = [
  { key: "emi", label: "EMI / Loan", color: "#5b8dee", icon: "fa-building-columns" },
  { key: "subscription", label: "Subscription", color: "#d4a35a", icon: "fa-rotate" },
  { key: "rent", label: "Rent", color: "#34d17b", icon: "fa-house" },
  { key: "insurance", label: "Insurance", color: "#9b8ea6", icon: "fa-shield-halved" },
  { key: "other", label: "Other", color: "#808080", icon: "fa-ellipsis" },
];

export function getCommitmentTypeInfo(key) {
  return (
    COMMITMENT_TYPES.find((t) => t.key === key) ??
    COMMITMENT_TYPES.find((t) => t.key === "other")
  );
}
