import {
  commitmentIsActive,
  daysUntilCardDue,
  daysUntilCommitmentDue,
} from "./solvencyUtils";
import { commitmentOutstanding } from "./solvencyStats";

const INR0 = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function monthsAgo(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

const dueWord = (days) =>
  days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`;

// Ranked, actionable debt insights from the user's OWN data. Pure. `cards` must
// be enriched (carry `.outstanding`/`.poolOutstanding`/`.poolLimit`).
export function solvencyInsights(
  cards = [],
  commitments = [],
  lendings = [],
  transactions = [],
) {
  const out = [];
  const active = commitments.filter(commitmentIsActive);

  // 1. Overdue + due-soon — cards then commitments.
  for (const card of cards) {
    const days = daysUntilCardDue(card, transactions, commitments);
    if (days == null) continue;
    if (days < 0) {
      out.push({
        id: `overdue-card-${card.id}`,
        kind: "overdue",
        weight: 100,
        icon: "fa-triangle-exclamation",
        title: `${card.name} bill is overdue`,
        detail: `Due ${Math.abs(days)}d ago — clear it to dodge interest & late fees.`,
      });
    } else if (days <= 4) {
      out.push({
        id: `due-card-${card.id}`,
        kind: "due",
        weight: 85,
        icon: "fa-clock",
        title: `${card.name} payment due ${dueWord(days)}`,
        detail: "Statement due date is coming up.",
      });
    }
  }
  for (const c of active) {
    const days = daysUntilCommitmentDue(c, transactions);
    if (days == null) continue;
    const emi = parseFloat(c.emiAmount) || 0;
    if (days < 0) {
      out.push({
        id: `overdue-emi-${c.id}`,
        kind: "overdue",
        weight: 98,
        icon: "fa-triangle-exclamation",
        title: `${c.name} EMI is overdue`,
        detail: `Due ${Math.abs(days)}d ago — ${INR0(emi)}.`,
      });
    } else if (days <= 4) {
      out.push({
        id: `due-emi-${c.id}`,
        kind: "due",
        weight: 80,
        icon: "fa-clock",
        title: `${c.name} EMI due ${dueWord(days)}`,
        detail: `${INR0(emi)} payment.`,
      });
    }
  }

  // 2. Utilization guardrail — the single worst card over 50% (pools deduped).
  const seenPools = new Set();
  let worst = null;
  for (const card of cards) {
    const lim = parseFloat(card.poolLimit || card.limit) || 0;
    if (!lim) continue;
    if (card.creditGroupId) {
      if (seenPools.has(card.creditGroupId)) continue;
      seenPools.add(card.creditGroupId);
    }
    const bal =
      card.poolOutstanding != null
        ? card.poolOutstanding
        : parseFloat(card.outstanding) || 0;
    const util = bal / lim;
    if (util >= 0.5 && (!worst || util > worst.util))
      worst = { card, util, lim, bal };
  }
  if (worst) {
    const target = worst.bal - 0.3 * worst.lim;
    out.push({
      id: `util-${worst.card.id}`,
      kind: "util",
      weight: 65,
      icon: "fa-gauge-high",
      title: `${worst.card.name} at ${Math.round(worst.util * 100)}% utilization`,
      detail:
        target > 0
          ? `Pay ${INR0(target)} before the statement to drop under 30% and protect your score.`
          : "High utilization drags your credit score down.",
    });
  }

  // 3. Avalanche — highest-rate active loan (kills the most interest).
  const withRate = active.filter((c) => (parseFloat(c.interestRate) || 0) > 0);
  if (withRate.length) {
    const top = withRate.reduce((a, b) =>
      (parseFloat(b.interestRate) || 0) > (parseFloat(a.interestRate) || 0)
        ? b
        : a,
    );
    out.push({
      id: `avalanche-${top.id}`,
      kind: "avalanche",
      weight: 55,
      icon: "fa-fire",
      title: `Attack ${top.name} first`,
      detail: `Highest rate at ${parseFloat(top.interestRate)}% — extra payments here cut the most interest.`,
    });
  }

  // 4. Snowball — smallest active balance (momentum).
  if (active.length >= 2) {
    const withOut = active
      .map((c) => ({ c, bal: commitmentOutstanding(c) }))
      .filter((x) => x.bal > 0);
    if (withOut.length >= 2) {
      const small = withOut.reduce((a, b) => (b.bal < a.bal ? b : a));
      out.push({
        id: `snowball-${small.c.id}`,
        kind: "snowball",
        weight: 48,
        icon: "fa-snowflake",
        title: `Quick win: ${small.c.name}`,
        detail: `Smallest balance at ${INR0(small.bal)} — clear it first for momentum.`,
      });
    }
  }

  // 5. Stale lendings — lent, still outstanding, older than ~4 months.
  for (const l of lendings) {
    if (l.direction !== "lent") continue;
    const bal = parseFloat(l.outstanding) || 0;
    if (bal <= 0) continue;
    const m = monthsAgo(l.date);
    if (m >= 4) {
      out.push({
        id: `stale-${l.id}`,
        kind: "stale",
        weight: 44,
        icon: "fa-hourglass-half",
        title: `${INR0(bal)} lent to ${l.name || "someone"}`,
        detail: `${m} months ago — worth a follow-up?`,
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight);
}
