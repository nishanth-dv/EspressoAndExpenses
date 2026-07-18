// Borrowed-lending outstanding after applying a repayment draw-down or its
// reversal. `delta` < 0 draws down (repayment), > 0 gives back (delete/edit).
// Clamped to [0, original borrowed amount] so reversals can't inflate a debt
// past what was owed, nor drive it negative.
export function lendingOutstandingAfter(lending, delta) {
  const total = parseFloat(lending.amount);
  const raw = (parseFloat(lending.outstanding) || 0) + delta;
  return Math.max(0, total > 0 ? Math.min(total, raw) : raw);
}
