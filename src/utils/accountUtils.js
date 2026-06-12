// Helpers for the multi-bank tracking feature. All computations operate on
// the raw accounts/transactions arrays from Redux — no store coupling so
// these can be unit-tested or called from any component.

// Per-account computed balance from opening + tagged transactions + self
// transfers. Self transfers don't move aggregate balance but DO move
// per-account balance, so they're applied here.
export function computeAccountBalance(account, transactions = []) {
  const opening = parseFloat(account?.openingBalance) || 0;
  const openingDate = account?.openingDate ? new Date(account.openingDate) : null;
  let bal = opening;
  for (const t of transactions) {
    const occurredAt = t.occurredAt ? new Date(t.occurredAt) : null;
    // Only count transactions on/after the opening date — earlier ones
    // pre-date the user's declared opening balance and would double-count.
    if (openingDate && occurredAt && occurredAt < openingDate) continue;
    if (t.transactionType === "self_transfer") {
      if (t.fromAccountId === account.id) bal -= parseFloat(t.amount) || 0;
      if (t.toAccountId === account.id) bal += parseFloat(t.amount) || 0;
      continue;
    }
    if (t.accountId !== account.id) continue;
    if (t.transactionType === "income") bal += parseFloat(t.amount) || 0;
    else if (t.transactionType === "investment") bal -= parseFloat(t.amount) || 0;
    else if (t.cardId) continue; // credit-card spend, doesn't touch bank
    else bal -= parseFloat(t.amount) || 0;
  }
  return bal;
}

// Reconciliation delta. Negative = the user's bank reports MORE than we
// computed (we're missing entries); positive = we computed MORE than the
// bank (we have phantom entries or duplicates).
export function getReconciliationDelta(account, transactions = []) {
  if (account?.verifiedBalance == null || !account.verifiedAt) return null;
  // Only count transactions up to and including the verification date.
  const cutoff = new Date(account.verifiedAt);
  const upTo = transactions.filter((t) => {
    const d = t.occurredAt ? new Date(t.occurredAt) : null;
    return d ? d <= cutoff : true;
  });
  const computedAtVerify = computeAccountBalance(account, upTo);
  return {
    delta: computedAtVerify - (parseFloat(account.verifiedBalance) || 0),
    verifiedAt: account.verifiedAt,
    verifiedBalance: parseFloat(account.verifiedBalance) || 0,
    computed: computedAtVerify,
  };
}

// Monthly net for an account — income tagged + transfers in − expense tagged
// − transfers out, scoped to the current calendar month. Used in the
// carousel's "+₹X this month" delta line.
export function getAccountMonthlyDelta(account, transactions = []) {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth();
  let delta = 0;
  for (const t of transactions) {
    if (!t.occurredAt) continue;
    const d = new Date(t.occurredAt);
    if (d.getFullYear() !== yr || d.getMonth() !== mo) continue;
    const amt = parseFloat(t.amount) || 0;
    if (t.transactionType === "self_transfer") {
      if (t.fromAccountId === account.id) delta -= amt;
      if (t.toAccountId === account.id) delta += amt;
      continue;
    }
    if (t.accountId !== account.id) continue;
    if (t.transactionType === "income") delta += amt;
    else if (t.transactionType === "investment") delta -= amt;
    else if (t.cardId) continue;
    else delta -= amt;
  }
  return delta;
}

// Aggregate balance — sum of all accounts plus any untagged-transaction
// contribution. Untagged transactions stay visible in the "All" view per
// the migration plan, so they need to be included here too.
export function computeAggregateBalance(accounts = [], transactions = []) {
  let total = 0;
  for (const a of accounts) total += computeAccountBalance(a, transactions);
  // Untagged income/expense/investment also affects the user's overall
  // money picture — count it once (no double-count because computeAccountBalance
  // only sums tagged-to-this-account rows).
  for (const t of transactions) {
    if (t.accountId) continue;
    if (t.transactionType === "self_transfer") continue;
    if (t.transactionType === "income") total += parseFloat(t.amount) || 0;
    else if (t.transactionType === "investment") total -= parseFloat(t.amount) || 0;
    else if (t.cardId) continue;
    else total -= parseFloat(t.amount) || 0;
  }
  return total;
}
