// Cross-module reconciliation — the "one coherent plan, not 24 shouting cards"
// layer. Individual modules are pure and independent, so they can contradict
// each other: "deploy your spare cash" next to "your emergency fund is short",
// or "step up your SIP" while "you're spending more than you earn".
//
// This post-pass runs AFTER ranking. It never deletes advice — it detects known
// conflicts, keeps the foundational card leading, and demotes the card that only
// makes sense once the foundation is in place (annotating WHY it was held back).
// Demoted cards sink below the active ones but stay visible and actionable.

// Foundation-first rules. When a "trigger" card is live, the "demote" cards are
// pushed down with a short note explaining the sequencing.
const RULES = [
  {
    when: (ids) => ids.has("emergency-fund"),
    demote: (c) => c.id === "idle-cash" || c.id.startsWith("opp-") || c.category === "goal",
    note: "Build your emergency fund first — then put spare cash to work.",
  },
  {
    // Not saving / overstretched → don't lead with "invest more".
    when: (ids) => ids.has("savings-rate") || ids.has("debt-dti"),
    demote: (c) =>
      c.id === "sip-stepup" ||
      c.id === "idle-cash" ||
      c.id.startsWith("opp-") ||
      c.category === "goal",
    note: "Free up cash flow first — this can wait until you're saving steadily.",
  },
  {
    // A live loss-harvest and an equity-trim both touch the same equity sleeve;
    // lead with the tax move, sequence the rebalance after it.
    when: (ids) => ids.has("tax-harvest") || ids.has("tax-ltcg"),
    demote: (c) => c.id === "alloc-equity",
    note: "Do the tax booking first, then rebalance what's left — it's more tax-efficient.",
  },
];

// Returns a new array: same cards, conflicting ones demoted (flagged with
// `conflictNote`) and moved after the un-demoted set, order otherwise preserved.
export function reconcile(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return cards ?? [];
  const ids = new Set(cards.map((c) => c.id));

  const notes = new Map(); // cardId -> first note that demoted it
  for (const rule of RULES) {
    if (!rule.when(ids)) continue;
    for (const c of cards) {
      if (notes.has(c.id)) continue;
      // Never demote the trigger card itself by its own rule.
      if (rule.demote(c)) notes.set(c.id, rule.note);
    }
  }
  if (notes.size === 0) return cards;

  const keep = [];
  const held = [];
  for (const c of cards) {
    if (notes.has(c.id)) held.push({ ...c, conflictNote: notes.get(c.id) });
    else keep.push(c);
  }
  return [...keep, ...held];
}
