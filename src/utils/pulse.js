// Per-transaction "Pulse" — contextual intelligence derived entirely from the
// user's own ledger (no network, no LLM). Given one transaction, it answers:
// how often do I do this, is this amount normal for me, and what does it do to
// my budget. Consumed by the expanded TransactionCard.

const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
const dateOf = (t) => new Date(t.occurredAt || t.createdAt);
const amt = (t) => parseFloat(t.amount) || 0;
const norm = (t) => (t.name || t.source || "").trim().toLowerCase();

function ordinalWord(n) {
  const words = [
    "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
  ];
  return words[n - 1] || `${n}th`;
}

// Returns null when there's nothing meaningful to show (transfers, blank).
export function computePulse(tx, all = [], budgets = {}, now = new Date()) {
  if (!tx || tx.transactionType === "self_transfer") return null;
  const type = tx.transactionType;
  const label = (tx.name || tx.source || "").trim();
  const key = label.toLowerCase();
  const amount = amt(tx);
  const thisMonth = monthKey(dateOf(tx));

  // Cohort: prior/other transactions with the same normalized merchant + type.
  const cohort = key
    ? all.filter(
        (t) => t.id !== tx.id && t.transactionType === type && norm(t) === key,
      )
    : [];

  // Occurrences this calendar month (including this one), and this txn's
  // chronological position among them.
  const monthCohort = [tx, ...cohort].filter(
    (t) => monthKey(dateOf(t)) === thisMonth,
  );
  const ordinal =
    monthCohort
      .slice()
      .sort((a, b) => dateOf(a) - dateOf(b))
      .findIndex((t) => t.id === tx.id) + 1;
  const monthTotal = monthCohort.reduce((s, t) => s + amt(t), 0);

  // How this amount compares to the user's usual for this merchant (mean of the
  // rest). Needs at least 2 priors so a single outlier doesn't set "usual".
  let vsUsual = null;
  if (cohort.length >= 2 && amount > 0) {
    const usual = cohort.reduce((s, t) => s + amt(t), 0) / cohort.length;
    if (usual > 0) {
      vsUsual = { usual, pct: Math.round(((amount - usual) / usual) * 100) };
    }
  }

  // Budget impact (expense only) for this transaction's category this month,
  // plus a forward-looking "safe to spend" forecast when it's the live month.
  let budget = null;
  if (type === "expense" && tx.category && budgets[tx.category] > 0) {
    const spent = all
      .filter(
        (t) =>
          t.transactionType === "expense" &&
          t.category === tx.category &&
          monthKey(dateOf(t)) === thisMonth,
      )
      .reduce((s, t) => s + amt(t), 0);
    const limit = budgets[tx.category];
    budget = {
      spent,
      limit,
      pct: Math.round((spent / limit) * 100),
      remaining: limit - spent,
    };
    // Forecast only makes sense for the CURRENT month (a past month is settled).
    if (thisMonth === monthKey(now)) {
      const daysInMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
      ).getDate();
      const daysElapsed = now.getDate();
      const daysLeft = daysInMonth - daysElapsed;
      budget.projected =
        daysElapsed > 0 ? Math.round((spent / daysElapsed) * daysInMonth) : spent;
      budget.projectedPct = Math.round((budget.projected / limit) * 100);
      budget.daysLeft = daysLeft;
      budget.dailyAllowance =
        daysLeft > 0 ? Math.max(0, Math.round((limit - spent) / daysLeft)) : 0;
    }
  }

  // One derived headline — a genuinely useful fact, not a quip.
  let headline = null;
  if (budget) {
    if (budget.remaining <= 0) {
      headline = `Over your ${tx.category} budget by ₹${Math.round(-budget.remaining).toLocaleString("en-IN")} this month`;
    } else if (amount > 0) {
      const more = Math.floor(budget.remaining / amount);
      headline =
        more <= 0
          ? `This tips you to ${budget.pct}% of your ${tx.category} budget`
          : `${more} more like this reaches your ${tx.category} budget`;
    }
  } else if (vsUsual && Math.abs(vsUsual.pct) >= 25) {
    headline =
      vsUsual.pct > 0
        ? `Pricier than your usual ${label} run`
        : `Cheaper than your usual ${label} run`;
  }

  // Expense in a category with no budget set → we can nudge the user to set one
  // to unlock the Safe-to-Spend forecast.
  const budgetNudge =
    type === "expense" && !!tx.category && !(budgets[tx.category] > 0);

  return {
    label,
    type,
    ordinal,
    ordinalWord: ordinalWord(ordinal),
    monthCount: monthCohort.length,
    monthTotal,
    vsUsual,
    budget,
    budgetNudge,
    headline,
    isFirst: cohort.length === 0,
  };
}

// All-time stats for a merchant (same normalized name + same type), powering
// the Merchant history sheet opened from the ledger avatar.
export function computeMerchantStats(tx, all = [], now = new Date()) {
  const label = (tx?.name || tx?.source || "").trim();
  const key = label.toLowerCase();
  if (!key) return null;
  const type = tx.transactionType;
  const rows = all.filter((t) => t.transactionType === type && norm(t) === key);
  if (rows.length === 0) return null;

  const total = rows.reduce((s, t) => s + amt(t), 0);
  const times = rows.map((t) => dateOf(t).getTime()).sort((a, b) => a - b);

  // Trailing 6-month spend bars.
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKey(d);
    const mTotal = rows
      .filter((t) => monthKey(dateOf(t)) === k)
      .reduce((s, t) => s + amt(t), 0);
    months.push({
      key: k,
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      total: mTotal,
    });
  }

  const catCount = {};
  for (const t of rows) {
    if (t.category) catCount[t.category] = (catCount[t.category] ?? 0) + 1;
  }
  const topCategory =
    Object.entries(catCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    label,
    type,
    count: rows.length,
    total,
    avg: total / rows.length,
    first: new Date(times[0]),
    last: new Date(times[times.length - 1]),
    months,
    topCategory,
  };
}
