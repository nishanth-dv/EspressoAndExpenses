import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { labelForPath } from "../utils/pages";

// A single, app-wide "back to where you came from" control. Mounted once in the
// persistent Home layout, it reads the `deepLinkFrom` stamp left by
// useDeepLinkNav on any programmatic redirect and offers a button back to that
// origin. The origin is latched into state so it survives the target page
// clearing its own query params/state (which drops history state); it's cleared
// only when the user navigates to a different page without a fresh stamp.
//
// State is adjusted during render (the documented React pattern for deriving
// state from changing props) rather than in an effect, so there's no extra
// render pass and no set-state-in-effect.
export default function DeepLinkBack() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.deepLinkFrom || null;

  const [back, setBack] = useState(from);
  const [prevPath, setPrevPath] = useState(location.pathname);

  if (location.pathname !== prevPath) {
    // Landed on a new page: latch the origin if this was a redirect, else drop.
    setPrevPath(location.pathname);
    setBack(from);
  } else if (from && from !== back) {
    // Same page, but a fresh redirect stamp arrived.
    setBack(from);
  }

  if (!back) return null;

  const goBack = () => {
    const to = back;
    setBack(null);
    navigate(to);
  };

  return (
    <div className="deeplink-back-bar">
      <button type="button" className="deeplink-back" onClick={goBack}>
        <i className="fa-solid fa-arrow-left" />
        <span>Back to {labelForPath(back)}</span>
      </button>
    </div>
  );
}
