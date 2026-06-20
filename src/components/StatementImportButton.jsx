// ── StatementImportButton ──────────────────────────────
//
// Small reusable trigger that holds its own modal state. Drop this in
// any page header / quick-action card; it handles open + close + the
// rest of the import flow internally so callers don't manage state.
//
// Variants:
//   • "compact"  — icon + short label, fits a filter-bar row
//   • "card"     — wider tile with subtitle, for dashboard sections

import { memo, lazy, Suspense, useState } from "react";
import PropTypes from "prop-types";

// The import modal drags in the statement parsers (xlsx + pdfjs, ~2 MB of
// worker code). Lazy-load it and only mount once the user opens it, so none
// of that ships until a statement import is actually started.
const StatementImportModal = lazy(() => import("./StatementImportModal"));

const StatementImportButton = ({ variant = "compact", className }) => {
  const [open, setOpen] = useState(false);

  const modal = open && (
    <Suspense fallback={null}>
      <StatementImportModal open={open} onClose={() => setOpen(false)} />
    </Suspense>
  );

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
        {modal}
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
      {modal}
    </>
  );
};

StatementImportButton.propTypes = {
  variant: PropTypes.oneOf(["compact", "card"]),
  className: PropTypes.string,
};

export default memo(StatementImportButton);
