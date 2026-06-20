import { useMemo } from "react";
import { useSelector } from "react-redux";
import { deriveNotifications } from "../utils/notificationEngine";

// The single source of truth for the bell badge and the modal. Derives the
// live notification list from the user's data and subtracts anything they've
// dismissed (whose dismissal hasn't yet expired). Returns the visible items
// plus a count; both consumers read the same memoised result.
//
// `notificationsEnabled === false` short-circuits to an empty list, so the
// whole feature can be switched off from Preferences → General.
export default function useNotifications() {
  const data = useSelector((s) => s.transactions.transactionData);
  const prefs = data?.preferences;

  return useMemo(() => {
    if (!prefs?.notificationsEnabled) return { items: [], count: 0 };
    const all = deriveNotifications(data, prefs);
    const dismissals = data?.notificationDismissals ?? {};
    const now = Date.now();
    const items = all.filter((n) => {
      if (!Object.prototype.hasOwnProperty.call(dismissals, n.id)) return true;
      const expiry = dismissals[n.id];
      // A null expiry is a permanent acknowledgement (milestones) — always
      // hidden. A timed dismissal hides the item only until it expires, after
      // which the notification shows again.
      if (expiry == null) return false;
      return new Date(expiry).getTime() <= now;
    });
    return { items, count: items.length };
  }, [data, prefs]);
}
