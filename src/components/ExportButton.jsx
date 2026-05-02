import { memo, useMemo, useState, useRef, useEffect } from "react";
import { useSelector } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import { applyFilter, getFilterLabel, getFilterFilename } from "../utils/filterUtils";
import { exportToExcel, exportToPDF } from "../utils/exportUtils";

const OPTIONS = [
  { key: "excel", label: "Excel", icon: "fa-file-excel" },
  { key: "pdf",   label: "PDF",   icon: "fa-file-pdf"   },
];

const ExportButton = () => {
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? []
  );
  const insights = useSelector(
    (state) => state.transactions.transactionData?.insights ?? {}
  );
  const budgets = useSelector(
    (state) => state.transactions.transactionData?.budgets ?? {}
  );
  const filter = useSelector((state) => state.filter);

  const transactions = useMemo(
    () => applyFilter(allTransactions, filter),
    [allTransactions, filter]
  );
  const filterLabel = getFilterLabel(filter);
  const filterFilename = getFilterFilename(filter);

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(null); // "excel" | "pdf"
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target))
        setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  function handleConfirm() {
    if (pending === "excel")
      exportToExcel(transactions, allTransactions, insights, budgets, filterLabel, filterFilename);
    else if (pending === "pdf")
      exportToPDF(transactions, allTransactions, insights, budgets, filterLabel, filterFilename);
    setPending(null);
  }

  return (
    <>
      <div className="export-wrapper" ref={wrapperRef}>
        <button
          className={`export-trigger${open ? " export-trigger--open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          title="Download"
        >
          <i className="fa-solid fa-download" />
          <span className="export-trigger-label">Download</span>
        </button>

        {open && (
          <div className="export-dropdown">
            {OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className="export-dropdown-item"
                onClick={() => { setOpen(false); setPending(opt.key); }}
              >
                <i className={`fa-solid ${opt.icon}`} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <Modal open={!!pending} onClose={() => setPending(null)} title="Download Report">
          <div className="export-confirm">
            <p className="export-confirm-msg">
              Download as <strong>{pending === "excel" ? "Excel" : "PDF"}</strong>
              {filterLabel
                ? <> for <strong>{filterLabel}</strong></>
                : " for all transactions"}?
            </p>
            <div className="form-actions export-confirm-actions">
              <button className="cancel-button" onClick={() => setPending(null)}>Cancel</button>
              <button className="export-confirm-btn" onClick={handleConfirm}>
                <i className={`fa-solid ${pending === "excel" ? "fa-file-excel" : "fa-file-pdf"}`} />
                Download
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default memo(ExportButton);
