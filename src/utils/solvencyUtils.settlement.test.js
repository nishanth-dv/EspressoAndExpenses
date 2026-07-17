// Runnable self-check for commitmentCycleSettled — the EMI "is this cycle paid?"
// logic that mirrors credit-card netting (repayments count regardless of date).
// No test framework in this repo; run directly:  node src/utils/solvencyUtils.settlement.test.js
import assert from "node:assert/strict";
import {
  commitmentCycleSettled,
  emiInstallmentsBilled,
} from "./solvencyUtils.js";

const asOf = new Date(2025, 5, 10); // 10 Jun 2025

const emi = {
  id: "emi1",
  emiAmount: 10000,
  dueDay: 5,
  tenureMonths: 24,
  firstPaymentMonth: "2025-01",
};

const repay = (amount, occurredAt) => ({ repaymentFor: "emi1", amount, occurredAt });

// Sanity: Jan–Jun instalments have billed by 10 Jun (billing day = dueDay 5).
assert.equal(emiInstallmentsBilled(emi, asOf), 6, "6 instalments billed by asOf");

// 1. Nothing logged → still owed.
assert.equal(commitmentCycleSettled(emi, [], asOf), false, "no repayments → open");

// 2. Repayments covering every billed instalment (mixed dates) → settled.
const covered = [
  repay(10000, "2025-01-05"),
  repay(10000, "2025-02-05"),
  repay(10000, "2025-03-05"),
  repay(10000, "2025-04-05"),
  repay(10000, "2025-05-05"),
  repay(10000, "2025-06-08"),
];
assert.equal(commitmentCycleSettled(emi, covered, asOf), true, "fully covered → settled");

// 3. Back-dating: short by one EMI → open; a back-dated 6th repayment settles it.
const short = covered.slice(0, 5);
assert.equal(commitmentCycleSettled(emi, short, asOf), false, "short by one EMI → open");
const backDated = [...short, repay(10000, "2025-03-05")]; // dated a past month
assert.equal(
  commitmentCycleSettled(emi, backDated, asOf),
  true,
  "back-dated repayment settles the cycle (card-like)",
);

// 4. A plain (non-repayment) transaction must never count as clearance.
assert.equal(
  commitmentCycleSettled(
    emi,
    [{ cardId: "x", amount: 99999, occurredAt: "2025-06-01", repaymentFor: "" }],
    asOf,
  ),
  false,
  "plain transactions are not repayments",
);

// 5. Fallback (no schedule data → calendar-month check against asOf).
const recurring = { id: "rent1", emiAmount: 5000, dueDay: 10 };
assert.equal(
  commitmentCycleSettled(
    recurring,
    [{ repaymentFor: "rent1", amount: 5000, occurredAt: "2025-06-15" }],
    asOf,
  ),
  true,
  "fallback: repayment in asOf month → settled",
);
assert.equal(
  commitmentCycleSettled(
    recurring,
    [{ repaymentFor: "rent1", amount: 5000, occurredAt: "2025-05-15" }],
    asOf,
  ),
  false,
  "fallback: repayment in a different month → open",
);

console.log("solvencyUtils settlement: all assertions passed");
