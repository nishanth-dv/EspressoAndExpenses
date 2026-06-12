// ── Learned classifier index ───────────────────────────
//
// Built fresh at the start of every import. Combines two tiers:
//
//   • Explicit aliases — the user-curated table persisted on Drive.
//     Highest signal: the user has either explicitly created a rule or
//     confirmed an auto-pick by importing without changing it. We trust
//     these and surface very high confidence (0.97).
//
//   • Implicit patterns — extracted from the user's existing ledger.
//     If 80% of past transactions matching a fingerprint share the
//     same (type, category), use that. Lower confidence (0.78) because
//     the user never explicitly told us.
//
// The index is just a Map keyed by fingerprint. Lookups are O(1) once
// the fingerprint has been extracted.

import { extractMerchantFingerprint, fingerprintMatches } from "./fingerprint";

const IMPLICIT_MIN_OBSERVATIONS = 2;     // need at least this many tx with the same fp
const IMPLICIT_MIN_AGREEMENT = 0.65;     // dominant (type,cat) must hit this share
const IMPLICIT_LOOKBACK_DAYS = 365;      // train from the last year only

export function buildLearnedIndex(existingTransactions = [], merchantAliases = []) {
  // ── Explicit aliases (persisted) ────────────────────────
  const explicit = new Map();
  for (const a of merchantAliases ?? []) {
    if (!a?.pattern) continue;
    // Normalise stored patterns the same way fingerprints are produced
    // so a pattern entered as "blinkit" still matches "BLINKIT MUMBAI".
    explicit.set(String(a.pattern).toUpperCase().trim(), {
      transactionType: a.transactionType,
      category: a.category,
      paymentMode: a.paymentMode,
      confidence: 0.97,
      source: "alias",
      aliasKey: a.key,
    });
  }

  // ── Implicit patterns (derived) ─────────────────────────
  const cutoff =
    new Date().getTime() - IMPLICIT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const counts = new Map(); // fp → { (type|cat) → count, total }

  for (const t of existingTransactions) {
    if (!t?.name || !t?.transactionType || !t?.category) continue;
    if (t.occurredAt && new Date(t.occurredAt).getTime() < cutoff) continue;
    const fp = extractMerchantFingerprint(t.name);
    if (!fp) continue;
    if (!counts.has(fp)) counts.set(fp, { total: 0, byBucket: new Map() });
    const c = counts.get(fp);
    c.total++;
    const bucket = `${t.transactionType}|${t.category}|${t.paymentMode ?? ""}`;
    c.byBucket.set(bucket, (c.byBucket.get(bucket) ?? 0) + 1);
  }

  const implicit = new Map();
  for (const [fp, c] of counts.entries()) {
    if (c.total < IMPLICIT_MIN_OBSERVATIONS) continue;
    let bestBucket = null;
    let bestCount = 0;
    for (const [bucket, n] of c.byBucket.entries()) {
      if (n > bestCount) {
        bestBucket = bucket;
        bestCount = n;
      }
    }
    const share = bestCount / c.total;
    if (share < IMPLICIT_MIN_AGREEMENT) continue;
    const [transactionType, category, paymentMode] = bestBucket.split("|");
    implicit.set(fp, {
      transactionType,
      category,
      paymentMode: paymentMode || "Other",
      confidence: 0.78,
      source: "implicit",
      observations: c.total,
    });
  }

  return { explicit, implicit };
}

// Look up a parsed row in the learned index. Returns the matched entry
// or null. Explicit aliases win over implicit patterns even when the
// implicit match is more specific — user intent beats statistics.
export function lookupLearned(description, index) {
  const fp = extractMerchantFingerprint(description);
  if (!fp) return null;

  // Direct hit on explicit alias.
  if (index.explicit.has(fp)) return index.explicit.get(fp);

  // Fuzzy hit on explicit alias — substring either way.
  for (const [pattern, entry] of index.explicit.entries()) {
    if (fingerprintMatches(fp, pattern)) return entry;
  }

  // Direct hit on implicit patterns.
  if (index.implicit.has(fp)) return index.implicit.get(fp);

  // Fuzzy hit on implicit (less common — fingerprints from same source
  // are usually identical).
  for (const [pattern, entry] of index.implicit.entries()) {
    if (fingerprintMatches(fp, pattern)) return entry;
  }
  return null;
}

// Convenience for the commit step: take an imported row and produce
// the alias record we'd persist. Returns null when fingerprinting
// fails. The caller decides whether to actually persist (e.g. only if
// the user edited the auto-pick).
export function aliasFromRow(row) {
  const fp = extractMerchantFingerprint(row.description);
  if (!fp) return null;
  return {
    pattern: fp,
    transactionType: row.transactionType,
    category: row.category,
    paymentMode: row.paymentMode,
  };
}
