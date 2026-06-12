// ── Reconciliation detector orchestrator ───────────────
//
// Runs all detectors against the just-imported batch + current ledger
// state. Each detector returns its suggestions independently; the
// orchestrator concatenates and sorts so the modal can show them in
// one ranked list.
//
// Inputs:
//   importedTxIds: Set of transaction IDs just committed
//   transactions:  full ledger (post-commit)
//   investments:   full investments array
//   userTypes:     custom investment type schemas
//   banks:         the user's known bank names (for self-transfer hint matching)
//   schemaResolver: a function (typeKey, userTypes) → schema (lazy-injected
//                  so detectors stay pure)
//
// Output: ordered array of suggestion objects. Each one is rendered as
// a card in the reconciliation step.

import { detectSipMatches } from "./sipDetector";
import { detectAutoDeductMatches } from "./autoDeductDetector";
import { detectSelfTransfers } from "./selfTransferDetector";

export function runDetectors({
  importedTxIds,
  transactions,
  investments,
  userTypes,
  banks,
  schemaResolver,
}) {
  const importedTxs = (transactions ?? []).filter((t) =>
    importedTxIds.has(t.id),
  );

  const sipInvestments = (investments ?? []).filter((i) => i.type === "sip");
  const autoDeductInvestments = (investments ?? []).filter(
    (i) => i.autoDeduct?.enabled && i.type !== "sip",
  );

  const sipSuggestions = detectSipMatches({
    importedTxs,
    sipInvestments,
    allTransactions: transactions,
  });
  const autoSuggestions = detectAutoDeductMatches({
    importedTxs,
    autoDeductInvestments,
    allTransactions: transactions,
    userTypes,
    schemaResolver,
  });
  const selfSuggestions = detectSelfTransfers({
    importedTxs,
    banks,
  });

  // Combine and re-sort. SIP / auto-deduct matches lead because they
  // unlock concrete portfolio behaviour (SIP-tagged rows reduce the
  // "Legacy Investment" aggregate, etc.). Self-transfer matches follow.
  return [...sipSuggestions, ...autoSuggestions, ...selfSuggestions];
}
