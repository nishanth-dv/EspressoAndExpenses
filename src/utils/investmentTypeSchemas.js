// ── Investment type schemas ─────────────────────────────
//
// Each investment type owns a SCHEMA describing the fields that appear in
// the Add / Edit Investment form for that type. A schema is composable from:
//   • mathProfile  — drives portfolio math: "unit" | "fixed" | "manual" | "cashflow"
//   • rows         — layout for the form. Each row holds 1–3 Fields.
//
// A Field carries:
//   • id            stable identifier inside the schema
//   • key           the transaction record property it reads / writes
//   • type          field-type from the palette (see FIELD_TYPES below)
//   • label         display label in the form
//   • locked        anchor field — the user CANNOT remove / rename / hide it
//                   in the type designer. Optional becomes false-y when absent.
//   • required      runtime form validation
//   • defaultValue  pre-fill value
//   • options       for dropdown / multi-select
//   • config        type-specific config (e.g., auto-deduct frequency defaults)
//
// Field keys MUST match the existing transaction record field names (quantity,
// buyPrice, monthlyAmount, sipDay, etc.) so existing investments in the user's
// Drive file render correctly with the schema-driven form rolled out in
// Phase 2. New custom types pick fresh keys.

export const MATH_PROFILES = {
  unit:     { key: "unit",     label: "Unit × Price",       affectsPortfolio: true  },
  fixed:    { key: "fixed",    label: "Principal + Interest",     affectsPortfolio: true  },
  manual:   { key: "manual",   label: "Manual value",             affectsPortfolio: true  },
  // Cash-flow profile tracks contributions in / withdrawals out without
  // attempting to compute returns. Used for APY, chit funds, etc.
  // affectsPortfolio = false → excluded from return %, CAGR, top-performers.
  cashflow: { key: "cashflow", label: "Cash flow (contributions)", affectsPortfolio: false },
};

// Palette of field types available in the designer. The form renderer maps
// these to concrete React components.
export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "currency",
  "percentage",
  "date",
  "month",
  "day-of-month",
  "dropdown",
  "multi-select",
  "checkbox",
  // Special semantic fields with built-in behaviour:
  "ticker",               // text input + autocomplete + price fetch
  "month-grid",           // 12-month grid picker (LIC-style premium months)
  "deduct-from-balance",  // affectsBalance toggle + (when multi-bank) bank picker
  "auto-deduct",          // recurring auto-debit schedule + bank picker
];

// Helper for schema row construction.
function row(...fields) {
  return { id: `r-${fields.map((f) => f.id).join("-")}`, fields };
}

function field(id, key, type, label, opts = {}) {
  return { id, key, type, label, locked: true, ...opts };
}

// ── Common anchor segments shared across multiple profiles ────

const NAME_ROW = (label = "Name") =>
  row(field("name", "name", "text", label, { required: true }));

const START_DATE_FIELD = field(
  "startDate",
  "startDate",
  "date",
  "Start date",
  { required: true },
);

// ── Built-in investment type schemas ──────────────────────────
//
// `key` matches the existing `inv.type` values so existing user records
// continue to map. `builtIn: true` marks them as system types — the user
// can add EXTRA fields in the designer (Phase 3) but cannot delete or
// alter the anchors / rename / remove the type itself.

export const BUILTIN_INVESTMENT_TYPES = [
  // ── Equity / market-linked ───────────────────────────────────
  {
    key: "stock",
    label: "Stocks",
    color: "#4a90d9",
    icon: "fa-chart-line",
    mathProfile: "unit",
    builtIn: true,
    description: "Shares of listed companies. Prices move daily, you may earn dividends, and over time equity tends to outpace inflation. Volatile in the short term.",
    rows: [
      NAME_ROW("Stock name"),
      row(field("ticker", "ticker", "ticker", "Ticker symbol")),
      row(
        field("quantity", "quantity", "number", "Quantity", { required: true }),
        field("buyPrice", "buyPrice", "currency", "Buy price", { required: true }),
      ),
      row(field("currentPrice", "currentPrice", "currency", "Current price")),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "mf",
    label: "Mutual Fund",
    color: "#7abf8e",
    icon: "fa-seedling",
    mathProfile: "unit",
    builtIn: true,
    description: "Money pooled with other investors and managed by a fund house. Priced via NAV, professionally run, and the backbone of most long-term Indian portfolios.",
    rows: [
      NAME_ROW("Fund name"),
      row(field("ticker", "ticker", "ticker", "Scheme code")),
      row(
        field("quantity", "quantity", "number", "Units", { required: true }),
        field("buyPrice", "buyPrice", "currency", "Buy NAV", { required: true }),
      ),
      row(field("currentPrice", "currentPrice", "currency", "Current NAV")),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "sip",
    label: "SIP",
    color: "#d4a35a",
    icon: "fa-rotate",
    mathProfile: "unit",
    builtIn: true,
    description: "Automated monthly purchases of mutual fund units. The same amount goes in every month, which smooths out market ups and downs over time.",
    rows: [
      NAME_ROW("SIP name"),
      row(field("ticker", "ticker", "ticker", "Scheme code")),
      row(
        field("monthlyAmount", "monthlyAmount", "currency", "Monthly amount", { required: true }),
        field("sipDay", "sipDay", "day-of-month", "SIP day"),
      ),
      row(field("startDate", "startDate", "date", "Start date", { required: true })),
      // Auto-deduct is an ANCHOR for SIP → always on, can't be turned off.
      row(field("autoDeduct", "autoDeduct", "auto-deduct", "Auto-deduct schedule", {
        config: { frequency: "monthly", dayKey: "sipDay" },
      })),
    ],
  },
  {
    key: "etf",
    label: "ETF",
    color: "#9b8ea6",
    icon: "fa-layer-group",
    mathProfile: "unit",
    builtIn: true,
    description: "An index fund that trades on the stock exchange like a share. Low cost, instantly diversified, and you can buy or sell any time the market is open.",
    rows: [
      NAME_ROW("ETF name"),
      row(field("ticker", "ticker", "ticker", "Ticker symbol")),
      row(
        field("quantity", "quantity", "number", "Units", { required: true }),
        field("buyPrice", "buyPrice", "currency", "Buy price", { required: true }),
      ),
      row(field("currentPrice", "currentPrice", "currency", "Current price")),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Fixed income ─────────────────────────────────────────────
  {
    key: "fd",
    label: "Fixed Deposit",
    color: "#5a9fd4",
    icon: "fa-building-columns",
    mathProfile: "fixed",
    builtIn: true,
    description: "A bank deposit locked at a fixed rate for a fixed period. Safe and predictable. Interest is fully taxed and breaking it early costs a small penalty.",
    rows: [
      NAME_ROW("Deposit name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Principal", { required: true }),
        field("interestRate", "interestRate", "percentage", "Interest rate p.a."),
      ),
      row(
        field("tenureMonths", "tenureMonths", "number", "Tenure (months)"),
        START_DATE_FIELD,
      ),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "rd",
    label: "Recurring Deposit",
    color: "#6abfa8",
    icon: "fa-piggy-bank",
    mathProfile: "fixed",
    builtIn: true,
    description: "A small fixed amount deposited every month at a set interest rate. Better thought of as forced savings than as a return chaser.",
    rows: [
      NAME_ROW("Deposit name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Monthly deposit", { required: true }),
        field("interestRate", "interestRate", "percentage", "Interest rate p.a."),
      ),
      row(
        field("tenureMonths", "tenureMonths", "number", "Tenure (months)"),
        START_DATE_FIELD,
      ),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "ppf",
    label: "PPF",
    color: "#a8c55a",
    icon: "fa-landmark",
    mathProfile: "manual",
    builtIn: true,
    // One PPF per individual at any time — picker blocks duplicates.
    singleton: true,
    description: "A 15 year government backed savings account. Tax free on the way in, while invested, and on the way out. Earns around 7 to 8 percent a year, and you can withdraw partially after the seventh year.",
    rows: [
      NAME_ROW("Account name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Total invested", { required: true }),
        field("currentValue", "currentValue", "currency", "Current value"),
      ),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "nps",
    label: "NPS",
    color: "#d48a5a",
    icon: "fa-user-shield",
    mathProfile: "manual",
    builtIn: true,
    // One PRAN per individual (NPS Tier 1) — picker blocks duplicates.
    singleton: true,
    description: "A retirement account that splits your money across equity, debt and government bonds. Stays locked till age 60. Gives you an extra 50,000 rupee deduction on top of the regular 80C limit.",
    rows: [
      NAME_ROW("Account name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Total invested", { required: true }),
        field("currentValue", "currentValue", "currency", "Current value"),
      ),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "lic",
    label: "LIC",
    color: "#e07b3a",
    icon: "fa-shield-halved",
    mathProfile: "fixed",
    builtIn: true,
    description: "A life insurance policy from LIC. Covers your life and may pay out a maturity amount at the end. You can pick how often to pay the premium. Counts toward your 80C deduction.",
    rows: [
      NAME_ROW("Policy name"),
      row(field("policyNumber", "policyNumber", "text", "Policy number")),
      row(
        field("startDate", "startDate", "date", "Start date", { required: true }),
        field("maturityDate", "maturityDate", "date", "Maturity date"),
      ),
      row(
        field("premiumAmount", "premiumAmount", "currency", "Premium amount", { required: true }),
        field("frequency", "frequency", "dropdown", "Frequency", {
          options: [
            { value: 1,  label: "Annual" },
            { value: 2,  label: "Semi-annual" },
            { value: 4,  label: "Quarterly" },
            { value: 12, label: "Monthly" },
          ],
          defaultValue: 1,
        }),
      ),
      row(field("premiumMonths", "premiumMonths", "multi-select", "Premium months")),
      row(field("maturityAmount", "maturityAmount", "currency", "Maturity amount")),
    ],
  },
  {
    key: "plan",
    label: "Savings Plan",
    color: "#5abfa8",
    icon: "fa-hand-holding-dollar",
    mathProfile: "fixed",
    builtIn: true,
    description: "A monthly savings plan from a bank or insurance company with a fixed payout at the end. Steady but slow. You trade upside for predictability.",
    rows: [
      NAME_ROW("Plan name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Monthly deposit", { required: true }),
        field("tenureMonths", "tenureMonths", "number", "Tenure (months)"),
      ),
      row(
        field("maturityAmount", "maturityAmount", "currency", "Maturity amount"),
        START_DATE_FIELD,
      ),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "bond",
    label: "Bonds",
    color: "#a88a6a",
    icon: "fa-file-contract",
    mathProfile: "fixed",
    builtIn: true,
    description: "A loan you give to a government, PSU or company that pays you interest at regular intervals. Less volatile than stocks but its price moves when interest rates change.",
    rows: [
      NAME_ROW("Bond name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Investment", { required: true }),
        field("interestRate", "interestRate", "percentage", "Coupon rate p.a."),
      ),
      row(
        field("tenureMonths", "tenureMonths", "number", "Tenure (months)"),
        START_DATE_FIELD,
      ),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Alternatives ─────────────────────────────────────────────
  {
    key: "gold",
    label: "Gold",
    color: "#d4c35a",
    icon: "fa-coins",
    mathProfile: "unit",
    builtIn: true,
    description: "Gold held as coins, bars, or through gold ETFs and funds. A hedge against inflation and a weakening rupee. Capital gains apply when you sell.",
    rows: [
      NAME_ROW("Holding name"),
      row(field("ticker", "ticker", "ticker", "Ticker (optional)")),
      row(
        field("quantity", "quantity", "number", "Grams / units", { required: true }),
        field("buyPrice", "buyPrice", "currency", "Buy price", { required: true }),
      ),
      row(field("currentPrice", "currentPrice", "currency", "Current price")),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "real_estate",
    label: "Real Estate",
    color: "#8a9fd4",
    icon: "fa-house",
    mathProfile: "manual",
    builtIn: true,
    description: "A property you own. Residential, commercial, or just land. Hard to sell quickly and ties up a lot of money, but tends to build wealth over the long run.",
    rows: [
      NAME_ROW("Property name"),
      row(
        field("investedAmount", "investedAmount", "currency", "Purchase price", { required: true }),
        field("currentValue", "currentValue", "currency", "Current value"),
      ),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "crypto",
    label: "Crypto",
    color: "#d4735a",
    icon: "fa-bitcoin-sign",
    mathProfile: "unit",
    builtIn: true,
    description: "Holdings in Bitcoin, Ethereum, and other digital currencies. Prices swing hard and India taxes gains at a flat 30 percent with no offsetting of losses.",
    rows: [
      NAME_ROW("Coin name"),
      row(field("ticker", "ticker", "ticker", "Symbol")),
      row(
        field("quantity", "quantity", "number", "Quantity", { required: true }),
        field("buyPrice", "buyPrice", "currency", "Buy price", { required: true }),
      ),
      row(field("currentPrice", "currentPrice", "currency", "Current price")),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
  {
    key: "other",
    label: "Other",
    color: "#808080",
    icon: "fa-wallet",
    mathProfile: "manual",
    builtIn: true,
    description: "For anything that doesn't fit the categories above. You track the invested amount and current value yourself and update it when the asset changes.",
    rows: [
      NAME_ROW(),
      row(
        field("investedAmount", "investedAmount", "currency", "Invested", { required: true }),
        field("currentValue", "currentValue", "currency", "Current value"),
      ),
      row(START_DATE_FIELD),
      row(field("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
];

// ── Anchor templates per math profile ───────────────────────
//
// When the user creates a fresh custom type or switches a type to a new
// math profile, the anchor (locked) fields are seeded from these templates
// so the portfolio math has the inputs it needs. Each anchor `key` matches
// the property the math engine reads off the investment record.

const ANCHOR_TEMPLATES = {
  unit: [
    { id: "name", key: "name", type: "text", label: "Name", locked: true, required: true },
    { id: "quantity", key: "quantity", type: "number", label: "Quantity", locked: true, required: true },
    { id: "buyPrice", key: "buyPrice", type: "currency", label: "Buy price", locked: true, required: true },
    { id: "currentPrice", key: "currentPrice", type: "currency", label: "Current price", locked: true },
    { id: "startDate", key: "startDate", type: "date", label: "Start date", locked: true, required: true },
  ],
  fixed: [
    { id: "name", key: "name", type: "text", label: "Name", locked: true, required: true },
    { id: "investedAmount", key: "investedAmount", type: "currency", label: "Invested amount", locked: true, required: true },
    { id: "interestRate", key: "interestRate", type: "percentage", label: "Interest rate p.a.", locked: true },
    { id: "tenureMonths", key: "tenureMonths", type: "number", label: "Tenure (months)", locked: true },
    { id: "startDate", key: "startDate", type: "date", label: "Start date", locked: true, required: true },
  ],
  manual: [
    { id: "name", key: "name", type: "text", label: "Name", locked: true, required: true },
    { id: "investedAmount", key: "investedAmount", type: "currency", label: "Invested amount", locked: true, required: true },
    { id: "currentValue", key: "currentValue", type: "currency", label: "Current value", locked: true },
    { id: "startDate", key: "startDate", type: "date", label: "Start date", locked: true, required: true },
  ],
  cashflow: [
    { id: "name", key: "name", type: "text", label: "Name", locked: true, required: true },
    { id: "investedAmount", key: "investedAmount", type: "currency", label: "Total contributed", locked: true, required: true },
    { id: "withdrawals", key: "withdrawals", type: "currency", label: "Withdrawn / received", locked: true, defaultValue: 0 },
    { id: "startDate", key: "startDate", type: "date", label: "Start date", locked: true, required: true },
  ],
};

// Returns an array of anchor field objects for the given math profile.
// Used by the type designer to seed a brand-new custom type's anchor list.
export function getAnchorsForProfile(profile) {
  const tpl = ANCHOR_TEMPLATES[profile] ?? ANCHOR_TEMPLATES.manual;
  // Return a fresh clone so callers can mutate freely.
  return tpl.map((f) => ({ ...f }));
}

// Distinguishes anchor (locked) fields from user-added extras inside a
// schema's rows array. Useful when the designer needs to enforce the
// "anchors can't be removed / renamed" rule.
export function isAnchorField(field) {
  return !!field?.locked;
}

// ── Helpers ─────────────────────────────────────────────────

// Resolves a `type` key to its schema, merging the user's local overrides
// from `transactionData.investmentTypes` over the BUILTIN list. Returns
// `null` if the key is unknown (e.g., a deleted custom type with surviving
// transactions — the caller decides how to render that case).
export function getInvestmentTypeSchema(typeKey, userTypes = []) {
  const userMatch = userTypes.find((t) => t.key === typeKey);
  if (userMatch) return userMatch;
  return BUILTIN_INVESTMENT_TYPES.find((t) => t.key === typeKey) ?? null;
}

// All visible types in the Add Investment dropdown — user types unioned over
// built-ins (user overrides win when keys collide). Filtered to non-archived.
export function getAllInvestmentTypes(userTypes = []) {
  const byKey = new Map();
  for (const t of BUILTIN_INVESTMENT_TYPES) byKey.set(t.key, t);
  for (const t of userTypes) {
    if (t?.archived) {
      byKey.delete(t.key);
      continue;
    }
    byKey.set(t.key, t);
  }
  return [...byKey.values()];
}

// True if a math profile contributes to portfolio return / allocation math.
// Cash-flow types are excluded.
export function profileAffectsPortfolio(profile) {
  return MATH_PROFILES[profile]?.affectsPortfolio !== false;
}
