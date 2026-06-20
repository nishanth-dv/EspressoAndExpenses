import { memo } from "react";
import PropTypes from "prop-types";

// One-tap suggestion bar shown under the name field: "✨ ₹250 · Food · UPI ·
// HDFC — Use". Reads a prediction from smartFill and lets the user fill the
// whole form in a tap, or dismiss it.
const SmartFillBar = ({ prediction, accounts = [], onApply, onDismiss }) => {
  if (!prediction) return null;

  const bank = prediction.accountId
    ? accounts.find((a) => a.id === prediction.accountId)?.bank
    : null;

  const parts = [];
  if (prediction.amount) {
    parts.push(`₹${Number(prediction.amount).toLocaleString("en-IN")}`);
  }
  if (prediction.category) parts.push(prediction.category);
  if (prediction.paymentMode) parts.push(prediction.paymentMode);
  if (bank) parts.push(bank);
  if (parts.length === 0) return null;

  return (
    <div className="smartfill-bar">
      <button type="button" className="smartfill-apply" onClick={onApply}>
        <i className="fa-solid fa-wand-magic-sparkles" />
        <span className="smartfill-text">{parts.join(" · ")}</span>
        <span className="smartfill-cta">Use</span>
      </button>
      <button
        type="button"
        className="smartfill-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss suggestion"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
};

SmartFillBar.propTypes = {
  prediction: PropTypes.object,
  accounts: PropTypes.array,
  onApply: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
};

export default memo(SmartFillBar);
