import { nextRenewal as subscriptionNextRenewal } from "./subscriptionUtils";

// A card/commitment balance below half a rupee is treated as settled. Card
// bills are whole rupees, so anything smaller is a floating-point residual
// from summing charges against equal repayments — not a real due.
const SETTLED_EPS = 0.5;

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

// ── Card-funded EMI: the single source of truth ──────────────────────────
// A commitment is funded on a credit card iff it carries a `cardId`. The
// commitment form only sets `cardId` when "Credit Card" is chosen and clears it
// otherwise, so `cardId` alone is authoritative. `paymentMedium` is legacy and
// can drift out of sync — keying every path (billing total, the card ledger,
// and the due lists) off `cardId` guarantees they agree: a card EMI is always
// routed through its card's statement, never shown twice or on its raw due day.
export function emiCardId(commitment) {
  return commitment?.cardId || null;
}
export function isCardFundedEmi(commitment) {
  return !!commitment?.cardId;
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
  const billedEmis = getBilledCardEmiTotal(
    card.id,
    commitments,
    today,
    card.statementDay,
  );
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

// Most recent statement (billing) date on or before `ref`. Returns null when
// the card has no statement day configured — callers then fall back to a
// dueDay-only model. Day-of-month is clamped to the month length so a "31"
// statement day still resolves in February.
function lastStatementDate(statementDay, ref) {
  const day = parseInt(statementDay);
  if (!day) return null;
  const clamp = (y, m) => Math.min(day, new Date(y, m + 1, 0).getDate());
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const thisCycle = new Date(y, m, clamp(y, m));
  return thisCycle <= ref ? thisCycle : new Date(y, m - 1, clamp(y, m - 1));
}

// Payment due date for the statement generated on `stmt`: the first dueDay
// strictly after the statement date. This correctly handles the common case
// where dueDay < statementDay (statement on the 25th, payment due the 13th of
// the *following* month) instead of treating the bill as due the same month.
function dueDateForStatement(stmt, dueDay) {
  const clamp = (y, m) => Math.min(dueDay, new Date(y, m + 1, 0).getDate());
  const y = stmt.getFullYear();
  const m = stmt.getMonth();
  let due = new Date(y, m, clamp(y, m));
  if (due <= stmt) due = new Date(y, m + 1, clamp(y, m + 1));
  return due;
}

// Statement (billing) date for a specific year/month, clamped to month length.
function statementOn(statementDay, y, m) {
  const day = Math.min(parseInt(statementDay), new Date(y, m + 1, 0).getDate());
  return new Date(y, m, day);
}

// The card's next payment: the amount due and the date it's payable.
// Models real statement cycles. We enumerate statement dates from ~a year back
// to two cycles ahead and report the EARLIEST cycle that carries a positive
// balance (cumulative charges + EMIs billed by that statement − all repayments).
// This single sweep uniformly covers:
//   • overdue bills (a past statement still unpaid → negative diffDays),
//   • the current statement's bill,
//   • an UPCOMING bill that hasn't been statemented yet — e.g. a card whose
//     statement is today with an EMI that just billed, or an EMI whose first
//     instalment lands next cycle — so the user still sees what's coming.
// A post-statement purchase made after the bill was paid naturally lands on the
// next statement and is dated to its future due date, not shown as due now.
// EMIs billed to the card are folded in via getBilledCardEmiTotal (they don't
// appear as `cardId` transactions). Returns null when nothing is owed/upcoming.
export function getCardDue(card, allTransactions = [], commitments = [], now = new Date()) {
  const dueDay = parseInt(card?.dueDay);
  if (!dueDay) return null;
  const stmtDay = parseInt(card?.statementDay);

  const repayments = allTransactions
    .filter((t) => t.repaymentFor === card.id)
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  // Charges (txns + EMI instalments) billed on or before `cutoff`, net of all
  // repayments. Positive ⇒ that cycle's bill is still (partly) unpaid.
  // The cutoff is extended to the END of the statement day so a charge dated
  // ON the billing date (any time, or a date-only entry) is counted on THAT
  // statement — not pushed to the next cycle. Only charges dated a later day
  // roll forward.
  const unpaidAsOf = (cutoff) => {
    const dayEnd = new Date(
      cutoff.getFullYear(),
      cutoff.getMonth(),
      cutoff.getDate(),
      23,
      59,
      59,
      999,
    );
    return (
      allTransactions
        .filter((t) => t.cardId === card.id && new Date(t.occurredAt) <= dayEnd)
        .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) +
      getBilledCardEmiTotal(card.id, commitments, dayEnd, stmtDay) -
      repayments
    );
  };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const result = (amount, due) => ({
    amount,
    dueDate: due,
    diffDays: Math.round((due - today) / 86_400_000),
  });

  if (!stmtDay) {
    // Legacy fallback (no statement day): bill = everything owed now, due on
    // this month's dueDay, anchored until settled, else rolling to next month.
    const total = unpaidAsOf(now);
    if (!(total > SETTLED_EPS)) return null;
    const y = now.getFullYear();
    const m = now.getMonth();
    const clamp = (yy, mm) => Math.min(dueDay, new Date(yy, mm + 1, 0).getDate());
    const thisMonthDue = new Date(y, m, clamp(y, m));
    let due;
    if (thisMonthDue >= now) due = thisMonthDue;
    else if (unpaidAsOf(thisMonthDue) > SETTLED_EPS) due = thisMonthDue;
    else due = new Date(y, m + 1, clamp(y, m + 1));
    return result(Math.max(0, total), due);
  }

  // Sweep statement cycles oldest → newest and return the first unpaid one.
  const cur = lastStatementDate(stmtDay, now);
  for (let i = -14; i <= 2; i++) {
    const s = statementOn(stmtDay, cur.getFullYear(), cur.getMonth() + i);
    const bal = unpaidAsOf(s);
    if (bal > SETTLED_EPS) return result(bal, dueDateForStatement(s, dueDay));
  }
  return null;
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
// the user logs a repayment. Statement-cycle aware: the due date follows the
// latest statement, and post-statement charges don't pull the date forward.
export function daysUntilCardDue(card, allTransactions = [], commitments = []) {
  return getCardDue(card, allTransactions, commitments)?.diffDays ?? null;
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

// ── Installments billed: the single source of truth ──────────────────────
// How many EMI instalments have actually posted by `asOf`. Each instalment
// lands on the commitment's BILLING day (its own billingDay, else the card's
// statementDay, else the payment due day, else the start day-of-month),
// starting from getEmiFirstPaymentDate and capped at tenure. Billing-DAY aware,
// so the current month's instalment does NOT count until its bill is generated.
// Both the card bill total and the loan-progress bar route through this, so
// "how far along is this loan" can never disagree between the two views.
export function emiInstallmentsBilled(c, asOf = new Date(), statementDay) {
  const amt = parseFloat(c?.emiAmount) || 0;
  if (amt <= 0) return 0;
  const first = getEmiFirstPaymentDate(c);
  if (!first) return 0;
  const billingDay =
    parseInt(c.billingDay) ||
    parseInt(statementDay) ||
    parseInt(c.dueDay) ||
    (c.startDate ? new Date(c.startDate).getDate() : 1) ||
    1;
  const tenure = parseInt(c.tenureMonths) || 0;
  const cap = tenure > 0 ? tenure : 240; // safety cap for open-ended recurring
  let count = 0;
  for (let i = 0; i < cap; i++) {
    const y = first.getFullYear();
    const m = first.getMonth() + i;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const day = Math.min(billingDay, lastDay);
    if (new Date(y, m, day) > asOf) break;
    count += 1;
  }
  return count;
}

// Total of EMI installments billed by `today` across all credit-card-paid
// commitments routed to the given card — the cumulative EMI portion the card
// has been charged. Uses the shared instalment count so it agrees with the
// loan-progress bar and the card ledger.
export function getBilledCardEmiTotal(
  cardId,
  commitments,
  today = new Date(),
  statementDay,
) {
  let total = 0;
  for (const c of commitments) {
    if (emiCardId(c) !== cardId) continue;
    if (!commitmentIsActive(c)) continue;
    const amt = parseFloat(c.emiAmount) || 0;
    total += emiInstallmentsBilled(c, today, statementDay) * amt;
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

export function getUpcomingDues(
  cards,
  commitments,
  lendings,
  days = 30,
  allTransactions = [],
  subscriptions = [],
) {
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
    // Statement-cycle aware bill: only charges posted on/before the latest
    // statement date count toward the current due (post-statement purchases
    // roll to the next cycle), and the due date follows that statement. See
    // getCardDue for the full model.
    const info = getCardDue(card, allTransactions, commitments, now);
    if (!info || !(info.amount > SETTLED_EPS)) return;
    if (info.diffDays <= days)
      result.push({
        type: "card",
        id: card.id,
        name: card.name,
        amount: info.amount,
        dueDate: info.dueDate,
        diffDays: info.diffDays,
      });
  });

  commitments.forEach((c) => {
    if (!commitmentIsActive(c) || !c.dueDay) return;
    // Credit-card-paid commitments are already folded into the card row above
    // (statement-aware — they only appear once the bill is generated). Listing
    // them separately would mean two due dates for the same money, on the wrong
    // calendar day, and bypass the statement gate.
    if (isCardFundedEmi(c)) return;
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

  // Subscriptions renewing within the window. Reuses the subscription cycle
  // model so the due date and amount match what the Subscriptions page shows.
  subscriptions.forEach((s) => {
    if (s.status !== "active" && s.status !== "trial") return;
    const next = subscriptionNextRenewal(s, now);
    if (!next) return;
    const diff = Math.round((next - now) / 86_400_000);
    if (diff >= 0 && diff <= days)
      result.push({
        type: "subscription",
        id: s.id,
        name: s.name,
        amount: parseFloat(s.amount) || 0,
        dueDate: next,
        diffDays: diff,
      });
  });

  return result.sort((a, b) => a.dueDate - b.dueDate);
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
