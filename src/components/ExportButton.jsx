import { memo, useMemo, useState, useRef } from "react";
import PropTypes from "prop-types";
import { useSelector, useDispatch } from "react-redux";
import { showToast } from "../redux/slices/toastSlice";
import Modal from "../preStyledElements/modal/Modal";
import { applyFilter, getFilterLabel, getFilterFilename } from "../utils/filterUtils";
import { exportToExcel, exportToPDF } from "../utils/exportUtils";

const SECTIONS = [
  { key: "dashboard",    label: "Dashboard",    icon: "fa-chart-pie" },
  { key: "transactions", label: "Transactions", icon: "fa-list" },
  { key: "investments",  label: "Investments",  icon: "fa-seedling" },
  { key: "solvency",     label: "Solvency",     icon: "fa-shield-halved" },
];

const FORMATS = [
  { key: "excel", label: "Excel", icon: "fa-file-excel" },
  { key: "pdf",   label: "PDF",   icon: "fa-file-pdf" },
];

const ExportButton = ({ scope = "transactions" }) => {
  const dispatch = useDispatch();
  const allTransactions = useSelector((s) => s.transactions.transactionData?.transactions ?? []);
  const insights      = useSelector((s) => s.transactions.transactionData?.insights ?? {});
  const budgets       = useSelector((s) => s.transactions.transactionData?.budgets ?? {});
  const investments   = useSelector((s) => s.transactions.transactionData?.investments ?? []);
  const cards         = useSelector((s) => s.transactions.transactionData?.cards ?? []);
  const commitments   = useSelector((s) => s.transactions.transactionData?.commitments ?? []);
  const lendings      = useSelector((s) => s.transactions.transactionData?.lendings ?? []);
  const filter        = useSelector((s) => s.filter[scope]);

  const transactions   = useMemo(() => applyFilter(allTransactions, filter), [allTransactions, filter]);
  const filterLabel    = getFilterLabel(filter);
  const filterFilename = getFilterFilename(filter);

  const [open, setOpen]             = useState(false);
  const [format, setFormat]         = useState("excel");
  const [sections, setSections]     = useState({ dashboard: true, transactions: true, investments: true, solvency: true });
  const [filenameStem, setFilenameStem] = useState("");
  const [editingName, setEditingName]   = useState(false);
  const [downloading, setDownloading]   = useState(false);
  const filenameRef = useRef(null);

  const noneSelected = !Object.values(sections).some(Boolean);
  const ext      = format === "excel" ? "xlsx" : "pdf";

  function handleOpen() {
    setFilenameStem(filterFilename);
    setEditingName(false);
    setOpen(true);
  }

  function toggle(key) {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  }

  function handleEditClick() {
    setEditingName(true);
    setTimeout(() => {
      filenameRef.current?.focus();
      filenameRef.current?.select();
    }, 0);
  }

  async function handleDownload() {
    if (noneSelected || downloading) return;
    const stem = filenameStem.trim() || filterFilename;
    const data = { transactions, allTransactions, insights, budgets, investments, cards, commitments, lendings, sections };
    setDownloading(true);
    try {
      if (format === "excel") await exportToExcel(data, filterLabel, stem);
      else await exportToPDF(data, filterLabel, stem);
      dispatch(showToast({ message: `${format === "excel" ? "Excel" : "PDF"} downloaded` }));
      setOpen(false);
    } catch {
      dispatch(showToast({ message: "Download failed", type: "error" }));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <button className="export-trigger" onClick={handleOpen} title="Download">
        <i className="fa-solid fa-download" />
        <span className="export-trigger-label">Download</span>
      </button>

      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title="Download Report">
          <div className="export-modal">
            <p className="export-modal-label">Include</p>
            <div className="export-sections">
              {SECTIONS.map((s) => (
                <label key={s.key} className="export-section-item">
                  <input type="checkbox" checked={sections[s.key]} onChange={() => toggle(s.key)} />
                  <i className={`fa-solid ${s.icon}`} />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>

            <p className="export-modal-label">Format</p>
            <div className="export-format-row">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  className={`export-format-pill${format === f.key ? " export-format-pill--active" : ""}`}
                  onClick={() => setFormat(f.key)}
                >
                  <i className={`fa-solid ${f.icon}`} />
                  {f.label}
                </button>
              ))}
            </div>

            <p className="export-modal-label">File name</p>
            <div className="export-filename-wrap">
              <input
                ref={filenameRef}
                className={`export-filename-input${editingName ? " export-filename-input--editing" : ""}`}
                value={filenameStem}
                onChange={(e) => setFilenameStem(e.target.value)}
                readOnly={!editingName}
                onBlur={() => setEditingName(false)}
              />
              <span className="export-filename-ext">.{ext}</span>
              <button className="export-filename-edit-btn" onClick={handleEditClick} title="Edit filename" type="button">
                <i className="fa-solid fa-pen" />
              </button>
            </div>

            <div className="form-actions export-confirm-actions">
              <button className="cancel-button" onClick={() => setOpen(false)} disabled={downloading}>Cancel</button>
              <button className="export-confirm-btn" onClick={handleDownload} disabled={noneSelected || downloading}>
                <i className={`fa-solid ${downloading ? "fa-spinner fa-spin" : format === "excel" ? "fa-file-excel" : "fa-file-pdf"}`} />
                {downloading ? "Preparing…" : "Download"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

ExportButton.propTypes = {
  scope: PropTypes.oneOf(["transactions", "investments"]),
};

export default memo(ExportButton);
