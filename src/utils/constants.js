export const CATEGORIES = [
  "Food",
  "Bills",
  "Utilities",
  "Transport",
  "Fuel",
  "Shopping",
  "Entertainment",
  "Rent",
  "Repayment",
  "Investment",
  "Other",
];

export const INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Rent",
  "Dividends",
  "Interest",
  "Business",
  "Gift",
  "Refund",
  "Other",
];

export const PAYMENT_MODES = [
  "Cash",
  "UPI",
  "Debit Card",
  "Credit Card",
  "Other",
];

// subtype drives which form fields appear:
//   unit  → quantity + buyPrice + currentPrice
//   fixed → investedAmount + interestRate + tenureMonths  (value auto-calculated)
//   manual→ investedAmount + currentValue  (both manually entered)
export const INVESTMENT_TYPES = [
  // ── Equity / market-linked ───────────────────────────
  {
    key: "stock",
    label: "Stocks",
    subtype: "unit",
    color: "#4a90d9",
    icon: "fa-chart-line",
  },
  {
    key: "mf",
    label: "Mutual Fund",
    subtype: "unit",
    color: "#7abf8e",
    icon: "fa-seedling",
  },
  {
    key: "sip",
    label: "SIP",
    subtype: "unit",
    color: "#d4a35a",
    icon: "fa-rotate",
  },
  {
    key: "etf",
    label: "ETF",
    subtype: "unit",
    color: "#9b8ea6",
    icon: "fa-layer-group",
  },
  // ── Fixed income ─────────────────────────────────────
  {
    key: "fd",
    label: "Fixed Deposit",
    subtype: "fixed",
    color: "#5a9fd4",
    icon: "fa-building-columns",
  },
  {
    key: "rd",
    label: "Recurring Deposit",
    subtype: "fixed",
    color: "#6abfa8",
    icon: "fa-piggy-bank",
  },
  {
    key: "ppf",
    label: "PPF",
    subtype: "manual",
    color: "#a8c55a",
    icon: "fa-landmark",
    // PPF rules: one account per individual at any time.
    singleton: true,
  },
  {
    key: "nps",
    label: "NPS",
    subtype: "manual",
    color: "#d48a5a",
    icon: "fa-user-shield",
    // NPS Tier 1: one PRAN per individual.
    singleton: true,
  },
  {
    key: "lic",
    label: "LIC",
    subtype: "fixed",
    color: "#e07b3a",
    icon: "fa-shield-halved",
  },
  {
    key: "plan",
    label: "Savings Plan",
    subtype: "fixed",
    color: "#5abfa8",
    icon: "fa-hand-holding-dollar",
  },
  {
    key: "bond",
    label: "Bonds",
    subtype: "fixed",
    color: "#a88a6a",
    icon: "fa-file-contract",
  },
  // ── Alternatives ─────────────────────────────────────
  {
    key: "gold",
    label: "Gold",
    subtype: "unit",
    color: "#d4c35a",
    icon: "fa-coins",
  },
  {
    key: "real_estate",
    label: "Real Estate",
    subtype: "manual",
    color: "#8a9fd4",
    icon: "fa-house",
  },
  {
    key: "crypto",
    label: "Crypto",
    subtype: "unit",
    color: "#d4735a",
    icon: "fa-bitcoin-sign",
  },
  {
    key: "other",
    label: "Other",
    subtype: "manual",
    color: "#808080",
    icon: "fa-wallet",
  },
];

export const EQUITY_SECTORS = [
  "Technology", "Banking & Finance", "Healthcare", "FMCG",
  "Auto", "Energy", "Infrastructure", "Metals & Mining",
  "Telecom", "Diversified", "Other",
];

export const MF_CATEGORIES = [
  "Large Cap", "Mid Cap", "Small Cap", "Large & Mid Cap",
  "Flexi Cap", "Multi Cap", "ELSS", "Debt", "Hybrid",
  "Index Fund", "Sector Fund", "Other",
];

export const AUTO_CATEGORY_MAP = {
  gold:        { label: "Commodities",  color: "#d4c35a" },
  real_estate: { label: "Real Estate",  color: "#8a9fd4" },
  crypto:      { label: "Crypto",       color: "#d4735a" },
  fd:          { label: "Fixed Income", color: "#5a9fd4" },
  rd:          { label: "Fixed Income", color: "#5a9fd4" },
  ppf:         { label: "Fixed Income", color: "#a8c55a" },
  nps:         { label: "Fixed Income", color: "#d48a5a" },
  lic:         { label: "Fixed Income", color: "#e07b3a" },
  bond:        { label: "Fixed Income", color: "#a88a6a" },
  plan:        { label: "Fixed Income", color: "#5abfa8" },
};

export const CATEGORY_COLOR_PALETTE = {
  "Technology":        "#4a90d9",
  "Banking & Finance": "#7abf8e",
  "Healthcare":        "#e07b3a",
  "FMCG":              "#d4a35a",
  "Auto":              "#9b8ea6",
  "Energy":            "#d4735a",
  "Infrastructure":    "#5abfa8",
  "Metals & Mining":   "#a88a6a",
  "Telecom":           "#d4c35a",
  "Diversified":       "#8a9fd4",
  "Large Cap":         "#4a90d9",
  "Mid Cap":           "#7abf8e",
  "Small Cap":         "#d4a35a",
  "Large & Mid Cap":   "#9b8ea6",
  "Flexi Cap":         "#5abfa8",
  "Multi Cap":         "#d4c35a",
  "ELSS":              "#d4735a",
  "Debt":              "#5a9fd4",
  "Hybrid":            "#e07b3a",
  "Index Fund":        "#8a9fd4",
  "Sector Fund":       "#c45858",
  "Other":             "#808080",
};

export const CARD_COLORS = [
  "#4a90d9",
  "#7abf8e",
  "#d4a35a",
  "#9b8ea6",
  "#d4735a",
  "#5abfa8",
  "#d4c35a",
  "#e07b3a",
  "#5b8dee",
  "#c45858",
];

export const BANKS = [
  "HDFC", "ICICI", "SBI", "Axis", "Kotak", "IDFC", "Yes Bank",
  "IndusInd", "Amex", "Citi", "Standard Chartered", "RBL", "Other",
];

export const DEFAULT_HEALTH_SCORE = {
  // Utilization brackets and their penalty points.
  utilThresholds: [
    { upTo: 0.3, penalty: 0 },
    { upTo: 0.5, penalty: 10 },
    { upTo: 0.7, penalty: 20 },
    { upTo: 0.9, penalty: 30 },
    { upTo: 1.01, penalty: 40 },
  ],
  // Net-borrowing penalty: floor(net / borrowingChunk) * borrowingStep, capped at borrowingCap.
  borrowingChunk: 10000,
  borrowingStep: 2,
  borrowingCap: 25,
  // Overdue thresholds (days past due that count as overdue).
  overdueDays: 3,
  commitmentOverduePerItem: 7,
  commitmentOverdueCap: 20,
  cardOverduePerItem: 7,
  cardOverdueCap: 15,
  // Grade boundaries.
  grades: [
    { atLeast: 80, label: "Excellent", color: "#34d17b" },
    { atLeast: 65, label: "Good", color: "#a8c55a" },
    { atLeast: 50, label: "Fair", color: "#d4a35a" },
    { atLeast: 30, label: "Poor", color: "#d4735a" },
    { atLeast: 0, label: "Critical", color: "#c45858" },
  ],
};

export const DEFAULT_DUE_WINDOWS = {
  upcomingDays: 30, // window for "Upcoming dues" list
  soonDays: 7,      // a due is "due soon" if within this many days
  overdueDays: 3,   // a due is "overdue" only after this many days past
};

export const DEFAULT_PREFERENCES = {
  fdRate: 7,
  inflationRate: 6,
  voiceAddEnabled: false,
  autoCategoryRules: [],
  privacyMode: false,
  multiBankEnabled: false,
  // Bank-statement importer. Off by default so the Add Investment +
  // Expenses pages stay uncluttered for users who don't need it. When
  // on, the import launcher shows on the Expenses page header and a
  // quick-action card on the Dashboard.
  statementImportEnabled: false,
  // Investment type keys the user has enabled. The Add Investment form
  // shows only these keys in its type-picker. Empty / undefined means
  // "all built-ins" — the migration in initializeDrive populates this
  // with the 16 built-in keys for new + existing users so the default
  // experience is unchanged.
  enabledInvestmentTypes: [],
  // User-defined order of investment type keys. Drives both the
  // Preferences flat list and the Add Investment picker so the order
  // stays consistent. New keys (added via Discover or custom design)
  // append to the end on first sight.
  investmentTypeOrder: [],
  healthScore: { ...DEFAULT_HEALTH_SCORE },
  dueWindows: { ...DEFAULT_DUE_WINDOWS },
};

export const DEFAULT_LISTS = {
  paymentModes: [...PAYMENT_MODES],
  banks: [...BANKS],
};

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
  preferences: { ...DEFAULT_PREFERENCES },
  categories: {
    expense: [...CATEGORIES],
    income: [...INCOME_CATEGORIES],
  },
  lists: {
    paymentModes: [...PAYMENT_MODES],
    banks: [...BANKS],
  },
  transactions: [],
  budgets: {},
  investments: [],
  goals: [],
  cards: [],
  commitments: [],
  lendings: [],
  // Bank accounts for the multi-bank tracking feature. Each entry:
  // { id, bank, color, openingBalance, openingDate,
  //   verifiedBalance?, verifiedAt?, archived?, createdAt }
  accounts: [],
  // Learned merchant aliases — populated by the statement importer when
  // the user corrects an auto-classification, or implicitly when they
  // accept an auto-pick by importing without changes. Each entry:
  //   { key, pattern, transactionType, category, paymentMode,
  //     hits, lastSeen, createdAt }
  // `pattern` is the canonical merchant fingerprint (see
  // utils/statementImport/fingerprint.js). Used to bias future imports
  // toward the user's previously-accepted choices.
  merchantAliases: [],
  // User-extended investment type schemas. The full schema spec lives in
  // src/utils/investmentTypeSchemas.js — built-ins are kept in code, not
  // persisted. Each entry here is either:
  //   • a brand-new custom type the user added (key starts with "custom-")
  //   • an override of a built-in type (matching key) carrying user-defined
  //     extra fields layered on top of the built-in's anchors
  // Entries may set { archived: true } to hide a type from the dropdown.
  investmentTypes: [],
};
