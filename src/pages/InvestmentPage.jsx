import { memo, useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSelector, useDispatch } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import Modal from "../preStyledElements/modal/Modal";
import InvestmentForm from "../Forms/InvestmentForm";
import LiquidGlassCard from "../components/LiquidGlassCard";
import BankChipSelector from "../components/BankChipSelector";
import DateField from "../components/DateField";
import { INVESTMENT_TYPES } from "../utils/constants";
import { INR } from "../utils/dashboardUtils";
import {
  calcReturns,
  getPortfolioSummary,
  getAllocationData,
  getCategoryAllocationData,
  getInvestmentInsights,
  getTypeInfo,
  getPerformanceExtremes,
  getConcentrationRisks,
  getUpcomingMaturities,
  groupInvestmentsByTicker,
  findAutoDeductAmount,
  getInvestmentMathProfile,
  resolveGrace,
  graceToDays,
  computeLatePenalty,
} from "../utils/investmentUtils";
import { getInvestmentTypeSchema } from "../utils/investmentTypeSchemas";
import {
  persistAddInvestment,
  persistUpdateInvestment,
  persistPayLicArrears,
  persistDeleteInvestment,
  persistDeleteTransaction,
  persistSIPInstalment,
  persistLogAutoDeductPayment,
  persistSellInvestment,
  persistPauseInvestment,
  persistResumeInvestment,
  persistHardDeleteInvestment,
  persistSurrenderLicPolicy,
  persistMatureLicPolicy,
} from "../redux/slices/transactionSlice";
import { fetchCurrentPrice, fetchSIPData } from "../utils/priceService";
import { filterInvestmentsByDate, getFilterLabel } from "../utils/filterUtils";
import { showToast } from "../redux/slices/toastSlice";
import FilterBar from "../components/FilterBar";
// The Investment page reuses the .dashboard / .dash-section layout primitives,
// which are defined in dashboard.css. Import it here so those base styles are
// present even when the Dashboard route (the only other importer) hasn't been
// visited — otherwise the section cards render unstyled in the classic skin.
import "../styles/dashboard.css";
import "../styles/investment.css";

// ── LIC helpers ───────────────────────────────────────
// Premium due-day inside each scheduled month is taken from the policy's
// start date (clamped to the last day of the month). For each premium
// month, a payment is considered "made" when there's a `licPolicyId` tx
// in that calendar month.

function getLicStatus(lot, allTransactions) {
  if (!lot?.startDate || !lot?.premiumMonths?.length) return null;
  const start = new Date(lot.startDate);
  const startDay = start.getDate();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Premiums due before the policy was added to the app are assumed paid —
  // a backdated startDate would otherwise read as a run of missed premiums.
  const enrolledRaw = lot.createdAt ? new Date(lot.createdAt) : start;
  const enrolled = new Date(
    enrolledRaw.getFullYear(),
    enrolledRaw.getMonth(),
    enrolledRaw.getDate(),
  );

  const cadenceDays = Math.round(365 / (lot.premiumMonths.length || 12));
  const graceDays = graceToDays(resolveGrace(lot), cadenceDays);
  const premium = parseFloat(lot.premiumAmount) || 0;
  const penaltyPer = computeLatePenalty(lot.latePenalty, premium);

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const horizon = new Date(now.getFullYear() + 1, now.getMonth() + 1, 1);

  const paymentSet = new Set();
  for (const t of allTransactions) {
    if (t.licPolicyId !== lot.id) continue;
    const d = new Date(t.occurredAt);
    paymentSet.add(`${d.getFullYear()}-${d.getMonth()}`);
  }

  const overdue = [];
  let nextDue = null;
  while (cursor < horizon) {
    if (lot.premiumMonths.includes(cursor.getMonth() + 1)) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (!paymentSet.has(key)) {
        const lastDay = new Date(
          cursor.getFullYear(),
          cursor.getMonth() + 1,
          0,
        ).getDate();
        const dueDay = Math.min(startDay, lastDay);
        const due = new Date(cursor.getFullYear(), cursor.getMonth(), dueDay);
        if (due >= enrolled) {
          const diffDays = Math.round((due - today) / 86_400_000);
          if (diffDays >= 0) {
            if (!nextDue) nextDue = { due, daysLeft: diffDays };
          } else {
            overdue.push({ due, daysPast: -diffDays });
          }
        }
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (overdue.length === 0) {
    if (nextDue) return { next: nextDue.due, daysLeft: nextDue.daysLeft, status: "due" };
    return null;
  }

  const earliest = overdue[0];
  const lapsed = earliest.daysPast > graceDays;
  return {
    next: earliest.due,
    daysLeft: -earliest.daysPast,
    status: lapsed ? "lapsed" : "grace",
    graceDays,
    overdueCount: overdue.length,
    overduePeriods: overdue.map((o) => o.due),
    premium,
    penaltyPer,
    arrears: overdue.length * premium,
    totalPenalty: lapsed ? overdue.length * penaltyPer : 0,
  };
}

function licPremiumStats(lot, allTransactions) {
  let paidCount = 0;
  let paidAmount = 0;
  for (const t of allTransactions) {
    if (t.licPolicyId !== lot.id) continue;
    paidCount++;
    paidAmount += parseFloat(t.amount) || 0;
  }
  return { paidCount, paidAmount };
}

// Premiums scheduled before the policy was added to the app are assumed paid
// (see getLicStatus). Returns the count plus the first/last due dates of that
// pre-enrollment run, so the card tally and the ledger's "Legacy Investment"
// row both reflect the policy's real history instead of showing nothing.
function licAssumedPaid(lot) {
  const empty = { count: 0, first: null, last: null };
  if (!lot?.startDate || !lot?.premiumMonths?.length) return empty;
  const start = new Date(lot.startDate);
  const startDay = start.getDate();
  const enrolledRaw = lot.createdAt ? new Date(lot.createdAt) : start;
  const enrolled = new Date(
    enrolledRaw.getFullYear(),
    enrolledRaw.getMonth(),
    enrolledRaw.getDate(),
  );
  let count = 0;
  let first = null;
  let last = null;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < enrolled) {
    if (lot.premiumMonths.includes(cursor.getMonth() + 1)) {
      const lastDay = new Date(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        0,
      ).getDate();
      const dueDay = Math.min(startDay, lastDay);
      const due = new Date(cursor.getFullYear(), cursor.getMonth(), dueDay);
      if (due < enrolled) {
        count++;
        if (!first) first = due;
        last = due;
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { count, first, last };
}

function isLicTenureComplete(lot) {
  if (!lot?.startDate || !lot?.tenureMonths) return false;
  const start = new Date(lot.startDate);
  const matureBy = new Date(start);
  matureBy.setMonth(matureBy.getMonth() + parseInt(lot.tenureMonths));
  return new Date() >= matureBy;
}

function useCurrentTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark",
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute("data-theme") || "dark"),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ── Portfolio Hero ────────────────────────────────────

function PortfolioHero({ investments }) {
  const { totalInvested, totalCurrent, totalReturn, returnPct } = useMemo(
    () => getPortfolioSummary(investments),
    [investments],
  );
  const pos = totalReturn >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";

  if (investments.length === 0) return null;

  return (
    <div className="inv-hero">
      <LiquidGlassCard className="inv-hero-card">
        <p className="inv-hero-label">Total Invested</p>
        <p className="inv-hero-value">{INR.format(totalInvested)}</p>
      </LiquidGlassCard>
      <LiquidGlassCard className="inv-hero-card">
        <p className="inv-hero-label">Current Value</p>
        <p className="inv-hero-value" style={{ color: retColor }}>
          {INR.format(totalCurrent)}
        </p>
      </LiquidGlassCard>
      <LiquidGlassCard className="inv-hero-card">
        <p className="inv-hero-label">Total Returns</p>
        <p className="inv-hero-value" style={{ color: retColor }}>
          {pos ? "+" : ""}
          {INR.format(totalReturn)}
        </p>
      </LiquidGlassCard>
      <LiquidGlassCard className="inv-hero-card">
        <p className="inv-hero-label">Return %</p>
        <p className="inv-hero-value" style={{ color: retColor }}>
          {pos ? "+" : ""}
          {returnPct.toFixed(2)}%
        </p>
      </LiquidGlassCard>
    </div>
  );
}

// ── Portfolio Highlights ──────────────────────────────
// Top/bottom performer + concentration risk + upcoming maturities, packed
// into a single auto-fit grid so cards always fill the row.

function fmtMaturityDate(d) {
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short" });
}

function PortfolioHighlights() {
  // Highlights always works on the FULL unfiltered investments list — the
  // page's date filter shouldn't be allowed to slice out one half of a
  // grouped position (e.g. a legacy MF started years ago paired with a
  // brand-new SIP) and skew the top-performer math.
  const rawInvestments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const groupedInvestments = useMemo(
    () => groupInvestmentsByTicker(rawInvestments),
    [rawInvestments],
  );
  const extremes = useMemo(
    () =>
      getPerformanceExtremes(
        groupedInvestments,
        rawInvestments,
        allTransactions,
      ),
    [groupedInvestments, rawInvestments, allTransactions],
  );
  const risks = useMemo(
    () => getConcentrationRisks(groupedInvestments),
    [groupedInvestments],
  );
  const maturities = useMemo(
    () => getUpcomingMaturities(rawInvestments),
    [rawInvestments],
  );
  const hasActiveInvestments = useMemo(
    () => rawInvestments.some((inv) => !inv.inHistory),
    [rawInvestments],
  );
  const hasFixedIncome = useMemo(
    () =>
      rawInvestments.some(
        (inv) => !inv.inHistory && getTypeInfo(inv.type)?.subtype === "fixed",
      ),
    [rawInvestments],
  );

  if (!hasActiveInvestments) return null;

  const sameTopBottom = extremes?.top && extremes.bottom === null;

  return (
    <div className="dash-section">
      <p className="dash-section-title">Highlights</p>
      <div className="inv-highlights-grid">
        {extremes?.top && (
          <div className="inv-highlight-card inv-highlight-card--top">
            <div className="inv-highlight-head">
              <i className="fa-solid fa-trophy" />
              <span>Top performer</span>
            </div>
            <p className="inv-highlight-name">{extremes.top.inv.name}</p>
            <p
              className="inv-highlight-metric"
              style={{
                color:
                  extremes.top.returnPct >= 0
                    ? "var(--amount-income)"
                    : "var(--amount-expense)",
              }}
            >
              {extremes.top.returnPct >= 0 ? "+" : ""}
              {extremes.top.returnPct.toFixed(1)}%
            </p>
            <p className="inv-highlight-sub">
              {INR.format(extremes.top.investedAmount)} →{" "}
              {INR.format(extremes.top.currentValue)}
            </p>
          </div>
        )}

        {extremes?.bottom && !sameTopBottom && (
          <div className="inv-highlight-card inv-highlight-card--bottom">
            <div className="inv-highlight-head">
              <i className="fa-solid fa-arrow-trend-down" />
              <span>Lagging</span>
            </div>
            <p className="inv-highlight-name">{extremes.bottom.inv.name}</p>
            <p
              className="inv-highlight-metric"
              style={{
                color:
                  extremes.bottom.returnPct < 0
                    ? "var(--amount-expense)"
                    : "var(--text-secondary)",
              }}
            >
              {extremes.bottom.returnPct >= 0 ? "+" : ""}
              {extremes.bottom.returnPct.toFixed(1)}%
            </p>
            <p className="inv-highlight-sub">
              {INR.format(extremes.bottom.investedAmount)} →{" "}
              {INR.format(extremes.bottom.currentValue)}
            </p>
          </div>
        )}

        {risks.map((r) => (
          <div
            key={r.inv.id}
            className="inv-highlight-card inv-highlight-card--warn"
          >
            <div className="inv-highlight-head">
              <i className="fa-solid fa-triangle-exclamation" />
              <span>Concentration risk</span>
            </div>
            <p className="inv-highlight-name">{r.inv.name}</p>
            <p className="inv-highlight-metric">
              {r.pct.toFixed(0)}% of portfolio
            </p>
            <p className="inv-highlight-sub">
              Single-holding exposure — consider diversifying.
            </p>
          </div>
        ))}

        {/* Maturity card always renders so the user discovers the feature
            even before they have any fixed-income holdings. */}
        <div className="inv-highlight-card inv-highlight-card--maturity">
          <div className="inv-highlight-head">
            <i className="fa-solid fa-calendar-check" />
            <span>Maturities ahead</span>
          </div>
          {maturities.length > 0 ? (
            <>
              <p className="inv-highlight-name">
                {maturities.length}{" "}
                {maturities.length === 1 ? "instrument" : "instruments"} · next 12 months
              </p>
              <ul className="inv-highlight-list">
                {maturities.slice(0, 3).map((m) => (
                  <li key={m.inv.id}>
                    <span className="inv-highlight-list-name">{m.inv.name}</span>
                    <span className="inv-highlight-list-meta">
                      {m.daysLeft}d · {fmtMaturityDate(m.maturity)}
                    </span>
                  </li>
                ))}
              </ul>
              {maturities.length > 3 && (
                <p className="inv-highlight-sub">
                  + {maturities.length - 3} more
                </p>
              )}
            </>
          ) : (
            <>
              <p className="inv-highlight-name">No maturities ahead</p>
              <p className="inv-highlight-sub">
                {hasFixedIncome
                  ? "No FD, RD, LIC, Bond, or Plan matures in the next 12 months."
                  : "Add a fixed-income holding (FD, RD, LIC, Bond, Savings Plan) with a tenure to track its maturity here."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section 80C Tracker ───────────────────────────────
// Tracks deductions eligible under Section 80C (₹1.5 lakh cap) for the
// current Indian Financial Year (April → March). Eligible contributions:
//   • LIC premiums actually paid in this FY (from licPolicyId txs)
//   • PPF / NPS / ULIP / SSY contributions started this FY (investedAmount)
//   • ELSS contributions: SIP instalments + lump-sum lots whose category
//     contains "ELSS" (case-insensitive). Honest line: it relies on the
//     user actually tagging the holding correctly.

const SECTION_80C_CAP = 150000;

function fyBoundaries(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  // FY starts April 1 (month index 3).
  const fyStartYear = m >= 3 ? y : y - 1;
  return {
    start: new Date(fyStartYear, 3, 1),
    end: new Date(fyStartYear + 1, 3, 1),
    label: `FY ${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}`,
  };
}

function isElssLike(inv) {
  const cat = `${inv.category || ""} ${inv.name || ""}`.toLowerCase();
  return cat.includes("elss");
}

function compute80C(investments, transactions) {
  const { start, end, label } = fyBoundaries(new Date());
  const inWindow = (iso) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= start && d < end;
  };

  const buckets = { lic: 0, ppf: 0, nps: 0, elss: 0 };

  // LIC premiums paid this FY — from the payment ledger
  for (const t of transactions) {
    if (!t.licPolicyId) continue;
    if (!inWindow(t.occurredAt)) continue;
    buckets.lic += parseFloat(t.amount) || 0;
  }

  for (const inv of investments) {
    if (inv.type === "ppf" && inWindow(inv.startDate)) {
      buckets.ppf += parseFloat(inv.investedAmount) || 0;
    } else if (inv.type === "nps" && inWindow(inv.startDate)) {
      buckets.nps += parseFloat(inv.investedAmount) || 0;
    } else if (isElssLike(inv)) {
      if (inv.type === "sip") {
        // ELSS-tagged SIP — count each instalment that hit in this FY
        for (const t of transactions) {
          if (t.sipInvestmentId !== inv.id) continue;
          if (!inWindow(t.occurredAt)) continue;
          buckets.elss += parseFloat(t.amount) || 0;
        }
      } else if (inWindow(inv.startDate)) {
        // ELSS-tagged lump sum lot
        const qty = parseFloat(inv.quantity) || 0;
        const buy = parseFloat(inv.buyPrice) || 0;
        buckets.elss += qty * buy || parseFloat(inv.investedAmount) || 0;
      }
    }
  }

  const total = buckets.lic + buckets.ppf + buckets.nps + buckets.elss;
  const cap = SECTION_80C_CAP;
  const pct = Math.min(100, (total / cap) * 100);
  const remaining = Math.max(0, cap - total);
  return { buckets, total, cap, pct, remaining, label };
}

function Section80CTracker() {
  const investments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const data = useMemo(
    () => compute80C(investments, allTransactions),
    [investments, allTransactions],
  );

  if (data.total <= 0) return null;

  const rows = [
    { key: "lic", label: "LIC premiums", color: "#9b59b6" },
    { key: "ppf", label: "PPF", color: "#16a34a" },
    { key: "nps", label: "NPS", color: "#0ea5e9" },
    { key: "elss", label: "ELSS funds", color: "#f59e0b" },
  ].filter((r) => data.buckets[r.key] > 0);

  const exhausted = data.total >= data.cap;

  return (
    <div className="dash-section inv-80c-tile">
      <div className="inv-80c-head">
        <div>
          <p className="dash-section-title" style={{ margin: 0 }}>
            <i className="fa-solid fa-receipt" style={{ marginRight: 6 }} />
            Section 80C used
          </p>
          <p className="inv-80c-sub">{data.label} · cap {INR.format(data.cap)}</p>
        </div>
        <p
          className="inv-80c-total"
          style={{
            color: exhausted ? "var(--amount-income)" : "var(--text-primary)",
          }}
        >
          {INR.format(data.total)}
          <span className="inv-80c-pct">
            {" "}
            ({data.pct.toFixed(0)}%)
          </span>
        </p>
      </div>
      <div className="inv-80c-bar-track">
        <div
          className="inv-80c-bar-fill"
          style={{
            width: `${data.pct}%`,
            background: exhausted
              ? "var(--amount-income)"
              : "linear-gradient(90deg, #9b59b6, #f59e0b)",
          }}
        />
      </div>
      <div className="inv-80c-rows">
        {rows.map((r) => (
          <div key={r.key} className="inv-80c-row">
            <span className="inv-alloc-dot" style={{ background: r.color }} />
            <span className="inv-80c-row-label">{r.label}</span>
            <span className="inv-80c-row-val">
              {INR.format(data.buckets[r.key])}
            </span>
          </div>
        ))}
      </div>
      <p className="inv-80c-foot">
        {exhausted ? (
          <>
            <i className="fa-solid fa-check" /> 80C cap exhausted for {data.label}.
          </>
        ) : (
          <>
            <i className="fa-solid fa-piggy-bank" /> {INR.format(data.remaining)}{" "}
            of headroom left this FY.
          </>
        )}
      </p>
    </div>
  );
}

// ── Upcoming Reminders ────────────────────────────────
// Surfaces the next debit for each active SIP and the next premium for
// each active LIC policy, sorted soonest-first. Read straight from the
// unfiltered investment list so the page's date filter doesn't hide a
// recurring obligation.

function getNextSipDebit(inv) {
  if (inv.paused || inv.inHistory) return null;
  const day =
    parseInt(inv.sipDay) ||
    (inv.startDate ? new Date(inv.startDate).getDate() : 1);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function buildDue(year, monthIdx) {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    return new Date(year, monthIdx, Math.min(day, lastDay));
  }
  let due = buildDue(today.getFullYear(), today.getMonth());
  if (due < today) due = buildDue(today.getFullYear(), today.getMonth() + 1);
  const daysLeft = Math.round((due - today) / 86_400_000);
  return { due, daysLeft };
}

function ReminderSection() {
  const investments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const reminders = useMemo(() => {
    const out = [];
    for (const inv of investments) {
      if (inv.inHistory) continue;
      if (inv.type === "sip") {
        const next = getNextSipDebit(inv);
        if (!next) continue;
        out.push({
          id: inv.id,
          kind: "sip",
          inv,
          due: next.due,
          daysLeft: next.daysLeft,
          amount: parseFloat(inv.monthlyAmount) || 0,
        });
      } else if (inv.type === "lic") {
        const status = getLicStatus(inv, allTransactions);
        if (!status) continue;
        out.push({
          id: inv.id,
          kind: "lic",
          inv,
          due: status.next,
          daysLeft: status.daysLeft,
          status: status.status,
          amount: parseFloat(inv.premiumAmount) || 0,
        });
      }
    }
    return out.sort((a, b) => a.due - b.due).slice(0, 6);
  }, [investments, allTransactions]);

  if (reminders.length === 0) return null;

  const fmtDue = (d) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <div className="dash-section">
      <p className="dash-section-title">
        <i className="fa-solid fa-bell" style={{ marginRight: 6 }} />
        Upcoming Reminders
      </p>
      <div className="inv-reminder-list">
        {reminders.map((r) => {
          const info = getTypeInfo(r.inv.type);
          const isLate = r.daysLeft < 0;
          const lateBy = Math.abs(r.daysLeft);
          const isToday = r.daysLeft === 0;
          const isLapsed = r.kind === "lic" && r.status === "lapsed";
          return (
            <div
              key={`${r.kind}-${r.id}`}
              className={`inv-reminder-item${isLapsed ? " inv-reminder-item--lapsed" : isLate ? " inv-reminder-item--late" : ""}`}
            >
              <span
                className="inv-reminder-icon"
                style={{ background: info.color + "22", color: info.color }}
              >
                <i className={`fa-solid ${info.icon}`} />
              </span>
              <div className="inv-reminder-body">
                <p className="inv-reminder-name">{r.inv.name}</p>
                <p className="inv-reminder-sub">
                  {INR.format(r.amount)} · {r.kind === "sip" ? "SIP" : "LIC premium"} · {fmtDue(r.due)}
                </p>
              </div>
              <span
                className={`inv-reminder-when${isLate ? " inv-reminder-when--late" : isToday ? " inv-reminder-when--today" : ""}`}
              >
                {isLapsed
                  ? `Lapsed · ${lateBy}d`
                  : isLate
                    ? `${lateBy}d overdue`
                    : isToday
                      ? "Today"
                      : `in ${r.daysLeft}d`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Insight Cards ─────────────────────────────────────

function InsightCards({ investments }) {
  const fdRate = useSelector(
    (state) => state.transactions.transactionData?.preferences?.fdRate ?? 7,
  );
  const inflationRate = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.inflationRate ?? 6,
  );
  const insights = useMemo(
    () => getInvestmentInsights(investments, { fdRate, inflationRate }),
    [investments, fdRate, inflationRate],
  );
  if (insights.length === 0) return null;
  return (
    <div className="dash-section">
      <p className="dash-section-title">Portfolio Pulse</p>
      <div className="inv-insight-strip">
        {insights.map((ins, i) => (
          <div
            key={i}
            className={`inv-insight-card${ins.positive ? "" : " inv-insight--neg"}`}
          >
            <i className={`fa-solid ${ins.icon} inv-insight-icon`} />
            <div>
              <p className="inv-insight-label">{ins.label}</p>
              <p className="inv-insight-value">{ins.value}</p>
              <p className="inv-insight-sub">{ins.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Holdings List ─────────────────────────────────────

function fmtUpdated(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Shared bank-destination picker for the balance-affecting modals (sell,
// surrender, mature). When multi-bank tracking is on, the proceeds have to
// land in a specific account — otherwise it's ambiguous which bank's balance
// the income credits. Returns "" (Untagged) by default.
function useBalanceBankPicker() {
  const multiBankEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.multiBankEnabled ?? false,
  );
  const accounts = useSelector(
    (s) => s.transactions.transactionData?.accounts ?? [],
  );
  const [accountId, setAccountId] = useState("");
  return { multiBankEnabled, accounts, accountId, setAccountId };
}

function SellModal({ inv, onConfirm, onClose }) {
  const [qty, setQty] = useState("");
  const [sellPrice, setSellPrice] = useState(String(inv.currentPrice || ""));
  const [addToBalance, setAddToBalance] = useState(true);
  const { multiBankEnabled, accounts, accountId, setAccountId } =
    useBalanceBankPicker();
  const totalQty = inv.quantity;
  const sellQty = parseFloat(qty) || 0;
  const sellPriceNum = parseFloat(sellPrice) || 0;
  const proceeds = sellQty * sellPriceNum;
  const remaining = Math.max(0, totalQty - sellQty);
  const isValid = sellQty > 0 && sellQty <= totalQty;
  const isAll = isValid && remaining < 0.00001;

  return (
    <div className="inv-sell-form">
      <p className="inv-sell-total">
        Currently holding <strong>{totalQty} units</strong>
        {inv._lots > 1 && (
          <span className="inv-orders-badge" style={{ marginLeft: 6 }}>
            {inv._lots} orders
          </span>
        )}
      </p>
      <div className="sol-form-row">
        <div className="field">
          <input
            type="number"
            inputMode="decimal"
            min="0.0001"
            max={totalQty}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder=" "
            autoFocus
          />
          <label>Quantity to sell</label>
        </div>
        <div className="field">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={sellPrice}
            onChange={(e) => setSellPrice(e.target.value)}
            placeholder=" "
          />
          <label>Sell price per unit (₹)</label>
        </div>
      </div>
      {isValid && sellPriceNum > 0 && (
        <p className="inv-sell-proceeds">
          Proceeds: <strong>{INR.format(proceeds)}</strong>
        </p>
      )}
      {isValid && (
        <p className={`inv-sell-remaining${isAll ? " inv-sell-remaining--all" : ""}`}>
          {isAll
            ? "Selling all units will remove this holding"
            : `${+remaining.toFixed(6)} units remaining after sell`}
        </p>
      )}
      <label className="inv-balance-toggle" style={{ marginTop: 16 }}>
        <input
          type="checkbox"
          checked={addToBalance}
          onChange={(e) => setAddToBalance(e.target.checked)}
        />
        <span className="inv-balance-toggle-text">
          Add proceeds to balance
          <span className="inv-balance-toggle-sub">
            {addToBalance
              ? "Sale amount will be logged as income and increase your balance"
              : "Sale recorded against the holding only — balance unaffected"}
          </span>
        </span>
      </label>
      {addToBalance && multiBankEnabled && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Received into"
        />
      )}
      <div className="form-actions inv-sell-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="inv-sell-confirm-btn"
          disabled={!isValid}
          onClick={() => onConfirm({ qty: sellQty, sellPrice: sellPriceNum, addToBalance, accountId })}
        >
          <i className="fa-solid fa-arrow-trend-down" /> Sell
        </button>
      </div>
    </div>
  );
}

// ── LIC Surrender / Mature Modals ─────────────────────

function LicSurrenderModal({ inv, allTransactions, onConfirm, onClose }) {
  const { paidCount, paidAmount } = useMemo(
    () => licPremiumStats(inv, allTransactions),
    [inv, allTransactions],
  );
  const [amount, setAmount] = useState("");
  const [addToBalance, setAddToBalance] = useState(true);
  const { multiBankEnabled, accounts, accountId, setAccountId } =
    useBalanceBankPicker();
  const value = parseFloat(amount) || 0;
  const paid = paidAmount > 0 ? paidAmount : parseFloat(inv.investedAmount) || 0;
  const returnAmt = value - paid;
  const returnPct = paid > 0 ? (returnAmt / paid) * 100 : 0;
  const isValid = value > 0;
  const pos = returnAmt >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";

  return (
    <div className="inv-sell-form">
      <p className="inv-sell-total">
        You've paid <strong>{INR.format(paid)}</strong> across{" "}
        <strong>{paidCount} premium{paidCount !== 1 ? "s" : ""}</strong>.
        Surrender closes the policy and moves it to History.
      </p>
      <div className="field">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder=" "
          autoFocus
        />
        <label>Surrender value received (₹)</label>
      </div>
      {isValid && (
        <p className="inv-sell-proceeds" style={{ color: retColor }}>
          {pos ? "Gain" : "Loss"}: <strong>{INR.format(Math.abs(returnAmt))}</strong>
          <span style={{ marginLeft: 8, opacity: 0.8 }}>
            ({pos ? "+" : ""}{returnPct.toFixed(1)}%)
          </span>
        </p>
      )}
      <label className="inv-balance-toggle" style={{ marginTop: 16 }}>
        <input
          type="checkbox"
          checked={addToBalance}
          onChange={(e) => setAddToBalance(e.target.checked)}
        />
        <span className="inv-balance-toggle-text">
          Add surrender amount to balance
          <span className="inv-balance-toggle-sub">
            {addToBalance
              ? "Surrender value will be logged as income and increase your balance"
              : "Recorded against the policy only — balance unaffected"}
          </span>
        </span>
      </label>
      {addToBalance && multiBankEnabled && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Received into"
        />
      )}
      <div className="form-actions inv-sell-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="inv-sell-confirm-btn"
          disabled={!isValid}
          onClick={() => onConfirm({ amount: value, addToBalance, accountId })}
        >
          <i className="fa-solid fa-arrow-right-from-bracket" /> Surrender
        </button>
      </div>
    </div>
  );
}

function LicMatureModal({ inv, allTransactions, onConfirm, onClose }) {
  const { paidCount, paidAmount } = useMemo(
    () => licPremiumStats(inv, allTransactions),
    [inv, allTransactions],
  );
  const [amount, setAmount] = useState(
    inv.maturityAmount ? String(inv.maturityAmount) : "",
  );
  const [addToBalance, setAddToBalance] = useState(true);
  const { multiBankEnabled, accounts, accountId, setAccountId } =
    useBalanceBankPicker();
  const value = parseFloat(amount) || 0;
  const paid = paidAmount > 0 ? paidAmount : parseFloat(inv.investedAmount) || 0;
  const returnAmt = value - paid;
  const returnPct = paid > 0 ? (returnAmt / paid) * 100 : 0;
  const isValid = value > 0;
  const pos = returnAmt >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";

  return (
    <div className="inv-sell-form">
      <p className="inv-sell-total">
        Policy completed its {inv.tenureMonths}-month tenure. You've paid{" "}
        <strong>{INR.format(paid)}</strong> across{" "}
        <strong>{paidCount} premium{paidCount !== 1 ? "s" : ""}</strong>.
      </p>
      <div className="field">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder=" "
          autoFocus
        />
        <label>Actual maturity amount (₹)</label>
      </div>
      {isValid && (
        <p className="inv-sell-proceeds" style={{ color: retColor }}>
          Total return: <strong>{INR.format(Math.abs(returnAmt))}</strong>
          <span style={{ marginLeft: 8, opacity: 0.8 }}>
            ({pos ? "+" : ""}{returnPct.toFixed(1)}%)
          </span>
        </p>
      )}
      <label className="inv-balance-toggle" style={{ marginTop: 16 }}>
        <input
          type="checkbox"
          checked={addToBalance}
          onChange={(e) => setAddToBalance(e.target.checked)}
        />
        <span className="inv-balance-toggle-text">
          Add maturity amount to balance
          <span className="inv-balance-toggle-sub">
            {addToBalance
              ? "Maturity payout will be logged as income and increase your balance"
              : "Recorded against the policy only — balance unaffected"}
          </span>
        </span>
      </label>
      {addToBalance && multiBankEnabled && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Received into"
        />
      )}
      <div className="form-actions inv-sell-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="inv-sell-confirm-btn"
          disabled={!isValid}
          onClick={() => onConfirm({ amount: value, addToBalance, accountId })}
        >
          <i className="fa-solid fa-flag-checkered" /> Mark Matured
        </button>
      </div>
    </div>
  );
}

// ── Lot Picker (for multi-lot edit) ───────────────────

function LotPicker({ group, allInvestments, onPick, onClose }) {
  const lots = (group._ids ?? [group.id])
    .map((id) => allInvestments.find((i) => i.id === id))
    .filter(Boolean);
  return (
    <div className="inv-lot-picker">
      <p className="inv-lot-picker-hint">
        This holding has {lots.length} underlying lots. Pick the one you want
        to edit — the form will load that lot's fields.
      </p>
      <div className="inv-lot-picker-list">
        {lots.map((lot) => {
          const info = getTypeInfo(lot.type);
          const isUnit = info.subtype === "unit";
          return (
            <button
              key={lot.id}
              type="button"
              className="inv-lot-picker-item"
              onClick={() => onPick(lot.id)}
            >
              <span
                className="inv-type-badge"
                style={{ background: info.color + "22", color: info.color }}
              >
                <i className={`fa-solid ${info.icon}`} /> {info.label}
              </span>
              <div className="inv-lot-picker-meta">
                <span className="inv-lot-picker-name">{lot.name}</span>
                <span className="inv-lot-picker-sub">
                  {isUnit
                    ? `${lot.quantity} units · ${INR.format((parseFloat(lot.quantity) || 0) * (parseFloat(lot.buyPrice) || 0))} invested`
                    : `${INR.format(parseFloat(lot.investedAmount) || 0)} invested`}
                  {lot.startDate && (
                    <>
                      {" · started "}
                      {new Date(lot.startDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </>
                  )}
                </span>
              </div>
              <i className="fa-solid fa-chevron-right inv-lot-picker-chevron" />
            </button>
          );
        })}
      </div>
      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Pause SIP Confirmation ────────────────────────────

function PauseConfirm({ inv, onConfirm, onClose }) {
  const monthly = parseFloat(inv.monthlyAmount) || 0;
  return (
    <div className="inv-pause-confirm">
      <p className="inv-pause-summary">
        Pausing <strong>{inv.name}</strong> stops the monthly auto-deduction
        of <strong>{INR.format(monthly)}</strong>. Past instalments, units,
        and returns are kept as-is — nothing is deleted.
      </p>
      <ul className="inv-pause-points">
        <li>
          <i className="fa-solid fa-check" /> All logged instalments stay on
          record
        </li>
        <li>
          <i className="fa-solid fa-check" /> Quantity, NAV and returns are
          preserved
        </li>
        <li>
          <i className="fa-solid fa-check" /> No future months will be
          auto-deducted until you Resume
        </li>
      </ul>
      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="generic-button"
          onClick={onConfirm}
        >
          <i className="fa-solid fa-pause" /> Pause SIP
        </button>
      </div>
    </div>
  );
}

// ── Resume SIP Form ───────────────────────────────────

function ResumeForm({ inv, onConfirm, onClose }) {
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [deductOnStart, setDeductOnStart] = useState(false);
  const monthly = parseFloat(inv.monthlyAmount) || 0;

  return (
    <div className="inv-resume-form">
      <p className="inv-resume-summary">
        Resuming <strong>{inv.name}</strong>. Auto-deduction of{" "}
        <strong>{INR.format(monthly)}</strong> will continue every month from
        the chosen day.
      </p>
      <DateField
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        label="New start date"
        required
      />
      <label className="card-combine-toggle">
        <input
          type="checkbox"
          checked={deductOnStart}
          onChange={(e) => setDeductOnStart(e.target.checked)}
        />
        <span className="card-combine-toggle-text">
          Also deduct an instalment for the start date
          <span className="card-combine-toggle-sub">
            {deductOnStart
              ? `${INR.format(monthly)} will be logged on ${new Date(startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
              : "Only future months will be auto-deducted"}
          </span>
        </span>
      </label>
      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="generic-button"
          onClick={() =>
            onConfirm({
              startDate: new Date(startDate).toISOString(),
              deductOnStart,
            })
          }
        >
          <i className="fa-solid fa-play" /> Resume
        </button>
      </div>
    </div>
  );
}

// ── Per-holding Ledger ────────────────────────────────

function getDeletePayload(e) {
  if (e.id.startsWith("buy-")) return { kind: "investment", id: e.id.slice(4) };
  if (e.id.startsWith("sip-enrol-")) return { kind: "investment", id: e.id.slice(10) };
  if (e.id.startsWith("lic-enrol-")) return { kind: "investment", id: e.id.slice(10) };
  if (e.id.startsWith("sip-legacy-")) return null;
  if (e.id.startsWith("auto-enrol-")) return { kind: "investment", id: e.id.slice(11) };
  if (e.id.startsWith("auto-legacy-")) return null;
  if (e.id.startsWith("lic-legacy-")) return null;
  if (e.id.startsWith("lic-surrender-")) return null;
  if (e.id.startsWith("lic-mature-")) return null;
  return { kind: "transaction", id: e.id };
}

const FREQ_LABEL = {
  1: "Annual",
  2: "Semi-annual",
  4: "Quarterly",
  12: "Monthly",
};

function licFreqLabel(f) {
  return FREQ_LABEL[parseInt(f) || 1] || "Annual";
}

// ── Auto-deduct period walker ─────────────────────────────────
//
// Generates a list of completed periods between an investment's startDate
// and "now" for a given frequency, then matches each period against the
// `autoDeductInvestmentId`-tagged transactions on the ledger to decide
// which are tracked vs legacy (untracked). Mirrors how the SIP block in
// LedgerModal walks months, generalised to monthly / quarterly / yearly.

function walkAutoDeductPeriods(startDate, frequency) {
  const out = [];
  const start = new Date(startDate);
  const now = new Date();
  if (frequency === "yearly") {
    for (let yr = start.getFullYear(); yr < now.getFullYear(); yr++) {
      out.push({ kind: "yearly", year: yr });
    }
  } else if (frequency === "quarterly") {
    let yr = start.getFullYear();
    let q = Math.floor(start.getMonth() / 3);
    const curYr = now.getFullYear();
    const curQ = Math.floor(now.getMonth() / 3);
    while (yr < curYr || (yr === curYr && q < curQ)) {
      out.push({ kind: "quarterly", year: yr, quarter: q });
      q++;
      if (q > 3) { q = 0; yr++; }
    }
  } else {
    let yr = start.getFullYear();
    let mo = start.getMonth();
    while (
      yr < now.getFullYear() ||
      (yr === now.getFullYear() && mo < now.getMonth())
    ) {
      out.push({ kind: "monthly", year: yr, month: mo });
      mo++;
      if (mo > 11) { mo = 0; yr++; }
    }
  }
  return out;
}

function txMatchesPeriod(txDate, period) {
  if (period.kind === "yearly") return txDate.getFullYear() === period.year;
  if (period.kind === "quarterly") {
    return (
      txDate.getFullYear() === period.year &&
      Math.floor(txDate.getMonth() / 3) === period.quarter
    );
  }
  return (
    txDate.getFullYear() === period.year &&
    txDate.getMonth() === period.month
  );
}

function periodToDate(period) {
  if (period.kind === "yearly") return new Date(period.year, 0, 1);
  if (period.kind === "quarterly") return new Date(period.year, period.quarter * 3, 1);
  return new Date(period.year, period.month, 1);
}

// The period that contains `now` for the given frequency. Used to
// identify "the period whose contribution we're currently expecting"
// in the LedgerModal pending-entry logic.
function currentPeriodOf(now, frequency) {
  if (frequency === "yearly") return { kind: "yearly", year: now.getFullYear() };
  if (frequency === "quarterly") {
    return {
      kind: "quarterly",
      year: now.getFullYear(),
      quarter: Math.floor(now.getMonth() / 3),
    };
  }
  return { kind: "monthly", year: now.getFullYear(), month: now.getMonth() };
}

function periodLabel(period) {
  if (period.kind === "yearly") return String(period.year);
  if (period.kind === "quarterly") {
    return `Q${period.quarter + 1} ${period.year}`;
  }
  const d = new Date(period.year, period.month, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function frequencyLabel(frequency) {
  if (frequency === "yearly") return "year";
  if (frequency === "quarterly") return "quarter";
  return "month";
}

function LedgerModal({ inv, rawLots, allTransactions, highlightTxId, onSell, onDelete }) {
  // userTypes are needed to resolve schemas for custom auto-deduct types.
  // The schema lookup gives us a label for entries plus the amount-key
  // convention the scheduler uses, so the legacy aggregate and posted
  // instalments report the same number per period.
  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.investmentTypes ?? [],
  );
  const dispatch = useDispatch();
  const [logging, setLogging] = useState(null); // pending entry id while a log is in flight

  // One-tap "log this payment" handler. Resolves the lot fresh from
  // rawLots so we have the current autoDeduct config + name. Posts a
  // real ledger entry with today's date + the configured per-period
  // amount; the user can edit later via the standard transaction-edit
  // flow if the amount differs (e.g., a one-off bank fee).
  async function handleLogPending(entry, amountOverride) {
    const pending = entry._pending;
    if (!pending) return;
    const lot = rawLots.find((l) => l.id === pending.investmentId);
    if (!lot) return;
    const amount = amountOverride != null ? amountOverride : pending.amount;
    if (!(amount > 0)) return;
    setLogging(entry.id);
    try {
      await dispatch(
        persistLogAutoDeductPayment(lot, {
          occurredAt: new Date().toISOString(),
          amount,
        }),
      );
    } finally {
      setLogging(null);
    }
  }

  const entries = useMemo(() => {
    const list = [];
    const info = getTypeInfo(inv.type);
    const lotIds = new Set(rawLots.map((l) => l.id));
    const hasMixedTypes =
      rawLots.some((l) => l.type === "sip") && rawLots.some((l) => l.type !== "sip");

    const fmtDate = (iso) =>
      iso
        ? new Date(iso).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : null;

    // Buy / enrol entries from each lot
    for (const lot of rawLots) {
      if (info.subtype === "unit" && lot.type !== "sip") {
        const hasLinkedTx = allTransactions.some(
          (t) => t.id === lot.id && t.transactionType === "investment",
        );
        const legacy = !hasLinkedTx;
        const sinceDate = legacy ? fmtDate(lot.startDate || lot.createdAt) : null;
        list.push({
          id: `buy-${lot.id}`,
          type: legacy ? "legacy" : "buy",
          date: lot.startDate || lot.createdAt || "",
          label: legacy ? "Legacy Investment" : "Bought",
          tag: hasMixedTypes ? "Lump sum" : null,
          sub: legacy
            ? `${lot.quantity} units @ ${INR.format(lot.buyPrice)}${sinceDate ? ` · since ${sinceDate}` : ""}`
            : `${lot.quantity} units @ ${INR.format(lot.buyPrice)}`,
          amount: +(lot.quantity * lot.buyPrice).toFixed(2),
          affectsBalance: !legacy,
          sign: legacy ? null : "+",
          color: legacy ? "var(--text-secondary)" : "var(--amount-income)",
        });
      } else if (lot.type === "sip") {
        list.push({
          id: `sip-enrol-${lot.id}`,
          type: "enrol",
          date: lot.createdAt ?? lot.startDate ?? "",
          label: "SIP Started",
          sub: lot.monthlyAmount
            ? `${INR.format(parseFloat(lot.monthlyAmount))}/month`
            : null,
          amount: null,
          affectsBalance: false,
          sign: null,
          color: "#d4a35a",
        });

        // Single consolidated legacy entry for all untracked SIP months
        if (lot.startDate && lot.monthlyAmount) {
          const monthlyAmt = parseFloat(lot.monthlyAmount) || 0;
          const start = new Date(lot.startDate);
          const now = new Date();
          let yr = start.getFullYear();
          let mo = start.getMonth();
          let untracked = 0;
          let firstUntracked = null;
          let lastUntracked = null;

          while (
            yr < now.getFullYear() ||
            (yr === now.getFullYear() && mo < now.getMonth())
          ) {
            const hasInstalment = allTransactions.some((t) => {
              if (t.sipInvestmentId !== lot.id) return false;
              const d = new Date(t.occurredAt);
              return d.getFullYear() === yr && d.getMonth() === mo;
            });

            if (!hasInstalment) {
              untracked++;
              const d = new Date(yr, mo, 1);
              if (!firstUntracked) firstUntracked = d;
              lastUntracked = d;
            }

            mo++;
            if (mo > 11) { mo = 0; yr++; }
          }

          if (untracked > 0) {
            const fmtMo = (d) =>
              d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
            const rangeLabel =
              firstUntracked === lastUntracked ||
              firstUntracked?.getTime() === lastUntracked?.getTime()
                ? fmtMo(firstUntracked)
                : `${fmtMo(firstUntracked)} – ${fmtMo(lastUntracked)}`;
            list.push({
              id: `sip-legacy-${lot.id}`,
              type: "legacy",
              date: firstUntracked.toISOString(),
              label: "Legacy Investment",
              tag: hasMixedTypes ? "SIP" : null,
              sub: `${untracked} SIP instalment${untracked !== 1 ? "s" : ""} · ${rangeLabel}`,
              amount: +(untracked * monthlyAmt).toFixed(2),
              affectsBalance: false,
              sign: null,
              color: "var(--text-secondary)",
            });
          }
        }
      } else if (lot.type === "lic") {
        // LIC enrol marker — mirrors the SIP "Started" marker. Premium
        // payments are added below from the licPolicyId-tagged transactions.
        const premium = parseFloat(lot.premiumAmount) || 0;
        list.push({
          id: `lic-enrol-${lot.id}`,
          type: "enrol",
          date: lot.startDate ?? lot.createdAt ?? "",
          label: "Policy Started",
          sub: premium
            ? `${INR.format(premium)} · ${licFreqLabel(lot.frequency)}${lot.policyNumber ? ` · #${lot.policyNumber}` : ""}`
            : lot.policyNumber
              ? `#${lot.policyNumber}`
              : null,
          amount: null,
          affectsBalance: false,
          sign: null,
          color: "#e07b3a",
        });

        // Single consolidated legacy row for premiums assumed paid before the
        // policy was added to the app — mirrors the SIP "Legacy Investment".
        const assumed = licAssumedPaid(lot);
        if (assumed.count > 0 && premium > 0) {
          const fmtMo = (d) =>
            d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
          const rangeLabel =
            assumed.first?.getTime() === assumed.last?.getTime()
              ? fmtMo(assumed.first)
              : `${fmtMo(assumed.first)} – ${fmtMo(assumed.last)}`;
          list.push({
            id: `lic-legacy-${lot.id}`,
            type: "legacy",
            date: assumed.first.toISOString(),
            label: "Legacy Investment",
            sub: `${assumed.count} premium${assumed.count !== 1 ? "s" : ""} · ${rangeLabel}`,
            amount: +(assumed.count * premium).toFixed(2),
            affectsBalance: false,
            sign: null,
            color: "var(--text-secondary)",
          });
        }
        if (lot.surrendered) {
          list.push({
            id: `lic-surrender-${lot.id}`,
            type: "sell",
            date: lot.surrenderedAt ?? "",
            label: "Surrendered",
            sub: "Policy closed early",
            amount: parseFloat(lot.surrenderAmount) || 0,
            affectsBalance: parseFloat(lot.surrenderAmount) > 0,
            sign: "−",
            color: "var(--amount-expense)",
          });
        }
        if (lot.matured) {
          list.push({
            id: `lic-mature-${lot.id}`,
            type: "sell",
            date: lot.maturedAt ?? "",
            label: "Matured",
            sub: "Policy completed tenure",
            amount: parseFloat(lot.actualMaturityAmount) || 0,
            affectsBalance: parseFloat(lot.actualMaturityAmount) > 0,
            sign: "−",
            color: "var(--amount-income)",
          });
        }
      } else if (
        lot.autoDeduct?.enabled &&
        lot.startDate &&
        info.subtype !== "unit" &&
        getInvestmentMathProfile(lot.type, userTypes) !== "unit"
      ) {
        // ── Generic auto-deduct types (chit fund, APY, custom fixed /
        //    cashflow types with a recurring schedule). Mirrors the SIP
        //    block — emit an enrol marker, then a single grey "Legacy
        //    Investment" aggregate row for every period before today
        //    that doesn't have a posted instalment. Posted instalments
        //    are appended further below in a dedicated pass so the
        //    presentation stays consistent with SIP / LIC.
        const schema = getInvestmentTypeSchema(lot.type, userTypes);
        const periodAmt = findAutoDeductAmount(lot, schema);
        const frequency = lot.autoDeduct.frequency || "monthly";
        const freqWord = frequencyLabel(frequency);
        const typeLabel = schema?.label || lot.type;

        list.push({
          id: `auto-enrol-${lot.id}`,
          type: "enrol",
          date: lot.createdAt ?? lot.startDate ?? "",
          label: `${typeLabel} Started`,
          sub: periodAmt
            ? `${INR.format(periodAmt)}/${freqWord}`
            : null,
          amount: null,
          affectsBalance: false,
          sign: null,
          color: "#d4a35a",
        });

        if (periodAmt > 0) {
          const periods = walkAutoDeductPeriods(lot.startDate, frequency);
          let untracked = 0;
          let firstUntracked = null;
          let lastUntracked = null;
          for (const p of periods) {
            const hasInstalment = allTransactions.some((t) => {
              if (t.autoDeductInvestmentId !== lot.id) return false;
              return txMatchesPeriod(new Date(t.occurredAt), p);
            });
            if (!hasInstalment) {
              untracked++;
              const d = periodToDate(p);
              if (!firstUntracked) firstUntracked = { date: d, p };
              lastUntracked = { date: d, p };
            }
          }
          if (untracked > 0) {
            const rangeLabel =
              firstUntracked.date.getTime() === lastUntracked.date.getTime()
                ? periodLabel(firstUntracked.p)
                : `${periodLabel(firstUntracked.p)} – ${periodLabel(lastUntracked.p)}`;
            list.push({
              id: `auto-legacy-${lot.id}`,
              type: "legacy",
              date: firstUntracked.date.toISOString(),
              label: "Legacy Investment",
              tag: hasMixedTypes ? typeLabel : null,
              sub: `${untracked} ${freqWord}${untracked !== 1 ? "s" : ""} · ${rangeLabel}`,
              amount: +(untracked * periodAmt).toFixed(2),
              affectsBalance: false,
              sign: null,
              color: "var(--text-secondary)",
            });
          }

          // ── Pending current-period entry ──
          // For the CURRENT (incomplete) period we emit a virtual row
          // with a "Log this payment" action. The user taps it the day
          // the debit actually clears, and a real ledger entry lands
          // with their confirmed date — no phantom-day fiction. Only
          // shown if there's no posted instalment for the current
          // period yet.
          const now = new Date();
          const curPeriod = currentPeriodOf(now, frequency);
          const curHasInst = allTransactions.some((t) => {
            if (t.autoDeductInvestmentId !== lot.id) return false;
            return txMatchesPeriod(new Date(t.occurredAt), curPeriod);
          });
          if (!curHasInst) {
            list.push({
              id: `auto-pending-${lot.id}`,
              type: "pending",
              date: now.toISOString(),
              label: `${periodLabel(curPeriod)} contribution`,
              tag: hasMixedTypes ? typeLabel : null,
              sub: `Log this when the debit clears your account`,
              amount: periodAmt,
              affectsBalance: false,
              sign: null,
              color: "#d4a35a",
              _pending: {
                investmentId: lot.id,
                amount: periodAmt,
                variable: !!lot.autoDeduct.variableAmount,
              },
            });
          }
        }
      } else {
        // fixed / manual
        const hasLinkedTx = allTransactions.some(
          (t) => t.id === lot.id && t.transactionType === "investment",
        );
        const legacy = !hasLinkedTx;
        const sinceDate = legacy ? fmtDate(lot.startDate || lot.createdAt) : null;
        list.push({
          id: `buy-${lot.id}`,
          type: legacy ? "legacy" : "buy",
          date: lot.startDate || lot.createdAt || "",
          label: legacy ? "Legacy Investment" : "Invested",
          sub: legacy && sinceDate ? `Since ${sinceDate}` : null,
          amount: parseFloat(lot.investedAmount) || 0,
          affectsBalance: !legacy,
          sign: legacy ? null : "+",
          color: legacy ? "var(--text-secondary)" : "var(--amount-income)",
        });
      }
    }

    // SIP instalment transactions — each one is a unit purchase
    for (const t of allTransactions) {
      if (t.sipInvestmentId && lotIds.has(t.sipInvestmentId)) {
        list.push({
          id: t.id,
          type: "buy",
          date: t.occurredAt,
          label: "Bought",
          tag: hasMixedTypes ? "SIP" : null,
          sub: "SIP instalment",
          amount: parseFloat(t.amount) || 0,
          affectsBalance: true,
          sign: "+",
          color: "var(--amount-income)",
        });
      }
    }

    // Auto-deduct instalments — recurring debits posted by the generic
    // scheduler for custom / Discover types (chit fund, APY, etc).
    // Skipped for unit-profile types like ULIP — their position is the
    // cumulative quantity × buyPrice on the "Invested" row above, so
    // showing instalments alongside would visually double-count the same
    // money. The main Transactions list still has them.
    const skipAutoDeductRows =
      info.subtype === "unit" ||
      getInvestmentMathProfile(inv.type, userTypes) === "unit";
    for (const t of allTransactions) {
      if (skipAutoDeductRows) break;
      if (t.autoDeductInvestmentId && lotIds.has(t.autoDeductInvestmentId)) {
        const d = new Date(t.occurredAt);
        const monthLabel = d.toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric",
        });
        list.push({
          id: t.id,
          type: "buy",
          date: t.occurredAt,
          label: "Instalment",
          sub: monthLabel,
          amount: parseFloat(t.amount) || 0,
          affectsBalance: true,
          sign: "+",
          color: "var(--amount-income)",
        });
      }
    }

    // LIC premium transactions — each one a premium installment
    for (const t of allTransactions) {
      if (t.licPolicyId && lotIds.has(t.licPolicyId)) {
        const d = new Date(t.occurredAt);
        const monthLabel = d.toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric",
        });
        list.push({
          id: t.id,
          type: "buy",
          date: t.occurredAt,
          label: "Premium Paid",
          sub: monthLabel,
          amount: parseFloat(t.amount) || 0,
          affectsBalance: true,
          sign: "+",
          color: "var(--amount-income)",
        });
      }
    }

    // Sell / surrender / mature transactions matched by name
    for (const t of allTransactions) {
      if (t.transactionType !== "income" || t.category !== "Investment") continue;
      const amt = parseFloat(t.amount) || 0;
      if (t.name === `Sold: ${inv.name}`) {
        list.push({
          id: t.id,
          type: "sell",
          date: t.occurredAt,
          label: "Sold",
          sub: null,
          amount: amt,
          affectsBalance: amt > 0,
          sign: "−",
          color: "var(--amount-expense)",
        });
      } else if (t.name === `Surrendered: ${inv.name}`) {
        list.push({
          id: t.id,
          type: "sell",
          date: t.occurredAt,
          label: "Surrender Payout",
          sub: "credited to balance",
          amount: amt,
          affectsBalance: true,
          sign: "−",
          color: "var(--amount-expense)",
        });
      } else if (t.name === `Matured: ${inv.name}`) {
        list.push({
          id: t.id,
          type: "sell",
          date: t.occurredAt,
          label: "Maturity Payout",
          sub: "credited to balance",
          amount: amt,
          affectsBalance: true,
          sign: "−",
          color: "var(--amount-income)",
        });
      }
    }

    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [inv, rawLots, allTransactions, userTypes]);

  const fmt = (iso) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  if (entries.length === 0) {
    return (
      <div className="inv-ledger-empty">
        <i className="fa-solid fa-clock-rotate-left inv-ledger-empty-icon" />
        <p>No activity recorded yet.</p>
        <p className="inv-ledger-empty-sub">
          Buy, SIP and sell events will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="inv-ledger-list">
      {entries.map((e) => {
        const deletePayload = getDeletePayload(e);
        return (
          <LedgerEntry
            key={e.id}
            e={e}
            fmt={fmt}
            highlight={highlightTxId === e.id}
            onSell={onSell && (e.type === "buy" || e.type === "legacy") ? onSell : null}
            onDelete={onDelete && deletePayload ? () => onDelete(deletePayload) : null}
            onLogPending={e.type === "pending" ? (amt) => handleLogPending(e, amt) : null}
            logPendingBusy={logging === e.id}
          />
        );
      })}
    </div>
  );
}

function LedgerEntry({ e, fmt, highlight, onSell, onDelete, onLogPending, logPendingBusy }) {
  const ref = useRef(null);
  const scrolledRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [amtDraft, setAmtDraft] = useState(
    e.amount != null ? String(e.amount) : "",
  );
  const variablePending = !!(onLogPending && e._pending?.variable);
  const draftAmount = parseFloat(amtDraft) || 0;
  // Drive the highlight class from a local timer so it lifts ~1.8s after the
  // blink ends — independent of the URL-clear timer (3.5s). This lets the
  // entry's action buttons fade back in promptly.
  const [highlightActive, setHighlightActive] = useState(false);

  useEffect(() => {
    if (!highlight) return;
    // Highlight is driven by a parent prop / URL param (external source) —
    // syncing into a local blink timer is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightActive(true);
    const off = setTimeout(() => setHighlightActive(false), 1800);
    return () => clearTimeout(off);
  }, [highlight]);

  useEffect(() => {
    if (highlight && ref.current && !scrolledRef.current) {
      scrolledRef.current = true;
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  // Map activity type → row tint. Same recipe used across the app:
  // money going into an investment → blue; money coming back → green;
  // legacy / untracked → no tint; pending → amber accent (handled via
  // .inv-ledger-entry--pending in styles, not a ledger-tint utility).
  return (
    <div
      ref={ref}
      className={`inv-ledger-entry${highlightActive ? " inv-ledger-entry--highlight" : ""}`}
    >
      <div className={`inv-ledger-dot inv-ledger-dot--${e.type}`} />
      <div className="inv-ledger-body">
        <div className="inv-ledger-row">
          <span className="inv-ledger-label">
            {e.label}
            {e.tag && <span className="inv-ledger-tag">{e.tag}</span>}
          </span>
          <div className="inv-ledger-row-right">
            {variablePending && !confirming ? (
              <span className="inv-ledger-amount-edit" style={{ color: e.color }}>
                ₹
                <input
                  type="number"
                  inputMode="decimal"
                  className="inv-ledger-amount-input"
                  value={amtDraft}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={(ev) => setAmtDraft(ev.target.value)}
                  aria-label="Contribution amount"
                />
              </span>
            ) : (
              e.amount !== null && !confirming && (
                <span className="inv-ledger-amount" style={{ color: e.color }}>
                  {e.sign}{INR.format(e.amount)}
                </span>
              )
            )}
            {onLogPending && !confirming && (
              <button
                className="inv-ledger-log-btn"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onLogPending(variablePending ? draftAmount : undefined);
                }}
                disabled={logPendingBusy || (variablePending && !(draftAmount > 0))}
                title="Post a ledger entry with today's date"
              >
                {logPendingBusy ? (
                  <><i className="fa-solid fa-spinner fa-spin" /> Logging…</>
                ) : (
                  <><i className="fa-solid fa-circle-check" /> Log this payment</>
                )}
              </button>
            )}
            {onSell && !confirming && (
              <button
                className="inv-ledger-sell-btn"
                onClick={(ev) => { ev.stopPropagation(); onSell(); }}
              >
                <i className="fa-solid fa-arrow-trend-down" /> Sell
              </button>
            )}
            {onDelete && !confirming && (
              <button
                className="inv-ledger-del-btn"
                title="Delete"
                onClick={(ev) => { ev.stopPropagation(); setConfirming(true); }}
              >
                <i className="fa-solid fa-trash-can" />
              </button>
            )}
          </div>
        </div>
        {confirming ? (
          <div className="inv-ledger-confirm">
            <span className="inv-ledger-confirm-text">
              {(() => {
                if (e.id.startsWith("sip-enrol-"))
                  return "Moves the SIP to History and stops auto-deductions. All past instalments stay on record.";
                if (e.id.startsWith("lic-enrol-"))
                  return "Moves the policy to History. Past premium payments stay on record for audit.";
                if (e.id.startsWith("lic-surrender-") || e.id.startsWith("lic-mature-"))
                  return "These are policy-status markers and can't be removed from the ledger directly.";
                if (e.id.startsWith("buy-"))
                  return "Removes this lot and its linked transaction. Cannot be undone.";
                if (e.type === "sell")
                  return "Removes this sale record. Proceeds will be taken back off your balance.";
                return "Removes only this month's payment. The parent SIP / policy and other payments stay.";
              })()}
            </span>
            <button
              className="inv-ledger-confirm-cancel"
              onClick={(ev) => { ev.stopPropagation(); setConfirming(false); }}
            >
              Cancel
            </button>
            <button
              className="inv-ledger-confirm-del"
              onClick={(ev) => { ev.stopPropagation(); onDelete(); }}
            >
              <i className="fa-solid fa-trash-can" /> Delete
            </button>
          </div>
        ) : (
          <>
            {e.sub && <p className="inv-ledger-sub">{e.sub}</p>}
            <p className="inv-ledger-meta">
              <span className="inv-ledger-date">{fmt(e.date)}</span>
              {e.amount !== null && (
                <span className="inv-ledger-balance-note">
                  {e.affectsBalance
                    ? e.type === "sell"
                      ? "added to balance"
                      : "deducted from balance"
                    : "balance unaffected"}
                </span>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function HoldingCard({ inv, onEdit, onDelete, onSell, onLedger, onPause, onResume, onHardDelete, onSurrender, onMature, onPayArrears, allTransactions = [], highlightId, mode = "holdings" }) {
  const isHighlighted =
    highlightId && (inv.id === highlightId || inv._ids?.includes(highlightId));
  const cardRef = useRef(null);
  const triggerWrapRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);

  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  const openMenu = () => {
    const rect = triggerWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setMenuOpen(true);
  };

  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e) {
      const inTrigger = triggerWrapRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) closeMenu();
    }
    function onKey(e) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    // Close on scroll (any ancestor) and resize — keeps the menu visually
    // anchored to its trigger instead of drifting off the screen.
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menuOpen]);

  const runAction = (fn) => {
    closeMenu();
    fn();
  };

  const { investedAmount, currentValue, absoluteReturn, returnPct } =
    calcReturns(inv);
  const info = getTypeInfo(inv.type);
  const pos = absoluteReturn >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";

  return (
    <div
      ref={cardRef}
      className={`inv-holding-card${isHighlighted ? " inv-holding-card--highlight" : ""}`}
    >
      <div className="inv-holding-header">
        <span
          className="inv-type-badge"
          style={{ background: info.color + "22", color: info.color }}
        >
          <i className={`fa-solid ${info.icon}`} /> {info.label}
        </span>
        <div className="inv-holding-actions">
          <button
            className="inv-icon-btn"
            onClick={() => onLedger(inv)}
            title="Activity"
            aria-label="Activity"
          >
            <i className="fa-solid fa-clock-rotate-left" />
          </button>
          <div className="inv-action-menu-wrap" ref={triggerWrapRef}>
            <button
              className={`inv-icon-btn${menuOpen ? " inv-icon-btn--active" : ""}`}
              onClick={() => (menuOpen ? closeMenu() : openMenu())}
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <i className="fa-solid fa-ellipsis-vertical" />
            </button>
            {menuOpen &&
              menuPos &&
              createPortal(
                <div
                  className="inv-action-menu inv-action-menu--portaled"
                  role="menu"
                  ref={menuRef}
                  style={{
                    position: "fixed",
                    top: menuPos.top,
                    right: menuPos.right,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="inv-action-menu-item"
                    onClick={() => runAction(() => onEdit(inv))}
                  >
                    <i className="fa-solid fa-pen" />
                    <span>{inv._lots > 1 ? "Edit (pick a lot)" : "Edit"}</span>
                  </button>
                  {info.subtype === "unit" && mode === "holdings" && (
                    <button
                      type="button"
                      role="menuitem"
                      className="inv-action-menu-item"
                      onClick={() => runAction(() => onSell(inv))}
                    >
                      <i className="fa-solid fa-arrow-trend-down" />
                      <span>Sell</span>
                    </button>
                  )}
                  {inv.type === "sip" && mode === "holdings" && (
                    inv.paused ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="inv-action-menu-item"
                        onClick={() => runAction(() => onResume(inv))}
                      >
                        <i className="fa-solid fa-play" />
                        <span>Resume SIP</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className="inv-action-menu-item"
                        onClick={() => runAction(() => onPause(inv))}
                      >
                        <i className="fa-solid fa-pause" />
                        <span>Pause SIP</span>
                      </button>
                    )
                  )}
                  {inv.type === "lic" && mode === "holdings" && onSurrender && (
                    <button
                      type="button"
                      role="menuitem"
                      className="inv-action-menu-item"
                      onClick={() => runAction(() => onSurrender(inv))}
                    >
                      <i className="fa-solid fa-arrow-right-from-bracket" />
                      <span>Surrender policy</span>
                    </button>
                  )}
                  {inv.type === "lic" && mode === "holdings" && onMature && (
                    <button
                      type="button"
                      role="menuitem"
                      className={`inv-action-menu-item${isLicTenureComplete(inv) ? "" : " inv-action-menu-item--disabled"}`}
                      disabled={!isLicTenureComplete(inv)}
                      title={
                        isLicTenureComplete(inv)
                          ? "Mark policy as matured"
                          : "Available once tenure is complete"
                      }
                      onClick={() => runAction(() => onMature(inv))}
                    >
                      <i className="fa-solid fa-flag-checkered" />
                      <span>Mark as matured</span>
                    </button>
                  )}
                  {mode === "history" ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="inv-action-menu-item inv-action-menu-item--danger"
                      onClick={() => runAction(() => onHardDelete(inv))}
                    >
                      <i className="fa-solid fa-trash-can" />
                      <span>Delete permanently</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className="inv-action-menu-item inv-action-menu-item--danger"
                      onClick={() =>
                        runAction(() =>
                          onDelete(inv._ids ?? inv.id, inv.name, inv._lots, inv),
                        )
                      }
                    >
                      <i className="fa-solid fa-trash-can" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>,
                document.body,
              )}
          </div>
        </div>
      </div>
      {inv.paused && mode === "holdings" && (
        <span className="inv-paused-tag">
          <i className="fa-solid fa-pause" /> Paused
        </span>
      )}
      <p className="inv-holding-name">{inv.name}</p>

      {info.subtype === "unit" && (
        <p className="inv-holding-meta">
          {inv.quantity} units
          {inv._lots > 1 && (
            <span className="inv-orders-badge"> {inv._lots} orders</span>
          )}
          {" · "}
          {inv.type === "sip"
            ? `Avg NAV ${INR.format(inv.buyPrice)} → Now ${INR.format(inv.currentPrice)}`
            : `${inv._lots > 1 ? "Avg buy" : "Buy"} ${INR.format(inv.buyPrice)} → Now ${INR.format(inv.currentPrice)}`}
          {inv.priceUpdatedAt && (
            <span className="inv-price-updated">
              {" "}
              · updated {fmtUpdated(inv.priceUpdatedAt)}
            </span>
          )}
        </p>
      )}
      {info.subtype === "fixed" && inv.type !== "lic" && (
        <p className="inv-holding-meta">
          {inv.interestRate}% p.a. · {inv.tenureMonths} months
        </p>
      )}
      {inv.type === "lic" && (() => {
        const { paidCount } = licPremiumStats(inv, allTransactions);
        const totalPaid = paidCount + licAssumedPaid(inv).count;
        const totalDue = inv.premiumMonths?.length
          ? Math.max(1, Math.round(((parseInt(inv.tenureMonths) || 0) / 12) * inv.premiumMonths.length))
          : null;
        const status = mode === "holdings" ? getLicStatus(inv, allTransactions) : null;
        return (
          <>
            <p className="inv-holding-meta">
              {totalPaid} premium{totalPaid !== 1 ? "s" : ""} paid
              {totalDue ? ` · ${totalDue} total` : ""}
              {inv.policyNumber ? ` · #${inv.policyNumber}` : ""}
            </p>
            {status && status.status === "due" && (
              <p className="inv-lic-due">
                <i className="fa-solid fa-calendar-day" />
                {status.daysLeft === 0
                  ? "Premium due today"
                  : `Premium due in ${status.daysLeft} day${status.daysLeft !== 1 ? "s" : ""}`}
              </p>
            )}
            {status && (status.status === "grace" || status.status === "lapsed") && (
              <div className="inv-lic-overdue">
                <span
                  className={`inv-lic-chip ${status.status === "lapsed" ? "inv-lic-chip--lapsed" : "inv-lic-chip--grace"}`}
                >
                  <i
                    className={`fa-solid ${status.status === "lapsed" ? "fa-triangle-exclamation" : "fa-hourglass-half"}`}
                  />
                  {status.status === "lapsed" ? "Lapsed" : "In grace"} ·{" "}
                  {Math.abs(status.daysLeft)}d overdue
                </span>
                <span className="inv-lic-arrears">
                  {status.overdueCount} unpaid · {INR.format(status.arrears)}
                  {status.totalPenalty > 0
                    ? ` + ${INR.format(status.totalPenalty)} penalty`
                    : ""}
                </span>
                {onPayArrears && mode === "holdings" && (
                  <button
                    type="button"
                    className="inv-lic-pay-overdue"
                    onClick={() => onPayArrears(inv, status)}
                  >
                    <i className="fa-solid fa-money-bill-wave" /> Pay overdue
                  </button>
                )}
              </div>
            )}
          </>
        );
      })()}

      <div className="inv-holding-amounts">
        <div>
          <p className="inv-holding-amt-label">Invested</p>
          <p className="inv-holding-amt">{INR.format(investedAmount)}</p>
        </div>
        <div>
          <p className="inv-holding-amt-label">Current</p>
          <p className="inv-holding-amt" style={{ color: retColor }}>
            {INR.format(currentValue)}
          </p>
        </div>
        <div>
          <p className="inv-holding-amt-label">Returns</p>
          <p className="inv-holding-amt" style={{ color: retColor }}>
            {pos ? "+" : ""}
            {INR.format(absoluteReturn)}
            <span className="inv-holding-pct">
              {" "}
              ({pos ? "+" : ""}
              {returnPct.toFixed(1)}%)
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Allocation Ring ───────────────────────────────────

const RADIAN = Math.PI / 180;
function AllocationLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct }) {
  if (pct < 5) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={700}
    >
      {pct}%
    </text>
  );
}

function AllocationRing({ investments, theme }) {
  const data = useMemo(() => getAllocationData(investments), [investments]);
  if (data.length === 0) return null;

  const tooltipStyle = {
    background: theme === "light" ? "#e0d6d5" : "#1a1a2e",
    border: "1px solid rgba(128,128,128,0.2)",
    borderRadius: 8,
    fontSize: 13,
  };

  return (
    <div className="dash-section inv-allocation">
      <p className="dash-section-title">Portfolio Allocation</p>
      <div className="inv-allocation-inner">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              dataKey="value"
              labelLine={false}
              label={AllocationLabel}
            >
              {data.map((entry) => (
                <Cell key={entry.type} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v) => INR.format(v)}
              contentStyle={tooltipStyle}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="inv-alloc-legend">
          {data.map((d) => (
            <div key={d.type} className="inv-alloc-legend-item">
              <span className="inv-alloc-dot" style={{ background: d.color }} />
              <span className="inv-alloc-label">{d.label}</span>
              <span className="inv-alloc-pct">{d.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Category Breakdown ────────────────────────────────

function CategoryBreakdown({ investments }) {
  const data = useMemo(() => getCategoryAllocationData(investments), [investments]);
  if (data.length < 2) return null;

  return (
    <div className="dash-section">
      <p className="dash-section-title">Sector &amp; Category Breakdown</p>
      <div className="inv-cat-list">
        {data.map((d) => (
          <div key={d.label} className="inv-cat-row">
            <div className="inv-cat-name">
              <span className="inv-alloc-dot" style={{ background: d.color }} />
              <span>{d.label}</span>
            </div>
            <div className="inv-cat-bar-track">
              <div
                className="inv-cat-bar-fill"
                style={{ width: `${d.pct}%`, background: d.color }}
              />
            </div>
            <span className="inv-cat-pct">{d.pct}%</span>
            <span className="inv-cat-value">{INR.format(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────

const InvestmentPage = () => {
  const dispatch = useDispatch();
  const theme = useCurrentTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const ledgerParam = searchParams.get("ledger");
  const highlightTxParam = searchParams.get("highlightTx");

  useEffect(() => {
    if (!highlightId) return;
    // 400ms delay before highlight starts + 1.8s blink + buffer.
    const t = setTimeout(() => setSearchParams({}, { replace: true }), 3500);
    return () => clearTimeout(t);
  }, [highlightId, setSearchParams]);

  useEffect(() => {
    if (!ledgerParam) return;
    const t = setTimeout(() => setSearchParams({}, { replace: true }), 3500);
    return () => clearTimeout(t);
  }, [ledgerParam, setSearchParams]);

  const investments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const filter = useSelector((state) => state.filter.investments);
  const filteredInvestments = useMemo(
    () => filterInvestmentsByDate(investments, filter),
    [investments, filter],
  );
  const isFiltered = filter.mode !== "all";
  const filterLabel = isFiltered ? getFilterLabel(filter) : null;

  const [invModal, setInvModal] = useState(null); // null | "add" | investment object
  const [sortBy, setSortBy] = useState("returns"); // "returns" | "value" | "name"
  const [refreshing, setRefreshing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { ids: string[], name: string, count: number }
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState(null); // grouped inv from history
  const [sellTarget, setSellTarget] = useState(null); // grouped inv object
  const [ledgerTarget, setLedgerTarget] = useState(null); // grouped inv object
  const [resumeTarget, setResumeTarget] = useState(null); // SIP being resumed
  const [pauseTarget, setPauseTarget] = useState(null); // SIP being paused (confirm modal)
  const [editPickerTarget, setEditPickerTarget] = useState(null); // multi-lot card whose edit was clicked
  const [surrenderTarget, setSurrenderTarget] = useState(null); // LIC policy being surrendered
  const [matureTarget, setMatureTarget] = useState(null); // LIC policy being matured
  const [tab, setTab] = useState("holdings"); // "holdings" | "history" (inner: Portfolio tab)
  const [pageTab, setPageTab] = useState("overview"); // "overview" | "portfolio"
  const [typeSel, setTypeSel] = useState("all"); // "all" | type key — Portfolio rail
  const savingInvestmentRef = useRef(false);
  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.investmentTypes ?? [],
  );

  // When navigated in via a deep-link to a specific holding/ledger, jump to
  // the Portfolio tab so the user actually lands on what they clicked. This
  // intentionally syncs URL state into local tab state; the React Compiler's
  // "no setState in effect" warning doesn't apply here since the URL is an
  // external source.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (highlightId || ledgerParam) setPageTab("portfolio");
  }, [highlightId, ledgerParam]);

  const sortedInvestments = useMemo(() => {
    // Group unit-type investments by type+ticker (or type+name if no ticker)
    const grouped = new Map();
    for (const inv of filteredInvestments) {
      const info = getTypeInfo(inv.type);
      if (info.subtype !== "unit") {
        grouped.set(inv.id, inv);
        continue;
      }
      const key = inv.ticker ? inv.ticker : `${inv.type}|${inv.name}`;
      if (!grouped.has(key)) {
        grouped.set(key, { ...inv, _ids: [inv.id], _lots: 1 });
      } else {
        const g = grouped.get(key);
        const totalQty = g.quantity + inv.quantity;
        const weightedBuy =
          (g.buyPrice * g.quantity + inv.buyPrice * inv.quantity) / totalQty;
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
    return [...grouped.values()].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const ra = calcReturns(a);
      const rb = calcReturns(b);
      if (sortBy === "returns") return rb.returnPct - ra.returnPct;
      return rb.currentValue - ra.currentValue;
    });
  }, [filteredInvestments, sortBy]);

  // Holdings = active investments. History = sold-out non-SIP unit lots and
  // soft-deleted SIPs (inHistory). Active SIPs (paused or not) stay in
  // Holdings. The `quantity === 0 → History` rule only applies to unit-based
  // investments — fixed-income (FD/RD/LIC/Bond/Plan) and manual entries
  // (Real Estate / PPF / NPS / Other) don't track a quantity at all, so the
  // `inv.quantity ?? 0` fallback used to wrongly send them to History.
  function isUnitSubtype(inv) {
    return getTypeInfo(inv.type)?.subtype === "unit";
  }
  const holdings = useMemo(
    () =>
      sortedInvestments.filter((inv) => {
        if (inv.inHistory) return false;
        if (inv.type === "sip") return true;
        if (isUnitSubtype(inv)) return (inv.quantity ?? 0) > 0;
        return true; // fixed / manual stay in Holdings
      }),
    [sortedInvestments],
  );
  const historyItems = useMemo(
    () =>
      sortedInvestments.filter((inv) => {
        if (inv.inHistory) return true;
        if (inv.type === "sip") return false;
        if (isUnitSubtype(inv)) return (inv.quantity ?? 0) === 0;
        return false; // fixed / manual never auto-go to History
      }),
    [sortedInvestments],
  );

  // Always-current ref so the open effect doesn't need sortedInvestments as
  // a dep. Updated inside an effect (not during render) to satisfy the
  // React Compiler's no-refs-during-render rule.
  const sortedInvestmentsRef = useRef(sortedInvestments);
  useEffect(() => {
    sortedInvestmentsRef.current = sortedInvestments;
  }, [sortedInvestments]);

  // Idempotency guard: even if React fires the effect twice for the same
  // ledgerParam value (concurrent rendering, double-mount, etc.) we only
  // setLedgerTarget once. Reset when ledgerParam clears so a future
  // navigation with the same value still opens the modal.
  const handledLedgerRef = useRef(null);

  // Auto-open ledger when navigated from a transaction (SIP instalment).
  // Defer the open by 400ms so the page transition (180ms) and any
  // concurrent re-renders fully settle first — this avoids the visible
  // open / close / re-open glitch when the modal renders mid-transition.
  // The setTimeout cleanup also makes this naturally idempotent: if React
  // re-runs the effect, the in-flight timer is cancelled.
  useEffect(() => {
    if (!ledgerParam) {
      handledLedgerRef.current = null;
      return;
    }
    if (handledLedgerRef.current === ledgerParam) return;
    const t = setTimeout(() => {
      const group = sortedInvestmentsRef.current.find(
        (g) => g.id === ledgerParam || g._ids?.includes(ledgerParam),
      );
      if (group) {
        handledLedgerRef.current = ledgerParam;
        setLedgerTarget(group);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [ledgerParam]);

  const handleSaveInvestment = useCallback(
    async (inv) => {
      if (savingInvestmentRef.current) return;
      savingInvestmentRef.current = true;
      const isEdit = invModal && typeof invModal === "object";
      setInvModal(null);
      try {
        if (isEdit) {
          await dispatch(persistUpdateInvestment(inv));
        } else {
          await dispatch(persistAddInvestment(inv));
          if (inv.type === "sip") {
            dispatch(persistSIPInstalment(inv));
          }
        }
      } finally {
        savingInvestmentRef.current = false;
      }
    },
    [dispatch, invModal],
  );

  const handleDeleteInvestment = useCallback((ids, name, count, inv) => {
    const many = Array.isArray(ids) ? ids : [ids];
    setDeleteConfirm({ ids: many, name, count: many.length, inv });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirm) return;
    deleteConfirm.ids.forEach((id) => dispatch(persistDeleteInvestment(id)));
    dispatch(showToast({ message: `Deleted ${deleteConfirm.name}` }));
    setDeleteConfirm(null);
  }, [deleteConfirm, dispatch]);

  const handleLedgerDelete = useCallback(
    (payload) => {
      if (!payload) return;
      if (payload.kind === "investment") {
        dispatch(persistDeleteInvestment(payload.id));
        dispatch(showToast({ message: "Investment entry removed" }));
        setLedgerTarget(null);
      } else {
        dispatch(persistDeleteTransaction(payload.id));
        dispatch(showToast({ message: "Transaction removed" }));
      }
    },
    [dispatch],
  );

  const handlePauseOpen = useCallback((inv) => {
    setPauseTarget(inv);
  }, []);

  const handlePayArrears = useCallback(
    (inv, status) => {
      if (!status?.overduePeriods?.length) return;
      dispatch(
        persistPayLicArrears({
          investmentId: inv.id,
          periods: status.overduePeriods.map((d) => d.toISOString()),
          withPenalty: status.status === "lapsed",
        }),
      );
    },
    [dispatch],
  );

  const handleConfirmPause = useCallback(() => {
    if (!pauseTarget) return;
    const ids = pauseTarget._ids ?? [pauseTarget.id];
    ids.forEach((id) => dispatch(persistPauseInvestment(id)));
    setPauseTarget(null);
  }, [pauseTarget, dispatch]);

  const handleResumeOpen = useCallback((inv) => {
    setResumeTarget(inv);
  }, []);

  const handleConfirmResume = useCallback(
    ({ startDate, deductOnStart }) => {
      if (!resumeTarget) return;
      const ids = resumeTarget._ids ?? [resumeTarget.id];
      ids.forEach((id) =>
        dispatch(persistResumeInvestment({ id, startDate, deductOnStart })),
      );
      setResumeTarget(null);
    },
    [resumeTarget, dispatch],
  );

  const handleHardDelete = useCallback((inv) => {
    setHardDeleteConfirm(inv);
  }, []);

  const handleConfirmHardDelete = useCallback(() => {
    if (!hardDeleteConfirm) return;
    const inv = hardDeleteConfirm;
    const ids = inv._ids ?? [inv.id];
    ids.forEach((id) => dispatch(persistHardDeleteInvestment(id)));
    dispatch(showToast({ message: `${inv.name} permanently removed` }));
    setHardDeleteConfirm(null);
  }, [dispatch, hardDeleteConfirm]);

  // Open the InvestmentForm for a specific lot inside a grouped card —
  // used by both the single-lot edit click and the multi-lot picker.
  const handleEditLot = useCallback(
    (lotId) => {
      const lot = investments.find((i) => i.id === lotId);
      if (!lot) return;
      setEditPickerTarget(null);
      setInvModal(lot);
    },
    [investments],
  );

  // Edit click on a HoldingCard. Single-lot opens the form straight away.
  // Multi-lot shows a picker so the user can choose which underlying record
  // to edit (e.g., the legacy MF or the SIP both linked to the same ticker).
  const handleEditClick = useCallback(
    (inv) => {
      if ((inv._lots ?? 1) === 1) {
        const lotId = inv._ids?.[0] ?? inv.id;
        handleEditLot(lotId);
      } else {
        setEditPickerTarget(inv);
      }
    },
    [handleEditLot],
  );

  const handleConfirmSell = useCallback(
    ({ qty: qtyToSell, sellPrice, addToBalance, accountId }) => {
      const inv = sellTarget;
      const lots = (
        inv._ids
          ? inv._ids
              .map((id) => investments.find((i) => i.id === id))
              .filter(Boolean)
          : [inv]
      ).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")); // newest first (LIFO)

      dispatch(persistSellInvestment({ lots, qtyToSell, sellPrice, addToBalance, accountId, invName: inv.name }));

      const symbol = inv.ticker || inv.name;
      const proceedsNote = addToBalance && sellPrice > 0
        ? ` · ${INR.format(qtyToSell * sellPrice)} added to balance`
        : "";
      dispatch(showToast({ message: `Sold ${qtyToSell} unit${qtyToSell !== 1 ? "s" : ""} of ${symbol}${proceedsNote}` }));
      setSellTarget(null);
    },
    [sellTarget, investments, dispatch],
  );

  const handleConfirmSurrender = useCallback(
    ({ amount, addToBalance, accountId }) => {
      if (!surrenderTarget) return;
      const id = surrenderTarget._ids?.[0] ?? surrenderTarget.id;
      dispatch(persistSurrenderLicPolicy({ id, amount, addToBalance, accountId }));
      setSurrenderTarget(null);
    },
    [surrenderTarget, dispatch],
  );

  const handleConfirmMature = useCallback(
    ({ amount, addToBalance, accountId }) => {
      if (!matureTarget) return;
      const id = matureTarget._ids?.[0] ?? matureTarget.id;
      dispatch(persistMatureLicPolicy({ id, amount, addToBalance, accountId }));
      setMatureTarget(null);
    },
    [matureTarget, dispatch],
  );

  const handleRefreshPrices = useCallback(async () => {
    const refreshable = investments.filter(
      (inv) => getTypeInfo(inv.type).subtype === "unit" && inv.ticker,
    );
    if (refreshable.length === 0) return;
    setRefreshing(true);
    let updated = 0,
      failed = 0;
    for (const inv of refreshable) {
      try {
        if (inv.type === "sip" && inv.monthlyAmount && inv.startDate) {
          const result = await fetchSIPData(inv.ticker, inv.monthlyAmount, inv.startDate, inv.sipDay);
          const updatedInv = {
            ...inv,
            quantity: result.totalUnits,
            buyPrice: result.avgNav,
            currentPrice: result.currentNav,
            priceUpdatedAt: new Date().toISOString(),
          };
          dispatch(persistUpdateInvestment(updatedInv));
          dispatch(persistSIPInstalment(updatedInv));
        } else {
          const price = await fetchCurrentPrice(inv.type, inv.ticker);
          dispatch(
            persistUpdateInvestment({
              ...inv,
              currentPrice: price,
              priceUpdatedAt: new Date().toISOString(),
            }),
          );
        }
        updated++;
      } catch {
        failed++;
      }
    }
    setRefreshing(false);
    if (failed === 0) {
      dispatch(
        showToast({
          message: `${updated} price${updated !== 1 ? "s" : ""} updated`,
        }),
      );
    } else if (updated > 0) {
      dispatch(
        showToast({
          message: `${updated} updated, ${failed} failed`,
          type: "info",
        }),
      );
    } else {
      dispatch(showToast({ message: "Price update failed", type: "error" }));
    }
  }, [investments, dispatch]);

  const isEmpty = investments.length === 0;
  const isFilteredEmpty =
    isFiltered && filteredInvestments.length === 0 && !isEmpty;

  return (
    <>
      <FilterBar scope="investments" />
      <div className="dashboard">
      <PortfolioHero investments={filteredInvestments} />
      <div className="inv-page-tabs">
        <button
          className={`inv-page-tab${pageTab === "overview" ? " inv-page-tab--active" : ""}`}
          onClick={() => setPageTab("overview")}
        >
          {pageTab === "overview" && (
            <motion.span
              layoutId="invPageTabPill"
              className="inv-page-tab-pill"
              transition={{ type: "spring", stiffness: 480, damping: 38 }}
            />
          )}
          <i className="fa-solid fa-chart-pie" /> Overview
        </button>
        <button
          className={`inv-page-tab${pageTab === "portfolio" ? " inv-page-tab--active" : ""}`}
          onClick={() => setPageTab("portfolio")}
        >
          {pageTab === "portfolio" && (
            <motion.span
              layoutId="invPageTabPill"
              className="inv-page-tab-pill"
              transition={{ type: "spring", stiffness: 480, damping: 38 }}
            />
          )}
          <i className="fa-solid fa-layer-group" /> Portfolio
        </button>
      </div>

      {pageTab === "overview" && (
        <>
          {/* ── Highlights (top/bottom, concentration, maturities) ──
               Reads from the unfiltered investments list internally so the
               date filter at the top of the page can't slice legacy holdings
               out of a grouped position. */}
          <PortfolioHighlights />

          {/* ── Upcoming Reminders ──
               Next SIP debit and next LIC premium for each active recurring
               investment. Always reads from the unfiltered list so an active
               date filter doesn't hide an obligation. */}
          <ReminderSection />

          {/* ── Section 80C tax tracker ──
               Tax-saving headroom for the current FY. Surfaces only when the
               user actually has 80C-eligible contributions. */}
          <Section80CTracker />

          {/* ── Allocation ring ── */}
          <AllocationRing investments={filteredInvestments} theme={theme} />

          {/* ── Sector & Category Breakdown ── */}
          <CategoryBreakdown investments={filteredInvestments} />

          {/* ── Portfolio Pulse ── */}
          <InsightCards investments={filteredInvestments} />
        </>
      )}

      {pageTab === "portfolio" && (
        <div className="dash-section inv-holdings-section">
          <div className="inv-tabs">
            <button
              className={`inv-tab${tab === "holdings" ? " inv-tab--active" : ""}`}
              onClick={() => {
                setTab("holdings");
                setTypeSel("all");
              }}
            >
              Holdings{holdings.length > 0 && ` (${holdings.length})`}
            </button>
            <button
              className={`inv-tab${tab === "history" ? " inv-tab--active" : ""}`}
              onClick={() => {
                setTab("history");
                setTypeSel("all");
              }}
            >
              History{historyItems.length > 0 && ` (${historyItems.length})`}
            </button>
          </div>
          <div className="inv-holdings-header">
            <p className="dash-section-title" style={{ margin: 0 }}>
              {tab === "holdings" ? "Holdings" : "History"}
            </p>
            <div className="inv-holdings-toolbar">
              <select
                className="inv-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="returns">Sort: Returns</option>
                <option value="value">Sort: Value</option>
                <option value="name">Sort: Name</option>
              </select>
              {tab === "holdings" && investments.some(
                (i) => getTypeInfo(i.type).subtype === "unit" && i.ticker,
              ) && (
                <button
                  className="inv-add-btn"
                  onClick={handleRefreshPrices}
                  disabled={refreshing}
                  title="Refresh live prices for all holdings with a ticker"
                >
                  <i
                    className={`fa-solid ${refreshing ? "fa-spinner fa-spin" : "fa-rotate"}`}
                  />
                  {refreshing ? "" : "Refresh"}
                </button>
              )}
            </div>
          </div>

          {(() => {
            const visible = tab === "holdings" ? holdings : historyItems;
            if (isEmpty) {
              return (
                <div className="inv-empty">
                  <i className="fa-solid fa-seedling inv-empty-icon" />
                  <p>No investments yet.</p>
                  <p className="inv-empty-sub">
                    Add your first one to start tracking growth.
                  </p>
                  <p className="inv-empty-sub inv-empty-sub--cta">
                    Don't see your type in the list?{" "}
                    <button
                      type="button"
                      className="inv-empty-link"
                      onClick={() => setInvModal("add")}
                    >
                      Build your own
                    </button>{" "}
                    from the Add Investment screen.
                  </p>
                </div>
              );
            }
            if (isFilteredEmpty) {
              return (
                <div className="inv-empty">
                  <i className="fa-solid fa-calendar-xmark inv-empty-icon" />
                  <p>No investments in this period.</p>
                  <p className="inv-empty-sub">
                    No holdings were started in <strong>{filterLabel}</strong>.
                  </p>
                </div>
              );
            }
            if (visible.length === 0) {
              return (
                <div className="inv-empty">
                  <i
                    className={`fa-solid ${tab === "history" ? "fa-clock-rotate-left" : "fa-seedling"} inv-empty-icon`}
                  />
                  <p>
                    {tab === "history"
                      ? "No history yet."
                      : "No active holdings."}
                  </p>
                  <p className="inv-empty-sub">
                    {tab === "history"
                      ? "Sold-out lots and deleted SIPs will appear here."
                      : "Add an investment to get started."}
                  </p>
                </div>
              );
            }
            // ── Per-type rail: one tab per investment type actually held,
            //    with live counts. Lets a mixed portfolio be read one type at
            //    a time instead of a single undifferentiated wall of cards.
            const typeCounts = new Map();
            for (const inv of visible) {
              typeCounts.set(inv.type, (typeCounts.get(inv.type) ?? 0) + 1);
            }
            // Built-in INVESTMENT_TYPES order first, then any custom / Discover
            // types in the order they were encountered.
            const builtinOrder = INVESTMENT_TYPES.map((t) => t.key);
            const typesPresent = [...typeCounts.keys()].sort((a, b) => {
              const ia = builtinOrder.indexOf(a);
              const ib = builtinOrder.indexOf(b);
              return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
            const typeMeta = (typeKey) => {
              const info = getTypeInfo(typeKey);
              const schema = getInvestmentTypeSchema(typeKey, userTypes);
              return {
                typeKey,
                label: schema?.label || info.label,
                color: info.color,
                icon: info.icon,
              };
            };

            // If the selected type vanished (tab switch, date filter), the
            // setTypeSel reset usually handles it; this guard covers the render
            // before that lands so we never show an empty, dead filter.
            const activeType =
              typeSel !== "all" && typeCounts.has(typeSel) ? typeSel : "all";

            const filtered =
              activeType === "all"
                ? visible
                : visible.filter((inv) => inv.type === activeType);

            // In "All" the cards are grouped under per-type sub-headers; with a
            // single type selected the chip already names it, so the redundant
            // sub-header is dropped.
            const showHeads = activeType === "all";
            const groupOrder = [];
            const groupMap = new Map();
            for (const inv of filtered) {
              if (!groupMap.has(inv.type)) {
                groupMap.set(inv.type, []);
                groupOrder.push(inv.type);
              }
              groupMap.get(inv.type).push(inv);
            }
            const groups = groupOrder.map((typeKey) => ({
              ...typeMeta(typeKey),
              items: groupMap.get(typeKey),
            }));

            const renderCard = (inv) => (
              <HoldingCard
                key={inv.id}
                inv={inv}
                mode={tab}
                onEdit={handleEditClick}
                onDelete={handleDeleteInvestment}
                onSell={(i) => setSellTarget(i)}
                onLedger={(i) => setLedgerTarget(i)}
                onPause={handlePauseOpen}
                onResume={handleResumeOpen}
                onHardDelete={handleHardDelete}
                onSurrender={(i) => setSurrenderTarget(i)}
                onMature={(i) => setMatureTarget(i)}
                onPayArrears={handlePayArrears}
                allTransactions={allTransactions}
                highlightId={highlightId}
              />
            );

            return (
              <>
                {typesPresent.length > 1 && (
                  <div className="inv-page-tabs inv-type-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeType === "all"}
                      className={`inv-page-tab${activeType === "all" ? " inv-page-tab--active" : ""}`}
                      onClick={() => setTypeSel("all")}
                    >
                      {activeType === "all" && (
                        <motion.span
                          layoutId="invTypeTabPill"
                          className="inv-page-tab-pill"
                          transition={{ type: "spring", stiffness: 480, damping: 38 }}
                        />
                      )}
                      All
                      <span className="inv-family-count">{visible.length}</span>
                    </button>
                    {typesPresent.map((tk) => {
                      const m = typeMeta(tk);
                      return (
                        <button
                          key={tk}
                          type="button"
                          role="tab"
                          aria-selected={activeType === tk}
                          className={`inv-page-tab${activeType === tk ? " inv-page-tab--active" : ""}`}
                          onClick={() => setTypeSel(tk)}
                        >
                          {activeType === tk && (
                            <motion.span
                              layoutId="invTypeTabPill"
                              className="inv-page-tab-pill"
                              transition={{ type: "spring", stiffness: 480, damping: 38 }}
                            />
                          )}
                          <i
                            className={`fa-solid ${m.icon}`}
                            style={{ color: m.color }}
                          />
                          {m.label}
                          <span className="inv-family-count">
                            {typeCounts.get(tk)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="inv-holdings-list" key={activeType}>
                  {groups.map((g) => (
                    <div className="inv-type-group" key={g.typeKey}>
                      {showHeads && (
                        <div className="inv-type-group-head">
                          <span
                            className="inv-type-group-icon"
                            style={{
                              background: g.color + "22",
                              color: g.color,
                            }}
                          >
                            <i className={`fa-solid ${g.icon}`} />
                          </span>
                          <span className="inv-type-group-label">{g.label}</span>
                          <span className="inv-type-group-count">
                            {g.items.length}
                          </span>
                        </div>
                      )}
                      {g.items.map(renderCard)}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Modals ── */}
      {invModal && (
        <Modal
          open={!!invModal}
          onClose={() => setInvModal(null)}
          title={
            typeof invModal === "object" ? "Edit Investment" : "Add Investment"
          }
        >
          <InvestmentForm
            onSubmit={handleSaveInvestment}
            onCancel={() => setInvModal(null)}
            existing={typeof invModal === "object" ? invModal : undefined}
          />
        </Modal>
      )}

      {deleteConfirm &&
        (() => {
          const inv = deleteConfirm.inv;
          const info = inv ? getTypeInfo(inv.type) : null;
          const { investedAmount, currentValue, absoluteReturn, returnPct } =
            inv ? calcReturns(inv) : {};
          const pos = absoluteReturn >= 0;
          const retColor = pos
            ? "var(--amount-income)"
            : "var(--amount-expense)";
          return (
            <Modal
              open={!!deleteConfirm}
              onClose={() => setDeleteConfirm(null)}
              title="Remove Investment"
            >
              <div className="inv-delete-confirm">
                {inv && (
                  <div className="inv-delete-asset-preview">
                    <span
                      className="inv-type-badge"
                      style={{
                        background: info.color + "22",
                        color: info.color,
                      }}
                    >
                      <i className={`fa-solid ${info.icon}`} /> {info.label}
                    </span>
                    <p className="inv-holding-name">{inv.name}</p>
                    {info.subtype === "unit" && (
                      <p className="inv-holding-meta">
                        {inv.quantity} units
                        {inv._lots > 1 && (
                          <span className="inv-orders-badge">
                            {" "}
                            {inv._lots} orders
                          </span>
                        )}
                        {" · "}
                        {inv._lots > 1 ? "Avg buy" : "Buy"}{" "}
                        {INR.format(inv.buyPrice)} → Now{" "}
                        {INR.format(inv.currentPrice)}
                      </p>
                    )}
                    {info.subtype === "fixed" && (
                      <p className="inv-holding-meta">
                        {inv.interestRate}% p.a. · {inv.tenureMonths} months
                      </p>
                    )}
                    <div className="inv-holding-amounts">
                      <div>
                        <p className="inv-holding-amt-label">Invested</p>
                        <p className="inv-holding-amt">
                          {INR.format(investedAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="inv-holding-amt-label">Current</p>
                        <p
                          className="inv-holding-amt"
                          style={{ color: retColor }}
                        >
                          {INR.format(currentValue)}
                        </p>
                      </div>
                      <div>
                        <p className="inv-holding-amt-label">Returns</p>
                        <p
                          className="inv-holding-amt"
                          style={{ color: retColor }}
                        >
                          {pos ? "+" : ""}
                          {INR.format(absoluteReturn)}
                          <span className="inv-holding-pct">
                            {" "}
                            ({pos ? "+" : ""}
                            {returnPct.toFixed(1)}%)
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <p className="inv-delete-confirm-msg">
                  {deleteConfirm.count > 1 ? (
                    <>
                      Remove all <strong>{deleteConfirm.count} orders</strong>?
                      This cannot be undone.
                    </>
                  ) : (
                    <>Remove this holding? This cannot be undone.</>
                  )}
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={() => setDeleteConfirm(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inv-delete-confirm-btn"
                    onClick={handleConfirmDelete}
                  >
                    <i className="fa-solid fa-trash-can" /> Delete
                  </button>
                </div>
              </div>
            </Modal>
          );
        })()}

      {hardDeleteConfirm && (
        <Modal
          open={!!hardDeleteConfirm}
          onClose={() => setHardDeleteConfirm(null)}
          title="Delete permanently?"
        >
          <div className="delete-confirm-body">
            <p className="delete-confirm-name">{hardDeleteConfirm.name}</p>
            <p className="delete-confirm-hint">
              This wipes the history record and any linked transactions. It
              cannot be undone.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setHardDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleConfirmHardDelete}
              >
                <i className="fa-solid fa-trash-can" /> Delete permanently
              </button>
            </div>
          </div>
        </Modal>
      )}

      {sellTarget && (
        <Modal
          open={!!sellTarget}
          onClose={() => setSellTarget(null)}
          title={`Sell ${sellTarget.name}`}
        >
          <SellModal
            inv={sellTarget}
            onConfirm={handleConfirmSell}
            onClose={() => setSellTarget(null)}
          />
        </Modal>
      )}

      {ledgerTarget && (
        <Modal
          open={!!ledgerTarget}
          onClose={() => setLedgerTarget(null)}
          title={`Activity — ${ledgerTarget.name}`}
        >
          <LedgerModal
            inv={ledgerTarget}
            rawLots={
              ledgerTarget._ids
                ? ledgerTarget._ids
                    .map((id) => investments.find((i) => i.id === id))
                    .filter(Boolean)
                : [investments.find((i) => i.id === ledgerTarget.id)].filter(Boolean)
            }
            allTransactions={allTransactions}
            highlightTxId={highlightTxParam}
            onSell={
              getTypeInfo(ledgerTarget.type).subtype === "unit"
                ? () => { setSellTarget(ledgerTarget); setLedgerTarget(null); }
                : null
            }
            onDelete={handleLedgerDelete}
          />
        </Modal>
      )}

      {resumeTarget && (
        <Modal
          open={!!resumeTarget}
          onClose={() => setResumeTarget(null)}
          title={`Resume ${resumeTarget.name}`}
        >
          <ResumeForm
            inv={resumeTarget}
            onConfirm={handleConfirmResume}
            onClose={() => setResumeTarget(null)}
          />
        </Modal>
      )}

      {pauseTarget && (
        <Modal
          open={!!pauseTarget}
          onClose={() => setPauseTarget(null)}
          title={`Pause ${pauseTarget.name}?`}
        >
          <PauseConfirm
            inv={pauseTarget}
            onConfirm={handleConfirmPause}
            onClose={() => setPauseTarget(null)}
          />
        </Modal>
      )}

      {surrenderTarget && (
        <Modal
          open={!!surrenderTarget}
          onClose={() => setSurrenderTarget(null)}
          title={`Surrender ${surrenderTarget.name}`}
        >
          <LicSurrenderModal
            inv={surrenderTarget}
            allTransactions={allTransactions}
            onConfirm={handleConfirmSurrender}
            onClose={() => setSurrenderTarget(null)}
          />
        </Modal>
      )}

      {matureTarget && (
        <Modal
          open={!!matureTarget}
          onClose={() => setMatureTarget(null)}
          title={`${matureTarget.name} matured`}
        >
          <LicMatureModal
            inv={matureTarget}
            allTransactions={allTransactions}
            onConfirm={handleConfirmMature}
            onClose={() => setMatureTarget(null)}
          />
        </Modal>
      )}

      {editPickerTarget && (
        <Modal
          open={!!editPickerTarget}
          onClose={() => setEditPickerTarget(null)}
          title="Pick a lot to edit"
        >
          <LotPicker
            group={editPickerTarget}
            allInvestments={investments}
            onPick={handleEditLot}
            onClose={() => setEditPickerTarget(null)}
          />
        </Modal>
      )}
      </div>
    </>
  );
};

export default memo(InvestmentPage);
