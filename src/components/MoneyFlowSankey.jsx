import { memo, useMemo } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import { Sankey, Tooltip, ResponsiveContainer, Rectangle } from "recharts";

// Builds a 3-tier Sankey: Income source (category) → Bank → Expense category.
// Only computed when multi-bank is enabled. Falls back gracefully when there
// aren't enough nodes to form an interesting flow.

function buildFlowData(accounts, transactions) {
  // Scope to the current calendar month so the chart stays readable.
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth();
  const inMonth = (t) => {
    if (!t.occurredAt) return false;
    const d = new Date(t.occurredAt);
    return d.getFullYear() === yr && d.getMonth() === mo;
  };

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const incomeByAccount = new Map(); // accountId → Map(incomeCategory → amt)
  const expenseByAccount = new Map(); // accountId → Map(expenseCategory → amt)
  const totalIncomePerAccount = new Map();
  const totalExpensePerAccount = new Map();

  for (const t of transactions) {
    if (!inMonth(t)) continue;
    if (!t.accountId) continue;
    if (!accountById.has(t.accountId)) continue;
    const amt = parseFloat(t.amount) || 0;
    if (amt <= 0) continue;
    const cat = t.category || "Other";
    if (t.transactionType === "income") {
      const m = incomeByAccount.get(t.accountId) ?? new Map();
      m.set(cat, (m.get(cat) || 0) + amt);
      incomeByAccount.set(t.accountId, m);
      totalIncomePerAccount.set(
        t.accountId,
        (totalIncomePerAccount.get(t.accountId) || 0) + amt,
      );
    } else if (t.transactionType === "expense" && !t.cardId) {
      const m = expenseByAccount.get(t.accountId) ?? new Map();
      m.set(cat, (m.get(cat) || 0) + amt);
      expenseByAccount.set(t.accountId, m);
      totalExpensePerAccount.set(
        t.accountId,
        (totalExpensePerAccount.get(t.accountId) || 0) + amt,
      );
    }
  }

  // Only include accounts that have at least some flow.
  const activeAccounts = accounts.filter(
    (a) =>
      (totalIncomePerAccount.get(a.id) || 0) > 0 ||
      (totalExpensePerAccount.get(a.id) || 0) > 0,
  );
  if (activeAccounts.length === 0) return null;

  // Collect unique income / expense categories.
  const incomeCats = new Set();
  const expenseCats = new Set();
  for (const m of incomeByAccount.values())
    for (const k of m.keys()) incomeCats.add(k);
  for (const m of expenseByAccount.values())
    for (const k of m.keys()) expenseCats.add(k);

  // Nodes ordered: income categories → accounts → expense categories
  const nodes = [];
  const incomeNodeIdx = new Map();
  for (const c of incomeCats) {
    incomeNodeIdx.set(c, nodes.length);
    nodes.push({ name: c, kind: "income" });
  }
  const accountNodeIdx = new Map();
  for (const a of activeAccounts) {
    accountNodeIdx.set(a.id, nodes.length);
    nodes.push({ name: a.bank, kind: "account", color: a.color });
  }
  const expenseNodeIdx = new Map();
  for (const c of expenseCats) {
    expenseNodeIdx.set(c, nodes.length);
    nodes.push({ name: c, kind: "expense" });
  }

  const links = [];
  // Income → Account links
  for (const [accId, m] of incomeByAccount.entries()) {
    for (const [cat, amt] of m.entries()) {
      links.push({
        source: incomeNodeIdx.get(cat),
        target: accountNodeIdx.get(accId),
        value: amt,
      });
    }
  }
  // Account → Expense links
  for (const [accId, m] of expenseByAccount.entries()) {
    for (const [cat, amt] of m.entries()) {
      links.push({
        source: accountNodeIdx.get(accId),
        target: expenseNodeIdx.get(cat),
        value: amt,
      });
    }
  }

  // Sankey requires every node to be part of at least one link AND a path.
  // If links is empty, return null.
  if (links.length === 0) return null;
  return { nodes, links };
}

// Custom node renderer — colors account nodes by their account color and
// shows the label inline. Recharts ships a default but the custom one lets
// us color-code the bank nodes consistently with the rest of the app.
function FlowNode({ x, y, width, height, payload }) {
  const isAccount = payload.kind === "account";
  const fill = isAccount
    ? payload.color || "#5b8dee"
    : payload.kind === "income"
      ? "#16a34a"
      : "#ef4444";
  return (
    <g>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.85}
      />
      <text
        x={x < 200 ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={x < 200 ? "start" : "end"}
        dominantBaseline="middle"
        fontSize={11}
        fill="currentColor"
        opacity={0.85}
      >
        {payload.name}
      </text>
    </g>
  );
}

FlowNode.propTypes = {
  x: PropTypes.number,
  y: PropTypes.number,
  width: PropTypes.number,
  height: PropTypes.number,
  payload: PropTypes.object,
};

const MoneyFlowSankey = () => {
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );

  const data = useMemo(
    () =>
      multiBankEnabled && accounts.length > 0
        ? buildFlowData(accounts, allTransactions)
        : null,
    [multiBankEnabled, accounts, allTransactions],
  );

  if (!multiBankEnabled) return null;
  if (!data) {
    return (
      <div className="dash-section money-flow money-flow--empty">
        <p className="dash-section-title">Money flow · this month</p>
        <p className="money-flow-empty">
          No tagged income or expense this month yet. Tag a few transactions
          to a bank and they&apos;ll start showing up here.
        </p>
      </div>
    );
  }

  return (
    <div className="dash-section money-flow">
      <p className="dash-section-title">Money flow · this month</p>
      <p className="money-flow-sub">
        Income source → bank → spending category
      </p>
      <ResponsiveContainer width="100%" height={Math.max(220, data.nodes.length * 22)}>
        <Sankey
          data={data}
          nodePadding={18}
          nodeWidth={14}
          margin={{ top: 10, right: 100, bottom: 10, left: 100 }}
          link={{ stroke: "#888", strokeOpacity: 0.18 }}
          node={<FlowNode />}
        >
          <Tooltip
            formatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
            contentStyle={{
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border-open)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
};

export default memo(MoneyFlowSankey);
