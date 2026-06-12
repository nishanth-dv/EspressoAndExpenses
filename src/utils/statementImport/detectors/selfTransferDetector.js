// ── Self-transfer detector ─────────────────────────────
//
// Hunts for paired entries within the imported batch that look like
// money moved between the user's own accounts: same amount, one income
// + one expense (or two opposite-direction txs), dates within ±2 days.
//
// We only operate within the imported batch — never against the
// existing ledger. Cross-import pair detection is too easy to get
// wrong (e.g., a salary credit + a coincidental matching rent expense
// from the prior month). Within-batch is the safe scope: if both
// statements were just imported in one session, the pairing is intent-
// ional and obvious.
//
// Confidence ramps up when descriptions reinforce the signal — either
// side mentioning the other side's bank, or strings like "SELF",
// "TPT", "OWN ACCOUNT", "TRANSFER FROM" / "TRANSFER TO".

const AMOUNT_TOLERANCE = 1;
const DAY_TOLERANCE = 2;

const STRONG_TRANSFER_HINTS = [
  /\bself\b/i,
  /\btpt\b/i,
  /\bown\s+account\b/i,
  /\btransfer\s+(to|from)\b/i,
  /\bint(er)?\s+bank\b/i,
];

function daysApart(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function hasTransferHint(desc) {
  if (!desc) return false;
  return STRONG_TRANSFER_HINTS.some((re) => re.test(desc));
}

function mentionsBank(desc, banks) {
  if (!desc) return null;
  const d = desc.toLowerCase();
  return (banks ?? []).find((b) => b && d.includes(b.toLowerCase())) ?? null;
}

export function detectSelfTransfers({ importedTxs, banks }) {
  const txs = (importedTxs ?? []).filter(
    (t) =>
      t.transactionType !== "self_transfer" &&
      !t.sipInvestmentId &&
      !t.autoDeductInvestmentId,
  );

  // Bucket by absolute amount so we can find pairs efficiently.
  const byAmount = new Map();
  for (const t of txs) {
    const amt = Math.round(parseFloat(t.amount) || 0);
    if (!amt) continue;
    if (!byAmount.has(amt)) byAmount.set(amt, []);
    byAmount.get(amt).push(t);
  }

  const suggestions = [];
  const usedIds = new Set();

  for (const [amt, group] of byAmount.entries()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      if (usedIds.has(a.id)) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j];
        if (usedIds.has(b.id)) continue;

        // One must be income, the other not — or, generously, the two
        // must have opposite "directions" in their original types.
        const isMirror =
          (a.transactionType === "income" && b.transactionType !== "income") ||
          (b.transactionType === "income" && a.transactionType !== "income");
        if (!isMirror) continue;
        if (daysApart(a.occurredAt, b.occurredAt) > DAY_TOLERANCE) continue;
        if (Math.abs(parseFloat(a.amount) - parseFloat(b.amount)) > AMOUNT_TOLERANCE)
          continue;

        // Confidence: amount-and-date-match alone is 0.6; description
        // hints on either side push it up. A bank name on one side
        // that matches a known bank in the user's accounts list is
        // the strongest signal short of an explicit "SELF".
        let conf = 0.6;
        if (hasTransferHint(a.name) || hasTransferHint(b.name)) conf += 0.2;
        if (mentionsBank(a.name, banks) || mentionsBank(b.name, banks)) conf += 0.1;

        suggestions.push({
          kind: "self-transfer",
          key: `self-${a.id}-${b.id}`,
          amount: Math.abs(amt),
          fromTx: a.transactionType === "income" ? b : a,
          toTx: a.transactionType === "income" ? a : b,
          confidence: Math.min(0.95, conf),
        });
        usedIds.add(a.id);
        usedIds.add(b.id);
        break;
      }
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
