// ── Auto-deduct detector ───────────────────────────────
//
// Period-aware counterpart to sipDetector for the custom / Discover
// types that ship with an auto-deduct field — chit funds, APY, ULIP
// premiums, anything the user designed. Same approach: walk the
// investment's expected periods, skip periods already filled, and find
// imported rows whose amount matches and date falls in that period.
//
// Period granularity follows `autoDeduct.frequency`:
//   • monthly  → { year, month }
//   • quarterly → { year, quarter (0–3) }
//   • yearly   → { year }
//
// The configured `dayOfMonth` is no longer a hard gate — NACH-style
// debits routinely slip a few days for weekends/holidays. Day proximity
// is used as a tiebreaker when several candidates land in the same
// period, but no rows get dropped purely for "wrong day".
//
// The legacy aggregate row on the per-holding ledger collapses into
// real instalments as soon as the user accepts the suggestion.

import { findAutoDeductAmount } from "../../investmentUtils";

const AMOUNT_TOLERANCE = 1;

function dayOfMonth(iso) {
  return new Date(iso).getDate();
}

function txPeriodKey(d, frequency) {
  const yr = d.getFullYear();
  const mo = d.getMonth();
  if (frequency === "yearly") return `${yr}`;
  if (frequency === "quarterly") return `${yr}-Q${Math.floor(mo / 3)}`;
  return `${yr}-${mo}`;
}

function walkPeriods(startIso, endDate, frequency) {
  const start = new Date(startIso);
  const out = [];
  if (frequency === "yearly") {
    const curYr = endDate.getFullYear();
    for (let yr = start.getFullYear(); yr < curYr; yr++) {
      out.push({ key: `${yr}`, year: yr });
    }
    return out;
  }
  if (frequency === "quarterly") {
    let yr = start.getFullYear();
    let q = Math.floor(start.getMonth() / 3);
    const curYr = endDate.getFullYear();
    const curQ = Math.floor(endDate.getMonth() / 3);
    while (yr < curYr || (yr === curYr && q < curQ)) {
      out.push({ key: `${yr}-Q${q}`, year: yr, quarter: q });
      q++;
      if (q > 3) { q = 0; yr++; }
    }
    return out;
  }
  // monthly — include current month once past the 15th, like sipDetector.
  let yr = start.getFullYear();
  let mo = start.getMonth();
  const curYr = endDate.getFullYear();
  const curMo = endDate.getMonth();
  const curHalfDone = endDate.getDate() >= 15;
  while (
    yr < curYr ||
    (yr === curYr && (mo < curMo || (mo === curMo && curHalfDone)))
  ) {
    out.push({ key: `${yr}-${mo}`, year: yr, month: mo });
    mo++;
    if (mo > 11) { mo = 0; yr++; }
  }
  return out;
}

function fuzzyDescScore(tx, inv) {
  const desc = (tx.name ?? "").toLowerCase();
  const name = (inv.name ?? "").toLowerCase();
  if (!desc || !name) return 0;
  if (desc.includes(name) || name.includes(desc)) return 1;
  const words = name.split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return 0;
  const hits = words.filter((w) => desc.includes(w)).length;
  return hits / words.length;
}

export function detectAutoDeductMatches({
  importedTxs,
  autoDeductInvestments,
  allTransactions,
  userTypes,
  schemaResolver,
}) {
  const candidates = (importedTxs ?? []).filter(
    (t) => !t.sipInvestmentId && !t.autoDeductInvestmentId,
  );

  // Pre-index already-filled periods per investment, keyed by frequency.
  // We resolve frequency from the investment itself; one walk over the
  // ledger covers all of them.
  const invFreq = new Map();
  for (const inv of autoDeductInvestments ?? []) {
    invFreq.set(inv.id, inv.autoDeduct?.frequency || "monthly");
  }
  const filledByInv = new Map(); // invId → Set of period keys
  for (const t of allTransactions ?? []) {
    if (!t.autoDeductInvestmentId) continue;
    const freq = invFreq.get(t.autoDeductInvestmentId);
    if (!freq) continue;
    const key = txPeriodKey(new Date(t.occurredAt), freq);
    if (!filledByInv.has(t.autoDeductInvestmentId))
      filledByInv.set(t.autoDeductInvestmentId, new Set());
    filledByInv.get(t.autoDeductInvestmentId).add(key);
  }

  const now = new Date();
  const suggestions = [];

  for (const inv of autoDeductInvestments ?? []) {
    if (inv.inHistory || inv.paused) continue;
    if (!inv.autoDeduct?.enabled || !inv.startDate) continue;

    const schema =
      schemaResolver?.(inv.type, userTypes) ?? { rows: [], label: inv.type };
    const perPeriod = findAutoDeductAmount(inv, schema);
    if (perPeriod <= 0) continue;

    const frequency = inv.autoDeduct.frequency || "monthly";
    const dayCfg =
      parseInt(inv.autoDeduct.dayOfMonth) ||
      new Date(inv.startDate).getDate() ||
      1;

    const periods = walkPeriods(inv.startDate, now, frequency);
    const filled = filledByInv.get(inv.id) ?? new Set();
    const matches = [];

    for (const p of periods) {
      if (filled.has(p.key)) continue;

      const inPeriod = candidates.filter((tx) => {
        if (Math.abs(parseFloat(tx.amount) - perPeriod) > AMOUNT_TOLERANCE)
          return false;
        return txPeriodKey(new Date(tx.occurredAt), frequency) === p.key;
      });
      if (inPeriod.length === 0) continue;

      const best = inPeriod.sort((a, b) => {
        const aD = Math.abs(dayOfMonth(a.occurredAt) - dayCfg);
        const bD = Math.abs(dayOfMonth(b.occurredAt) - dayCfg);
        if (aD !== bD) return aD - bD;
        return a.occurredAt.localeCompare(b.occurredAt);
      })[0];

      matches.push({
        txId: best.id,
        occurredAt: best.occurredAt,
        amount: parseFloat(best.amount),
        nameMatch: fuzzyDescScore(best, inv),
        dayDelta: Math.abs(dayOfMonth(best.occurredAt) - dayCfg),
      });
    }

    if (matches.length === 0) continue;

    const avgDesc =
      matches.reduce((sum, m) => sum + m.nameMatch, 0) / matches.length;
    const confidence = 0.78 + 0.17 * avgDesc;

    suggestions.push({
      kind: "auto-deduct",
      key: `auto-${inv.id}`,
      investment: {
        id: inv.id,
        name: inv.name,
        type: inv.type,
        typeLabel: schema.label || inv.type,
        perPeriod,
        frequency,
      },
      matches,
      confidence,
    });
  }

  return suggestions.sort(
    (a, b) =>
      b.confidence * b.matches.length - a.confidence * a.matches.length,
  );
}
