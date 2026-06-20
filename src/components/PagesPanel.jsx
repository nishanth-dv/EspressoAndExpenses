// ── PagesPanel ──────────────────────────────────────────
//
// Preferences → Pages. Lets the user turn optional pages on/off. Mandatory
// pages (Dashboard, Transactions) are shown locked. Toggling writes the
// enabled set to preferences.enabledPages, which drives the navbar, the mobile
// drawer and route gating. Built to scale — rows come straight from the page
// registry, so new pages appear here automatically.

import { memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { persistSetPreference } from "../redux/slices/transactionSlice";
import { APP_PAGES, OPTIONAL_PAGE_KEYS, isPageEnabled } from "../utils/pages";

const PagesPanel = () => {
  const dispatch = useDispatch();
  const preferences = useSelector(
    (state) => state.transactions.transactionData?.preferences,
  );

  function toggle(key) {
    // Current enabled optional set, defaulting to "all on" when unset.
    const current = OPTIONAL_PAGE_KEYS.filter((k) =>
      isPageEnabled(k, preferences),
    );
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    // Persist in registry order for stable nav ordering.
    const ordered = OPTIONAL_PAGE_KEYS.filter((k) => next.includes(k));
    dispatch(persistSetPreference("enabledPages", ordered));
  }

  return (
    <>
      <p className="pref-section-hint">
        Choose which pages appear in your navigation. Dashboard and Transactions
        are the core of the tracker and stay on. Turning a page off hides it
        everywhere; turn it back on any time — your data is never deleted.
      </p>

      <ul className="pref-pages-list">
        {APP_PAGES.map((p) => {
          const on = isPageEnabled(p.key, preferences);
          return (
            <li key={p.key} className="pref-page-row">
              <span className="pref-page-icon">
                <i className={`fa-solid ${p.icon}`} />
              </span>
              <div className="pref-page-meta">
                <span className="pref-page-name">
                  {p.label}
                  {p.mandatory && (
                    <span className="pref-page-lock">
                      <i className="fa-solid fa-lock" /> Core
                    </span>
                  )}
                </span>
                <span className="pref-page-blurb">{p.blurb}</span>
              </div>
              {p.mandatory ? (
                <span className="pref-page-always">Always on</span>
              ) : (
                <button
                  type="button"
                  className={`pref-switch${on ? " pref-switch--on" : ""}`}
                  role="switch"
                  aria-checked={on}
                  aria-label={`${on ? "Disable" : "Enable"} ${p.label}`}
                  onClick={() => toggle(p.key)}
                >
                  <span className="pref-switch-thumb" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
};

export default memo(PagesPanel);
