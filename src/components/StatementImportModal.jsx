// ── StatementImportModal ───────────────────────────────
//
// Phase A of the bank-statement importer. Two input modes:
//   1. File drop / pick — CSV / TXT for v1 (PDF + xlsx land in Phase B)
//   2. Paste-from-clipboard — handy for bank apps with no export
//
// Pipeline (all client-side, no upload):
//   parseStatement → classifier → dedupe → review table → bulk dispatch
//
// The review table lets the user toggle each row's inclusion, edit the
// type / category / payment mode, and skip rows that already exist in
// the ledger (auto-detected via date+amount match). Confidence colours
// guide the eye toward rows that need attention.

import { memo, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import {
  parseStatementText,
  parseStatementFile,
  PasswordRequiredError,
  PasswordIncorrectError,
} from "../utils/statementImport";
import { aliasFromRow } from "../utils/statementImport/learnedIndex";
import { runDetectors } from "../utils/statementImport/detectors";
import {
  persistBulkImport,
  persistMerchantAliases,
  persistBulkUpdateTransactions,
  persistMergeAsSelfTransfer,
} from "../redux/slices/transactionSlice";
import { getInvestmentTypeSchema } from "../utils/investmentTypeSchemas";
import { CATEGORIES, INCOME_CATEGORIES, PAYMENT_MODES } from "../utils/constants";

const TYPE_OPTIONS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "investment", label: "Investment" },
];

function categoryOptionsFor(type) {
  if (type === "income") return INCOME_CATEGORIES;
  if (type === "investment") return ["Investment"];
  return CATEGORIES;
}

function INR(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const StatementImportModal = ({ open, onClose }) => {
  const dispatch = useDispatch();
  const autoRules = useSelector(
    (s) => s.transactions.transactionData?.autoCategoryRules ?? [],
  );
  const existingTransactions = useSelector(
    (s) => s.transactions.transactionData?.transactions ?? [],
  );
  const merchantAliases = useSelector(
    (s) => s.transactions.transactionData?.merchantAliases ?? [],
  );
  const investments = useSelector(
    (s) => s.transactions.transactionData?.investments ?? [],
  );
  const userTypes = useSelector(
    (s) => s.transactions.transactionData?.investmentTypes ?? [],
  );
  const banks = useSelector(
    (s) => s.transactions.transactionData?.lists?.banks ?? [],
  );

  const [step, setStep] = useState("input"); // "input" | "review" | "reconcile"
  const [mode, setMode] = useState("drop");   // "drop" | "paste"
  const [pastedText, setPastedText] = useState("");
  const [parsedRows, setParsedRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reconciliation state — populated after a successful import. Holds
  // the suggestions + per-suggestion "applied" / "dismissed" status so
  // we can re-render the cards as the user acts on them.
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionStatus, setSuggestionStatus] = useState({}); // key → "pending" | "applying" | "applied" | "dismissed"

  // Password flow state — populated when a PDF needs a password. We hold
  // on to the original File so the user can retry without re-picking.
  const [passwordFile, setPasswordFile] = useState(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState(null);
  const fileInputRef = useRef(null);

  function reset() {
    setStep("input");
    setMode("drop");
    setPastedText("");
    setParsedRows([]);
    setMeta(null);
    setError(null);
    setIsProcessing(false);
    setIsDraggingOver(false);
    setPasswordFile(null);
    setPasswordValue("");
    setPasswordError(null);
    setSuggestions([]);
    setSuggestionStatus({});
  }

  function closeAndReset() {
    reset();
    onClose();
  }

  function applyResult(result, sourceLabel) {
    if (result.errors.length > 0) {
      setError(result.errors[0]);
      return;
    }
    setParsedRows(result.rows);
    setMeta(result.meta ?? null);
    setStep("review");
    setError(null);
    if (sourceLabel) setPasswordFile(null);
  }

  async function handleFile(file, password) {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const result = await parseStatementFile(
        file,
        { autoRules, existingTransactions, merchantAliases },
        password ? { password } : undefined,
      );
      applyResult(result, file.name);
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        setPasswordFile(file);
        setPasswordValue("");
        setPasswordError(null);
      } else if (e instanceof PasswordIncorrectError) {
        setPasswordError("That password didn't work. Try again.");
      } else {
        setError(`${file.name} couldn't be parsed: ${e.message ?? "unknown error"}`);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleParse() {
    if (!pastedText.trim()) {
      setError("Paste your transactions first.");
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      const result = parseStatementText(pastedText, {
        autoRules,
        existingTransactions,
        merchantAliases,
      });
      applyResult(result);
    } catch (e) {
      setError(`Pasted text couldn't be parsed: ${e.message ?? "unknown error"}`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePasswordSubmit() {
    if (!passwordFile || !passwordValue) return;
    setPasswordError(null);
    await handleFile(passwordFile, passwordValue);
  }

  // ── Review-step row helpers ──────────────────────────

  function updateRow(idx, patch) {
    setParsedRows((rows) =>
      rows.map((r, i) =>
        i === idx ? { ...r, ...patch, userEdited: true } : r,
      ),
    );
  }

  function toggleRow(idx) {
    setParsedRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r)),
    );
  }

  function setAllSelected(value) {
    setParsedRows((rows) =>
      rows.map((r) => ({
        ...r,
        // Duplicates stay unselected even on "Select all" — the user
        // has to explicitly opt them in.
        selected: r.duplicateOf ? r.selected : value,
      })),
    );
  }

  function changeType(idx, newType) {
    const opts = categoryOptionsFor(newType);
    setParsedRows((rows) =>
      rows.map((r, i) =>
        i === idx
          ? {
              ...r,
              transactionType: newType,
              // Reset category to a valid one when changing type so we
              // don't carry "Groceries" into an "income" row.
              category: opts.includes(r.category) ? r.category : opts[0],
              userEdited: true,
            }
          : r,
      ),
    );
  }

  // ── Summary stats for the footer ─────────────────────

  const summary = useMemo(() => {
    const selected = parsedRows.filter((r) => r.selected);
    let inflow = 0;
    let outflow = 0;
    for (const r of selected) {
      if (r.transactionType === "income") inflow += r.amount;
      else outflow += r.amount;
    }
    return {
      total: selected.length,
      skipped: parsedRows.length - selected.length,
      inflow,
      outflow,
      net: inflow - outflow,
    };
  }, [parsedRows]);

  // ── Commit ───────────────────────────────────────────

  async function handleImport() {
    const selected = parsedRows.filter((r) => r.selected);
    if (selected.length === 0) return;
    setSubmitting(true);
    const now = new Date().toISOString();
    const transactions = selected.map((r) => ({
      id: crypto.randomUUID(),
      createdAt: now,
      occurredAt: r.occurredAt,
      transactionType: r.transactionType,
      amount: String(r.amount),
      name: r.description,
      category: r.category,
      paymentMode: r.paymentMode,
      importedAt: now,
    }));
    await dispatch(persistBulkImport(transactions));

    // Commit-time learning. Every selected row teaches the index — user
    // corrections strengthen explicit aliases; accepted auto-picks
    // promote implicit patterns to explicit ones so they stick across
    // future imports. Dedupe by fingerprint within the batch so a
    // single statement with 10 BLINKIT rows only writes one alias.
    const learnings = new Map();
    for (const r of selected) {
      const alias = aliasFromRow(r);
      if (!alias) continue;
      learnings.set(alias.pattern, alias);
    }
    if (learnings.size > 0) {
      await dispatch(persistMerchantAliases([...learnings.values()]));
    }

    // Run reconciliation detectors against the just-committed batch.
    // If we find anything actionable (SIP / auto-deduct / self-
    // transfer matches), surface the reconciliation step; otherwise
    // close out cleanly with the import toast that persistBulkImport
    // already dispatched.
    const importedIds = new Set(transactions.map((t) => t.id));
    const found = runDetectors({
      importedTxIds: importedIds,
      transactions: [...existingTransactions, ...transactions],
      investments,
      userTypes,
      banks,
      schemaResolver: getInvestmentTypeSchema,
    });

    setSubmitting(false);

    if (found.length === 0) {
      closeAndReset();
      return;
    }
    setSuggestions(found);
    setSuggestionStatus(
      Object.fromEntries(found.map((s) => [s.key, "pending"])),
    );
    setStep("reconcile");
  }

  // ── Reconciliation handlers ──────────────────────────

  async function applySuggestion(s) {
    setSuggestionStatus((prev) => ({ ...prev, [s.key]: "applying" }));
    try {
      if (s.kind === "sip") {
        // Tag each matched tx with sipInvestmentId, normalise type to
        // "investment" and category to "SIP" so the downstream math
        // (Legacy aggregate, SIP ledger) recognises them.
        const pairs = s.matches
          .map((m) => {
            const tx = existingTransactions.find((t) => t.id === m.txId);
            if (!tx) return null;
            return {
              oldTx: tx,
              newTx: {
                ...tx,
                transactionType: "investment",
                category: "SIP",
                sipInvestmentId: s.sip.id,
              },
            };
          })
          .filter(Boolean);
        if (pairs.length > 0) await dispatch(persistBulkUpdateTransactions(pairs));
      } else if (s.kind === "auto-deduct") {
        const pairs = s.matches
          .map((m) => {
            const tx = existingTransactions.find((t) => t.id === m.txId);
            if (!tx) return null;
            return {
              oldTx: tx,
              newTx: {
                ...tx,
                transactionType: "investment",
                category: s.investment.typeLabel,
                autoDeductInvestmentId: s.investment.id,
              },
            };
          })
          .filter(Boolean);
        if (pairs.length > 0) await dispatch(persistBulkUpdateTransactions(pairs));
      } else if (s.kind === "self-transfer") {
        const transfer = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          occurredAt: s.toTx.occurredAt,
          transactionType: "self_transfer",
          amount: String(s.amount),
          name: `Transfer: ${s.fromTx.name} → ${s.toTx.name}`,
          category: "Transfer",
          paymentMode: s.fromTx.paymentMode || s.toTx.paymentMode || "Other",
        };
        await dispatch(
          persistMergeAsSelfTransfer({
            removeIds: [s.fromTx.id, s.toTx.id],
            transfer,
          }),
        );
      }
      setSuggestionStatus((prev) => ({ ...prev, [s.key]: "applied" }));
    } catch (e) {
      setSuggestionStatus((prev) => ({ ...prev, [s.key]: "pending" }));
      setError(`Couldn't apply: ${e.message ?? "unknown error"}`);
    }
  }

  function dismissSuggestion(key) {
    setSuggestionStatus((prev) => ({ ...prev, [key]: "dismissed" }));
  }

  return (
    <Modal
      open={open}
      onClose={closeAndReset}
      title={
        step === "input"
          ? "Import bank statement"
          : `Review ${parsedRows.length} transaction${parsedRows.length === 1 ? "" : "s"}`
      }
    >
      {step === "input" && (
        <div className="stmt-import">
          <div className="stmt-mode-toggle">
            <button
              type="button"
              className={`stmt-mode-tab${mode === "drop" ? " stmt-mode-tab--on" : ""}`}
              onClick={() => { setMode("drop"); setError(null); }}
            >
              <i className="fa-solid fa-file-arrow-up" /> Upload file
            </button>
            <button
              type="button"
              className={`stmt-mode-tab${mode === "paste" ? " stmt-mode-tab--on" : ""}`}
              onClick={() => { setMode("paste"); setError(null); }}
            >
              <i className="fa-solid fa-clipboard" /> Paste text
            </button>
          </div>

          {mode === "drop" && (
            <div
              className={`stmt-dropzone${isDraggingOver ? " stmt-dropzone--over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <i className="fa-solid fa-file-arrow-up stmt-dropzone-icon" />
              <p className="stmt-dropzone-primary">
                Drop your statement here, or click to choose
              </p>
              <p className="stmt-dropzone-secondary">
                CSV, Excel, or PDF. Password-protected PDFs work — we'll ask.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.txt,text/plain,.pdf,application/pdf,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          )}

          {mode === "paste" && (
            <div className="stmt-paste">
              <textarea
                className="stmt-paste-area"
                placeholder="Paste rows from your bank app or email. Each row should have a date, a description, and an amount — comma, tab, or semicolon separated."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={10}
              />
              <button
                type="button"
                className="generic-button stmt-parse-btn"
                onClick={handleParse}
                disabled={isProcessing || !pastedText.trim()}
              >
                <i className="fa-solid fa-magnifying-glass" /> Parse
              </button>
            </div>
          )}

          {passwordFile && (
            <div className="stmt-pwd">
              <div className="stmt-pwd-head">
                <i className="fa-solid fa-lock" />
                <span>
                  <strong>{passwordFile.name}</strong> is password protected.
                </span>
              </div>
              <p className="stmt-pwd-hint">
                Indian banks usually use a short combo of your name and date
                of birth — for example, first 4 letters of your name in caps
                + DDMM (NAME0509). Check the email the bank sent.
              </p>
              <form
                className="stmt-pwd-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePasswordSubmit();
                }}
              >
                <input
                  type="password"
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  placeholder="Password"
                  autoFocus
                  className="stmt-pwd-input"
                />
                <button
                  type="submit"
                  className="generic-button"
                  disabled={!passwordValue || isProcessing}
                >
                  {isProcessing ? (
                    <><i className="fa-solid fa-spinner fa-spin" /> Unlocking…</>
                  ) : (
                    <><i className="fa-solid fa-key" /> Unlock</>
                  )}
                </button>
              </form>
              {passwordError && (
                <p className="stmt-pwd-err">
                  <i className="fa-solid fa-triangle-exclamation" /> {passwordError}
                </p>
              )}
            </div>
          )}

          {isProcessing && !passwordFile && (
            <p className="stmt-status">Parsing…</p>
          )}
          {error && (
            <p className="stmt-status stmt-status--err">
              <i className="fa-solid fa-triangle-exclamation" /> {error}
            </p>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="stmt-review">
          {meta?.detectedBank && (
            <div className="stmt-detected">
              <i className="fa-solid fa-building-columns" />
              <span>
                Detected <strong>{meta.detectedBank.label}</strong> statement.
              </span>
            </div>
          )}
          <div className="stmt-review-head">
            <button
              type="button"
              className="cancel-button stmt-review-back"
              onClick={reset}
            >
              <i className="fa-solid fa-arrow-left" /> Choose another file
            </button>
            <div className="stmt-review-bulk">
              <button
                type="button"
                className="stmt-bulk-btn"
                onClick={() => setAllSelected(true)}
              >
                Select all
              </button>
              <button
                type="button"
                className="stmt-bulk-btn"
                onClick={() => setAllSelected(false)}
              >
                Deselect all
              </button>
            </div>
          </div>

          <ul className="stmt-rows">
            {parsedRows.map((r, idx) => {
              const isDup = !!r.duplicateOf;
              const cats = categoryOptionsFor(r.transactionType);
              const conf = r.confidence ?? 0;
              const confClass =
                conf >= 0.8
                  ? "stmt-row--conf-high"
                  : conf >= 0.55
                    ? "stmt-row--conf-med"
                    : "stmt-row--conf-low";
              return (
                <li
                  key={r.id}
                  className={`stmt-row${r.selected ? " stmt-row--on" : ""}${isDup ? " stmt-row--dup" : ""} ${confClass}`}
                >
                  <input
                    type="checkbox"
                    className="stmt-row-check"
                    checked={!!r.selected}
                    onChange={() => toggleRow(idx)}
                  />
                  <div className="stmt-row-main">
                    <div className="stmt-row-head">
                      <span className="stmt-row-date">{fmtDate(r.occurredAt)}</span>
                      <span
                        className={`stmt-row-amount${r.transactionType === "income" ? " stmt-row-amount--in" : " stmt-row-amount--out"}`}
                      >
                        {r.transactionType === "income" ? "+" : "−"}{INR(r.amount)}
                      </span>
                    </div>
                    <div className="stmt-row-desc" title={r.description}>
                      {r.description}
                    </div>
                    {isDup && (
                      <div className="stmt-row-dup-badge">
                        <i className="fa-solid fa-clone" /> Already in your ledger — leave unchecked to skip
                      </div>
                    )}
                    {r.reason && !isDup && (
                      <div className="stmt-row-hint" title={r.reason}>
                        {r.reason}
                      </div>
                    )}
                    <div className="stmt-row-controls">
                      <select
                        className="stmt-row-select"
                        value={r.transactionType}
                        onChange={(e) => changeType(idx, e.target.value)}
                      >
                        {TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <select
                        className="stmt-row-select"
                        value={r.category}
                        onChange={(e) => updateRow(idx, { category: e.target.value })}
                      >
                        {cats.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <select
                        className="stmt-row-select"
                        value={r.paymentMode}
                        onChange={(e) => updateRow(idx, { paymentMode: e.target.value })}
                      >
                        {PAYMENT_MODES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="stmt-summary">
            <div className="stmt-summary-grid">
              <div>
                <span className="stmt-summary-label">Importing</span>
                <span className="stmt-summary-value">
                  {summary.total}
                  {summary.skipped > 0 && (
                    <span className="stmt-summary-sub">
                      {" "}({summary.skipped} skipped)
                    </span>
                  )}
                </span>
              </div>
              <div>
                <span className="stmt-summary-label">Inflow</span>
                <span className="stmt-summary-value stmt-summary-value--in">
                  +{INR(summary.inflow)}
                </span>
              </div>
              <div>
                <span className="stmt-summary-label">Outflow</span>
                <span className="stmt-summary-value stmt-summary-value--out">
                  −{INR(summary.outflow)}
                </span>
              </div>
              <div>
                <span className="stmt-summary-label">Net change</span>
                <span
                  className={`stmt-summary-value${summary.net >= 0 ? " stmt-summary-value--in" : " stmt-summary-value--out"}`}
                >
                  {summary.net >= 0 ? "+" : "−"}{INR(Math.abs(summary.net))}
                </span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={closeAndReset}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="generic-button"
              onClick={handleImport}
              disabled={summary.total === 0 || submitting}
            >
              {submitting ? (
                <><i className="fa-solid fa-spinner fa-spin" /> Importing…</>
              ) : (
                <><i className="fa-solid fa-check" /> Import {summary.total} transaction{summary.total === 1 ? "" : "s"}</>
              )}
            </button>
          </div>
        </div>
      )}

      {step === "reconcile" && (
        <div className="stmt-reconcile">
          <p className="stmt-reconcile-intro">
            Your transactions are in. We spotted a few patterns that match
            the rest of your portfolio — convert them or skip, your call.
          </p>

          <ul className="stmt-recon-list">
            {suggestions.map((s) => {
              const status = suggestionStatus[s.key] ?? "pending";
              return (
                <SuggestionCard
                  key={s.key}
                  s={s}
                  status={status}
                  onApply={() => applySuggestion(s)}
                  onDismiss={() => dismissSuggestion(s.key)}
                />
              );
            })}
          </ul>

          <div className="form-actions">
            <button
              type="button"
              className="generic-button"
              onClick={closeAndReset}
            >
              <i className="fa-solid fa-check" /> Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

// ── Suggestion card ────────────────────────────────────

function SuggestionCard({ s, status, onApply, onDismiss }) {
  const isApplied = status === "applied";
  const isDismissed = status === "dismissed";
  const isApplying = status === "applying";

  const { title, body, applyLabel } = describeSuggestion(s);
  const confidence = Math.round((s.confidence ?? 0) * 100);

  return (
    <li
      className={`stmt-recon-card${isApplied ? " stmt-recon-card--applied" : ""}${isDismissed ? " stmt-recon-card--dismissed" : ""}`}
    >
      <div className="stmt-recon-card-head">
        <span className="stmt-recon-kind">{kindLabel(s.kind)}</span>
        <span className="stmt-recon-conf" title={`${confidence}% confidence`}>
          {confidence}%
        </span>
      </div>
      <h4 className="stmt-recon-title">{title}</h4>
      <div className="stmt-recon-body">{body}</div>
      <div className="stmt-recon-actions">
        {isApplied ? (
          <span className="stmt-recon-applied">
            <i className="fa-solid fa-check" /> Applied
          </span>
        ) : isDismissed ? (
          <span className="stmt-recon-dismissed">
            <i className="fa-solid fa-xmark" /> Dismissed
          </span>
        ) : (
          <>
            <button
              type="button"
              className="cancel-button stmt-recon-skip"
              onClick={onDismiss}
              disabled={isApplying}
            >
              Skip
            </button>
            <button
              type="button"
              className="generic-button"
              onClick={onApply}
              disabled={isApplying}
            >
              {isApplying ? (
                <><i className="fa-solid fa-spinner fa-spin" /> Applying…</>
              ) : (
                <><i className="fa-solid fa-wand-magic-sparkles" /> {applyLabel}</>
              )}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

SuggestionCard.propTypes = {
  s: PropTypes.object.isRequired,
  status: PropTypes.string.isRequired,
  onApply: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
};

function kindLabel(kind) {
  if (kind === "sip") return "SIP match";
  if (kind === "auto-deduct") return "Auto-deduct match";
  if (kind === "self-transfer") return "Self transfer";
  return kind;
}

function describeSuggestion(s) {
  if (s.kind === "sip") {
    const total = s.matches.reduce((sum, m) => sum + m.amount, 0);
    return {
      title: `${s.matches.length} instalment${s.matches.length === 1 ? "" : "s"} for ${s.sip.name}`,
      body: (
        <ul className="stmt-recon-tx-list">
          {s.matches.slice(0, 5).map((m) => (
            <li key={m.txId}>
              <span>{fmtDate(m.occurredAt)}</span>
              <span className="stmt-recon-amt">{INR(m.amount)}</span>
            </li>
          ))}
          {s.matches.length > 5 && (
            <li className="stmt-recon-tx-more">
              +{s.matches.length - 5} more
            </li>
          )}
          <li className="stmt-recon-tx-total">
            <span>Total</span>
            <span className="stmt-recon-amt">{INR(total)}</span>
          </li>
        </ul>
      ),
      applyLabel: `Tag as ${s.matches.length} SIP instalment${s.matches.length === 1 ? "" : "s"}`,
    };
  }
  if (s.kind === "auto-deduct") {
    const total = s.matches.reduce((sum, m) => sum + m.amount, 0);
    return {
      title: `${s.matches.length} ${s.investment.frequency === "monthly" ? "monthly" : s.investment.frequency} contribution${s.matches.length === 1 ? "" : "s"} for ${s.investment.name}`,
      body: (
        <ul className="stmt-recon-tx-list">
          {s.matches.slice(0, 5).map((m) => (
            <li key={m.txId}>
              <span>{fmtDate(m.occurredAt)}</span>
              <span className="stmt-recon-amt">{INR(m.amount)}</span>
            </li>
          ))}
          {s.matches.length > 5 && (
            <li className="stmt-recon-tx-more">
              +{s.matches.length - 5} more
            </li>
          )}
          <li className="stmt-recon-tx-total">
            <span>Total</span>
            <span className="stmt-recon-amt">{INR(total)}</span>
          </li>
        </ul>
      ),
      applyLabel: `Tag as ${s.matches.length} ${s.investment.typeLabel} instalment${s.matches.length === 1 ? "" : "s"}`,
    };
  }
  if (s.kind === "self-transfer") {
    return {
      title: `Looks like a transfer of ${INR(s.amount)} between your accounts`,
      body: (
        <div className="stmt-recon-pair">
          <div className="stmt-recon-pair-row">
            <span className="stmt-recon-pair-arrow"><i className="fa-solid fa-arrow-up-from-bracket" /> Out</span>
            <span className="stmt-recon-pair-name">{s.fromTx.name}</span>
            <span className="stmt-recon-pair-date">{fmtDate(s.fromTx.occurredAt)}</span>
          </div>
          <div className="stmt-recon-pair-row">
            <span className="stmt-recon-pair-arrow"><i className="fa-solid fa-arrow-down-to-bracket" /> In</span>
            <span className="stmt-recon-pair-name">{s.toTx.name}</span>
            <span className="stmt-recon-pair-date">{fmtDate(s.toTx.occurredAt)}</span>
          </div>
        </div>
      ),
      applyLabel: "Merge as self-transfer",
    };
  }
  return { title: "Suggestion", body: null, applyLabel: "Apply" };
}

StatementImportModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default memo(StatementImportModal);
