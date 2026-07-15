// Shared per-card action state for Advisory — the "close the loop" layer.
// Persisted under preferences.advisoryState = { [cardId]: { status, until? } }.
//   status: "done" | "dismissed" | "snoozed"
// A snooze self-expires once `until` passes, so the map never needs cleanup —
// the card simply reappears. Both the Actions and Review lenses use this.

export const SNOOZE_DAYS = 30;

export function snoozeUntil(days = SNOOZE_DAYS) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// Effective status of a card right now (null = active/visible).
export function statusOf(state, id, now = Date.now()) {
  const e = state?.[id];
  if (!e) return null;
  if (e.status === "snoozed") {
    if (!e.until || new Date(e.until).getTime() <= now) return null; // lapsed
    return "snoozed";
  }
  return e.status; // done | dismissed
}

export function isSuppressed(state, id, now = Date.now()) {
  return statusOf(state, id, now) != null;
}

// Immutably set/clear a card's entry; returns the next map for persisting.
export function setCardState(state, id, entry) {
  const next = { ...(state || {}) };
  if (entry == null) delete next[id];
  else next[id] = entry;
  return next;
}

export const STATUS_LABEL = {
  done: "Done",
  snoozed: "Snoozed",
  dismissed: "Dismissed",
};
