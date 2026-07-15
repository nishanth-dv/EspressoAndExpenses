// Icon + accent for a spending/income category, so the ledger can render a
// colored avatar per transaction. Curated for the built-in categories; unknown
// (user-added) categories fall back to a neutral receipt glyph, or a green
// wallet for income so inflows always read green.

const MAP = {
  Food: { icon: "fa-utensils", color: "#f59e0b" },
  Bills: { icon: "fa-file-invoice-dollar", color: "#6366f1" },
  Utilities: { icon: "fa-bolt", color: "#eab308" },
  Transport: { icon: "fa-bus", color: "#0ea5e9" },
  Fuel: { icon: "fa-gas-pump", color: "#ef4444" },
  Shopping: { icon: "fa-bag-shopping", color: "#ec4899" },
  Entertainment: { icon: "fa-clapperboard", color: "#a855f7" },
  Rent: { icon: "fa-house", color: "#14b8a6" },
  Repayment: { icon: "fa-rotate-left", color: "#8b5cf6" },
  Investment: { icon: "fa-chart-line", color: "#5b8dee" },
  Subscription: { icon: "fa-repeat", color: "#f97316" },
  "Late penalty": { icon: "fa-triangle-exclamation", color: "#ef4444" },
  // Investment ledger categories (SIP instalments, LIC premiums, fund buys) —
  // so investment rows keep a meaningful icon without the investments list.
  SIP: { icon: "fa-chart-line", color: "#5b8dee" },
  LIC: { icon: "fa-umbrella", color: "#5b8dee" },
  Stock: { icon: "fa-arrow-trend-up", color: "#5b8dee" },
  ETF: { icon: "fa-layer-group", color: "#5b8dee" },
  "Mutual Fund": { icon: "fa-chart-pie", color: "#5b8dee" },
  FD: { icon: "fa-building-columns", color: "#5b8dee" },
  RD: { icon: "fa-piggy-bank", color: "#5b8dee" },
  Gold: { icon: "fa-coins", color: "#eab308" },
  NPS: { icon: "fa-user-shield", color: "#5b8dee" },
  PPF: { icon: "fa-landmark", color: "#5b8dee" },
  APY: { icon: "fa-umbrella-beach", color: "#5b8dee" },
  // Income
  Salary: { icon: "fa-wallet", color: "#16a34a" },
  Freelance: { icon: "fa-laptop-code", color: "#16a34a" },
  Dividends: { icon: "fa-coins", color: "#16a34a" },
  Interest: { icon: "fa-piggy-bank", color: "#16a34a" },
  Business: { icon: "fa-briefcase", color: "#16a34a" },
  Gift: { icon: "fa-gift", color: "#ec4899" },
  Refund: { icon: "fa-arrow-rotate-left", color: "#16a34a" },
  "Current Balance": { icon: "fa-scale-balanced", color: "#16a34a" },
};

const DEFAULT_EXPENSE = { icon: "fa-receipt", color: "#94a3b8" };
const DEFAULT_INCOME = { icon: "fa-wallet", color: "#16a34a" };

export function categoryVisual(category, transactionType) {
  const hit = MAP[category];
  if (hit) return { ...hit, iconStyle: "fa-solid" };
  const base = transactionType === "income" ? DEFAULT_INCOME : DEFAULT_EXPENSE;
  return { ...base, iconStyle: "fa-solid" };
}
