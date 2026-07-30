import { useMemo } from "react";
import { useSelector } from "react-redux";
import { useDeepLinkNav } from "./useDeepLinkNav";
import { resolveShortcuts } from "../utils/shortcuts";

export function useShortcuts() {
  const preferences = useSelector(
    (state) => state.transactions.transactionData?.preferences,
  );
  const accessPages = useSelector((state) => state.access.pages);
  const deepNav = useDeepLinkNav();

  return useMemo(
    () =>
      resolveShortcuts(preferences?.shortcuts, {
        preferences,
        accessPages,
      }).map((s) => ({ ...s, run: () => deepNav(s.path) })),
    [preferences, accessPages, deepNav],
  );
}
