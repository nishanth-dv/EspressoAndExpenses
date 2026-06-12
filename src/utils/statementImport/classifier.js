// ── Statement-row classifier ───────────────────────────
//
// Inputs:
//   parsed: { description, direction, amount }   (from the CSV layer)
//   ctx:    { autoRules, learnedIndex }
//
// Output:
//   {
//     transactionType: "expense" | "income" | "investment",
//     category: string,
//     paymentMode: string,
//     confidence: 0..1,
//     reason: short string for tooltips during review
//   }
//
// Layered logic, highest-signal first:
//   1. Learned index match — user-curated merchant aliases (explicit),
//      or per-user implicit patterns derived from existing ledger. This
//      ranks above everything else because it's tailored to the user.
//   2. Investment keyword match — covers SIP/MF brokers (Zerodha,
//      Groww, Paytm Money, Kuvera…) and "SIP", "MUTUAL FUND" in
//      narrations.
//   3. AutoCategory rules — the user's existing autoCategoryRules (the
//      legacy rule table). Still useful, just supplements the index.
//   4. Direction-based default — credits → income, debits → expense.
//   5. Payment mode heuristic — UPI, POS, ATM, NEFT/IMPS/RTGS.

import { matchAutoCategory } from "../autoCategory";
import { lookupLearned } from "./learnedIndex";

const INVESTMENT_KEYWORDS = [
  // Broker / platform names that appear in narrations
  "zerodha", "groww", "paytm money", "kuvera", "coin by zerodha",
  "icici direct", "hdfc securities", "kotak securities", "upstox",
  "5paisa", "angel one", "iifl", "sharekhan",
  // Fund houses (common ones)
  "axis mutual", "hdfc mutual", "icici prudential", "sbi mutual",
  "kotak mahindra mf", "nippon india mf", "uti mutual",
  // Direct keywords
  "mutual fund", "mf systematic", "sip",
];

// Income keywords beyond the autoCategory rules — covers cases where
// users haven't taught the system yet.
const INCOME_HINTS = [
  "salary", "stipend", "refund", "cashback", "interest paid",
  "interest credit", "dividend", "neft cr", "imps cr",
];

const PAYMENT_MODE_PATTERNS = [
  { mode: "UPI", patterns: ["upi", "vpa", "@okhdfc", "@okicici", "@axis", "@paytm", "@ybl"] },
  { mode: "Debit Card", patterns: ["pos ", "debit card", "atw"] },
  { mode: "Credit Card", patterns: ["credit card payment", "cc bill"] },
  { mode: "Cash", patterns: ["atm withdrawal", "cash wdl", "cash withdrawal"] },
];

function lower(s) {
  return (s || "").toLowerCase();
}

function detectPaymentMode(desc) {
  const d = lower(desc);
  for (const { mode, patterns } of PAYMENT_MODE_PATTERNS) {
    if (patterns.some((p) => d.includes(p))) return mode;
  }
  if (/\b(neft|imps|rtgs)\b/i.test(desc)) return "Other";
  return "Other";
}

function detectInvestmentKeyword(desc) {
  const d = lower(desc);
  return INVESTMENT_KEYWORDS.find((k) => d.includes(k)) ?? null;
}

function detectIncomeHint(desc) {
  const d = lower(desc);
  return INCOME_HINTS.some((k) => d.includes(k));
}

export function classify(parsed, ctx = {}) {
  const autoRules = ctx.autoRules ?? [];
  const desc = parsed.description ?? "";
  const direction = parsed.direction; // "debit" | "credit"

  // 1. Learned per-user index (explicit aliases > implicit patterns).
  //    Highest signal because it's tailored to this user's history.
  if (ctx.learnedIndex) {
    const learned = lookupLearned(desc, ctx.learnedIndex);
    if (learned) {
      return {
        transactionType: learned.transactionType,
        category: learned.category,
        paymentMode: learned.paymentMode || detectPaymentMode(desc),
        confidence: learned.confidence,
        reason:
          learned.source === "alias"
            ? "Matched your saved merchant rule"
            : `Looks like your past ${learned.transactionType}s for this merchant`,
      };
    }
  }

  // 2. Investment keyword — strongest hint, beats direction default.
  const invKw = detectInvestmentKeyword(desc);
  if (invKw && direction === "debit") {
    return {
      transactionType: "investment",
      category: "Investment",
      paymentMode: detectPaymentMode(desc),
      confidence: 0.85,
      reason: `Matched investment keyword "${invKw}"`,
    };
  }

  // 3. AutoCategory rules — legacy user-defined dictionary.
  const expenseMatch =
    direction === "debit" ? matchAutoCategory(desc, "expense", autoRules) : null;
  const incomeMatch =
    direction === "credit" ? matchAutoCategory(desc, "income", autoRules) : null;
  if (expenseMatch) {
    return {
      transactionType: "expense",
      category: expenseMatch,
      paymentMode: detectPaymentMode(desc),
      confidence: 0.95,
      reason: `Matched your rule for "${expenseMatch}"`,
    };
  }
  if (incomeMatch) {
    return {
      transactionType: "income",
      category: incomeMatch,
      paymentMode: detectPaymentMode(desc),
      confidence: 0.95,
      reason: `Matched your rule for "${incomeMatch}"`,
    };
  }

  // 3. Direction + heuristics.
  if (direction === "credit") {
    const looksIncome = detectIncomeHint(desc);
    return {
      transactionType: "income",
      category: looksIncome ? guessIncomeCategory(desc) : "Other",
      paymentMode: detectPaymentMode(desc),
      confidence: looksIncome ? 0.65 : 0.4,
      reason: looksIncome
        ? "Description suggests income"
        : "Credit entry, category needs review",
    };
  }

  // Default debit → expense.
  return {
    transactionType: "expense",
    category: "Other",
    paymentMode: detectPaymentMode(desc),
    confidence: 0.4,
    reason: "Debit entry, category needs review",
  };
}

function guessIncomeCategory(desc) {
  const d = lower(desc);
  if (d.includes("salary") || d.includes("stipend")) return "Salary";
  if (d.includes("refund") || d.includes("cashback")) return "Refund";
  if (d.includes("dividend")) return "Dividends";
  if (d.includes("interest")) return "Interest";
  return "Other";
}
