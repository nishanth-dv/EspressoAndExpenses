export const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatShort(v) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}k`;
  return `₹${Math.round(v)}`;
}

function isInMonth(isoDate, year, month) {
  const d = new Date(isoDate);
  return d.getFullYear() === year && d.getMonth() === month;
}

function prevMonth(year, month) {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
}

export function getSummary(transactions, insights) {
  const totalIncome = transactions
    .filter((t) => t.transactionType === "income")
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalExpenses = transactions
    .filter((t) => t.transactionType === "expense")
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const balance = insights?.balance ?? 0;
  const savingsRate =
    totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0;
  return { balance, totalIncome, totalExpenses, savingsRate };
}

export function getMonthlyTrend(transactions, months = 6) {
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const label = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
    const income = transactions
      .filter((t) => t.transactionType === "income" && isInMonth(t.occurredAt, year, month))
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const expense = transactions
      .filter((t) => t.transactionType === "expense" && isInMonth(t.occurredAt, year, month))
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    return { month: label, income, expense };
  });
}

export function getCategoryBreakdown(transactions) {
  const spend = {};
  transactions
    .filter((t) => t.transactionType === "expense")
    .forEach((t) => {
      const cat = t.category || "Uncategorized";
      spend[cat] = (spend[cat] || 0) + parseFloat(t.amount);
    });
  const total = Object.values(spend).reduce((s, v) => s + v, 0);
  return Object.entries(spend)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({
      category,
      amount,
      pct: total > 0 ? Math.round((amount / total) * 100) : 0,
    }));
}

export function getPaymentSplit(transactions) {
  const split = {};
  transactions
    .filter((t) => t.transactionType === "expense")
    .forEach((t) => {
      const mode = t.paymentMode || "Unknown";
      split[mode] = (split[mode] || 0) + parseFloat(t.amount);
    });
  const total = Object.values(split).reduce((s, v) => s + v, 0);
  return Object.entries(split)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, amount]) => ({
      mode,
      amount,
      pct: total > 0 ? Math.round((amount / total) * 100) : 0,
    }));
}

export function getDailyAverage(transactions) {
  const expenses = transactions.filter((t) => t.transactionType === "expense");
  if (expenses.length === 0) return { avg: 0, days: 0 };
  const oldest = expenses.reduce(
    (min, t) => (t.occurredAt < min ? t.occurredAt : min),
    expenses[0].occurredAt
  );
  const days = Math.max(
    1,
    Math.ceil((Date.now() - new Date(oldest)) / (1000 * 60 * 60 * 24))
  );
  const total = expenses.reduce((s, t) => s + parseFloat(t.amount), 0);
  return { avg: total / days, days };
}

export function getMonthDelta(transactions) {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();
  const { year: ly, month: lm } = prevMonth(cy, cm);

  const thisMonth = transactions.filter(
    (t) => t.transactionType === "expense" && isInMonth(t.occurredAt, cy, cm)
  );
  const lastMonth = transactions.filter(
    (t) => t.transactionType === "expense" && isInMonth(t.occurredAt, ly, lm)
  );

  const thisTotal = thisMonth.reduce((s, t) => s + parseFloat(t.amount), 0);
  const lastTotal = lastMonth.reduce((s, t) => s + parseFloat(t.amount), 0);
  const delta = lastTotal > 0 ? ((thisTotal - lastTotal) / lastTotal) * 100 : null;

  const cats = new Set([
    ...thisMonth.map((t) => t.category || "Uncategorized"),
    ...lastMonth.map((t) => t.category || "Uncategorized"),
  ]);
  const byCategory = Array.from(cats)
    .map((cat) => {
      const thisAmt = thisMonth
        .filter((t) => (t.category || "Uncategorized") === cat)
        .reduce((s, t) => s + parseFloat(t.amount), 0);
      const lastAmt = lastMonth
        .filter((t) => (t.category || "Uncategorized") === cat)
        .reduce((s, t) => s + parseFloat(t.amount), 0);
      return {
        category: cat,
        thisMonth: thisAmt,
        lastMonth: lastAmt,
        delta: lastAmt > 0 ? ((thisAmt - lastAmt) / lastAmt) * 100 : null,
      };
    })
    .sort((a, b) => b.thisMonth - a.thisMonth);

  return { thisTotal, lastTotal, delta, byCategory };
}

export function getBiggestExpense(transactions) {
  const now = new Date();
  const thisMonth = transactions.filter(
    (t) =>
      t.transactionType === "expense" &&
      isInMonth(t.occurredAt, now.getFullYear(), now.getMonth())
  );
  if (thisMonth.length === 0) return null;
  return thisMonth.reduce(
    (max, t) => (parseFloat(t.amount) > parseFloat(max.amount) ? t : max),
    thisMonth[0]
  );
}

export function getDayOfWeekData(transactions) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const totals = [0, 0, 0, 0, 0, 0, 0];
  transactions
    .filter((t) => t.transactionType === "expense")
    .forEach((t) => {
      totals[new Date(t.occurredAt).getDay()] += parseFloat(t.amount);
    });
  const max = Math.max(...totals, 1);
  return DAYS.map((day, i) => ({
    day,
    amount: totals[i],
    intensity: totals[i] / max,
  }));
}

export function getRecurringSpend(transactions) {
  const grouped = {};
  transactions
    .filter((t) => t.transactionType === "expense")
    .forEach((t) => {
      const key = t.name?.toLowerCase().trim();
      if (!key) return;
      if (!grouped[key]) grouped[key] = { name: t.name, count: 0, total: 0 };
      grouped[key].count++;
      grouped[key].total += parseFloat(t.amount);
    });
  return Object.values(grouped)
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.count - a.count);
}

export function getSpendingVelocity(transactions) {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();
  const { year: ly, month: lm } = prevMonth(cy, cm);

  const thisTotal = transactions
    .filter((t) => t.transactionType === "expense" && isInMonth(t.occurredAt, cy, cm))
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const lastTotal = transactions
    .filter((t) => t.transactionType === "expense" && isInMonth(t.occurredAt, ly, lm))
    .reduce((s, t) => s + parseFloat(t.amount), 0);

  const daysElapsed = now.getDate();
  const daysInMonth = new Date(cy, cm + 1, 0).getDate();
  const projected =
    daysElapsed > 0 ? (thisTotal / daysElapsed) * daysInMonth : 0;
  const vsLastMonth =
    lastTotal > 0 ? ((projected - lastTotal) / lastTotal) * 100 : null;

  return { projected, vsLastMonth, daysElapsed, daysInMonth };
}

export function getIncomeCoverage(transactions) {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();
  const income = transactions
    .filter((t) => t.transactionType === "income" && isInMonth(t.occurredAt, cy, cm))
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const expenses = transactions
    .filter((t) => t.transactionType === "expense" && isInMonth(t.occurredAt, cy, cm))
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  return {
    income,
    expenses,
    coverage: income > 0 ? (expenses / income) * 100 : null,
  };
}

export function getTransactionFrequency(transactions) {
  const expenses = transactions.filter((t) => t.transactionType === "expense");
  if (expenses.length === 0) return { txPerDay: 0, total: 0, days: 0 };
  const oldest = expenses.reduce(
    (min, t) => (t.occurredAt < min ? t.occurredAt : min),
    expenses[0].occurredAt
  );
  const days = Math.max(
    1,
    Math.ceil((Date.now() - new Date(oldest)) / (1000 * 60 * 60 * 24))
  );
  return { txPerDay: expenses.length / days, total: expenses.length, days };
}

export function getThisMonthCategorySpend(transactions) {
  const now = new Date();
  const spend = {};
  transactions
    .filter(
      (t) =>
        t.transactionType === "expense" &&
        isInMonth(t.occurredAt, now.getFullYear(), now.getMonth())
    )
    .forEach((t) => {
      const cat = t.category || "Uncategorized";
      spend[cat] = (spend[cat] || 0) + parseFloat(t.amount);
    });
  return spend;
}
