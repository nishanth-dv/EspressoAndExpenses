// ── Monthly income baseline: single source of truth ──────────────────────
// Metrics like Cash flow and income coverage need a "monthly income" figure
// that DOESN'T collapse to ~0 early in the month just because a salaried user's
// pay lands on the last day. This resolves one stable figure by classifying
// each income STREAM (per category) and modelling it appropriately:
//   • regular streams (Salary/Rent, or low-variance recurring income) are
//     PROJECTED at their typical monthly amount — counted even before this
//     month's credit lands;
//   • irregular streams (Business/Freelance/etc.) use a trailing average over
//     the months elapsed, so lumpy income is spread out.
// A "mixed" user (salary + side business) is handled for free — per stream.
// `incomeType` ("auto" | "salaried" | "business") lets the user override the
// per-stream classification globally.

export const INCOME_TYPES = [
  {
    key: "auto",
    label: "Auto-detect",
    blurb: "Classify each income source from your history (best for most).",
  },
  {
    key: "salaried",
    label: "Salaried",
    blurb: "Regular monthly pay — use the expected amount even before it lands.",
  },
  {
    key: "business",
    label: "Business / variable",
    blurb: "Irregular income — use a rolling average of recent months.",
  },
];

const WINDOW_MONTHS = 6;
// Categories that are inherently regular/monthly.
const REGULAR_CATEGORIES = new Set(["Salary", "Rent"]);

function txTime(t) {
  return new Date(t.occurredAt || t.createdAt).getTime();
}

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isIncome(t) {
  // Exclude borrowings (not income) and the synthetic opening "Current Balance"
  // entries (they're stored as income but are a starting balance, not earnings).
  return (
    t.transactionType === "income" && !t.lendingId && !t.openingForAccount
  );
}

function classifyRegular(category, monthlyTotals, incomeType) {
  if (incomeType === "salaried") return true;
  if (incomeType === "business") return false;
  if (REGULAR_CATEGORIES.has(category)) return true;
  if (monthlyTotals.length < 3) return false; // too little history to call regular
  const mean = monthlyTotals.reduce((s, v) => s + v, 0) / monthlyTotals.length;
  if (mean <= 0) return false;
  const variance =
    monthlyTotals.reduce((s, v) => s + (v - mean) ** 2, 0) /
    monthlyTotals.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  return cv < 0.2; // consistent amount across ≥3 months → regular
}

// Returns { monthly, projected, actualThisMonth, streams }.
// `monthly` is what metrics should use: max(projected, actual-this-month) so a
// bonus month isn't understated and a not-yet-credited month isn't zeroed.
export function resolveMonthlyIncome(
  transactions = [],
  { now = new Date(), incomeType = "auto", excludeCategories = [] } = {},
) {
  const windowStart = new Date(
    now.getFullYear(),
    now.getMonth() - (WINDOW_MONTHS - 1),
    1,
  ).getTime();
  const nowMs = now.getTime();
  const curKey = `${now.getFullYear()}-${now.getMonth()}`;
  // Categories the user has flagged as "don't count as income" (refunds,
  // reimbursements, one-offs, …) — kept out of the baseline entirely.
  const excluded = new Set(excludeCategories);

  const incomes = transactions.filter((t) => {
    if (!isIncome(t)) return false;
    if (excluded.has(t.category)) return false;
    const ts = txTime(t);
    return Number.isFinite(ts) && ts >= windowStart && ts <= nowMs;
  });
  if (incomes.length === 0) {
    return { monthly: 0, projected: 0, actualThisMonth: 0, streams: [] };
  }

  // Months elapsed since the earliest income in the window (capped at the
  // window) — the divisor for spreading irregular income, so dry months count.
  const firstMs = Math.min(...incomes.map(txTime));
  const firstD = new Date(firstMs);
  const elapsed =
    (now.getFullYear() - firstD.getFullYear()) * 12 +
    (now.getMonth() - firstD.getMonth()) +
    1;
  const effectiveMonths = Math.min(WINDOW_MONTHS, Math.max(1, elapsed));

  const byStream = new Map();
  for (const t of incomes) {
    const key = t.category || "Other";
    if (!byStream.has(key)) byStream.set(key, []);
    byStream.get(key).push(t);
  }

  let projected = 0;
  let actualThisMonth = 0;
  const streams = [];
  for (const [category, txns] of byStream) {
    const byMonth = new Map();
    for (const t of txns) {
      const d = new Date(txTime(t));
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      byMonth.set(k, (byMonth.get(k) || 0) + (parseFloat(t.amount) || 0));
    }
    const monthlyTotals = [...byMonth.values()];
    const sum = monthlyTotals.reduce((s, v) => s + v, 0);
    const regular = classifyRegular(category, monthlyTotals, incomeType);
    // Regular streams (salary/rent): average the months we actually have, so a
    // raise or any month-to-month variation is reflected rather than being
    // pinned to a single middle month (median under-reported a rising salary).
    // Irregular streams: spread the total across months elapsed (incl. dry ones).
    const value = regular
      ? sum / monthlyTotals.length
      : sum / effectiveMonths;

    projected += value;
    actualThisMonth += byMonth.get(curKey) || 0;
    // Per-month buckets (chronological) so consumers can show a transparent
    // breakdown and spot two credits that landed in the same month.
    const months = [...byMonth.entries()]
      .map(([k, total]) => {
        const [yr, mo] = k.split("-").map(Number);
        return { key: k, year: yr, month: mo, total };
      })
      .sort((a, b) => a.year - b.year || a.month - b.month);
    streams.push({ category, regular, value, months });
  }

  return {
    monthly: Math.max(projected, actualThisMonth),
    projected,
    actualThisMonth,
    streams,
  };
}

// Optimistic outlook: the income still EXPECTED to land this month. For each
// regular stream (e.g. salary) that hasn't been credited yet this month, we
// infer its typical credit day from history — the median day-of-month of past
// credits, falling back to the last day of the month — and project it there at
// the stream's usual amount. Consumers use `pendingThisMonth` to pre-credit an
// "after-payday" figure, and `next` for the dated headline.
//
// Returns { pendingThisMonth, next: { category, amount, date } | null, upcoming }.
export function projectUpcomingIncome(
  transactions = [],
  { now = new Date(), incomeType = "auto", excludeCategories = [] } = {},
) {
  const { streams } = resolveMonthlyIncome(transactions, {
    now,
    incomeType,
    excludeCategories,
  });
  const excluded = new Set(excludeCategories);
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = new Date(y, m, now.getDate());
  const monthEndDay = new Date(y, m + 1, 0).getDate();
  const curKey = `${y}-${m}`;

  const upcoming = [];
  for (const s of streams) {
    if (!s.regular || s.value <= 0) continue;
    const txns = transactions.filter(
      (t) =>
        isIncome(t) &&
        !excluded.has(t.category) &&
        (t.category || "Other") === s.category,
    );
    // Already received this month → not "upcoming".
    const received = txns.some((t) => {
      const d = new Date(txTime(t));
      return `${d.getFullYear()}-${d.getMonth()}` === curKey;
    });
    if (received) continue;
    // Credit day: median day-of-month from history, else the last day.
    const days = txns
      .map((t) => new Date(txTime(t)).getDate())
      .filter((n) => n > 0);
    const creditDay = days.length ? Math.round(median(days)) : monthEndDay;
    const date = new Date(y, m, Math.min(creditDay, monthEndDay));
    upcoming.push({ category: s.category, amount: s.value, date });
  }
  upcoming.sort((a, b) => a.date - b.date);
  const pendingThisMonth = upcoming.reduce((sum, u) => sum + u.amount, 0);
  // Optimistic: even if the usual day just passed without posting, we still
  // expect it this month — so prefer the next future credit, else the soonest.
  const next = upcoming.find((u) => u.date >= today) || upcoming[0] || null;
  return { pendingThisMonth, next, upcoming };
}
