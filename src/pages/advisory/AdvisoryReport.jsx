import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSelector } from "react-redux";
import { buildReport } from "../../utils/advisory/report";

const EASE = [0.25, 0.46, 0.45, 0.94];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const ALLOC_COLORS = {
  Equity: "#1a9f63",
  "Debt / Fixed": "#9aa3b2",
  Gold: "#d9a521",
  Alternatives: "#6c5ce7",
};

// A printable / copyable financial snapshot. Rendered as a full-screen overlay;
// Print scopes the page to just this sheet via the .adv-report-printing body class.
export default function AdvisoryReport({ open, onClose }) {
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const report = useMemo(() => (open ? buildReport(data) : null), [open, data]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && report && (
        <motion.div
          className="adv-report-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="adv-report"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="adv-report-toolbar">
              <button
                type="button"
                className="adv-report-tool adv-report-tool--close"
                onClick={onClose}
                aria-label="Close report"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="adv-report-sheet">
              <header className="adv-report-header">
                <div>
                  <h2>Financial snapshot</h2>
                  <p className="adv-report-date">{report.dateLabel}</p>
                </div>
                <div className="adv-report-nw">
                  <span className="adv-report-nw-lbl">Net worth</span>
                  <span className="adv-report-nw-val">
                    {INR.format(report.netWorth.netWorth)}
                  </span>
                </div>
              </header>

              <div className="adv-report-grid">
                <div className="adv-report-stat">
                  <span className="adv-report-stat-lbl">This month net</span>
                  <span
                    className={`adv-report-stat-val ${report.waterfall.netFlow >= 0 ? "adv-report-up" : "adv-report-down"}`}
                  >
                    {report.waterfall.netFlow >= 0 ? "+" : "−"}
                    {INR.format(Math.abs(report.waterfall.netFlow))}
                  </span>
                </div>
                {report.runway.months != null && (
                  <div className="adv-report-stat">
                    <span className="adv-report-stat-lbl">Cash runway</span>
                    <span className="adv-report-stat-val">
                      {report.runway.months.toFixed(1)} mo
                    </span>
                  </div>
                )}
                {report.health && (
                  <div className="adv-report-stat">
                    <span className="adv-report-stat-lbl">Health score</span>
                    <span className="adv-report-stat-val">
                      {report.health.score}
                      <em>/{report.health.grade}</em>
                    </span>
                  </div>
                )}
                {report.fire && (
                  <div className="adv-report-stat">
                    <span className="adv-report-stat-lbl">FI progress</span>
                    <span className="adv-report-stat-val">
                      {report.fire.pct}%
                      {report.fire.reachable && report.fire.yearsToFI != null && (
                        <em>~{report.fire.yearsToFI}y</em>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {report.allocation.length > 0 && (
                <section className="adv-report-section">
                  <h3>Allocation</h3>
                  <div className="adv-report-alloc-bar">
                    {report.allocation.map((a) => (
                      <span
                        key={a.label}
                        className="adv-report-alloc-seg"
                        style={{
                          width: `${a.pct * 100}%`,
                          background: ALLOC_COLORS[a.label] || "#9aa3b2",
                        }}
                        title={`${a.label} ${(a.pct * 100).toFixed(0)}%`}
                      />
                    ))}
                  </div>
                  <div className="adv-report-alloc-legend">
                    {report.allocation.map((a) => (
                      <span key={a.label} className="adv-report-alloc-leg">
                        <span
                          className="adv-report-dot"
                          style={{ background: ALLOC_COLORS[a.label] || "#9aa3b2" }}
                        />
                        {a.label} {(a.pct * 100).toFixed(0)}% ·{" "}
                        {INR.format(a.amount)}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {report.actions.length > 0 && (
                <section className="adv-report-section">
                  <h3>
                    Top actions
                    <span className="adv-report-money">
                      {INR.format(report.moneyFound)}/yr on the table
                    </span>
                  </h3>
                  <ol className="adv-report-actions">
                    {report.actions.map((c) => (
                      <li key={c.id}>
                        <span className="adv-report-action-title">{c.title}</span>
                        <span className="adv-report-action-impact">
                          {c.impactLabel}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <footer className="adv-report-footer">
                Generated by Espresso &amp; Expenses · Advisory. Figures are
                estimates from your own data — not financial advice.
              </footer>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
