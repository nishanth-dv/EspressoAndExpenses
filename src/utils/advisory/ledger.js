// Realized-gains ledger — the "Money Made" store behind the Grow domain.
//
// Persisted under preferences.moneyMade:
//   { entries: [{ id, cardId, bucket, title, amount, source, capturedAt }] }
//
// One entry per acted-on recommendation, KEYED BY cardId so marking a card done
// (then undoing, or later dismissing it) keeps the ledger consistent instead of
// double-counting. Total money made = Σ entries.amount. The amount is the card's
// estimated annual value (₹/yr) at the moment it was acted on — an estimate, so
// the UI labels it as such.

export const EMPTY_LEDGER = { entries: [] };

// Coarse "money made" buckets for the dashboard breakdown. Colours are drawn
// from the app's semantic family so the chart reads as one system.
export const MONEY_BUCKETS = {
  fees: { label: "Fees saved", icon: "fa-scissors", accent: "#5b8dee" },
  tax: { label: "Tax saved", icon: "fa-receipt", accent: "#8b5cf6" },
  yield: { label: "Idle-cash yield", icon: "fa-piggy-bank", accent: "#16a34a" },
  rewards: { label: "Rewards captured", icon: "fa-credit-card", accent: "#f59e0b" },
  returns: { label: "Better returns", icon: "fa-chart-line", accent: "#0ea5e9" },
  other: { label: "Other gains", icon: "fa-coins", accent: "#94a3b8" },
};

export const BUCKET_ORDER = ["fees", "tax", "yield", "rewards", "returns", "other"];

// Classify an advisory card into a bucket. Id prefixes are the strongest signal
// (they're stable and module-specific); category is a fallback. Unknown → other.
export function bucketFor(card) {
  const id = card?.id || "";
  const cat = (card?.category || "").toLowerCase();
  const starts = (p) => id.startsWith(p);

  if (starts("mf-direct-") || starts("lic-") || starts("card-fee-")) return "fees";
  if (starts("ltcg-") || starts("harvest-") || starts("loss-") || starts("80c") || starts("nps") || cat === "tax") return "tax";
  if (starts("idle-") || starts("fd-") || starts("gsec") || starts("scss") || starts("arbitrage") || cat === "cash") return "yield";
  if (starts("card-best-") || starts("card-util-") || cat === "cards") return "rewards";
  if (starts("alloc-") || starts("conc-") || starts("sip-") || cat === "allocation") return "returns";
  return "other";
}

// Normalise a stored (possibly partial/legacy) ledger blob.
export function readLedger(l) {
  const entries = Array.isArray(l?.entries) ? l.entries : [];
  return { entries: entries.filter((e) => e && typeof e === "object") };
}

export function makeEntry(card) {
  return {
    id: `m_${card.id}`,
    cardId: card.id,
    bucket: bucketFor(card),
    title: card.title || "Recommendation",
    amount: Number(card?.saving) || 0,
    source: "advisory",
    capturedAt: new Date().toISOString(),
  };
}

// Add (or refresh) the entry for a card. Idempotent on cardId.
export function addEntry(ledger, card) {
  const { entries } = readLedger(ledger);
  return { entries: [...entries.filter((e) => e.cardId !== card.id), makeEntry(card)] };
}

// Drop a card's entry (called when a done card is undone or dismissed).
export function removeEntry(ledger, cardId) {
  const { entries } = readLedger(ledger);
  return { entries: entries.filter((e) => e.cardId !== cardId) };
}

// Dashboard aggregates: total, count, per-bucket sums, and a 12-month trend.
export function ledgerSummary(ledger) {
  const { entries } = readLedger(ledger);
  const total = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const byBucket = {};
  for (const e of entries) {
    const b = MONEY_BUCKETS[e.bucket] ? e.bucket : "other";
    byBucket[b] = (byBucket[b] || 0) + (Number(e.amount) || 0);
  }

  // Last 12 calendar months, oldest → newest, zero-filled for a clean trend.
  const now = new Date();
  const months = [];
  const monthTotals = {};
  for (const e of entries) {
    const d = new Date(e.capturedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthTotals[key] = (monthTotals[key] || 0) + (Number(e.amount) || 0);
  }
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: d.toLocaleString("en-IN", { month: "short" }),
      amount: monthTotals[key] || 0,
    });
  }

  const recent = [...entries].sort(
    (a, b) => new Date(b.capturedAt) - new Date(a.capturedAt),
  );

  return { total, count: entries.length, byBucket, months, recent };
}
