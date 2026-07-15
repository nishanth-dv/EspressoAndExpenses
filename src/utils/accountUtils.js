// Helpers for the multi-bank tracking feature. All computations operate on
// the raw accounts/transactions arrays from Redux — no store coupling so
// these can be unit-tested or called from any component.

// Per-account computed balance from opening + tagged transactions + self
// transfers. Self transfers don't move aggregate balance but DO move
// per-account balance, so they're applied here.
export function computeAccountBalance(account, transactions = []) {
  let bal = 0;
  for (const t of transactions) {
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

export function computeRunningBalances(transactions = [], multiBank = true) {
  const ordered = [...transactions].sort((a, b) => {
    const da = new Date(a.occurredAt || a.createdAt).getTime();
    const db = new Date(b.occurredAt || b.createdAt).getTime();
    if (da !== db) return da - db;
    const ca = new Date(a.createdAt || 0).getTime();
    const cb = new Date(b.createdAt || 0).getTime();
    if (ca !== cb) return ca - cb;
    return String(a.id).localeCompare(String(b.id));
  });

  const running = new Map();
  const result = new Map();
  const bump = (key, delta) => {
    const next = (running.get(key) || 0) + delta;
    running.set(key, next);
    return next;
  };

  for (const t of ordered) {
    const amt = parseFloat(t.amount) || 0;
    if (t.transactionType === "self_transfer") {
      if (t.fromAccountId) bump(t.fromAccountId, -amt);
      if (t.toAccountId) bump(t.toAccountId, amt);
      continue;
    }
    if (multiBank && !t.accountId) continue;
    const key = multiBank ? t.accountId : "__all__";
    let delta;
    if (t.transactionType === "income") delta = amt;
    else if (t.transactionType === "investment") delta = -amt;
    else if (t.cardId) continue;
    else delta = -amt;
    result.set(t.id, bump(key, delta));
  }

  return result;
}

// Reconciliation delta. Negative = the user's bank reports MORE than we
// computed (we're missing entries); positive = we computed MORE than the
// bank (we have phantom entries or duplicates).
export function balanceAsOf(account, transactions = [], asOf) {
  if (!asOf) return computeAccountBalance(account, transactions);
  let cutoff = new Date(asOf).getTime();
  if (Number.isNaN(cutoff)) return computeAccountBalance(account, transactions);
  // A date-only / midnight checkpoint means "as of the END of that day" — the
  // whole day's activity counts. This preserves the original day-granular
  // behaviour and keeps existing (date-picked) verifications stable. A
  // checkpoint that carries a real time-of-day — an auto-rolled checkpoint — is
  // honoured to the exact instant, so post-checkpoint spending is cleanly
  // excluded and recorded activity never manufactures drift.
  if (cutoff % 86_400_000 === 0) cutoff += 86_400_000 - 1;
  cutoff = Math.min(cutoff, Date.now()); // never reconcile against the future
  const upTo = transactions.filter((t) => {
    const ts = new Date(t.occurredAt || t.createdAt || 0).getTime();
    return Number.isNaN(ts) || ts <= cutoff;
  });
  return computeAccountBalance(account, upTo);
}

export function getReconciliationDelta(account, transactions = []) {
  if (account?.verifiedBalance == null || !account.verifiedAt) return null;
  const computed = balanceAsOf(account, transactions, account.verifiedAt);
  return {
    delta: computed - (parseFloat(account.verifiedBalance) || 0),
    verifiedAt: account.verifiedAt,
    verifiedBalance: parseFloat(account.verifiedBalance) || 0,
    computed,
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

// Aggregate balance — sum of every account's balance, nothing else.
// Untagged transactions (no accountId) are deliberately excluded: with no
// bank to attribute them to, they're kept for history/visibility only and
// never move the "All" balance. The user is told this when they save one,
// so the omission is intentional, not a missed entry.
export function computeAggregateBalance(accounts = [], transactions = []) {
  let total = 0;
  for (const a of accounts) total += computeAccountBalance(a, transactions);
  return total;
}
