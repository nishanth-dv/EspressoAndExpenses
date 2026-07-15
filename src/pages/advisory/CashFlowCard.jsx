import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { commitmentIsActive } from "../../utils/solvencyUtils";
import { subscriptionTotals } from "../../utils/subscriptionUtils";
import {
  resolveMonthlyIncome,
  projectUpcomingIncome,
} from "../../utils/incomeUtils";
import InfoTooltip from "../../components/InfoTooltip";
import "../../styles/solvency.css";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const INR_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const monthShort = (m) =>
  new Date(m.year, m.month, 1).toLocaleDateString("en-IN", { month: "short" });

// Median of the month totals — the "typical" single-credit month. Used as the
// flag baseline so a doubled month stands out without a low partial first month
// (or a genuine raise under 50%) raising a false alarm.
const medianTotal = (months) => {
  const s = months.map((m) => m.total).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Monthly cash-flow snapshot: typical income vs fixed obligations, the free /
// deficit, the committed-ratio bar, and an optimistic "after payday" balance
// when regular income is still expected this month. Self-contained (reads its
// own slices) so it can live on the Advisory → Understand lens.
export default function CashFlowCard() {
  const commitments = useSelector(
    (s) => s.transactions.transactionData?.commitments ?? [],
  );
  const allTransactions = useSelector(
    (s) => s.transactions.transactionData?.transactions ?? [],
  );
  const subscriptions = useSelector(
    (s) => s.transactions.transactionData?.subscriptions ?? [],
  );
  const incomeType = useSelector(
    (s) => s.transactions.transactionData?.preferences?.incomeType ?? "auto",
  );
  const excludeCategories = useSelector(
    (s) =>
      s.transactions.transactionData?.preferences?.incomeExcludeCategories ??
      [],
  );
  const balance = useSelector(
    (s) => s.transactions.transactionData?.insights?.balance ?? 0,
  );
  const now = new Date();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const incomeInfo = useMemo(
    () =>
      resolveMonthlyIncome(allTransactions, { incomeType, excludeCategories }),
    [allTransactions, incomeType, excludeCategories],
  );
  const income = incomeInfo.monthly;
  const proj = useMemo(
    () =>
      projectUpcomingIncome(allTransactions, { incomeType, excludeCategories }),
    [allTransactions, incomeType, excludeCategories],
  );

  if (income <= 0) return null;

  const fmtPayday = (d) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const fixed =
    commitments
      .filter(commitmentIsActive)
      .reduce((s, c) => s + (parseFloat(c.emiAmount) || 0), 0) +
    subscriptionTotals(subscriptions).monthly;
  const free = income - fixed;
  const pct = Math.min(100, Math.round((fixed / income) * 100));
  const freeColor =
    free >= 0 ? "var(--amount-income)" : "var(--amount-expense)";

  return (
    <div className="sol-section">
      <div className="sol-section-header">
        <p className="sol-section-title">
          Cash flow · {now.toLocaleDateString("en-IN", { month: "long" })}
          <InfoTooltip
            text={
              <>
                <strong>Income</strong> is your typical monthly income:{" "}
                <strong>regular pay</strong> (e.g. salary) is averaged over
                recent months so it doesn't read 0 before a month-end credit,
                and <strong>variable income</strong> is averaged.{" "}
                <strong>Fixed</strong> is your full monthly obligation. Change
                how income is modelled in{" "}
                <strong>Preferences → Income type</strong>.
              </>
            }
          />
        </p>
      </div>
      <div className="sol-cashflow-stats">
        <div className="sol-cashflow-stat">
          <span className="sol-cashflow-label">Income</span>
          <span
            className="sol-cashflow-value"
            style={{ color: "var(--amount-income)" }}
          >
            {INR.format(income)}
          </span>
        </div>
        <div className="sol-cashflow-stat">
          <span className="sol-cashflow-label">Fixed</span>
          <span
            className="sol-cashflow-value"
            style={{ color: "var(--amount-expense)" }}
          >
            {INR.format(fixed)}
          </span>
        </div>
        <div className="sol-cashflow-stat">
          <span className="sol-cashflow-label">
            {free >= 0 ? "Free" : "Deficit"}
          </span>
          <span className="sol-cashflow-value" style={{ color: freeColor }}>
            {INR.format(Math.abs(free))}
          </span>
        </div>
      </div>
      <div className="sol-cashflow-bar-wrap">
        <div className="sol-cashflow-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="sol-cashflow-ratio">
        {pct}% of income committed to fixed obligations
      </p>

      <button
        type="button"
        className="sol-cashflow-bd-toggle"
        onClick={() => setShowBreakdown((v) => !v)}
        aria-expanded={showBreakdown}
      >
        <i
          className={`fa-solid fa-chevron-${showBreakdown ? "down" : "right"}`}
        />
        How income is calculated
      </button>
      {showBreakdown && (
        <div className="sol-cashflow-breakdown">
          {incomeInfo.streams.map((s) => {
            const base = medianTotal(s.months);
            return (
              <div key={s.category} className="sol-cashflow-bd-stream">
                <div className="sol-cashflow-bd-head">
                  <span className="sol-cashflow-bd-cat">{s.category}</span>
                  <span className="sol-cashflow-bd-val">
                    {s.regular ? "avg" : "≈"} {INR.format(s.value)}/mo
                  </span>
                </div>
                <div className="sol-cashflow-bd-months">
                  {s.months.map((m) => {
                    const flag = base > 0 && m.total > base * 1.5;
                    return (
                      <span
                        key={m.key}
                        className={`sol-cashflow-bd-month${
                          flag ? " sol-cashflow-bd-month--flag" : ""
                        }`}
                        title={
                          flag
                            ? "More than one credit landed in this month"
                            : undefined
                        }
                      >
                        {monthShort(m)} {INR_COMPACT.format(m.total)}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="sol-cashflow-bd-note">
            Regular income (e.g. salary) is the average of the months shown;
            two credits in one month count as that month&apos;s total — a
            flagged month usually means a duplicate or a mis-dated entry.
          </p>
        </div>
      )}

      {proj.pendingThisMonth > 0 && proj.next && (
        <p className="sol-cashflow-payday">
          <i className="fa-solid fa-sack-dollar" />{" "}
          <strong>{INR.format(proj.pendingThisMonth)}</strong> expected{" "}
          {fmtPayday(proj.next.date)} · balance{" "}
          <strong>{INR.format(balance)}</strong> →{" "}
          <strong style={{ color: "var(--amount-income)" }}>
            {INR.format(balance + proj.pendingThisMonth)}
          </strong>{" "}
          after payday
        </p>
      )}
    </div>
  );
}
