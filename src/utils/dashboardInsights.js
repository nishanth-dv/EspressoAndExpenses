import { getMonthDelta, getBiggestExpense } from "./dashboardUtils";
import { subscriptionTotals } from "./subscriptionUtils";

const INR0 = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Ranked, actionable dashboard insights from the user's own data. Pure.
// kinds → tone: alert (red) · watch (amber) · good (green).
export function dashboardInsights({
  summary,
  allTransactions = [],
  budgets = {},
  subscriptions = [],
  upcomingIncome = null,
  balance = 0,
} = {}) {
  const out = [];
  const totalIncome = summary?.totalIncome || 0;
  const totalExpenses = summary?.totalExpenses || 0;

  // 1. Spending more than earning (this period).
  if (totalIncome > 0 && totalExpenses > totalIncome) {
    out.push({
      id: "overspend",
      kind: "alert",
      weight: 100,
      icon: "fa-triangle-exclamation",
      title: "Spending more than you earn",
      detail: `${INR0(totalExpenses - totalIncome)} over your income this period.`,
    });
  }

  // 2. Over / within total budget.
  const totalBudget = Object.values(budgets).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0,
  );
  if (totalBudget > 0) {
    if (totalExpenses > totalBudget) {
      out.push({
        id: "budget-over",
        kind: "alert",
        weight: 88,
        icon: "fa-gauge-high",
        title: "Over your total budget",
        detail: `${INR0(totalExpenses - totalBudget)} over the ${INR0(totalBudget)} you set.`,
      });
    } else {
      out.push({
        id: "budget-ok",
        kind: "good",
        weight: 34,
        icon: "fa-piggy-bank",
        title: "Within budget",
        detail: `${INR0(totalBudget - totalExpenses)} left of your ${INR0(totalBudget)} budget.`,
      });
    }
  }

  // 3. Pace vs last month.
  const md = getMonthDelta(allTransactions);
  if (md && md.lastTotal > 0) {
    const pct = Math.round(((md.thisTotal - md.lastTotal) / md.lastTotal) * 100);
    if (pct >= 15) {
      out.push({
        id: "pace-up",
        kind: "watch",
        weight: 72,
        icon: "fa-arrow-trend-up",
        title: `Spending ${pct}% more than last month`,
        detail: `${INR0(md.thisTotal)} so far vs ${INR0(md.lastTotal)}.`,
      });
    } else if (pct <= -15) {
      out.push({
        id: "pace-down",
        kind: "good",
        weight: 42,
        icon: "fa-arrow-trend-down",
        title: `Spending ${Math.abs(pct)}% less than last month`,
        detail: `Nice restraint — ${INR0(md.thisTotal)} vs ${INR0(md.lastTotal)}.`,
      });
    }
  }

  // 4. Upcoming income (after-payday heads-up).
  if (upcomingIncome?.pendingThisMonth > 0 && upcomingIncome.next) {
    out.push({
      id: "payday",
      kind: "good",
      weight: 60,
      icon: "fa-sack-dollar",
      title: `${INR0(upcomingIncome.pendingThisMonth)} income still expected`,
      detail: `Around ${upcomingIncome.next.date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })} → balance ~${INR0(balance + upcomingIncome.pendingThisMonth)}.`,
    });
  }

  // 5. Biggest expense unusually large (>25% of the period's spend).
  const biggest = getBiggestExpense(allTransactions);
  if (biggest && totalExpenses > 0) {
    const amt = parseFloat(biggest.amount) || 0;
    if (amt > 0.25 * totalExpenses) {
      out.push({
        id: "biggest",
        kind: "watch",
        weight: 54,
        icon: "fa-receipt",
        title: `${biggest.name} was a big hit`,
        detail: `${INR0(amt)} — ${Math.round((amt / totalExpenses) * 100)}% of this period's spend.`,
      });
    }
  }

  // 6. Subscription creep — monthly subs over 15% of monthly spend.
  const sub = subscriptionTotals(subscriptions);
  if (sub.monthly > 0 && totalExpenses > 0 && sub.monthly > 0.15 * totalExpenses) {
    out.push({
      id: "sub-creep",
      kind: "watch",
      weight: 50,
      icon: "fa-rotate",
      title: "Subscriptions are adding up",
      detail: `${INR0(sub.monthly)}/mo across ${sub.count} — ${INR0(sub.yearly)}/yr.`,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
