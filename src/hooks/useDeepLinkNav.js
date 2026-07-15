import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

// Navigate the way the normal router hook does, but tag the jump as a deep-link
// redirect by stamping the origin onto history state. The app-wide <DeepLinkBack>
// bar reads that stamp to offer a "back to where you came from" button — so this
// works even when the target is a bare page (no ?highlight), which query-param
// sniffing alone can't detect. Use it for any programmatic cross-page jump to a
// specific item (advisory cards, notifications, calendar, transaction links…).
export function useDeepLinkNav() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (to, options = {}) => {
      const from = location.pathname + location.search;
      navigate(to, {
        ...options,
        state: { ...(options.state || {}), deepLinkFrom: from },
      });
    },
    [navigate, location.pathname, location.search],
  );
}
