import {memo, useState, useMemo, useEffect, useCallback, useRef} from "react";
import {useSearchParams} from "react-router-dom";
import { useDeepLinkNav } from "../hooks/useDeepLinkNav";
import { useLedger } from "../hooks/useLedger";
import { useCoreData } from "../hooks/useCoreData";
import {useSelector, useDispatch} from "react-redux";
import {motion, AnimatePresence} from "framer-motion";
import Modal from "../preStyledElements/modal/Modal";
import DateField from "../components/DateField";
import BankLogo from "../components/BankLogo";
import CardForm from "../Forms/CardForm";
import CommitmentForm from "../Forms/CommitmentForm";
import LendingForm from "../Forms/LendingForm";
import BankChipSelector from "../components/BankChipSelector";
import {
  persistAddCard,
  persistUpdateCard,
  persistDeleteCard,
  persistAddCommitment,
  persistUpdateCommitment,
  persistDeleteCommitment,
  persistAddLending,
  persistUpdateLending,
  persistDeleteLending,
  persistRepayLending,
} from "../redux/slices/solvencySlice";
import {
  commitmentIsActive,
  getEmiFirstPaymentDate,
  calcPrincipalFromEMI,
  calcOutstanding,
  calcOutstandingFromSnapshot,
  daysUntilCardDue,
  daysUntilCommitmentDue,
  getUpcomingDues,
  getCommitmentTypeInfo,
  emiCardId,
  isCardFundedEmi,
  emiInstallmentsBilled,
  COMMITMENT_TYPES,
} from "../utils/solvencyUtils";
import { subscriptionTotals } from "../utils/subscriptionUtils";
import {
  solvencyTotals,
  computeSolvencyHealth,
  commitmentRemainingMonths,
} from "../utils/solvencyStats";
import { solvencyInsights } from "../utils/solvencyInsights";
import { resolveMonthlyIncome } from "../utils/incomeUtils";
import useCountUp from "../hooks/useCountUp";
import Reveal from "../components/Reveal";
import "../styles/solvency.css";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const accordionTransition = {
  height: {duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94]},
  opacity: {duration: 0.2},
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Stable per-month key for grouping ledger entries.
function monthKeyOf(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

// Card-ledger month separator label: "May 2026".
function formatMonthLabel(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

// ── Statement-cycle grouping ──────────────────────────
// A card's billing cycle closes on `statementDay` (inclusive — a charge made
// ON the statement day lands on that bill) and runs from the day after the
// previous close. So for a card whose statement day isn't the 1st, one cycle
// straddles two calendar months. We name the cycle by its closing month (the
// statement the bank generates) and show the covered date range beneath it.

// Closing date of the statement cycle that a given charge falls into.
function statementCloseDate(iso, statementDay) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth();
  const closeThis = Math.min(statementDay, new Date(y, m + 1, 0).getDate());
  if (d.getDate() <= closeThis) return new Date(y, m, closeThis);
  // Past this month's close → belongs to next month's statement.
  const nextLast = new Date(y, m + 2, 0).getDate();
  return new Date(y, m + 1, Math.min(statementDay, nextLast));
}

// Stable per-cycle key. Falls back to calendar month when no statement day.
function cycleKeyOf(iso, statementDay) {
  if (!iso) return "unknown";
  if (!statementDay) return monthKeyOf(iso);
  const c = statementCloseDate(iso, statementDay);
  return `${c.getFullYear()}-${c.getMonth()}-${c.getDate()}`;
}

// Separator content: { month: "May 2026", range: "19 Apr – 18 May" }.
function formatCycleLabel(iso, statementDay) {
  if (!iso) return {month: "—", range: ""};
  if (!statementDay) return {month: formatMonthLabel(iso), range: ""};
  const close = statementCloseDate(iso, statementDay);
  const start = new Date(close);
  start.setMonth(start.getMonth() - 1);
  start.setDate(start.getDate() + 1);
  const dayMon = {day: "numeric", month: "short"};
  return {
    month: close.toLocaleDateString("en-IN", {month: "long", year: "numeric"}),
    range: `${start.toLocaleDateString("en-IN", dayMon)} – ${close.toLocaleDateString("en-IN", dayMon)}`,
  };
}

function monthsSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.max(
    0,
    (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  );
}

function fmtDuration(months) {
  if (!months) return "";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}M`;
  if (m === 0) return `${y}Y`;
  return `${y}Y ${m}M`;
}

// ── EMI Bill Card ─────────────────────────────────────

function EMIBill({commitment, onDismiss}) {
  const emi = parseFloat(commitment.emiAmount) || 0;
  const rate = parseFloat(commitment.interestRate) || 0;
  const tenure = parseInt(commitment.tenureMonths) || 0;

  const monthsPaid = (() => {
    if (!commitment.startDate) return 0;
    const start = new Date(commitment.startDate);
    const now = new Date();
    return Math.max(
      0,
      (now.getFullYear() - start.getFullYear()) * 12 +
        (now.getMonth() - start.getMonth())
    );
  })();

  const principal = calcPrincipalFromEMI(emi, rate, tenure);
  const outstandingBefore =
    commitment.currentOutstanding != null
      ? calcOutstandingFromSnapshot(
          commitment.currentOutstanding,
          rate,
          emi,
          monthsSince(commitment.currentOutstandingDate || commitment.startDate)
        )
      : calcOutstanding(principal, rate, tenure, monthsPaid);
  const R = rate / 1200;
  const interestComponent =
    rate > 0 ? Math.round(outstandingBefore * R * 100) / 100 : 0;
  const principalComponent = Math.round((emi - interestComponent) * 100) / 100;
  const outstandingAfter = Math.max(
    0,
    Math.round((outstandingBefore - principalComponent) * 100) / 100
  );
  const remaining = tenure > 0 ? Math.max(0, tenure - monthsPaid - 1) : 0;

  return (
    <div className="sol-emi-bill">
      <div className="sol-emi-bill-header">
        <div className="sol-emi-bill-title-wrap">
          <span className="sol-emi-bill-tag">
            <i className="fa-solid fa-file-invoice" /> EMI Due Today
          </span>
          <div className="sol-emi-bill-name">{commitment.name}</div>
        </div>
        <button className="sol-icon-btn" onClick={onDismiss} title="Dismiss">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      <div className="sol-emi-bill-body">
        <div className="sol-emi-bill-row sol-emi-bill-row--total">
          <span>Monthly EMI</span>
          <span>{INR.format(emi)}</span>
        </div>
        {rate > 0 && (
          <>
            <div className="sol-emi-bill-row sol-emi-bill-row--sub">
              <span>Interest component</span>
              <span>{INR.format(interestComponent)}</span>
            </div>
            <div className="sol-emi-bill-row sol-emi-bill-row--sub">
              <span>Principal component</span>
              <span>{INR.format(principalComponent)}</span>
            </div>
          </>
        )}
        <div className="sol-emi-bill-divider" />
        <div className="sol-emi-bill-row">
          <span>Outstanding now</span>
          <span style={{color: "var(--amount-expense)"}}>
            {INR.format(outstandingBefore)}
          </span>
        </div>
        <div className="sol-emi-bill-row">
          <span>After this payment</span>
          <span style={{color: "var(--amount-income)"}}>
            {INR.format(outstandingAfter)}
          </span>
        </div>
        {remaining > 0 && (
          <div className="sol-emi-bill-row sol-emi-bill-row--sub">
            <span>Instalments remaining</span>
            <span>{remaining}</span>
          </div>
        )}
        {remaining === 0 && tenure > 0 && (
          <div className="sol-emi-bill-row sol-emi-bill-row--final">
            <i className="fa-solid fa-circle-check" /> Last instalment — loan
            closes after this payment
          </div>
        )}
      </div>
    </div>
  );
}

// ── Health Score Circle ────────────────────────────────

function HealthScoreCircle({score, grade, color, deductions}) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="sol-overview-hero">
      <div className="sol-score-wrap">
        <svg viewBox="0 0 100 100" className="sol-score-ring">
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="var(--surface-border)"
            strokeWidth="9"
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{transition: "stroke-dashoffset 0.8s ease"}}
          />
        </svg>
        <div className="sol-score-center">
          <span className="sol-score-num">{score}</span>
          <span className="sol-score-grade" style={{color}}>
            {grade}
          </span>
        </div>
      </div>

      <div className="sol-score-deductions">
        {deductions.length === 0 ? (
          <span className="sol-score-all-good">
            <i className="fa-solid fa-circle-check" /> All clear — no deductions
          </span>
        ) : (
          <>
            <p className="sol-score-ded-title">Score deductions</p>
            {deductions.map((d, i) => (
              <div key={i} className="sol-score-ded-item">
                <span>{d.reason}</span>
                <span className="sol-score-ded-pts">−{d.points}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Funding-source pill (shared) ──────────────────────
//
// Renders a small "via {Card Name}" or "from bank" pill underneath
// a commitment's name in the Overview tab. The pill answers the
// recurring user question: "this EMI is in my obligations — where
// does the money actually leave from?"
//
// For commitment-type dues only. Looks up the original commitment by
// id (so it reads the canonical cardId off the source record, not the
// nullable copy that getUpcomingDues sometimes strips), then resolves
// the card name from the cards array.

function NextDueSource({ next, commitments, cards }) {
  if (!next || next.type !== "commitment") return null;
  const commitment = (commitments ?? []).find((c) => c.id === next.id);
  if (!commitment) return null;
  const cardId = commitment.cardId;
  if (!cardId) return null;
  const card = (cards ?? []).find((c) => c.id === cardId);
  return (
    <div className="sol-hero-next-source">
      <i className="fa-solid fa-credit-card" />
      <span>
        via <strong>{card ? card.name : "deleted card"}</strong>
      </span>
    </div>
  );
}

// ── This Month Hero ───────────────────────────────────

function ThisMonthCard({cards, commitments, lendings, allTransactions, dueWindows}) {
  const subscriptions = useSelector(
    (state) => state.transactions.transactionData?.subscriptions ?? [],
  );
  const activeCommitments = commitments.filter(commitmentIsActive);
  const monthlyFixed =
    activeCommitments.reduce((s, c) => s + (parseFloat(c.emiAmount) || 0), 0) +
    subscriptionTotals(subscriptions).monthly;
  const overdueDays = dueWindows?.overdueDays ?? 3;
  const soonDays = dueWindows?.soonDays ?? 7;
  const upcomingDays = dueWindows?.upcomingDays ?? 30;

  const overdueCount = useMemo(() => {
    // Use the same statement-cycle- and payment-aware helpers that drive each
    // card/commitment row, so the hero badge can't disagree with them. Both
    // return a negative day count once a bill is past due and stay negative
    // until a repayment is logged; the grace window is `overdueDays`.
    let n = 0;
    cards.forEach((c) => {
      const days = daysUntilCardDue(c, allTransactions, commitments);
      if (days != null && days < -overdueDays) n++;
    });
    commitments.filter(commitmentIsActive).forEach((c) => {
      // EMIs paid via a credit card settle when the card bill is paid — the
      // card's own row already accounts for them, so don't double-flag here.
      if (isCardFundedEmi(c)) return;
      const days = daysUntilCommitmentDue(c, allTransactions);
      if (days != null && days < -overdueDays) n++;
    });
    return n;
  }, [cards, commitments, allTransactions, overdueDays]);

  const upcoming = useMemo(
    () =>
      getUpcomingDues(
        cards,
        commitments,
        lendings,
        upcomingDays,
        allTransactions,
        subscriptions,
      ).filter((d) => d.diffDays >= 0),
    [cards, commitments, lendings, allTransactions, upcomingDays, subscriptions]
  );
  const next = upcoming[0];
  const dueSoon = upcoming.filter((d) => d.diffDays <= soonDays).length;

  const badgeClass =
    overdueCount > 0
      ? "sol-hero-badge--warn"
      : dueSoon > 0
      ? "sol-hero-badge--soon"
      : "sol-hero-badge--ok";
  const badgeIcon =
    overdueCount > 0
      ? "fa-triangle-exclamation"
      : dueSoon > 0
      ? "fa-clock"
      : "fa-circle-check";
  const badgeText =
    overdueCount > 0
      ? `${overdueCount} overdue`
      : dueSoon > 0
      ? `${dueSoon} due this week`
      : "All clear";

  return (
    <div className="sol-hero-card">
      <div className="sol-hero-top">
        <div>
          <p className="sol-hero-label">Monthly obligations</p>
          <p className="sol-hero-amount">{INR.format(monthlyFixed)}</p>
        </div>
        <span className={`sol-hero-badge ${badgeClass}`}>
          <i className={`fa-solid ${badgeIcon}`} /> {badgeText}
        </span>
      </div>
      {next && (
        <div className="sol-hero-next-wrap">
          <div className="sol-hero-next">
            <span className="sol-hero-next-label">Next due</span>
            <span className="sol-hero-next-name">{next.name}</span>
            <span className="sol-hero-next-amount">
              {INR.format(next.amount)}
            </span>
            <span className="sol-hero-next-days">
              {next.diffDays === 0 ? "today" : `in ${next.diffDays}d`}
            </span>
          </div>
          <NextDueSource next={next} commitments={commitments} cards={cards} />
        </div>
      )}
    </div>
  );
}

// ── Obligations Breakdown ─────────────────────────────

function ObligationsBar({commitments}) {
  const active = useMemo(
    () => commitments.filter(commitmentIsActive),
    [commitments]
  );
  if (active.length === 0) return null;

  const byType = COMMITMENT_TYPES.map((t) => ({
    ...t,
    total: active
      .filter((c) => c.type === t.key)
      .reduce((s, c) => s + (parseFloat(c.emiAmount) || 0), 0),
  })).filter((t) => t.total > 0);

  const total = byType.reduce((s, t) => s + t.total, 0);

  return (
    <div className="sol-section">
      <div className="sol-section-header">
        <p className="sol-section-title">Obligations breakdown</p>
        <span className="sol-section-aside">{INR.format(total)}/mo</span>
      </div>
      <div className="sol-obligations-bar">
        {byType.map((t) => (
          <div
            key={t.key}
            className="sol-obligations-segment"
            style={{flex: t.total, background: t.color}}
            title={`${t.label}: ${INR.format(t.total)}`}
          />
        ))}
      </div>
      <div className="sol-obligations-legend">
        {byType.map((t) => (
          <div key={t.key} className="sol-obligations-row">
            <span
              className="sol-obligations-dot"
              style={{background: t.color}}
            />
            <i
              className={`fa-solid ${t.icon} sol-obligations-icon`}
              style={{color: t.color}}
            />
            <span className="sol-obligations-type">{t.label}</span>
            <span className="sol-obligations-amount">
              {INR.format(t.total)}
            </span>
            <span className="sol-obligations-pct">
              {Math.round((t.total / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Road to debt-free (horizontal payoff journey) ─────

const DF_SCALE = 88;

function DebtFreeTimeline({ commitments }) {
  const items = useMemo(() => {
    const now = new Date();
    return commitments
      .filter((c) => c.type === "emi" && commitmentIsActive(c))
      .map((c) => {
        const months = commitmentRemainingMonths(c);
        const info = getCommitmentTypeInfo(c.type);
        const payoff = new Date(now.getFullYear(), now.getMonth() + months, 1);
        return {
          id: c.id,
          name: c.name,
          months,
          payoff,
          color: info.color,
          icon: info.icon,
        };
      })
      .filter((x) => x.months > 0)
      .sort((a, b) => a.months - b.months);
  }, [commitments]);

  const laned = useMemo(() => {
    const laneEnds = [];
    const maxM = items.length ? items[items.length - 1].months : 1;
    return items.map((it) => {
      const x = (it.months / maxM) * DF_SCALE;
      let lane = laneEnds.findIndex((e) => x - e > 11);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = x;
      return { ...it, x, lane };
    });
  }, [items]);

  if (items.length === 0) return null;

  const maxMonths = items[items.length - 1].months || 1;
  const laneCount = Math.max(1, ...laned.map((d) => d.lane + 1));
  const fmtPay = (d) =>
    d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  const dfLabel = fmtPay(items[items.length - 1].payoff);

  const yearMarks = [];
  for (let y = 1; y <= Math.floor(maxMonths / 12); y++)
    yearMarks.push({ m: y * 12, label: `${y}y` });

  return (
    <div className="sol-df">
      <div className="sol-df-head">
        <span className="sol-df-title">Road to debt-free</span>
        <span className="sol-df-target">
          <i className="fa-solid fa-flag-checkered" /> {dfLabel}
        </span>
      </div>
      <div className="sol-df-track" style={{ height: laneCount * 30 + 18 }}>
        {yearMarks.map((ym) => (
          <div
            key={ym.m}
            className="sol-df-grid"
            style={{ left: `${(ym.m / maxMonths) * DF_SCALE}%` }}
          >
            <span className="sol-df-grid-label">{ym.label}</span>
          </div>
        ))}
        {laned.map((d) => (
          <div
            key={d.id}
            className="sol-df-marker"
            style={{ left: `${d.x}%`, top: d.lane * 30 + 2, "--accent": d.color }}
            title={`${d.name} · clear by ${fmtPay(d.payoff)}`}
          >
            <i className={`fa-solid ${d.icon}`} />
          </div>
        ))}
        <div className="sol-df-flag" title={`Debt-free · ${dfLabel}`}>
          <i className="fa-solid fa-flag-checkered" />
        </div>
      </div>
    </div>
  );
}

// ── Loan Progress Timeline ────────────────────────────

function LoanTimeline({commitments, cards, onCardTap}) {
  const now = new Date();
  const loans = commitments.filter(
    (c) =>
      c.type === "emi" &&
      commitmentIsActive(c) &&
      c.startDate &&
      parseInt(c.tenureMonths) > 0,
  );
  if (loans.length === 0) return null;

  // Look up cards by id so each loan can show its funding source as a
  // pill. Two values matter to the user here:
  //   • "via {Card}"  → EMI is auto-debited to a credit card. The EMI's
  //                     cash impact lands on the card's bill, so the
  //                     user knows to track repayment under the Cards
  //                     tab — not as a standalone debit.
  //   • "from bank"   → EMI is debited directly from a bank account.
  //                     Visible as a separate debit row on the user's
  //                     ledger and in Upcoming Dues.
  // Without this, a card-funded EMI in Loan Progress was indistinguish-
  // able from a bank-funded one; users were missing the connection
  // between "this EMI" and "the card whose bill goes up because of it".
  const cardById = new Map((cards ?? []).map((c) => [c.id, c]));

  return (
    <div className="sol-section">
      <div className="sol-section-header">
        <p className="sol-section-title">Loan progress</p>
      </div>
      <div className="sol-loan-list">
        {loans.map((c) => {
          const tenure = parseInt(c.tenureMonths);
          const start = new Date(c.startDate);
          const cardStmtDay = cardById.get(emiCardId(c))?.statementDay;
          // Billing-aware progress: only instalments whose bill has actually
          // been generated count (shared with the card bill / ledger via
          // emiInstallmentsBilled), so an unbilled month is never assumed
          // cleared — progress no longer runs ahead of the statement.
          const monthsPaid = emiInstallmentsBilled(c, now, cardStmtDay);
          const remaining = Math.max(0, tenure - monthsPaid);
          // Progress = share of the ORIGINAL principal actually repaid, using
          // the same amortisation math as card balances — not calendar time.
          // A loan only reads 100% once its outstanding is genuinely zero, so
          // an interest-heavy early stage shows the real (smaller) progress
          // instead of tracking the clock.
          const emi = parseFloat(c.emiAmount) || 0;
          const principal = calcPrincipalFromEMI(emi, c.interestRate || 0, tenure);
          const snapDate = c.currentOutstandingDate || c.startDate;
          const billedSinceSnap = Math.max(
            0,
            monthsPaid - emiInstallmentsBilled(c, new Date(snapDate), cardStmtDay),
          );
          const outstanding =
            c.currentOutstanding != null
              ? calcOutstandingFromSnapshot(
                  c.currentOutstanding,
                  c.interestRate || 0,
                  emi,
                  billedSinceSnap
                )
              : calcOutstanding(principal, c.interestRate || 0, tenure, monthsPaid);
          const pct =
            principal > 0
              ? Math.min(
                  100,
                  Math.max(0, Math.round((1 - outstanding / principal) * 100))
                )
              : 0;
          const paidOff = pct >= 100;
          const endDate = new Date(
            start.getFullYear(),
            start.getMonth() + tenure,
            1
          );
          const endLabel = endDate.toLocaleDateString("en-IN", {
            month: "short",
            year: "numeric",
          });

          const isCardFunded = isCardFundedEmi(c);
          const fundingCard = isCardFunded ? cardById.get(emiCardId(c)) : null;

          return (
            <div key={c.id} className="sol-loan-item">
              <div className="sol-loan-header">
                <span className="sol-loan-name">{c.name}</span>
                <span className="sol-loan-meta">
                  {paidOff
                    ? "Paid off"
                    : remaining > 0
                      ? `${fmtDuration(remaining)} left`
                      : "Term ended"}{" "}
                  · {endLabel}
                </span>
              </div>
              <div className="sol-loan-source-row">
                {isCardFunded ? (
                  <button
                    type="button"
                    className="sol-loan-source sol-loan-source--card"
                    style={{
                      background: `color-mix(in srgb, ${
                        fundingCard?.color || "#5b8dee"
                      } 10%, transparent)`,
                      color: fundingCard?.color || "#5b8dee",
                      border: `1px solid color-mix(in srgb, ${
                        fundingCard?.color || "#5b8dee"
                      } 40%, transparent)`,
                    }}
                    onClick={() => fundingCard && onCardTap?.(fundingCard.id)}
                    disabled={!fundingCard}
                    title={
                      fundingCard
                        ? `Auto-debits to ${fundingCard.name}. Tap to see the card's bill.`
                        : "This EMI's linked card is missing."
                    }
                  >
                    <i className="fa-solid fa-credit-card" />
                    <span>
                      via{"  "}
                      <strong>
                        {fundingCard ? fundingCard.name : "deleted card"}
                      </strong>
                    </span>
                  </button>
                ) : (
                  <span className="sol-loan-source sol-loan-source--bank">
                    <i className="fa-solid fa-building-columns" />
                    <span>From bank account</span>
                  </span>
                )}
              </div>
              <div className="sol-loan-bar-row">
                <div className="sol-progress-bar-bg" style={{flex: 1}}>
                  <div
                    className="sol-progress-bar-fill"
                    style={{
                      width: `${pct}%`,
                      background: fundingCard?.color || "#5b8dee",
                    }}
                  />
                </div>
                <span className="sol-loan-pct">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Upcoming Dues ─────────────────────────────────────

function UpcomingDues({
  cards,
  commitments,
  lendings,
  onCardTap,
  allTransactions,
  dueWindows,
}) {
  // The overview's upcoming list is a fixed 7-day glance and shows only
  // dues/obligations — subscriptions (renewals) are intentionally left out; they
  // live on the Subscriptions page.
  const upcomingDays = 7;
  const soonDays = dueWindows?.soonDays ?? 7;
  const deepNav = useDeepLinkNav();
  const dues = useMemo(
    () =>
      getUpcomingDues(cards, commitments, lendings, upcomingDays, allTransactions),
    [cards, commitments, lendings, allTransactions, upcomingDays]
  );

  if (dues.length === 0)
    return (
      <p style={{color: "var(--text-label)", fontSize: 14}}>
        No dues in the next {upcomingDays} days.
      </p>
    );

  const typeIcon = {
    card: "fa-credit-card",
    commitment: "fa-building-columns",
    lending: "fa-handshake",
    subscription: "fa-rotate",
  };

  // Look up canonical commitment records by id so commitment-type rows
  // can show their funding source even if the upcoming-dues result
  // didn't propagate the cardId (older code path / pre-migration data).
  const commitmentById = new Map(
    (commitments ?? []).map((c) => [c.id, c]),
  );
  const cardById = new Map((cards ?? []).map((c) => [c.id, c]));

  const renderDue = (d) => {
    const badgeClass =
      d.diffDays < 0
        ? "sol-due-badge--overdue"
        : d.diffDays <= soonDays
        ? "sol-due-badge--soon"
        : "sol-due-badge--ok";
    const badgeText =
      d.diffDays < 0
        ? `${Math.abs(d.diffDays)}d overdue`
        : d.diffDays === 0
        ? "Due today"
        : `${d.diffDays}d left`;
    const sourceCardId =
      d.type === "commitment"
        ? commitmentById.get(d.id)?.cardId ?? null
        : null;
    const sourceCard = sourceCardId ? cardById.get(sourceCardId) : null;
    const targetCardId = d.type === "card" ? d.id : sourceCardId;
    const isSubscription = d.type === "subscription";
    const isTappable = isSubscription || !!targetCardId;
    const onClick = isSubscription
      ? () => deepNav(`/Subscriptions?highlight=${d.id}`)
      : targetCardId
      ? () => onCardTap?.(targetCardId)
      : undefined;
    return (
      <div
        key={d.id}
        className={`sol-due-item${isTappable ? " sol-due-item--tappable" : ""}`}
        onClick={onClick}
        role={isTappable ? "button" : undefined}
      >
        <div className="sol-due-left">
          <i className={`fa-solid ${typeIcon[d.type]} sol-due-icon`} />
          <div>
            <div className="sol-due-name">{d.name}</div>
            <div className="sol-due-date">
              {fmtDate(d.dueDate.toISOString())}
            </div>
            {d.type === "commitment" && sourceCardId && (
              <div className="sol-due-source">
                <i className="fa-solid fa-credit-card" />
                <span>
                  via{" "}
                  <strong>
                    {sourceCard ? sourceCard.name : "deleted card"}
                  </strong>
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="sol-due-right">
          <span className="sol-due-amount">{INR.format(d.amount)}</span>
          <span className={`sol-due-badge ${badgeClass}`}>{badgeText}</span>
        </div>
        {isTappable && (
          <i className="fa-solid fa-arrow-up-right-from-square sol-due-nav-arrow" />
        )}
      </div>
    );
  };

  return <div className="sol-upcoming-list">{dues.map(renderDue)}</div>;
}

// ── Overview Tab ──────────────────────────────────────

function SolvencyHero({ totals }) {
  const animated = useCountUp(totals.totalOwed);
  const df = totals.debtFreeDate;
  const dfLabel = df
    ? df.toLocaleDateString("en-IN", { month: "short", year: "numeric" })
    : null;
  const util = totals.utilization;
  const utilColor =
    util == null
      ? undefined
      : util < 0.3
        ? "var(--amount-income)"
        : util < 0.6
          ? "#d4a35a"
          : "var(--amount-expense)";

  return (
    <div className="sol-lead">
      <span className="sol-lead-eyebrow">Total owed</span>
      <div className="sol-lead-value">{INR.format(Math.round(animated))}</div>
      <div className="sol-lead-chips">
        {dfLabel && (
          <span className="sol-lead-chip sol-lead-chip--good">
            <i className="fa-solid fa-flag-checkered" /> Debt-free by {dfLabel}
          </span>
        )}
        {util != null && (
          <span className="sol-lead-chip" style={{ color: utilColor }}>
            <i className="fa-solid fa-gauge-high" /> {Math.round(util * 100)}%
            utilization
          </span>
        )}
        {totals.netLent !== 0 && (
          <span className="sol-lead-chip">
            <i className="fa-solid fa-arrow-right-arrow-left" />
            {totals.netLent > 0
              ? `${INR.format(totals.netLent)} owed to you`
              : `${INR.format(Math.abs(totals.netLent))} you owe`}
          </span>
        )}
      </div>
      <div className="sol-lead-strip">
        <div className="sol-lead-stat">
          <span className="sol-lead-stat-lbl">Cards</span>
          <span className="sol-lead-stat-val">
            {INR.format(totals.totalCardOutstanding)}
          </span>
        </div>
        <div className="sol-lead-stat">
          <span className="sol-lead-stat-lbl">Loans</span>
          <span className="sol-lead-stat-val">
            {INR.format(totals.loanOutstanding)}
          </span>
        </div>
        <div className="sol-lead-stat">
          <span className="sol-lead-stat-lbl">Per month</span>
          <span className="sol-lead-stat-val">
            {INR.format(totals.monthlyEMI)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SolvencyInsights({ insights }) {
  if (!insights.length) return null;
  return (
    <div className="sol-insights">
      {insights.slice(0, 6).map((ins) => (
        <div key={ins.id} className={`sol-insight sol-insight--${ins.kind}`}>
          <span className="sol-insight-icon">
            <i className={`fa-solid ${ins.icon}`} />
          </span>
          <div className="sol-insight-text">
            <span className="sol-insight-title">{ins.title}</span>
            <span className="sol-insight-detail">{ins.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({
  cards,
  commitments,
  lendings,
  onCardTap,
  allTransactions,
  dueWindows,
}) {
  const totals = useMemo(
    () => solvencyTotals(cards, commitments, lendings),
    [cards, commitments, lendings],
  );
  const income = useMemo(
    () => resolveMonthlyIncome(allTransactions ?? []).monthly || 0,
    [allTransactions],
  );
  const insights = useMemo(
    () => solvencyInsights(cards, commitments, lendings, allTransactions),
    [cards, commitments, lendings, allTransactions],
  );
  const flags = useMemo(
    () => ({
      overdue: insights.filter((i) => i.kind === "overdue").length,
      stale: insights.filter((i) => i.kind === "stale").length,
    }),
    [insights],
  );
  const health = useMemo(
    () => computeSolvencyHealth(totals, income, flags),
    [totals, income, flags],
  );

  return (
    <>
      <SolvencyHero totals={totals} />
      <Reveal>
        <HealthScoreCircle
          score={health.score}
          grade={health.grade}
          color={health.color}
          deductions={health.deductions}
        />
      </Reveal>
      <Reveal>
        <SolvencyInsights insights={insights} />
      </Reveal>
      <Reveal>
        <ThisMonthCard
          cards={cards}
          commitments={commitments}
          lendings={lendings}
          allTransactions={allTransactions}
          dueWindows={dueWindows}
        />
      </Reveal>
      <Reveal>
        <ObligationsBar commitments={commitments} />
      </Reveal>
      <Reveal>
        <DebtFreeTimeline commitments={commitments} />
      </Reveal>
      <Reveal>
        <LoanTimeline
          commitments={commitments}
          cards={cards}
          onCardTap={onCardTap}
        />
      </Reveal>
      <Reveal className="sol-section">
        <div className="sol-section-header">
          <p className="sol-section-title">Upcoming (7 days)</p>
        </div>
        <UpcomingDues
          cards={cards}
          commitments={commitments}
          lendings={lendings}
          onCardTap={onCardTap}
          allTransactions={allTransactions}
          dueWindows={dueWindows}
        />
      </Reveal>
    </>
  );
}

// ── Cards Tab ─────────────────────────────────────────

function UtilRing({ pct, color }) {
  const r = 15;
  const circ = 2 * Math.PI * r;
  const offset = circ - Math.min(1, pct) * circ;
  return (
    <div className="sol-util-ring">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="var(--surface-border)"
          strokeWidth="4"
        />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span className="sol-util-ring-pct" style={{ color }}>
        {Math.round(pct * 100)}
      </span>
    </div>
  );
}

function CardItem({
  card,
  transactions,
  commitments = [],
  onEdit,
  onDelete,
  autoExpand,
  onExpandDone,
  onEmiBadgeClick,
  onJumpToCard,
}) {
  const [open, setOpen] = useState(false);
  const itemRef = useRef(null);
  const isPooled = card.poolLimit != null;
  // Pooled siblings that are actually consuming the shared limit — surfaced as
  // a summary banner instead of listing their charges row-by-row in the ledger.
  const poolSiblings = (card.poolMembers ?? []).filter(
    (m) => (parseFloat(m.ownOutstanding) || 0) > 0
  );
  const displayLimit = isPooled ? card.poolLimit : parseFloat(card.limit) || 0;
  const displayOutstanding = isPooled
    ? card.poolOutstanding
    : parseFloat(card.outstanding) || 0;
  const util =
    displayLimit > 0 ? Math.min(1, displayOutstanding / displayLimit) : 0;

  useEffect(() => {
    if (!autoExpand) return;
    // Auto-expand on a parent-driven highlight trigger — the parent prop is
    // the external source we're syncing to, so setState here is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
    const scrollT = setTimeout(() => {
      itemRef.current?.scrollIntoView({behavior: "smooth", block: "center"});
    }, 120);
    // Keep the highlight class applied for the full blink duration before
    // clearing the parent's highlightCardId.
    const doneT = setTimeout(() => {
      onExpandDone?.();
    }, 1800);
    return () => {
      clearTimeout(scrollT);
      clearTimeout(doneT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);
  const utilColor =
    util < 0.3
      ? "var(--amount-income)"
      : util < 0.6
      ? "#d4a35a"
      : "var(--amount-expense)";
  const daysLeft = card.dueDay
    ? daysUntilCardDue(card, transactions, commitments)
    : null;

  const linkedTx = useMemo(() => {
    // The ledger lists only THIS card's own activity: outgoing charges (cardId
    // tagged) and repayments paid TO this card (repaymentFor tagged). A pooled
    // sibling's charges are summarised in the pool banner instead of listed
    // row-by-row, so they no longer clutter this card's ledger.
    const charges = transactions.filter((t) => t.cardId === card.id);
    const repayments = transactions
      .filter((t) => t.repaymentFor === card.id)
      .map((t) => ({ ...t, _isRepayment: true }));
    const real = [...charges, ...repayments];
    const synthetic = [];
    const now = new Date();
    for (const c of commitments) {
      if (emiCardId(c) !== card.id) continue;
      if (!commitmentIsActive(c)) continue;
      const amt = parseFloat(c.emiAmount) || 0;
      if (amt <= 0 || !c.startDate) continue;
      const first = getEmiFirstPaymentDate(c);
      if (!first) continue;
      const billDay =
        parseInt(c.billingDay) ||
        parseInt(card.statementDay) ||
        parseInt(c.dueDay) ||
        new Date(c.startDate).getDate() ||
        1;
      const tenure = parseInt(c.tenureMonths) || 0;
      const months =
        (now.getFullYear() - first.getFullYear()) * 12 +
        (now.getMonth() - first.getMonth()) +
        1;
      if (months <= 0) continue;
      const cap = tenure > 0 ? Math.min(months, tenure) : months;
      for (let i = 0; i < cap; i++) {
        const y = first.getFullYear();
        const m = first.getMonth() + i;
        const lastDay = new Date(y, m + 1, 0).getDate();
        const day = Math.min(billDay, lastDay);
        const occurredAtDate = new Date(y, m, day);
        // Skip installments whose auto-debit day hasn't arrived yet — the
        // bank hasn't actually billed it, so it shouldn't show in the ledger.
        if (occurredAtDate > now) continue;
        synthetic.push({
          id: `emi-${c.id}-${y}-${m + 1}`,
          cardId: c.cardId,
          amount: amt,
          name: `${c.name}`,
          occurredAt: occurredAtDate.toISOString(),
          _isEmi: true,
          _commitmentId: c.id,
        });
      }
    }
    return [...real, ...synthetic]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 10);
  }, [transactions, commitments, card.id]);

  return (
    <div
      ref={itemRef}
      className={`sol-card-item${open ? " sol-card-item--open" : ""}${
        autoExpand ? " sol-card-item--highlight" : ""
      }`}
      onClick={() => setOpen((p) => !p)}
      role="button"
      aria-expanded={open}
    >
      <div className="sol-card-summary">
        {displayLimit > 0 ? (
          <UtilRing pct={util} color={utilColor} />
        ) : (
          <div
            className="sol-card-color-bar"
            style={{background: card.color || "#4a90d9"}}
          />
        )}
        <div className="sol-card-info">
          <div className="sol-card-name">
            {card.name}
            {isPooled && (
              <span className="sol-card-pool-chip" title={`Pooled with ${card.poolMembers.map((m) => m.name).join(", ")}`}>
                <i className="fa-solid fa-link" /> Pooled
              </span>
            )}
          </div>
          <div className="sol-card-bank">
            {card.bank && (
              <BankLogo bank={card.bank} color={card.color} size={16} />
            )}
            {card.bank}
            {isPooled && card.poolMembers.length > 0 && (
              <span className="sol-card-pool-meta">
                {" · with "}{card.poolMembers.map((m) => m.name).join(", ")}
              </span>
            )}
          </div>
        </div>
        <div className="sol-card-meta">
          <span className="sol-card-outstanding">
            {INR.format(displayOutstanding)}
          </span>
          <span className="sol-card-limit">
            of {INR.format(displayLimit)}
            {isPooled && <span className="sol-card-pool-tag"> pool</span>}
          </span>
          {daysLeft !== null && (
            <span className="sol-card-due-chip">Due day {card.dueDay}</span>
          )}
        </div>
        <div className="sol-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="sol-icon-btn"
            onClick={() => onEdit(card)}
            title="Edit"
          >
            <i className="fa-solid fa-pen" />
          </button>
          <button
            className="sol-icon-btn sol-icon-btn--del"
            onClick={() => onDelete(card)}
            title="Delete"
          >
            <i className="fa-solid fa-trash-can" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{height: 0, opacity: 0}}
            animate={{height: "auto", opacity: 1}}
            exit={{height: 0, opacity: 0}}
            transition={accordionTransition}
            style={{overflow: "hidden"}}
          >
            <div className="sol-card-detail">
              <div className="sol-detail-stats">
                {card.statementDay && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Statement</span>
                    <span className="sol-detail-stat-value">
                      Day {card.statementDay}
                    </span>
                  </div>
                )}
                {card.dueDay && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Due</span>
                    <span className="sol-detail-stat-value">
                      Day {card.dueDay}
                    </span>
                  </div>
                )}
                <div className="sol-detail-stat">
                  <span className="sol-detail-stat-label">
                    {isPooled ? "Pool available" : "Available"}
                  </span>
                  <span
                    className="sol-detail-stat-value"
                    style={{color: "var(--amount-income)"}}
                  >
                    {INR.format(Math.max(0, displayLimit - displayOutstanding))}
                  </span>
                </div>
                {isPooled && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">This card</span>
                    <span className="sol-detail-stat-value">
                      {INR.format(parseFloat(card.ownOutstanding) || 0)}
                      <span className="sol-card-pool-tag">
                        {" of "}{INR.format(parseFloat(card.limit) || 0)}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {isPooled && poolSiblings.length > 0 && (
                <div className="sol-pool-banner">
                  <div className="sol-pool-banner-head">
                    <i className="fa-solid fa-link" />
                    <span>
                      Shared limit also used by{" "}
                      {poolSiblings.length === 1
                        ? "this pooled card"
                        : "these pooled cards"}
                    </span>
                  </div>
                  <div className="sol-pool-banner-rows">
                    {poolSiblings.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        className="sol-pool-banner-row"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToCard?.(m.id);
                        }}
                        title={`View ${m.name}`}
                      >
                        <span className="sol-pool-banner-name">{m.name}</span>
                        <span className="sol-pool-banner-amt">
                          {INR.format(parseFloat(m.ownOutstanding) || 0)}
                          <i className="fa-solid fa-arrow-up-right-from-square sol-pool-banner-jump" />
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="sol-pool-banner-note">
                    Their charges draw down the shared limit, reducing this
                    card&apos;s available headroom.
                  </p>
                </div>
              )}

              <p className="sol-tx-sub-title">
                Recent transactions on this card
              </p>
              {linkedTx.length === 0 ? (
                <p className="sol-no-tx">No linked transactions yet.</p>
              ) : (
                <div className="sol-linked-tx-list">
                  {linkedTx.map((tx, i) => {
                    const stmtDay = parseInt(card?.statementDay) || 0;
                    const cycleKey = cycleKeyOf(tx.occurredAt, stmtDay);
                    const prevCycleKey =
                      i > 0 ? cycleKeyOf(linkedTx[i - 1].occurredAt, stmtDay) : null;
                    const showMonthSeparator = cycleKey !== prevCycleKey;
                    const cycleLabel = formatCycleLabel(tx.occurredAt, stmtDay);
                    // "Unbilled" = a real outgoing charge whose statement
                    // hasn't been generated yet. Derive it from the SAME cycle
                    // source of truth as the separators (statementCloseDate)
                    // so the pill can't disagree with the cycle a row sits in.
                    // EMI rows get the EMI tag instead.
                    const isUnbilled =
                      !tx._isEmi &&
                      !tx._isRepayment &&
                      stmtDay > 0 &&
                      statementCloseDate(tx.occurredAt, stmtDay) > new Date();
                    return (
                      <div key={tx.id}>
                        {showMonthSeparator && (
                          <div className="tx-date-separator sol-linked-tx-month">
                            <span className="sol-linked-tx-cycle">
                              {cycleLabel.month}
                              {cycleLabel.range && (
                                <span className="sol-linked-tx-cycle-range">
                                  {cycleLabel.range}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        <div
                          className={`sol-linked-tx${tx._isEmi ? " ledger-tint-invest" : tx._isRepayment ? " ledger-tint-income" : " ledger-tint-expense"}`}
                        >
                          <div className="sol-linked-tx-left">
                            <div className="sol-linked-tx-name">
                              {tx.name || tx.source || (tx._isRepayment ? "Repayment" : "")}
                            </div>
                            <div className="sol-linked-tx-date">
                              {fmtDate(tx.occurredAt)}
                            </div>
                          </div>
                          <div className="sol-linked-tx-right">
                            {tx._isEmi ? (
                              <button
                                type="button"
                                className="sol-linked-tx-tag sol-linked-tx-tag--emi sol-linked-tx-tag--clickable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEmiBadgeClick?.(tx._commitmentId);
                                }}
                                title="Open EMI in Commitments tab"
                              >
                                <i className="fa-solid fa-building-columns" /> EMI
                                <i className="fa-solid fa-arrow-up-right-from-square sol-linked-tx-tag-jump" />
                              </button>
                            ) : tx._isRepayment ? (
                              <span
                                className="sol-linked-tx-tag sol-linked-tx-tag--repayment"
                                title="Repayment toward this card"
                              >
                                Paid
                              </span>
                            ) : isUnbilled ? (
                              <span
                                className="sol-linked-tx-tag sol-linked-tx-tag--unbilled"
                                title="Will appear on the next statement"
                              >
                                <i className="fa-solid fa-hourglass-half" /> Unbilled
                              </span>
                            ) : null}
                            <span
                              className={`sol-linked-tx-amount${tx._isRepayment ? " sol-linked-tx-amount--credit" : ""}`}
                            >
                              {tx._isRepayment ? "+ " : ""}
                              {INR.format(parseFloat(tx.amount))}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CardsTab({
  cards,
  transactions,
  commitments,
  driveReady,
  onAdd,
  onEdit,
  onDelete,
  highlightCardId,
  onHighlightClear,
  onEmiBadgeClick,
  onJumpToCard,
}) {
  if (cards.length === 0)
    return (
      <div className="sol-empty">
        <i className="fa-solid fa-credit-card sol-empty-icon" />
        <p>No credit cards added yet.</p>
        <p className="sol-empty-sub">
          Track limits, utilization and due dates.
        </p>
        <button
          className="generic-button"
          onClick={onAdd}
          disabled={!driveReady}
        >
          Add Card
        </button>
      </div>
    );

  return (
    <div className="sol-section">
      {cards.map((c, i) => (
        <Reveal key={c.id} delay={Math.min(i, 6) * 0.04}>
          <CardItem
            card={c}
            transactions={transactions}
            commitments={commitments}
            onEdit={onEdit}
            onDelete={onDelete}
            autoExpand={highlightCardId === c.id}
            onExpandDone={onHighlightClear}
            onEmiBadgeClick={onEmiBadgeClick}
            onJumpToCard={onJumpToCard}
          />
        </Reveal>
      ))}
    </div>
  );
}

// ── Commitments Tab ───────────────────────────────────

function CommitmentItem({commitment, onEdit, onDelete, autoExpand, onExpandDone}) {
  const [open, setOpen] = useState(false);
  const itemRef = useRef(null);

  useEffect(() => {
    if (!autoExpand) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
    const scrollT = setTimeout(() => {
      itemRef.current?.scrollIntoView({behavior: "smooth", block: "center"});
    }, 120);
    const doneT = setTimeout(() => onExpandDone?.(), 1800);
    return () => {
      clearTimeout(scrollT);
      clearTimeout(doneT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);
  const typeInfo = getCommitmentTypeInfo(commitment.type);
  const allTransactions = useLedger();
  const daysLeft = commitment.dueDay
    ? daysUntilCommitmentDue(commitment, allTransactions)
    : null;
  const cards = useSelector(
    (state) => state.transactions.transactionData?.cards ?? []
  );
  const linkedCard = commitment.cardId
    ? cards.find((c) => c.id === commitment.cardId)
    : null;

  const isLoan = commitment.type === "emi";
  const tenureMonths = parseInt(commitment.tenureMonths) || 0;
  const monthsPaid = (() => {
    if (!isLoan || !commitment.startDate) return 0;
    const start = new Date(commitment.startDate);
    const now = new Date();
    return Math.max(
      0,
      (now.getFullYear() - start.getFullYear()) * 12 +
        (now.getMonth() - start.getMonth())
    );
  })();
  const remaining =
    isLoan && tenureMonths > 0 ? Math.max(0, tenureMonths - monthsPaid) : 0;
  const emiAmount = parseFloat(commitment.emiAmount) || 0;
  const principal = isLoan
    ? calcPrincipalFromEMI(
        emiAmount,
        commitment.interestRate || 0,
        tenureMonths
      )
    : 0;
  const calculatedOutstanding =
    isLoan && principal > 0
      ? calcOutstanding(
          principal,
          commitment.interestRate || 0,
          tenureMonths,
          monthsPaid
        )
      : 0;
  const outstanding =
    commitment.currentOutstanding != null
      ? calcOutstandingFromSnapshot(
          commitment.currentOutstanding,
          commitment.interestRate || 0,
          emiAmount,
          monthsSince(commitment.currentOutstandingDate || commitment.startDate)
        )
      : calculatedOutstanding;
  const pct =
    tenureMonths > 0
      ? Math.min(100, Math.round((monthsPaid / tenureMonths) * 100))
      : 0;

  return (
    <div
      ref={itemRef}
      className={`sol-commitment-item${
        open ? " sol-commitment-item--open" : ""
      }${autoExpand ? " sol-commitment-item--highlight" : ""}`}
      onClick={() => setOpen((p) => !p)}
      role="button"
      aria-expanded={open}
    >
      <div className="sol-commit-summary">
        <div className="sol-commit-header-row">
          <div
            className="sol-commit-type-badge"
            style={{background: typeInfo.color + "22", color: typeInfo.color}}
          >
            <i className={`fa-solid ${typeInfo.icon}`} />
            {typeInfo.label}
          </div>
          <div className="sol-commit-meta">
            <span className="sol-commit-emi">
              {INR.format(commitment.emiAmount || 0)}
            </span>
            <span className="sol-commit-emi-label">
              /mo
              {isLoan && remaining > 0
                ? ` · ${fmtDuration(remaining)} left`
                : ""}
            </span>
          </div>
        </div>

        <div className="sol-commit-name">{commitment.name}</div>

        {isLoan && tenureMonths > 0 && (
          <>
            <div className="sol-commit-progress-row">
              <div className="sol-progress-bar-bg">
                <div
                  className="sol-progress-bar-fill"
                  style={{width: `${pct}%`, background: typeInfo.color}}
                />
              </div>
              <span className="sol-progress-pct">{pct}%</span>
            </div>
            <div className="sol-commit-progress-cap">
              {monthsPaid} of {tenureMonths} paid · {INR.format(outstanding)} left
              {commitment.interestRate ? ` · ${commitment.interestRate}%` : ""}
            </div>
          </>
        )}

        <div className="sol-commit-footer-row">
          <div className="sol-commit-chips">
            {linkedCard && (
              <span
                className="sol-commit-card-chip"
                style={{color: linkedCard?.color || "var(--text-label)"}}
              >
                <i className="fa-solid fa-credit-card" /> {linkedCard.name}
              </span>
            )}
            {daysLeft !== null && (
              <span className="sol-card-due-chip">Day {commitment.dueDay}</span>
            )}
          </div>
          <div
            className="sol-card-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="sol-icon-btn"
              onClick={() => onEdit(commitment)}
              title="Edit"
            >
              <i className="fa-solid fa-pen" />
            </button>
            <button
              className="sol-icon-btn sol-icon-btn--del"
              onClick={() => onDelete(commitment)}
              title="Delete"
            >
              <i className="fa-solid fa-trash-can" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{height: 0, opacity: 0}}
            animate={{height: "auto", opacity: 1}}
            exit={{height: 0, opacity: 0}}
            transition={accordionTransition}
            style={{overflow: "hidden"}}
          >
            <div className="sol-commit-detail">
              <div className="sol-commit-detail-grid">
                {isLoan && outstanding > 0 && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Outstanding</span>
                    <span
                      className="sol-detail-stat-value"
                      style={{color: "var(--amount-expense)"}}
                    >
                      {INR.format(outstanding)}
                    </span>
                  </div>
                )}
                {commitment.interestRate > 0 && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Rate</span>
                    <span className="sol-detail-stat-value">
                      {commitment.interestRate}% p.a.
                    </span>
                  </div>
                )}
                {tenureMonths > 0 && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Tenure</span>
                    <span className="sol-detail-stat-value">
                      {fmtDuration(tenureMonths)}
                    </span>
                  </div>
                )}
                {remaining > 0 && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Remaining</span>
                    <span className="sol-detail-stat-value">
                      {fmtDuration(remaining)}
                    </span>
                  </div>
                )}
                {commitment.startDate && (
                  <div className="sol-detail-stat">
                    <span className="sol-detail-stat-label">Started</span>
                    <span className="sol-detail-stat-value">
                      {fmtDate(commitment.startDate)}
                    </span>
                  </div>
                )}
              </div>
              {linkedCard && (
                <div className="sol-commit-via-row">
                  <i
                    className="fa-solid fa-credit-card"
                    style={{
                      fontSize: 12,
                      color: linkedCard?.color || "var(--text-label)",
                    }}
                  />
                  <span
                    className="sol-paid-via"
                    style={{color: linkedCard?.color || "var(--text-label)"}}
                  >
                    {linkedCard.bank && (
                      <BankLogo
                        bank={linkedCard.bank}
                        color={linkedCard.color}
                        size={14}
                      />
                    )}
                    Paid via <strong>{linkedCard.name}</strong> (
                    {linkedCard.bank})
                  </span>
                </div>
              )}
              {commitment.paymentMedium === "bank" && (
                <div className="sol-commit-via-row">
                  <i
                    className="fa-solid fa-building-columns"
                    style={{fontSize: 12, color: "var(--text-label)"}}
                  />
                  <span>Paid via bank / auto debit</span>
                </div>
              )}
              {commitment.notes && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  {commitment.notes}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CommitmentsTab({
  commitments,
  driveReady,
  onAdd,
  onEdit,
  onDelete,
  highlightCommitmentId,
  onHighlightClear,
}) {
  if (commitments.length === 0)
    return (
      <div className="sol-empty">
        <i className="fa-solid fa-building-columns sol-empty-icon" />
        <p>No commitments added yet.</p>
        <p className="sol-empty-sub">
          Track EMIs, subscriptions, rent and loans.
        </p>
        <button
          className="generic-button"
          onClick={onAdd}
          disabled={!driveReady}
        >
          Add Commitment
        </button>
      </div>
    );

  return (
    <div className="sol-section">
      {commitments.map((c, i) => (
        <Reveal key={c.id} delay={Math.min(i, 6) * 0.04}>
          <CommitmentItem
            commitment={c}
            onEdit={onEdit}
            onDelete={onDelete}
            autoExpand={highlightCommitmentId === c.id}
            onExpandDone={onHighlightClear}
          />
        </Reveal>
      ))}
    </div>
  );
}

// ── Lendings Tab ──────────────────────────────────────

function LendingItem({lending, onEdit, onDelete, onMarkReturned}) {
  const isLent = lending.direction === "lent";
  const outstanding = parseFloat(lending.outstanding) || 0;
  const total = parseFloat(lending.amount) || 0;
  const pct = total > 0 ? Math.round(((total - outstanding) / total) * 100) : 0;

  return (
    <div className="sol-lending-item">
      <div className="sol-lending-info">
        <div className="sol-lending-name">{lending.name}</div>
        {lending.date && outstanding > 0 && monthsSince(lending.date) >= 1 && (
          <div className="sol-lending-age">
            {isLent ? "Lent" : "Borrowed"} {fmtDuration(monthsSince(lending.date))}{" "}
            ago
          </div>
        )}
        {outstanding === 0 && (
          <div
            className="sol-lending-due"
            style={{ color: "var(--amount-income)", fontWeight: 600 }}
          >
            <i className="fa-solid fa-circle-check" />{" "}
            {isLent ? "Fully received" : "Fully repaid"}
          </div>
        )}
        {total > 0 && outstanding < total && (
          <div
            className="sol-commit-progress-row"
            style={{marginTop: 6, maxWidth: 200}}
          >
            <div className="sol-progress-bar-bg">
              <div
                className="sol-progress-bar-fill"
                style={{
                  width: `${pct}%`,
                  background: isLent
                    ? "var(--amount-income)"
                    : "var(--amount-expense)",
                }}
              />
            </div>
            <span className="sol-progress-pct">{pct}% returned</span>
          </div>
        )}
      </div>
      <div className="sol-lending-meta">
        <span
          className={`sol-lending-outstanding ${
            isLent
              ? "sol-lending-outstanding--lent"
              : "sol-lending-outstanding--borrowed"
          }`}
        >
          {INR.format(outstanding)}
        </span>
        {outstanding < total && (
          <span className="sol-lending-total">of {INR.format(total)}</span>
        )}
        <div style={{display: "flex", gap: 4, marginTop: 4}}>
          {outstanding > 0 && (
            <button
              className="sol-mark-returned-btn"
              onClick={(e) => {
                e.stopPropagation();
                onMarkReturned(lending);
              }}
            >
              <i className="fa-solid fa-check" />
              {isLent ? "Receive" : "Repay"}
            </button>
          )}
          <button
            className="sol-icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(lending);
            }}
            title="Edit"
          >
            <i className="fa-solid fa-pen" />
          </button>
          <button
            className="sol-icon-btn sol-icon-btn--del"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(lending);
            }}
            title="Delete"
          >
            <i className="fa-solid fa-trash-can" />
          </button>
        </div>
      </div>
    </div>
  );
}

function LendingsTab({
  lendings,
  driveReady,
  onAdd,
  onEdit,
  onDelete,
  onMarkReturned,
}) {
  const [direction, setDirection] = useState("lent");
  const filtered = lendings.filter((l) => l.direction === direction);
  const totalLent = lendings
    .filter((l) => l.direction === "lent")
    .reduce((s, l) => s + (parseFloat(l.outstanding) || 0), 0);
  const totalBorrowed = lendings
    .filter((l) => l.direction === "borrowed")
    .reduce((s, l) => s + (parseFloat(l.outstanding) || 0), 0);

  return (
    <>
      <div className="sol-lendings-header">
        <div className="sol-lending-direction-toggle">
          {[
            {
              key: "lent",
              label: `Lent out`,
              icon: "fa-arrow-up-right-from-square",
            },
            {key: "borrowed", label: `Borrowed`, icon: "fa-arrow-down-left"},
          ].map((d) => (
            <button
              key={d.key}
              className={`sol-lend-dir-btn${
                direction === d.key ? " sol-lend-dir-btn--active" : ""
              }`}
              onClick={() => setDirection(d.key)}
            >
              {direction === d.key && (
                <motion.span
                  layoutId="solLendDirPill"
                  className="sol-lend-dir-pill"
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                />
              )}
              <i className={`fa-solid ${d.icon}`} />
              {d.label}
              {d.key === "lent" && totalLent > 0 && (
                <span style={{marginLeft: 4, fontSize: 11, opacity: 0.8}}>
                  {INR.format(totalLent)}
                </span>
              )}
              {d.key === "borrowed" && totalBorrowed > 0 && (
                <span style={{marginLeft: 4, fontSize: 11, opacity: 0.8}}>
                  {INR.format(totalBorrowed)}
                </span>
              )}
            </button>
          ))}
        </div>
        <button className="sol-add-btn" disabled={!driveReady} onClick={onAdd}>
          <i className="fa-solid fa-plus" />
          Add Entry
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="sol-empty">
          <i
            className={`fa-solid ${
              direction === "lent"
                ? "fa-hand-holding-dollar"
                : "fa-hand-holding"
            } sol-empty-icon`}
          />
          <p>
            {direction === "lent" ? "Nothing lent out." : "Nothing borrowed."}
          </p>
          <p className="sol-empty-sub">Track money you gave or received.</p>
          <button
            className="generic-button"
            onClick={onAdd}
            disabled={!driveReady}
          >
            Add Entry
          </button>
        </div>
      ) : (
        <div className="sol-section">
          {filtered.map((l, i) => (
            <Reveal key={l.id} delay={Math.min(i, 6) * 0.04}>
              <LendingItem
                lending={l}
                onEdit={onEdit}
                onDelete={onDelete}
                onMarkReturned={onMarkReturned}
              />
            </Reveal>
          ))}
        </div>
      )}
    </>
  );
}

// ── Lending Repay Modal ───────────────────────────────

function LendingRepayForm({ lending, onConfirm, onClose }) {
  const isLent = lending.direction === "lent";
  const outstanding = parseFloat(lending.outstanding) || 0;
  const [amount, setAmount] = useState(String(outstanding));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [affectBalance, setAffectBalance] = useState(true);
  const [accountId, setAccountId] = useState(lending.accountId ?? "");

  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );

  const amt = parseFloat(amount) || 0;
  const isValid = amt > 0 && amt <= outstanding + 0.001;
  const isFull = isValid && Math.abs(amt - outstanding) < 0.01;

  return (
    <div className="lending-repay-form">
      <p className="lending-repay-summary">
        Outstanding with <strong>{lending.name}</strong>:{" "}
        <strong>{INR.format(outstanding)}</strong>
      </p>
      <div className="sol-form-row">
        <div className="field">
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            max={outstanding}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder=" "
            autoFocus
          />
          <label>{isLent ? "Amount received (₹)" : "Amount repaid (₹)"}</label>
        </div>
        <DateField
          value={date}
          onChange={(e) => setDate(e.target.value)}
          label="Date"
        />
      </div>
      {isValid && (
        <p className="lending-repay-status">
          {isFull
            ? "This will mark the entry as fully settled."
            : `${INR.format(outstanding - amt)} will remain outstanding.`}
        </p>
      )}
      <label className="card-combine-toggle">
        <input
          type="checkbox"
          checked={affectBalance}
          onChange={(e) => setAffectBalance(e.target.checked)}
        />
        <span className="card-combine-toggle-text">
          {isLent
            ? "Add this to my balance as income"
            : "Deduct this from my balance as expense"}
          <span className="card-combine-toggle-sub">
            {affectBalance
              ? "A matching transaction will be logged"
              : "Just updates the lending entry — no transaction created"}
          </span>
        </span>
      </label>
      {affectBalance && multiBankEnabled && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label={isLent ? "Received into" : "Paid from"}
        />
      )}
      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="generic-button"
          disabled={!isValid}
          onClick={() =>
            onConfirm({
              amount: amt,
              occurredAt: new Date(date).toISOString(),
              affectBalance,
              accountId,
            })
          }
        >
          <i className="fa-solid fa-check" />{" "}
          {isLent ? "Receive" : "Repay"}
        </button>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ──────────────────────────────

function DeleteConfirm({name, onConfirm, onClose, blockedBy, onPreclose}) {
  // When the parent passes `blockedBy` (an array of linked commitments
  // for a card with active EMIs), the modal switches to a blocked
  // state: no Delete button, just the list of EMIs and per-row
  // "Preclose" actions. The user resolves each linked EMI before the
  // card can be removed.
  if (blockedBy?.length) {
    return (
      <div className="delete-confirm-body">
        <p className="delete-confirm-name">{name}</p>
        <div className="delete-blocked-hint">
          <i className="fa-solid fa-triangle-exclamation" />
          <div>
            This card has <strong>{blockedBy.length}</strong> active EMI
            {blockedBy.length === 1 ? "" : "s"} linked to it. Each EMI
            would lose its funding source if the card disappears.
            Preclose them (or unlink them in the Commitments tab) before
            removing the card.
          </div>
        </div>
        <ul className="delete-blocked-list">
          {blockedBy.map((c) => (
            <li key={c.id} className="delete-blocked-row">
              <div className="delete-blocked-row-meta">
                <span className="delete-blocked-row-name">{c.name}</span>
                <span className="delete-blocked-row-sub">
                  {INR.format(parseFloat(c.emiAmount) || 0)}/mo
                </span>
              </div>
              <button
                type="button"
                className="generic-button delete-blocked-preclose"
                onClick={() => onPreclose?.(c)}
              >
                <i className="fa-solid fa-flag-checkered" /> Preclose
              </button>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <button className="cancel-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="delete-confirm-body">
      <p className="delete-confirm-name">{name}</p>
      <p className="delete-confirm-hint">This cannot be undone.</p>
      <div className="form-actions">
        <button className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button className="danger-button" onClick={onConfirm}>
          <i className="fa-solid fa-trash-can" /> Delete
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────

const TABS = ["Overview", "Cards", "Commitments", "Lendings"];

const SolvencyPage = () => {
  const dispatch = useDispatch();
  const driveReady = useSelector(
    (state) => state.transactions.status === "ready"
  );
  const cards = useSelector(
    (state) => state.transactions.transactionData?.cards ?? []
  );
  const commitments = useSelector(
    (state) => state.transactions.transactionData?.commitments ?? []
  );
  const lendings = useSelector(
    (state) => state.transactions.transactionData?.lendings ?? []
  );
  const allTransactions = useLedger();
  // Seed the small bounded collections + settings/preferences (cards,
  // commitments, lendings, subscriptions, accounts, prefs) into the blob so the
  // selectors below read page-wise data — no loadAll dependency on this page.
  useCoreData();
  const dueWindows = useSelector(
    (state) => state.transactions.transactionData?.preferences?.dueWindows,
  );

  const enrichedCards = useMemo(() => {
    // Bucket charges + repayments by card in ONE pass over the ledger, instead
    // of two full filters per card (was O(cards × transactions) with a fresh
    // array allocated each time — a big chunk of the first-render cost).
    const chargeByCard = new Map();
    const repayByCard = new Map();
    for (const t of allTransactions) {
      const amt = parseFloat(t.amount) || 0;
      if (t.cardId) chargeByCard.set(t.cardId, (chargeByCard.get(t.cardId) || 0) + amt);
      if (t.repaymentFor)
        repayByCard.set(t.repaymentFor, (repayByCard.get(t.repaymentFor) || 0) + amt);
    }
    // Per-card outstanding (transactions and EMI) — same result as before.
    const perCard = cards.map((card) => {
      const txOutstanding = chargeByCard.get(card.id) || 0;
      const repayments = repayByCard.get(card.id) || 0;
      const emiOutstanding = commitments
        .filter((c) => emiCardId(c) === card.id && commitmentIsActive(c))
        .reduce((s, c) => {
          const emi = parseFloat(c.emiAmount) || 0;
          if (c.currentOutstanding != null) {
            return (
              s +
              calcOutstandingFromSnapshot(
                c.currentOutstanding,
                c.interestRate || 0,
                emi,
                monthsSince(c.currentOutstandingDate || c.startDate)
              )
            );
          }
          const tenure = parseInt(c.tenureMonths) || 0;
          const principal = calcPrincipalFromEMI(
            emi,
            c.interestRate || 0,
            tenure
          );
          if (!principal || !tenure) return s + emi;
          const start = c.startDate ? new Date(c.startDate) : null;
          const now = new Date();
          const paid = start
            ? Math.max(
                0,
                (now.getFullYear() - start.getFullYear()) * 12 +
                  (now.getMonth() - start.getMonth())
              )
            : 0;
          return (
            s + calcOutstanding(principal, c.interestRate || 0, tenure, paid)
          );
        }, 0);
      // Repayments only offset regular tx charges. emiOutstanding is self-accounting via amortization.
      const txNet = Math.max(0, txOutstanding - repayments);
      return {
        ...card,
        ownOutstanding: txNet + emiOutstanding,
        txOutstanding,
        txNet,
      };
    });

    // Build group totals so each card in a pool shares limit/outstanding.
    const groupTotals = new Map();
    perCard.forEach((c) => {
      if (!c.creditGroupId) return;
      const g = groupTotals.get(c.creditGroupId) ?? {
        limit: 0,
        outstanding: 0,
        members: [],
      };
      // Pooled cards share one physical credit limit (the form pre-fills the
       // new card's limit with the pool's available headroom). Take the max,
      // not the sum, so the displayed pool limit reflects the real ceiling
      // instead of double-counting it across siblings.
      g.limit = Math.max(g.limit, parseFloat(c.limit) || 0);
      g.outstanding += c.ownOutstanding;
      g.members.push({ id: c.id, name: c.name, ownOutstanding: c.ownOutstanding });
      groupTotals.set(c.creditGroupId, g);
    });

    return perCard.map((c) => {
      // outstanding stays per-card so summaries (totals, dues) don't double-count.
      // Pool fields are exposed separately for the card detail view.
      if (c.creditGroupId && groupTotals.has(c.creditGroupId)) {
        const g = groupTotals.get(c.creditGroupId);
        return {
          ...c,
          outstanding: c.ownOutstanding,
          poolLimit: g.limit,
          poolOutstanding: g.outstanding,
          poolMembers: g.members.filter((m) => m.id !== c.id),
        };
      }
      return { ...c, outstanding: c.ownOutstanding };
    });
  }, [cards, allTransactions, commitments]);

  const [activeTab, setActiveTab] = useState("Overview");
  const [modal, setModal] = useState(null); // { type, entity? }
  const [deleteTarget, setDeleteTarget] = useState(null); // { kind, item }
  const [precloseTarget, setPrecloseTarget] = useState(null); // commitment

  // Linked-EMI lookup for the delete-confirm modal. When the user tries
  // to delete a card, we surface any active EMIs paying via that card so
  // the modal can block deletion and route the user to preclose first.
  const blockedByCommitments = useMemo(() => {
    if (deleteTarget?.kind !== "card") return [];
    return commitments.filter(
      (c) =>
        c.cardId === deleteTarget.item.id &&
        commitmentIsActive(c) &&
        !c.preclosedAt,
    );
  }, [deleteTarget, commitments]);
  const [repayTarget, setRepayTarget] = useState(null); // lending object
  const [highlightCardId, setHighlightCardId] = useState(null);
  const [highlightCommitmentId, setHighlightCommitmentId] = useState(null);

  // Deep-link from the notifications modal: ?highlight=<id>&focus=card|commitment
  // switches to the relevant tab and flashes the item (same convention the
  // Investments/Subscriptions pages already use). The param is consumed once.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get("highlight");
    const focus = searchParams.get("focus");
    if (!id) return;
    if (focus === "commitment") {
      setActiveTab("Commitments");
      setHighlightCommitmentId(id);
    } else {
      setActiveTab("Cards");
      setHighlightCardId(id);
    }
    const t = setTimeout(() => setSearchParams({}, { replace: true }), 3500);
    return () => clearTimeout(t);
  }, [searchParams, setSearchParams]);

  const handleEmiBadgeClick = (commitmentId) => {
    setHighlightCommitmentId(commitmentId);
    setActiveTab("Commitments");
  };

  const [dismissedBills, setDismissedBills] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("sol_dismissed_bills") || "[]");
    } catch {
      return [];
    }
  });

  const todayBills = useMemo(() => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth();
    const todayDay = now.getDate();
    return commitments.filter((c) => {
      if (!commitmentIsActive(c) || c.type !== "emi") return false;
      // Trigger on the payment DUE day, not the billing/statement day — the
      // EMI is payable on its due date, so a "Due Today" prompt on the earlier
      // billing date is misleading.
      const triggerDay = parseInt(c.dueDay ?? c.billingDay);
      if (triggerDay !== todayDay) return false;
      // Suppress if a repayment was already logged this month for this commitment or its card
      const paidThisMonth = allTransactions.some((t) => {
        if (t.repaymentFor !== c.id && t.repaymentFor !== c.cardId)
          return false;
        const d = new Date(t.occurredAt ?? t.createdAt);
        return d.getFullYear() === yr && d.getMonth() === mo;
      });
      if (paidThisMonth) return false;
      const key = `${c.id}-${yr}-${mo}`;
      return !dismissedBills.includes(key);
    });
  }, [commitments, dismissedBills, allTransactions]);

  const handleDismissBill = useCallback(
    (commitment) => {
      const now = new Date();
      const key = `${commitment.id}-${now.getFullYear()}-${now.getMonth()}`;
      const updated = [...dismissedBills, key];
      setDismissedBills(updated);
      sessionStorage.setItem("sol_dismissed_bills", JSON.stringify(updated));
    },
    [dismissedBills]
  );

  const handleCardTap = useCallback((cardId) => {
    setHighlightCardId(cardId);
    setActiveTab("Cards");
  }, []);

  // ── Card handlers ──────────────────────────────────
  const handleSaveCard = useCallback(
    (card, opts) => {
      if (modal?.entity) dispatch(persistUpdateCard(card, opts));
      else dispatch(persistAddCard(card, opts));
      setModal(null);
    },
    [dispatch, modal]
  );

  // ── Commitment handlers ────────────────────────────
  const handleSaveCommitment = useCallback(
    (c) => {
      if (modal?.entity) dispatch(persistUpdateCommitment(c));
      else dispatch(persistAddCommitment(c));
      setModal(null);
    },
    [dispatch, modal]
  );

  // ── Lending handlers ───────────────────────────────
  const handleSaveLending = useCallback(
    (l) => {
      if (modal?.entity) dispatch(persistUpdateLending(l));
      else dispatch(persistAddLending(l));
      setModal(null);
    },
    [dispatch, modal]
  );

  const handleMarkReturned = useCallback((lending) => {
    setRepayTarget(lending);
  }, []);

  const handleConfirmRepay = useCallback(
    ({ amount, occurredAt, affectBalance, accountId }) => {
      if (!repayTarget) return;
      dispatch(
        persistRepayLending({
          lending: repayTarget,
          amount,
          occurredAt,
          affectBalance,
          accountId,
        }),
      );
      setRepayTarget(null);
    },
    [dispatch, repayTarget],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const {kind, item} = deleteTarget;
    if (kind === "card") dispatch(persistDeleteCard(item.id));
    else if (kind === "commitment") dispatch(persistDeleteCommitment(item.id));
    else if (kind === "lending") dispatch(persistDeleteLending(item.id));
    setDeleteTarget(null);
  }, [deleteTarget, dispatch]);

  const modalTitle = {
    addCard: "Add Credit Card",
    editCard: "Edit Card",
    addCommitment: "Add Commitment",
    editCommitment: "Edit Commitment",
    addLending: "Add Entry",
    editLending: "Edit Entry",
  }[modal?.type];

  return (
    <div className="sol-page">
      {/* ── Tab bar ── */}
      <div className="sol-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`sol-tab${activeTab === t ? " sol-tab--active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {activeTab === t && (
              <motion.span
                layoutId="solTabPill"
                className="sol-tab-pill"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            {t}
          </button>
        ))}
      </div>

      {/* ── Add button (Cards and Commitments only; Lendings has its own inline button) ── */}
      {(activeTab === "Cards" || activeTab === "Commitments") && (
        <div style={{display: "flex", justifyContent: "flex-end"}}>
          <button
            className="sol-add-btn"
            disabled={!driveReady}
            onClick={() =>
              setModal({
                type: activeTab === "Cards" ? "addCard" : "addCommitment",
              })
            }
          >
            <i className="fa-solid fa-plus" />
            {activeTab === "Cards" ? "Add Card" : "Add Commitment"}
          </button>
        </div>
      )}

      {/* ── Tab content ── */}
      {activeTab === "Overview" && (
        <>
          {todayBills.length > 0 && (
            <div className="sol-bills-wrap">
              {todayBills.map((c) => (
                <EMIBill
                  key={c.id}
                  commitment={c}
                  onDismiss={() => handleDismissBill(c)}
                />
              ))}
            </div>
          )}
          <OverviewTab
            cards={enrichedCards}
            commitments={commitments}
            lendings={lendings}
            onCardTap={handleCardTap}
            allTransactions={allTransactions}
            dueWindows={dueWindows}
          />
        </>
      )}
      {activeTab === "Cards" && (
        <CardsTab
          cards={enrichedCards}
          transactions={allTransactions}
          commitments={commitments}
          driveReady={driveReady}
          onAdd={() => setModal({type: "addCard"})}
          onEdit={(c) => setModal({type: "editCard", entity: c})}
          onDelete={(c) => setDeleteTarget({kind: "card", item: c})}
          highlightCardId={highlightCardId}
          onHighlightClear={() => setHighlightCardId(null)}
          onEmiBadgeClick={handleEmiBadgeClick}
          onJumpToCard={handleCardTap}
        />
      )}
      {activeTab === "Commitments" && (
        <CommitmentsTab
          commitments={commitments}
          driveReady={driveReady}
          onAdd={() => setModal({type: "addCommitment"})}
          onEdit={(c) => setModal({type: "editCommitment", entity: c})}
          onDelete={(c) => setDeleteTarget({kind: "commitment", item: c})}
          highlightCommitmentId={highlightCommitmentId}
          onHighlightClear={() => setHighlightCommitmentId(null)}
        />
      )}
      {activeTab === "Lendings" && (
        <LendingsTab
          lendings={lendings}
          driveReady={driveReady}
          onAdd={() => setModal({type: "addLending"})}
          onEdit={(l) => setModal({type: "editLending", entity: l})}
          onDelete={(l) => setDeleteTarget({kind: "lending", item: l})}
          onMarkReturned={handleMarkReturned}
        />
      )}

      {/* ── CRUD modals ── */}
      {modal && (
        <Modal open={!!modal} onClose={() => setModal(null)} title={modalTitle}>
          {(modal.type === "addCard" || modal.type === "editCard") && (
            <CardForm
              onSubmit={handleSaveCard}
              onCancel={() => setModal(null)}
              existing={modal.entity}
              cards={enrichedCards}
            />
          )}
          {(modal.type === "addCommitment" ||
            modal.type === "editCommitment") && (
            <CommitmentForm
              onSubmit={handleSaveCommitment}
              onCancel={() => setModal(null)}
              existing={modal.entity}
            />
          )}
          {(modal.type === "addLending" || modal.type === "editLending") && (
            <LendingForm
              onSubmit={handleSaveLending}
              onCancel={() => setModal(null)}
              existing={modal.entity}
            />
          )}
        </Modal>
      )}

      {/* ── Delete confirm ── */}
      {deleteTarget && (
        <Modal
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title={`Remove ${deleteTarget.kind}?`}
        >
          <DeleteConfirm
            name={deleteTarget.item.name}
            onConfirm={handleConfirmDelete}
            onClose={() => setDeleteTarget(null)}
          />
        </Modal>
      )}

      {/* ── Lending repay modal ── */}
      {repayTarget && (
        <Modal
          open={!!repayTarget}
          onClose={() => setRepayTarget(null)}
          title={
            repayTarget.direction === "lent"
              ? `Receive from ${repayTarget.name}`
              : `Repay ${repayTarget.name}`
          }
        >
          <LendingRepayForm
            lending={repayTarget}
            onConfirm={handleConfirmRepay}
            onClose={() => setRepayTarget(null)}
          />
        </Modal>
      )}
    </div>
  );
};

export default memo(SolvencyPage);
