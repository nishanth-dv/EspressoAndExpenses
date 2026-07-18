// Runnable self-check for lendingOutstandingAfter — the borrowed-lending
// draw-down/reversal math behind repayment delete/edit/undo. Clamped to
// [0, original amount]. No test framework in this repo; run directly:
//   node src/utils/solvencyUtils.lending.test.js
import assert from "node:assert/strict";
import { lendingOutstandingAfter } from "./lendingUtils.js";

const L = (amount, outstanding) => ({ amount, outstanding });

// Repayment draws down; delete of the same repayment restores it (round-trip).
const owed = L(1000, 1000);
const afterRepay = lendingOutstandingAfter(owed, -300);
assert.equal(afterRepay, 700, "repay 300 → 700 left");
assert.equal(
  lendingOutstandingAfter({ ...owed, outstanding: afterRepay }, 300),
  1000,
  "deleting that repayment restores 1000",
);

// Edit 300 → 500 nets an extra 200 drawdown: give back 300, take 500.
const restored = lendingOutstandingAfter(L(1000, 700), 300); // 1000
assert.equal(lendingOutstandingAfter(L(1000, restored), -500), 500, "edit to 500 → 500 left");

// Never negative, never above the original borrowed amount.
assert.equal(lendingOutstandingAfter(L(1000, 200), -500), 0, "overpay clamps at 0");
assert.equal(lendingOutstandingAfter(L(1000, 900), 500), 1000, "over-restore clamps at total");

// Missing/zero total → no upper clamp, still floored at 0.
assert.equal(lendingOutstandingAfter(L("", 0), 400), 400, "no total → uncapped");
assert.equal(lendingOutstandingAfter(L("", 100), -400), 0, "no total → floored at 0");

console.log("lendingOutstandingAfter self-check passed");
