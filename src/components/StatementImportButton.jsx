// ── StatementImportButton ──────────────────────────────
//
// Small reusable trigger that holds its own modal state. Drop this in
// any page header / quick-action card; it handles open + close + the
// rest of the import flow internally so callers don't manage state.
//
// Variants:
//   • "compact"  — icon + short label, fits a filter-bar row
//   • "card"     — wider tile with subtitle, for dashboard sections

import { memo, useState } from "react";
import PropTypes from "prop-types";
import StatementImportModal from "./StatementImportModal";

const StatementImportButton = ({ variant = "compact", className }) => {
  const [open, setOpen] = useState(false);

  if (variant === "card") {
    return (
      <>
        <button
          type="button"
          className={`stmt-launch-card ${className ?? ""}`}
          onClick={() => setOpen(true)}
        >
          <span className="stmt-launch-card-icon">
            <i className="fa-solid fa-file-arrow-up" />
          </span>
          <span className="stmt-launch-card-text">
            <span className="stmt-launch-card-title">Import a statement</span>
            <span className="stmt-launch-card-sub">
              Drop a CSV from your bank to backfill the ledger.
            </span>
          </span>
          <i className="fa-solid fa-chevron-right stmt-launch-card-chev" />
        </button>
        <StatementImportModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`stmt-launch-btn ${className ?? ""}`}
        onClick={() => setOpen(true)}
        title="Import a bank statement"
      >
        <i className="fa-solid fa-file-arrow-up" />
        <span>Import statement</span>
      </button>
      <StatementImportModal open={open} onClose={() => setOpen(false)} />
    </>
  );
};

StatementImportButton.propTypes = {
  variant: PropTypes.oneOf(["compact", "card"]),
  className: PropTypes.string,
};

export default memo(StatementImportButton);
