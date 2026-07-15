import { useMemo, useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import FilterBar from "../components/FilterBar";
import BalanceCarousel from "../components/BalanceCarousel";
import MoneyFlowBreakdown from "../components/MoneyFlowBreakdown";
import PinnedNotesCard from "../components/notes/PinnedNotesCard";
import StatementImportButton from "../components/StatementImportButton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";
import { categoryVisual } from "../utils/categoryVisual";
import { persistBudget } from "../redux/slices/transactionSlice";
import { CATEGORIES } from "../utils/constants";
import { applyFilter } from "../utils/filterUtils";
import {
  INR,
  formatShort,
  getSummary,
  getMonthlyTrend,
  getCategoryBreakdown,
  getPaymentSplit,
  getMonthDelta,
  getDayOfWeekData,
  getRecurringSpend,
  getThisMonthCategorySpend,
} from "../utils/dashboardUtils";
import { getPortfolioSummary } from "../utils/investmentUtils";
import { useInvestments } from "../hooks/useInvestments";
import { projectUpcomingIncome } from "../utils/incomeUtils";
import { dashboardInsights } from "../utils/dashboardInsights";
import useCountUp from "../hooks/useCountUp";
import Reveal from "../components/Reveal";
import "../styles/dashboard.css";

// Observe data-theme changes so charts re-colour on toggle
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

function chartColors(theme) {
  return theme === "light"
    ? {
        income: "#27ae60",
        expense: "#c0392b",
        label: "rgba(8,8,22,0.4)",
        grid: "rgba(44,26,16,0.08)",
        tooltipBg: "#e0d6d5",
        tooltipText: "#080816",
      }
    : {
        income: "#7abf8e",
        expense: "#d4735a",
        label: "rgba(224,214,213,0.38)",
        grid: "rgba(224,214,213,0.1)",
        tooltipBg: "#e0d6d5",
        tooltipText: "#080816",
      };
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

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      {payload.map((p) => (
        <p
          key={p.name}
          className="chart-tooltip-item"
          style={{ color: p.fill }}
        >
          {p.name}: {INR.format(p.value)}
        </p>
      ))}
    </div>
  );
}

// ── Sections ─────────────────────────────────────────

function CashFlowHero({ summary }) {
  const { totalIncome, totalExpenses, totalInvested, savingsRate } = summary;
  const net = totalIncome - totalExpenses;
  const positive = net >= 0;
  const animated = useCountUp(Math.abs(net));
  const pctSpent = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : null;

  const r = 15;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, savingsRate));
  const offset = circ - (clamped / 100) * circ;
  const ringColor =
    savingsRate >= 20
      ? "var(--amount-income)"
      : savingsRate >= 0
        ? "#d4a35a"
        : "var(--amount-expense)";

  return (
    <div className="dash-hero">
      <div className="dash-hero-main">
        <div className="dash-hero-lead">
          <span className="dash-hero-eyebrow">
            {positive ? "Saved this period" : "Overspent this period"}
          </span>
          <div
            className="dash-hero-value"
            style={{
              color: positive
                ? "var(--amount-income)"
                : "var(--amount-expense)",
            }}
          >
            {positive ? "" : "−"}
            {INR.format(Math.round(animated))}
          </div>
          {pctSpent != null && (
            <span className="dash-hero-chip">
              <i className="fa-solid fa-wallet" /> {Math.round(pctSpent)}% of
              income spent
            </span>
          )}
        </div>
        <div className="dash-hero-ring">
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
              stroke={ringColor}
              strokeWidth="4"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 20 20)"
              style={{ transition: "stroke-dashoffset 0.8s ease" }}
            />
          </svg>
          <div className="dash-hero-ring-center">
            <span className="dash-hero-ring-num">{savingsRate.toFixed(0)}%</span>
            <span className="dash-hero-ring-lbl">saved</span>
          </div>
        </div>
      </div>
      <div className="dash-hero-strip">
        <div className="dash-hero-stat">
          <span className="dash-hero-stat-lbl">Income</span>
          <span
            className="dash-hero-stat-val"
            style={{ color: "var(--amount-income)" }}
          >
            {INR.format(totalIncome)}
          </span>
        </div>
        <div className="dash-hero-stat">
          <span className="dash-hero-stat-lbl">Expenses</span>
          <span
            className="dash-hero-stat-val"
            style={{ color: "var(--amount-expense)" }}
          >
            {INR.format(totalExpenses)}
          </span>
        </div>
        {totalInvested > 0 && (
          <div className="dash-hero-stat">
            <span className="dash-hero-stat-lbl">Invested</span>
            <span
              className="dash-hero-stat-val"
              style={{ color: "var(--amount-investment)" }}
            >
              {INR.format(totalInvested)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SmartInsights({ insights }) {
  if (!insights.length) return null;
  return (
    <div className="dash-insights">
      {insights.slice(0, 5).map((ins) => (
        <div key={ins.id} className={`dash-insight dash-insight--${ins.kind}`}>
          <span className="dash-insight-icon">
            <i className={`fa-solid ${ins.icon}`} />
          </span>
          <div className="dash-insight-text">
            <span className="dash-insight-title">{ins.title}</span>
            <span className="dash-insight-detail">{ins.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlyTrend({ transactions, theme }) {
  const data = useMemo(() => getMonthlyTrend(transactions), [transactions]);
  const avgExpense = useMemo(
    () =>
      data.length
        ? data.reduce((s, d) => s + (d.expense || 0), 0) / data.length
        : 0,
    [data],
  );
  const c = chartColors(theme);
  return (
    <div className="dash-section">
      <SectionTitle>Income vs Expenses — Last 6 Months</SectionTitle>
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            barCategoryGap="30%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={c.grid}
              vertical={false}
            />
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
            <Tooltip
              content={<CustomTooltip colors={c} />}
              cursor={{ fill: "rgba(128,128,128,0.08)" }}
            />
            <Legend
              wrapperStyle={{
                fontSize: 13,
                fontFamily: "Smooch Sans",
                paddingTop: 8,
              }}
            />
            <Bar
              dataKey="income"
              fill={c.income}
              radius={[3, 3, 0, 0]}
              name="Income"
            />
            <Bar
              dataKey="expense"
              fill={c.expense}
              radius={[3, 3, 0, 0]}
              name="Expense"
            />
            {avgExpense > 0 && (
              <ReferenceLine
                y={avgExpense}
                stroke={c.label}
                strokeDasharray="4 4"
                strokeOpacity={0.55}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SpendForecast({ allTransactions, budgets }) {
  const now = new Date();
  const day = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const daysLeft = daysInMonth - day;

  const md = useMemo(() => getMonthDelta(allTransactions), [allTransactions]);
  const spent = md?.thisTotal || 0;
  if (spent <= 0) return null;

  const dailyPace = spent / Math.max(1, day);
  const projected = Math.round(dailyPace * daysInMonth);
  const totalBudget = Object.values(budgets).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0,
  );
  const ref = totalBudget > 0 ? totalBudget : md?.lastTotal || 0;
  const refLabel = totalBudget > 0 ? "budget" : "last month";
  const overRef = ref > 0 && projected > ref;

  const scale = Math.max(projected, ref, spent, 1);
  const spentW = (spent / scale) * 100;
  const projW = (projected / scale) * 100;
  const refL = ref > 0 ? (ref / scale) * 100 : null;
  const accent = overRef ? "var(--amount-expense)" : "var(--amount-income)";
  const safeDaily =
    ref > 0 && daysLeft > 0 ? Math.max(0, Math.round((ref - spent) / daysLeft)) : null;

  return (
    <div className="dash-section">
      <SectionTitle>Month-end forecast</SectionTitle>
      <div className="dash-fc-lead">
        <span className="dash-fc-eyebrow">On pace to spend</span>
        <span
          className="dash-fc-value"
          style={{ color: overRef ? "var(--amount-expense)" : "var(--text-primary)" }}
        >
          {INR.format(projected)}
        </span>
        <span className="dash-fc-sub">
          by {now.toLocaleDateString("en-IN", { month: "short" })} {daysInMonth} ·{" "}
          {INR.format(Math.round(dailyPace))}/day so far
        </span>
      </div>
      <div className="dash-fc-bar">
        <div
          className="dash-fc-bar-proj"
          style={{
            width: `${Math.min(100, projW)}%`,
            background: `color-mix(in srgb, ${accent} 26%, transparent)`,
          }}
        />
        <div
          className="dash-fc-bar-spent"
          style={{ width: `${Math.min(100, spentW)}%`, background: accent }}
        />
        {refL != null && (
          <div
            className="dash-fc-bar-ref"
            style={{ left: `${Math.min(100, refL)}%` }}
            title={`${refLabel}: ${INR.format(ref)}`}
          />
        )}
      </div>
      <p className="dash-fc-note">
        {ref > 0
          ? overRef
            ? `Projected ${INR.format(projected - ref)} over your ${refLabel}.`
            : `On track — ${INR.format(ref - projected)} under your ${refLabel}.`
          : `${INR.format(spent)} spent so far this month.`}
        {safeDaily != null &&
          daysLeft > 0 &&
          ` Safe to spend ~${INR.format(safeDaily)}/day for ${daysLeft} more days.`}
      </p>
    </div>
  );
}

const RING_PALETTE = [
  "#5b8dee",
  "#16a34a",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#ef4444",
  "#14b8a6",
];

function SpendRing({ title, data }) {
  const [selected, setSelected] = useState(null);
  if (data.length === 0) {
    return (
      <div className="dash-section">
        <SectionTitle>{title}</SectionTitle>
        <p className="dash-section-empty">No expense data yet</p>
      </div>
    );
  }
  const total = data.reduce((s, d) => s + d.amount, 0);
  const active = selected ? data.find((d) => d.label === selected) : null;
  return (
    <div className="dash-section">
      <SectionTitle>{title}</SectionTitle>
      <div className="dash-ring">
        <div className="dash-ring-chart">
          <ResponsiveContainer width="100%" height={172}>
            <PieChart>
              <Pie
                data={data}
                dataKey="amount"
                nameKey="label"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={2}
                stroke="none"
                onClick={(_, i) =>
                  setSelected(data[i].label === selected ? null : data[i].label)
                }
              >
                {data.map((d) => (
                  <Cell
                    key={d.label}
                    fill={d.color}
                    opacity={selected && selected !== d.label ? 0.32 : 1}
                    cursor="pointer"
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="dash-ring-center">
            <span className="dash-ring-val">
              {INR.format(active ? active.amount : total)}
            </span>
            <span className="dash-ring-lbl">
              {active ? active.label : "total"}
            </span>
          </div>
        </div>
        <div className="dash-ring-legend">
          {data.map((d) => (
            <button
              key={d.label}
              type="button"
              className={`dash-ring-leg${selected === d.label ? " dash-ring-leg--active" : ""}`}
              onClick={() => setSelected(d.label === selected ? null : d.label)}
            >
              <span
                className="dash-ring-leg-dot"
                style={{ background: d.color }}
              />
              <span className="dash-ring-leg-name">{d.label}</span>
              <span className="dash-ring-leg-pct">{d.pct}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryBreakdown({ transactions }) {
  const data = useMemo(
    () =>
      getCategoryBreakdown(transactions).map((d) => ({
        label: d.category,
        amount: d.amount,
        pct: d.pct,
        color: categoryVisual(d.category).color,
      })),
    [transactions],
  );
  return <SpendRing title="Spending by Category" data={data} />;
}

function PaymentSplit({ transactions }) {
  const data = useMemo(
    () =>
      getPaymentSplit(transactions).map((d, i) => ({
        label: d.mode,
        amount: d.amount,
        pct: d.pct,
        color: RING_PALETTE[i % RING_PALETTE.length],
      })),
    [transactions],
  );
  return <SpendRing title="Payment Mode Split" data={data} />;
}

function BudgetTracker({ transactions, budgets, dispatch }) {
  const [editingCat, setEditingCat] = useState(null);
  const [editVal, setEditVal] = useState("");
  const thisMonthSpend = useMemo(
    () => getThisMonthCategorySpend(transactions),
    [transactions],
  );
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
      {anyBudgetSet &&
        (() => {
          const totalBudget = Object.values(budgets).reduce(
            (s, v) => s + (parseFloat(v) || 0),
            0,
          );
          const totalSpent = Object.keys(budgets).reduce(
            (s, cat) => s + (thisMonthSpend[cat] || 0),
            0,
          );
          if (totalBudget <= 0) return null;
          const left = totalBudget - totalSpent;
          const bpct = Math.min(100, (totalSpent / totalBudget) * 100);
          const bover = totalSpent > totalBudget;
          const barColor = bover
            ? "var(--amount-expense)"
            : bpct >= 80
              ? "#f59e0b"
              : "var(--amount-income)";
          return (
            <div className="budget-summary">
              <div className="budget-summary-head">
                <span className="budget-summary-val">
                  {INR.format(totalSpent)}{" "}
                  <span className="budget-summary-of">
                    of {INR.format(totalBudget)}
                  </span>
                </span>
                <span
                  className="budget-summary-left"
                  style={{
                    color: bover
                      ? "var(--amount-expense)"
                      : "var(--text-secondary)",
                  }}
                >
                  {bover
                    ? `${INR.format(-left)} over`
                    : `${INR.format(left)} left`}
                </span>
              </div>
              <div className="bar-track budget-summary-bar">
                <div
                  className="bar-fill"
                  style={{ width: `${bpct}%`, background: barColor }}
                />
              </div>
            </div>
          );
        })()}
      <div className="budget-list">
        {CATEGORIES.map((cat) => {
          const spent = thisMonthSpend[cat] || 0;
          const budget = budgets[cat] || 0;
          const rawPct = budget > 0 ? (spent / budget) * 100 : 0;
          const pct = Math.min(100, rawPct);
          const over = budget > 0 && spent > budget;
          const rowColor = over
            ? "var(--amount-expense)"
            : rawPct >= 80
              ? "#f59e0b"
              : "var(--amount-income)";

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
                    <button
                      className="budget-set-btn"
                      onClick={() => startEdit(cat)}
                    >
                      {budget > 0 ? INR.format(budget) : "set budget"}
                    </button>
                  )}
                  {over && <span className="budget-over-label">Over!</span>}
                </div>
              </div>
              {budget > 0 && (
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${pct}%`, background: rowColor }}
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
    [transactions],
  );
  return (
    <div className="dash-section">
      <SectionTitle>This Month vs Last</SectionTitle>
      <div
        style={{
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
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
          <div
            className="delta-row"
            style={{
              borderBottom: "1px solid var(--detail-divider)",
              paddingBottom: 6,
            }}
          >
            <span className="dash-section-title" style={{ margin: 0 }}>
              Category
            </span>
            <span
              className="dash-section-title"
              style={{ margin: 0, textAlign: "right" }}
            >
              This
            </span>
            <span
              className="dash-section-title"
              style={{ margin: 0, textAlign: "right" }}
            >
              Last
            </span>
            <span
              className="dash-section-title"
              style={{ margin: 0, textAlign: "right" }}
            >
              Δ
            </span>
          </div>
          {byCategory.map(({ category, thisMonth, lastMonth, delta: d }) => (
            <div key={category} className="delta-row">
              <span className="delta-cat-name">{category}</span>
              <span className="delta-amount">{formatShort(thisMonth)}</span>
              <span className="delta-amount">
                {lastMonth > 0 ? formatShort(lastMonth) : "—"}
              </span>
              <span className="delta-amount">
                <DeltaBadge value={d} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioSnapshot({ investments }) {
  const { totalInvested, totalCurrent, totalReturn, returnPct } = useMemo(
    () => getPortfolioSummary(investments),
    [investments],
  );
  const pos = totalReturn >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";
  return (
    <div className="dash-section">
      <SectionTitle>Portfolio Snapshot</SectionTitle>
      <div className="summary-strip">
        <div className="summary-card">
          <p className="summary-card-label">Total Invested</p>
          <p className="summary-card-value">{INR.format(totalInvested)}</p>
        </div>
        <div className="summary-card">
          <p className="summary-card-label">Current Value</p>
          <p className="summary-card-value" style={{ color: retColor }}>
            {INR.format(totalCurrent)}
          </p>
        </div>
        <div className="summary-card">
          <p className="summary-card-label">Total Returns</p>
          <p className="summary-card-value" style={{ color: retColor }}>
            {pos ? "+" : ""}{INR.format(totalReturn)}
          </p>
        </div>
        <div className="summary-card">
          <p className="summary-card-label">Return %</p>
          <p className="summary-card-value" style={{ color: retColor }}>
            {pos ? "+" : ""}{returnPct.toFixed(2)}%
          </p>
        </div>
      </div>
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
  const recent = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
        .slice(0, 5),
    [transactions],
  );
  const fmt = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
  });
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
            const isInv = t.transactionType === "investment";
            const color = isExp
              ? "var(--amount-expense)"
              : isInv
              ? "var(--amount-investment)"
              : "var(--amount-income)";
            return (
              <div key={t.id} className="recent-row">
                <div className="recent-left">
                  <span className="recent-name">{name}</span>
                  <span className="recent-date">
                    {fmt.format(new Date(t.occurredAt))}
                  </span>
                </div>
                <span className="recent-amount" style={{ color }}>
                  {isExp ? "−" : isInv ? "" : "+"}
                  {INR.format(parseFloat(t.amount))}
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
  useInvestments();
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const filter = useSelector((state) => state.filter.transactions);
  const transactions = useMemo(
    () => applyFilter(allTransactions, filter),
    [allTransactions, filter],
  );
  const insights = useSelector(
    (state) => state.transactions.transactionData?.insights,
  );
  const budgets = useSelector(
    (state) => state.transactions.transactionData?.budgets ?? {},
  );
  const investments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const statementImportEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.statementImportEnabled ??
      false,
  );

  const summary = useMemo(
    () => getSummary(transactions, insights),
    [transactions, insights],
  );

  const subscriptions = useSelector(
    (state) => state.transactions.transactionData?.subscriptions ?? [],
  );
  const incomeType = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.incomeType ?? "auto",
  );
  const excludeCategories = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.incomeExcludeCategories ?? [],
  );
  const balance = useSelector(
    (state) => state.transactions.transactionData?.insights?.balance ?? 0,
  );
  const upcomingIncome = useMemo(
    () =>
      projectUpcomingIncome(allTransactions, { incomeType, excludeCategories }),
    [allTransactions, incomeType, excludeCategories],
  );
  const dashInsights = useMemo(
    () =>
      dashboardInsights({
        summary,
        allTransactions,
        budgets,
        subscriptions,
        upcomingIncome,
        balance,
      }),
    [summary, allTransactions, budgets, subscriptions, upcomingIncome, balance],
  );

  if (allTransactions.length === 0) {
    return (
      <>
        <FilterBar scope="transactions" />
        <div className="dashboard">
          <div className="dash-empty">
            <p>No transactions yet — add some to see your dashboard.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <FilterBar scope="transactions" />
      <div className="dashboard">
        {/* Hero — swipeable per-bank balance carousel. Falls back to the
            aggregate-only view when multi-bank tracking is off. */}
        <BalanceCarousel variant="hero" />
        {/* Filter-aware: totals reflect selected period */}
        <CashFlowHero summary={summary} />
        {/* Spending-by-bank breakdown — only renders when multi-bank tracking
            is on and the current month has at least one tagged expense. */}
        <Reveal>
          <MoneyFlowBreakdown />
        </Reveal>
        {/* Pinned notes — renders only when the user has pinned something. */}
        <Reveal>
          <PinnedNotesCard />
        </Reveal>
        <Reveal>
          <SmartInsights insights={dashInsights} />
        </Reveal>

        {/* Filter-independent: always show full 6-month picture */}
        <Reveal>
          <MonthlyTrend transactions={allTransactions} theme={theme} />
        </Reveal>

        {/* Filter-independent: this-month pace projection */}
        <Reveal>
          <SpendForecast allTransactions={allTransactions} budgets={budgets} />
        </Reveal>

        {/* Filter-aware: breakdown of the selected period */}
        <Reveal className="dash-two-col">
          <CategoryBreakdown transactions={transactions} />
          <PaymentSplit transactions={transactions} />
        </Reveal>

        {/* Filter-independent: budget is always vs current month */}
        <Reveal>
          <BudgetTracker
            transactions={allTransactions}
            budgets={budgets}
            dispatch={dispatch}
          />
        </Reveal>

        {/* Filter-aware: heatmap of selected period */}
        <Reveal>
          <DayHeatmap transactions={transactions} />
        </Reveal>

        {/* Filter-independent: month comparison has its own time context */}
        <Reveal className="dash-two-col">
          <MonthDelta transactions={allTransactions} />
          <RecurringSpend transactions={transactions} />
        </Reveal>

        {investments.length > 0 && (
          <Reveal>
            <PortfolioSnapshot investments={investments} />
          </Reveal>
        )}
        {statementImportEnabled && (
          <Reveal>
            <StatementImportButton variant="card" />
          </Reveal>
        )}
        <Reveal>
          <RecentTransactions transactions={transactions} />
        </Reveal>
      </div>
    </>
  );
};

export default Dashboard;
