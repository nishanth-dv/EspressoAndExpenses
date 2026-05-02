import { useMemo, useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { persistBudget } from "../redux/slices/transactionSlice";
import { CATEGORIES } from "../utils/constants";
import { applyFilter } from "../utils/filterUtils";
import {
  INR, formatShort,
  getSummary, getMonthlyTrend, getCategoryBreakdown, getPaymentSplit,
  getDailyAverage, getMonthDelta, getBiggestExpense, getDayOfWeekData,
  getRecurringSpend, getSpendingVelocity, getIncomeCoverage,
  getTransactionFrequency, getThisMonthCategorySpend,
} from "../utils/dashboardUtils";
import "../styles/dashboard.css";

// Observe data-theme changes so charts re-colour on toggle
function useCurrentTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark"
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute("data-theme") || "dark")
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function chartColors(theme) {
  return theme === "light"
    ? { income: "#27ae60", expense: "#c0392b", label: "rgba(8,8,22,0.4)", grid: "rgba(44,26,16,0.08)", tooltipBg: "#e0d6d5", tooltipText: "#080816" }
    : { income: "#7abf8e", expense: "#d4735a", label: "rgba(224,214,213,0.38)", grid: "rgba(224,214,213,0.1)", tooltipBg: "#e0d6d5", tooltipText: "#080816" };
}

// ── Small shared pieces ──────────────────────────────

function SectionTitle({ children }) {
  return <h2 className="dash-section-title">{children}</h2>;
}

function DeltaBadge({ value }) {
  if (value === null || value === undefined)
    return <span className="delta-badge delta-neutral">—</span>;
  const up = value > 0;
  return (
    <span className={`delta-badge ${up ? "delta-up" : "delta-down"}`}>
      {up ? "↑" : "↓"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function CustomTooltip({ active, payload, label, colors }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="chart-tooltip-item" style={{ color: p.fill }}>
          {p.name}: {INR.format(p.value)}
        </p>
      ))}
    </div>
  );
}

// ── Sections ─────────────────────────────────────────

function SummaryStrip({ summary }) {
  const { balance, totalIncome, totalExpenses, savingsRate } = summary;
  return (
    <div className="summary-strip">
      <div className="summary-card">
        <p className="summary-card-label">Balance</p>
        <p className="summary-card-value">{INR.format(balance)}</p>
      </div>
      <div className="summary-card">
        <p className="summary-card-label">Total Income</p>
        <p className="summary-card-value" style={{ color: "var(--amount-income)" }}>
          {INR.format(totalIncome)}
        </p>
      </div>
      <div className="summary-card">
        <p className="summary-card-label">Total Expenses</p>
        <p className="summary-card-value" style={{ color: "var(--amount-expense)" }}>
          {INR.format(totalExpenses)}
        </p>
      </div>
      <div className="summary-card">
        <p className="summary-card-label">Savings Rate</p>
        <p className="summary-card-value">{savingsRate.toFixed(1)}%</p>
        <p className="summary-card-sub">of total income</p>
      </div>
    </div>
  );
}

function InsightGrid({ transactions, allTransactions }) {
  // these three are period-agnostic — always compute from full history
  const monthDelta = useMemo(() => getMonthDelta(allTransactions), [allTransactions]);
  const biggest = useMemo(() => getBiggestExpense(allTransactions), [allTransactions]);
  const velocity = useMemo(() => getSpendingVelocity(allTransactions), [allTransactions]);
  // these respect the active filter
  const dailyAvg = useMemo(() => getDailyAverage(transactions), [transactions]);
  const coverage = useMemo(() => getIncomeCoverage(transactions), [transactions]);
  const freq = useMemo(() => getTransactionFrequency(transactions), [transactions]);

  return (
    <div className="insight-grid">
      <div className="insight-card">
        <p className="insight-label">Daily Avg Spend</p>
        <p className="insight-value">{INR.format(dailyAvg.avg)}</p>
        <p className="insight-sub">over {dailyAvg.days} days</p>
      </div>

      <div className="insight-card">
        <p className="insight-label">This vs Last Month</p>
        <p className="insight-value">
          {INR.format(monthDelta.thisTotal)}
          <DeltaBadge value={monthDelta.delta} />
        </p>
        <p className="insight-sub">last: {INR.format(monthDelta.lastTotal)}</p>
      </div>

      <div className="insight-card">
        <p className="insight-label">Income Coverage</p>
        <p className="insight-value">
          {coverage.coverage !== null ? `${coverage.coverage.toFixed(1)}%` : "—"}
        </p>
        <p className="insight-sub">
          {INR.format(coverage.expenses)} spent of {INR.format(coverage.income)} earned
        </p>
      </div>

      <div className="insight-card">
        <p className="insight-label">Biggest This Month</p>
        <p className="insight-value">
          {biggest ? INR.format(parseFloat(biggest.amount)) : "—"}
        </p>
        <p className="insight-sub">{biggest?.name ?? "no expenses yet"}</p>
      </div>

      <div className="insight-card">
        <p className="insight-label">Spending Velocity</p>
        <p className="insight-value">
          {INR.format(velocity.projected)}
          <DeltaBadge value={velocity.vsLastMonth} />
        </p>
        <p className="insight-sub">
          projected ({velocity.daysElapsed}/{velocity.daysInMonth} days elapsed)
        </p>
      </div>

      <div className="insight-card">
        <p className="insight-label">Tx Frequency</p>
        <p className="insight-value">{freq.txPerDay.toFixed(1)}/day</p>
        <p className="insight-sub">{freq.total} expenses over {freq.days} days</p>
      </div>
    </div>
  );
}

function MonthlyTrend({ transactions, theme }) {
  const data = useMemo(() => getMonthlyTrend(transactions), [transactions]);
  const c = chartColors(theme);
  return (
    <div className="dash-section">
      <SectionTitle>Income vs Expenses — Last 6 Months</SectionTitle>
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: c.label, fontSize: 12, fontFamily: "Smooch Sans" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: c.label, fontSize: 11, fontFamily: "Smooch Sans" }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={formatShort}
            />
            <Tooltip content={<CustomTooltip colors={c} />} cursor={{ fill: "rgba(128,128,128,0.08)" }} />
            <Legend wrapperStyle={{ fontSize: 13, fontFamily: "Smooch Sans", paddingTop: 8 }} />
            <Bar dataKey="income" fill={c.income} radius={[3, 3, 0, 0]} name="Income" />
            <Bar dataKey="expense" fill={c.expense} radius={[3, 3, 0, 0]} name="Expense" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CategoryBreakdown({ transactions }) {
  const data = useMemo(() => getCategoryBreakdown(transactions), [transactions]);
  return (
    <div className="dash-section">
      <SectionTitle>Spending by Category</SectionTitle>
      {data.length === 0 ? (
        <p className="dash-section-empty">No expense data yet</p>
      ) : (
        <div className="cat-list">
          {data.map(({ category, amount, pct }) => (
            <div key={category}>
              <div className="cat-row-header">
                <span className="cat-name">{category}</span>
                <span className="cat-meta">{INR.format(amount)} · {pct}%</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill bar-fill--expense" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentSplit({ transactions }) {
  const data = useMemo(() => getPaymentSplit(transactions), [transactions]);
  return (
    <div className="dash-section">
      <SectionTitle>Payment Mode Split</SectionTitle>
      {data.length === 0 ? (
        <p className="dash-section-empty">No expense data yet</p>
      ) : (
        <div className="cat-list">
          {data.map(({ mode, amount, pct }) => (
            <div key={mode}>
              <div className="cat-row-header">
                <span className="cat-name">{mode}</span>
                <span className="cat-meta">{INR.format(amount)} · {pct}%</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill bar-fill--income" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetTracker({ transactions, budgets, dispatch }) {
  const [editingCat, setEditingCat] = useState(null);
  const [editVal, setEditVal] = useState("");
  const thisMonthSpend = useMemo(() => getThisMonthCategorySpend(transactions), [transactions]);
  const anyBudgetSet = Object.keys(budgets).length > 0;

  function startEdit(cat) {
    setEditingCat(cat);
    setEditVal(budgets[cat] ? String(budgets[cat]) : "");
  }

  function commitEdit(cat) {
    const amount = parseFloat(editVal);
    dispatch(persistBudget(cat, isNaN(amount) ? 0 : amount));
    setEditingCat(null);
  }

  function handleKeyDown(e, cat) {
    if (e.key === "Enter") commitEdit(cat);
    if (e.key === "Escape") setEditingCat(null);
  }

  return (
    <div className="dash-section">
      <SectionTitle>Budget vs Actual — This Month</SectionTitle>
      {!anyBudgetSet && (
        <p className="budget-hint">Tap a category to set a monthly budget.</p>
      )}
      <div className="budget-list">
        {CATEGORIES.map((cat) => {
          const spent = thisMonthSpend[cat] || 0;
          const budget = budgets[cat] || 0;
          const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
          const over = budget > 0 && spent > budget;

          return (
            <div key={cat}>
              <div className="budget-row-header">
                <span className="budget-name">{cat}</span>
                <div className="budget-right">
                  <span className="budget-spent">{INR.format(spent)}</span>
                  <span className="budget-spent"> / </span>
                  {editingCat === cat ? (
                    <input
                      className="budget-edit-input"
                      type="number"
                      inputMode="decimal"
                      value={editVal}
                      autoFocus
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(cat)}
                      onKeyDown={(e) => handleKeyDown(e, cat)}
                    />
                  ) : (
                    <button className="budget-set-btn" onClick={() => startEdit(cat)}>
                      {budget > 0 ? INR.format(budget) : "set budget"}
                    </button>
                  )}
                  {over && <span className="budget-over-label">Over!</span>}
                </div>
              </div>
              {budget > 0 && (
                <div className="bar-track">
                  <div
                    className={`bar-fill ${over ? "bar-fill--over" : "bar-fill--income"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayHeatmap({ transactions }) {
  const data = useMemo(() => getDayOfWeekData(transactions), [transactions]);
  return (
    <div className="dash-section">
      <SectionTitle>Spending by Day of Week</SectionTitle>
      <div className="day-heatmap">
        {data.map(({ day, amount, intensity }) => (
          <div key={day} className="day-cell">
            <div className="day-cell-bg" style={{ opacity: intensity * 0.6 }} />
            <div className="day-cell-content">
              <span className="day-cell-name">{day}</span>
              <span className="day-cell-amount">
                {amount > 0 ? formatShort(amount) : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthDelta({ transactions }) {
  const { byCategory, thisTotal, lastTotal, delta } = useMemo(
    () => getMonthDelta(transactions),
    [transactions]
  );
  return (
    <div className="dash-section">
      <SectionTitle>This Month vs Last</SectionTitle>
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
          {INR.format(thisTotal)}
        </span>
        <DeltaBadge value={delta} />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          vs {INR.format(lastTotal)}
        </span>
      </div>
      {byCategory.length === 0 ? (
        <p className="dash-section-empty">No data to compare</p>
      ) : (
        <div className="delta-table">
          <div className="delta-row" style={{ borderBottom: "1px solid var(--detail-divider)", paddingBottom: 6 }}>
            <span className="dash-section-title" style={{ margin: 0 }}>Category</span>
            <span className="dash-section-title" style={{ margin: 0, textAlign: "right" }}>This</span>
            <span className="dash-section-title" style={{ margin: 0, textAlign: "right" }}>Last</span>
            <span className="dash-section-title" style={{ margin: 0, textAlign: "right" }}>Δ</span>
          </div>
          {byCategory.map(({ category, thisMonth, lastMonth, delta: d }) => (
            <div key={category} className="delta-row">
              <span className="delta-cat-name">{category}</span>
              <span className="delta-amount">{formatShort(thisMonth)}</span>
              <span className="delta-amount">{lastMonth > 0 ? formatShort(lastMonth) : "—"}</span>
              <span className="delta-amount"><DeltaBadge value={d} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecurringSpend({ transactions }) {
  const data = useMemo(() => getRecurringSpend(transactions), [transactions]);
  return (
    <div className="dash-section">
      <SectionTitle>Likely Recurring Expenses</SectionTitle>
      {data.length === 0 ? (
        <p className="dash-section-empty">No recurring patterns found yet</p>
      ) : (
        <div className="recurring-list">
          {data.map(({ name, count, total }) => (
            <div key={name} className="recurring-row">
              <span className="recurring-name">{name}</span>
              <span className="recurring-meta">
                {count}× · {INR.format(total)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentTransactions({ transactions }) {
  const recent = useMemo(() => transactions.slice(0, 5), [transactions]);
  const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
  return (
    <div className="dash-section">
      <SectionTitle>Recent Transactions</SectionTitle>
      {recent.length === 0 ? (
        <p className="dash-section-empty">No transactions yet</p>
      ) : (
        <div className="recent-list">
          {recent.map((t) => {
            const name = t.name || t.source || "—";
            const isExp = t.transactionType === "expense";
            return (
              <div key={t.id} className="recent-row">
                <div className="recent-left">
                  <span className="recent-name">{name}</span>
                  <span className="recent-date">{fmt.format(new Date(t.occurredAt))}</span>
                </div>
                <span
                  className="recent-amount"
                  style={{ color: isExp ? "var(--amount-expense)" : "var(--amount-income)" }}
                >
                  {isExp ? "−" : "+"}{INR.format(parseFloat(t.amount))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────

const Dashboard = () => {
  const dispatch = useDispatch();
  const theme = useCurrentTheme();
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? []
  );
  const filter = useSelector((state) => state.filter);
  const transactions = useMemo(
    () => applyFilter(allTransactions, filter),
    [allTransactions, filter]
  );
  const insights = useSelector((state) => state.transactions.transactionData?.insights);
  const budgets = useSelector(
    (state) => state.transactions.transactionData?.budgets ?? {}
  );

  const summary = useMemo(() => getSummary(transactions, insights), [transactions, insights]);

  if (allTransactions.length === 0) {
    return (
      <div className="dashboard">
        <div className="dash-empty">
          <p>No transactions yet — add some to see your dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Filter-aware: totals reflect selected period */}
      <SummaryStrip summary={summary} />
      <InsightGrid transactions={transactions} allTransactions={allTransactions} />

      {/* Filter-independent: always show full 6-month picture */}
      <MonthlyTrend transactions={allTransactions} theme={theme} />

      {/* Filter-aware: breakdown of the selected period */}
      <div className="dash-two-col">
        <CategoryBreakdown transactions={transactions} />
        <PaymentSplit transactions={transactions} />
      </div>

      {/* Filter-independent: budget is always vs current month */}
      <BudgetTracker transactions={allTransactions} budgets={budgets} dispatch={dispatch} />

      {/* Filter-aware: heatmap of selected period */}
      <DayHeatmap transactions={transactions} />

      {/* Filter-independent: month comparison has its own time context */}
      <div className="dash-two-col">
        <MonthDelta transactions={allTransactions} />
        <RecurringSpend transactions={transactions} />
      </div>

      <RecentTransactions transactions={transactions} />
    </div>
  );
};

export default Dashboard;
