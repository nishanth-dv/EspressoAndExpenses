// ── Discover catalog ────────────────────────────────────
//
// Curated investment types that ship with the app but aren't enabled by
// default. When the user opens the "Discover" picker (in Preferences →
// Investment Types) they see this list and can one-tap any entry to add
// it to their personal type catalog (transactionData.investmentTypes).
//
// Each entry is a complete schema (same shape as BUILTIN_INVESTMENT_TYPES)
// plus two extra display fields:
//   • description  — one-liner shown in the picker
//   • tags         — pills like "Tax-saving", "Retirement", "Pension"
//
// Bundled with the app rather than fetched remotely — keeps the offline
// story intact, no extra network call. New community types ship via app
// updates. A future phase can swap to a remote JSON if needed.

const r = (...fields) => ({ id: `r-${fields.map((f) => f.id).join("-")}`, fields });
const f = (id, key, type, label, opts = {}) => ({ id, key, type, label, locked: true, ...opts });

export const DISCOVER_INVESTMENT_TYPES = [
  // ── Voluntary Provident Fund ─────────────────────────────
  {
    key: "vpf",
    label: "VPF",
    color: "#86b07a",
    icon: "fa-shield-virus",
    mathProfile: "fixed",
    // VPF rides on your single EPF account — one per individual.
    singleton: true,
    description: "Voluntary contributions to your EPF above the mandatory 12 percent. Earns the same EPF rate and is tax free at maturity.",
    tags: ["Tax-saving", "Retirement", "80C"],
    rows: [
      r(f("name", "name", "text", "Account name", { required: true })),
      r(
        f("investedAmount", "investedAmount", "currency", "Total contributed", { required: true }),
        f("interestRate", "interestRate", "percentage", "Interest rate p.a.", { defaultValue: 8.25 }),
      ),
      r(
        f("tenureMonths", "tenureMonths", "number", "Years to retirement (months)"),
        f("startDate", "startDate", "date", "Start date", { required: true }),
      ),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Atal Pension Yojana ──────────────────────────────────
  {
    key: "apy",
    label: "APY",
    color: "#c98a5a",
    icon: "fa-person-cane",
    mathProfile: "cashflow",
    // APY is statutorily one-account-per-individual. The type picker
    // blocks a second "Add" once the user has an active record.
    singleton: true,
    description: "A government backed pension scheme. You contribute every month and receive a fixed monthly pension after age 60. The current value isn't well defined until the payout phase begins.",
    tags: ["Pension", "Government", "Deferred payout"],
    rows: [
      r(f("name", "name", "text", "Plan name", { required: true })),
      r(f("investedAmount", "investedAmount", "currency", "Total contributed so far", { required: true })),
      r(
        f("startDate", "startDate", "date", "Enrolment date", { required: true }),
        f("payoutStartDate", "payoutStartDate", "date", "Pension starts on (age 60)"),
      ),
      r(f("monthlyContribution", "monthlyContribution", "currency", "Monthly contribution")),
      r(f("autoDeduct", "autoDeduct", "auto-deduct", "Auto-deduct schedule", {
        config: { frequency: "monthly" },
      })),
    ],
  },

  // ── Senior Citizens' Savings Scheme ──────────────────────
  {
    key: "scss",
    label: "SCSS",
    color: "#7a9bb0",
    icon: "fa-umbrella",
    mathProfile: "fixed",
    description: "A savings scheme for senior citizens aged 60 and above. Pays interest every quarter at a fixed rate. The standard tenure is 5 years.",
    tags: ["Tax-saving", "Senior citizen", "80C"],
    rows: [
      r(f("name", "name", "text", "Account name", { required: true })),
      r(
        f("investedAmount", "investedAmount", "currency", "Principal", { required: true }),
        f("interestRate", "interestRate", "percentage", "Quarterly rate", { defaultValue: 8.2 }),
      ),
      r(
        f("tenureMonths", "tenureMonths", "number", "Tenure (months)", { defaultValue: 60 }),
        f("startDate", "startDate", "date", "Start date", { required: true }),
      ),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Sukanya Samriddhi Yojana ─────────────────────────────
  {
    key: "ssy",
    label: "SSY",
    color: "#d68aa0",
    icon: "fa-child",
    mathProfile: "fixed",
    description: "A long term savings account opened in the name of a girl child. Tax free at all three stages and earns around 8 percent a year.",
    tags: ["Tax-saving", "Children", "80C", "EEE"],
    rows: [
      r(f("name", "name", "text", "Account name", { required: true })),
      r(
        f("investedAmount", "investedAmount", "currency", "Total contributed", { required: true }),
        f("interestRate", "interestRate", "percentage", "Interest rate p.a.", { defaultValue: 8.2 }),
      ),
      r(
        f("tenureMonths", "tenureMonths", "number", "Maturity in (months)"),
        f("startDate", "startDate", "date", "Account opened on", { required: true }),
      ),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Unit-Linked Insurance Plan ───────────────────────────
  {
    key: "ulip",
    label: "ULIP",
    color: "#8a7ab0",
    icon: "fa-umbrella-beach",
    mathProfile: "unit",
    description: "A policy that bundles life insurance with market linked investments. Part of your premium covers insurance, the rest buys units. Has a 5 year lock in.",
    tags: ["Insurance", "Market-linked", "80C", "5-yr lock-in"],
    rows: [
      r(f("name", "name", "text", "Plan name", { required: true })),
      r(f("policyNumber", "policyNumber", "text", "Policy number")),
      r(
        f("quantity", "quantity", "number", "Units allocated", { required: true }),
        f("buyPrice", "buyPrice", "currency", "Avg NAV", { required: true }),
      ),
      r(f("currentPrice", "currentPrice", "currency", "Current NAV")),
      r(f("startDate", "startDate", "date", "Start date", { required: true })),
      r(f("autoDeduct", "autoDeduct", "auto-deduct", "Premium schedule", {
        config: { frequency: "yearly" },
      })),
    ],
  },

  // ── Real Estate Investment Trust ─────────────────────────
  {
    key: "reit",
    label: "REIT",
    color: "#5a8aa0",
    icon: "fa-city",
    mathProfile: "unit",
    description: "Listed units that own and operate commercial real estate. Pays out distributions quarterly and the unit price moves with the underlying property value.",
    tags: ["Real estate", "Listed", "Dividend"],
    rows: [
      r(f("name", "name", "text", "REIT name", { required: true })),
      r(f("ticker", "ticker", "ticker", "Ticker")),
      r(
        f("quantity", "quantity", "number", "Units", { required: true }),
        f("buyPrice", "buyPrice", "currency", "Buy price", { required: true }),
      ),
      r(f("currentPrice", "currentPrice", "currency", "Current price")),
      r(f("startDate", "startDate", "date", "Start date", { required: true })),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Infrastructure Investment Trust ──────────────────────
  {
    key: "invit",
    label: "INVIT",
    color: "#7a9bd6",
    icon: "fa-road",
    mathProfile: "unit",
    description: "Listed units that own infrastructure assets like toll roads, transmission lines, and power plants. Pays distributions on a regular schedule.",
    tags: ["Infra", "Listed", "Distribution"],
    rows: [
      r(f("name", "name", "text", "INVIT name", { required: true })),
      r(f("ticker", "ticker", "ticker", "Ticker")),
      r(
        f("quantity", "quantity", "number", "Units", { required: true }),
        f("buyPrice", "buyPrice", "currency", "Buy price", { required: true }),
      ),
      r(f("currentPrice", "currentPrice", "currency", "Current price")),
      r(f("startDate", "startDate", "date", "Start date", { required: true })),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Sovereign Gold Bond ──────────────────────────────────
  {
    key: "sgb",
    label: "Sovereign Gold Bond",
    color: "#d4c35a",
    icon: "fa-bullseye",
    mathProfile: "unit",
    description: "Paper gold issued by the RBI. Pays a fixed 2.5 percent annual coupon and you also benefit from any rise in gold prices. The tenure is 8 years.",
    tags: ["Gold", "Government", "Coupon"],
    rows: [
      r(f("name", "name", "text", "Tranche name", { required: true })),
      r(
        f("quantity", "quantity", "number", "Grams", { required: true }),
        f("buyPrice", "buyPrice", "currency", "Issue price / g", { required: true }),
      ),
      r(f("currentPrice", "currentPrice", "currency", "Current gold price / g")),
      r(
        f("interestRate", "interestRate", "percentage", "Coupon rate", { defaultValue: 2.5 }),
        f("startDate", "startDate", "date", "Issue date", { required: true }),
      ),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },

  // ── Chit Fund ────────────────────────────────────────────
  {
    key: "chit_fund",
    label: "Chit Fund",
    color: "#b07a86",
    icon: "fa-handshake-angle",
    mathProfile: "cashflow",
    description: "A group savings arrangement. Everyone contributes a fixed amount monthly, and one person takes the pot home each month based on an auction or lottery. Your turn to receive the lump sum can come any time during the cycle.",
    tags: ["Cash flow", "Group savings"],
    rows: [
      r(f("name", "name", "text", "Chit name", { required: true })),
      r(
        f("investedAmount", "investedAmount", "currency", "Total contributed", { required: true }),
        f("withdrawals", "withdrawals", "currency", "Amount received", { defaultValue: 0 }),
      ),
      r(f("monthlyContribution", "monthlyContribution", "currency", "Monthly subscription", { required: true })),
      r(
        f("tenureMonths", "tenureMonths", "number", "Tenure (months)"),
        f("startDate", "startDate", "date", "Start date", { required: true }),
      ),
      r(f("autoDeduct", "autoDeduct", "auto-deduct", "Auto-deduct schedule", {
        config: { frequency: "monthly" },
      })),
    ],
  },

  // ── NPS Tier 2 ───────────────────────────────────────────
  {
    key: "nps_tier2",
    label: "NPS Tier 2",
    color: "#c98a86",
    icon: "fa-piggy-bank",
    mathProfile: "unit",
    // Tier 2 sits under the same PRAN as Tier 1 — one per individual.
    singleton: true,
    description: "A voluntary, withdraw anytime account available to NPS subscribers. No tax benefits but more flexible than Tier 1.",
    tags: ["Retirement", "Flexible"],
    rows: [
      r(f("name", "name", "text", "Account name", { required: true })),
      r(
        f("quantity", "quantity", "number", "Units", { required: true }),
        f("buyPrice", "buyPrice", "currency", "Avg NAV", { required: true }),
      ),
      r(f("currentPrice", "currentPrice", "currency", "Current NAV")),
      r(f("startDate", "startDate", "date", "Start date", { required: true })),
      r(f("deductFromBalance", "affectsBalance", "deduct-from-balance", "Deduct from balance")),
    ],
  },
];
