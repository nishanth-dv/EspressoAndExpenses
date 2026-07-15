// Advisory feedback loop — the "learn from what the user does" layer.
//
// Persisted under preferences.advisoryFeedback:
//   { acted: { count, saving, lastAt }, dismissed: { [category]: count } }
//
// Two jobs:
//  1. A lifetime tally of what the user has actioned (count + ₹/yr they locked
//     in) — closes the loop so the page shows progress, not just a to-do list.
//  2. Category fatigue — a category the user keeps dismissing gets demoted in
//     the ranking, so the engine stops leading with advice they don't want.
//
// Per-card done/snooze/dismiss still lives in state.js; this is the aggregate,
// cross-session signal derived from those same actions.

export const EMPTY_FEEDBACK = { acted: { count: 0, saving: 0, lastAt: null }, dismissed: {} };

// Normalise a stored (possibly partial/legacy) feedback blob.
export function readFeedback(fb) {
  const acted = fb?.acted ?? {};
  return {
    acted: {
      count: Number(acted.count) || 0,
      saving: Number(acted.saving) || 0,
      lastAt: acted.lastAt ?? null,
    },
    dismissed: fb?.dismissed && typeof fb.dismissed === "object" ? { ...fb.dismissed } : {},
  };
}

// Fold a card action into the feedback blob, returning the next blob to persist.
// `status` is the new per-card state: "done" | "dismissed" | "snoozed" | null.
export function recordFeedback(fb, card, status) {
  const next = readFeedback(fb);
  if (status === "done") {
    next.acted = {
      count: next.acted.count + 1,
      saving: next.acted.saving + (Number(card?.saving) || 0),
      lastAt: new Date().toISOString(),
    };
  } else if (status === "dismissed") {
    const cat = card?.category || "other";
    next.dismissed[cat] = (next.dismissed[cat] || 0) + 1;
  }
  return next;
}

// Ranking multiplier for a category based on how often its advice is dismissed.
// The first dismissal is free (people dismiss one-offs); repeated dismissals in
// the same category progressively push it down. Never zero — the user can still
// find it, it just stops leading.
export function categoryWeight(fb, category) {
  const n = readFeedback(fb).dismissed[category] || 0;
  if (n <= 1) return 1;
  if (n === 2) return 0.7;
  if (n === 3) return 0.5;
  return 0.35;
}

// Lifetime "you acted on…" summary for the header strip.
export function actedSummary(fb) {
  return readFeedback(fb).acted;
}
