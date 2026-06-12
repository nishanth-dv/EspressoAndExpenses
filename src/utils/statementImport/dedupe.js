// ── Duplicate detection ────────────────────────────────
//
// For each parsed row, find an existing ledger transaction with the same
// date (day-resolution) and amount within ±₹1 tolerance. Returns the
// rows annotated with `duplicateOf` (existing tx id or null). Caller
// uses this to default-uncheck duplicate rows in the review table.
//
// We use ±1 rupee tolerance because some statements pretty-print
// amounts with rounding while the ledger holds exact paise; the false-
// positive risk is low at one-day granularity.

const TOLERANCE = 1;

function dayKey(iso) {
  return iso.slice(0, 10);
}

export function markDuplicates(parsedRows, existingTxs) {
  // Group existing transactions by date for O(N+M) lookups.
  const byDay = new Map();
  for (const tx of existingTxs ?? []) {
    if (!tx.occurredAt || !tx.amount) continue;
    const key = dayKey(tx.occurredAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(tx);
  }

  return parsedRows.map((row) => {
    if (!row.occurredAt) return { ...row, duplicateOf: null };
    const sameDay = byDay.get(dayKey(row.occurredAt)) ?? [];
    const match = sameDay.find(
      (tx) => Math.abs(parseFloat(tx.amount) - row.amount) <= TOLERANCE,
    );
    return {
      ...row,
      duplicateOf: match ? match.id : null,
      // Pre-select non-duplicates; user can override.
      selected: !match,
    };
  });
}
