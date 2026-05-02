export const CATEGORIES = [
  "Food",
  "Bills",
  "Utilities",
  "Transport",
  "Fuel",
  "Shopping",
  "Entertainment",
  "Rent",
  "Other",
];

export const PAYMENT_MODES = ["Cash", "UPI", "Debit Card", "Credit Card", "Other"];

// subtype drives which form fields appear:
//   unit  → quantity + buyPrice + currentPrice
//   fixed → investedAmount + interestRate + tenureMonths  (value auto-calculated)
//   manual→ investedAmount + currentValue  (both manually entered)
export const INVESTMENT_TYPES = [
  // ── Equity / market-linked ───────────────────────────
  { key: "stock",       label: "Stocks",             subtype: "unit",   color: "#4a90d9", icon: "fa-chart-line" },
  { key: "mf",          label: "Mutual Fund",        subtype: "unit",   color: "#7abf8e", icon: "fa-seedling" },
  { key: "sip",         label: "SIP",                subtype: "manual", color: "#d4a35a", icon: "fa-rotate" },
  { key: "etf",         label: "ETF",                subtype: "unit",   color: "#9b8ea6", icon: "fa-layer-group" },
  // ── Fixed income ─────────────────────────────────────
  { key: "fd",          label: "Fixed Deposit",      subtype: "fixed",  color: "#5a9fd4", icon: "fa-building-columns" },
  { key: "rd",          label: "Recurring Deposit",  subtype: "fixed",  color: "#6abfa8", icon: "fa-piggy-bank" },
  { key: "ppf",         label: "PPF",                subtype: "manual", color: "#a8c55a", icon: "fa-landmark" },
  { key: "nps",         label: "NPS",                subtype: "manual", color: "#d48a5a", icon: "fa-user-shield" },
  { key: "bond",        label: "Bonds",              subtype: "fixed",  color: "#a88a6a", icon: "fa-file-contract" },
  // ── Alternatives ─────────────────────────────────────
  { key: "gold",        label: "Gold",               subtype: "unit",   color: "#d4c35a", icon: "fa-coins" },
  { key: "real_estate", label: "Real Estate",        subtype: "manual", color: "#8a9fd4", icon: "fa-house" },
  { key: "crypto",      label: "Crypto",             subtype: "unit",   color: "#d4735a", icon: "fa-bitcoin-sign" },
  { key: "other",       label: "Other",              subtype: "manual", color: "#808080", icon: "fa-wallet" },
];

export const DEFAULT_DATA = {
  meta: {
    createdAt: new Date().toISOString(),
    currency: "INR",
  },
  insights: {
    balance: 0,
    expenses: 0,
    investments: 0,
  },
  transactions: [],
  budgets: {},
  investments: [],
  goals: [],
};
