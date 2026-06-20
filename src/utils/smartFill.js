// Smart-Fill: predicts a whole transaction from your own history. When a name
// matches past entries for the same merchant, it returns the most likely
// amount / category / payment mode / account so the form can be filled in one
// tap. Pure + local — just reads the ledger you already have.

export function normalizeName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null || v === "") continue;
    const k = String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return { value: best, count: bestCount };
}

// Returns a prediction object or null. `type` is "expense" | "income".
export function predictEntry(name, transactions = [], { type = "expense" } = {}) {
  const key = normalizeName(name);
  if (key.length < 2) return null;

  const matches = transactions.filter(
    (t) => t.transactionType === type && normalizeName(t.name) === key,
  );
  if (matches.length === 0) return null;

  const recent = [...matches].sort((a, b) =>
    (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
  );

  // A repeated amount (e.g. your usual coffee) wins; otherwise fall back to
  // the most recent amount you logged for this merchant.
  const amountMode = mostCommon(matches.map((t) => t.amount));
  const amount =
    amountMode.count >= 2 ? amountMode.value : recent[0]?.amount ?? "";

  return {
    name: recent[0]?.name ?? name,
    amount: amount != null ? String(amount) : "",
    category: mostCommon(matches.map((t) => t.category)).value,
    paymentMode: mostCommon(matches.map((t) => t.paymentMode)).value,
    accountId: mostCommon(matches.map((t) => t.accountId)).value,
    count: matches.length,
  };
}
