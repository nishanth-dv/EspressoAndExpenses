// ── SIP detector ───────────────────────────────────────
//
// Scans the just-imported batch and proposes "tag these N rows as
// instalments of <SIP>".
//
// Matching strategy: PERIOD-based, not date-based. A SIP debit's intent
// is "this is the contribution for period X" — not "this happened on
// day Y". NACH mandates frequently slip a few days for weekends, bank
// holidays, or cut-off rules, and pinning matching to a day-of-month
// window quietly drops those rows.
//
// For each SIP we:
//   1. Walk the expected monthly periods from startDate → now.
//   2. Subtract periods already filled by transactions tagged with the
//      SIP's id (so we don't propose tagging a tx the user has already
//      reconciled in a prior import).
//   3. For each remaining open period, find imported rows where:
//        • amount equals monthlyAmount (±₹1)
//        • occurredAt falls inside the period
//   4. When multiple candidates exist for one period, pick the one
//      closest to the configured sipDay as a tiebreaker.
//   5. Description fuzzy-match against the SIP name nudges confidence.
//
// Returns at most one suggestion per SIP, with all matched rows
// grouped — applying the suggestion tags them in one go.

const AMOUNT_TOLERANCE = 1; // rupees

function dayOfMonth(iso) {
  return new Date(iso).getDate();
}

function sameMonth(aDate, year, month) {
  return aDate.getFullYear() === year && aDate.getMonth() === month;
}

function walkMonthlyPeriods(startIso, endDate) {
  // Yields { year, month } for every month strictly before endDate's
  // month, starting from startIso's month. The "current" month is
  // included only if endDate is past the 15th — by then any reasonable
  // monthly debit should have landed.
  const start = new Date(startIso);
  const out = [];
  let yr = start.getFullYear();
  let mo = start.getMonth();
  const curYr = endDate.getFullYear();
  const curMo = endDate.getMonth();
  const curHalfDone = endDate.getDate() >= 15;
  while (
    yr < curYr ||
    (yr === curYr && (mo < curMo || (mo === curMo && curHalfDone)))
  ) {
    out.push({ year: yr, month: mo });
    mo++;
    if (mo > 11) { mo = 0; yr++; }
  }
  return out;
}

function fuzzyDescScore(tx, sip) {
  const desc = (tx.name ?? "").toLowerCase();
  const name = (sip.name ?? "").toLowerCase();
  if (!desc || !name) return 0;
  if (desc.includes(name) || name.includes(desc)) return 1;
  const words = name.split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return 0;
  const hits = words.filter((w) => desc.includes(w)).length;
  return hits / words.length;
}

export function detectSipMatches({
  importedTxs,
  sipInvestments,
  allTransactions,
}) {
  const candidates = (importedTxs ?? []).filter(
    (t) => !t.sipInvestmentId && !t.autoDeductInvestmentId,
  );

  // Pre-index already-filled periods per SIP — one pass over the full
  // ledger. The matching loop below stays O(periods × candidates).
  const filledBySip = new Map();
  for (const t of allTransactions ?? []) {
    if (!t.sipInvestmentId) continue;
    const d = new Date(t.occurredAt);
    const key = `${t.sipInvestmentId}-${d.getFullYear()}-${d.getMonth()}`;
    filledBySip.set(key, true);
  }

  const now = new Date();
  const suggestions = [];

  for (const sip of sipInvestments ?? []) {
    if (sip.inHistory || sip.paused) continue;
    const amt = parseFloat(sip.monthlyAmount);
    if (!amt || !sip.startDate) continue;

    const sipDay =
      parseInt(sip.sipDay) || new Date(sip.startDate).getDate() || 1;

    const periods = walkMonthlyPeriods(sip.startDate, now);
    const matches = [];

    for (const p of periods) {
      const key = `${sip.id}-${p.year}-${p.month}`;
      if (filledBySip.has(key)) continue; // already reconciled

      // Find every candidate that matches by amount and falls in this
      // calendar month. Pick the one whose day is closest to the
      // configured sipDay; ties broken by occurredAt to make the
      // outcome deterministic.
      const inPeriod = candidates.filter((tx) => {
        if (Math.abs(parseFloat(tx.amount) - amt) > AMOUNT_TOLERANCE) return false;
        return sameMonth(new Date(tx.occurredAt), p.year, p.month);
      });
      if (inPeriod.length === 0) continue;

      const best = inPeriod.sort((a, b) => {
        const aD = Math.abs(dayOfMonth(a.occurredAt) - sipDay);
        const bD = Math.abs(dayOfMonth(b.occurredAt) - sipDay);
        if (aD !== bD) return aD - bD;
        return a.occurredAt.localeCompare(b.occurredAt);
      })[0];

      matches.push({
        txId: best.id,
        occurredAt: best.occurredAt,
        amount: parseFloat(best.amount),
        nameMatch: fuzzyDescScore(best, sip),
        dayDelta: Math.abs(dayOfMonth(best.occurredAt) - sipDay),
      });
    }

    if (matches.length === 0) continue;

    // Baseline 0.80 for amount + period; up to +0.15 for description
    // similarity. Day proximity feeds an informational pill in the UI
    // but doesn't gate the match anymore.
    const avgDesc =
      matches.reduce((sum, m) => sum + m.nameMatch, 0) / matches.length;
    const confidence = 0.8 + 0.15 * avgDesc;

    suggestions.push({
      kind: "sip",
      key: `sip-${sip.id}`,
      sip: {
        id: sip.id,
        name: sip.name,
        monthlyAmount: amt,
        sipDay,
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
