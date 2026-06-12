import { memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { persistSetPreference } from "../redux/slices/transactionSlice";

// A slim sticky banner that appears below the navbar whenever privacy mode
// is enabled. Acts as the persistent visual cue (so the user knows their
// amounts are hidden) plus a hint on how to peek at them. A small turn-off
// button lets the user disable privacy without navigating to Preferences.
const PrivacyBanner = () => {
  const dispatch = useDispatch();
  const privacyMode = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.privacyMode ?? false,
  );

  if (!privacyMode) return null;

  return (
    <div className="privacy-banner" role="status" aria-live="polite">
      <i className="fa-solid fa-eye-slash privacy-banner-icon" />
      <span>Privacy mode is on</span>
      <span className="privacy-banner-hint">
        Tap &amp; hold any card to peek
      </span>
      <button
        type="button"
        className="privacy-banner-off"
        onClick={() => dispatch(persistSetPreference("privacyMode", false))}
        aria-label="Turn off privacy mode"
      >
        Turn off
      </button>
    </div>
  );
};

export default memo(PrivacyBanner);
