import { memo, useMemo, useState } from "react";
import PropTypes from "prop-types";

// Groups untagged transactions by paymentMode (skipping credit-card spends
// and self transfers) and lets the user assign a bank account per group.
// Auto-suggests when the paymentMode string contains the bank name —
// "HDFC UPI" → HDFC account, etc.
const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

const MultiBankMigration = ({ accounts, transactions, onApply, onClose }) => {
  const [expanded, setExpanded] = useState(() => new Set());

  function toggleExpanded(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const groups = useMemo(() => {
    const map = new Map();
    for (const t of transactions) {
      if (t.accountId) continue;
      if (t.cardId) continue; // card spend, no bank account involved
      if (t.transactionType === "self_transfer") continue;
      const key = t.paymentMode || "(Unspecified)";
      if (!map.has(key)) map.set(key, { paymentMode: key, txs: [] });
      map.get(key).txs.push(t);
    }
    return [...map.values()].sort((a, b) => b.txs.length - a.txs.length);
  }, [transactions]);

  const [assignments, setAssignments] = useState(() => {
    const out = {};
    for (const g of groups) {
      const lower = g.paymentMode.toLowerCase();
      const guess = accounts.find((a) =>
        lower.includes(a.bank.toLowerCase()),
      );
      if (guess) out[g.paymentMode] = guess.id;
    }
    return out;
  });

  const assignedCount = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      const aid = assignments[g.paymentMode];
      if (aid && aid !== "skip") n += g.txs.length;
    }
    return n;
  }, [groups, assignments]);

  function handleApply() {
    // Resolve groups → [txId, accountId] pairs.
    const pairs = [];
    for (const g of groups) {
      const aid = assignments[g.paymentMode];
      if (!aid || aid === "skip") continue;
      for (const t of g.txs) pairs.push([t.id, aid]);
    }
    onApply(pairs);
  }

  if (groups.length === 0) {
    return (
      <div className="multibank-migration multibank-migration--empty">
        <i className="fa-solid fa-circle-check multibank-migration-empty-icon" />
        <p>Nothing to tag.</p>
        <p className="multibank-migration-empty-sub">
          Every transaction is either already tagged, a credit-card spend, or
          a self transfer.
        </p>
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="multibank-migration">
      <p className="multibank-migration-hint">
        Past transactions are grouped by payment mode. Assign each group to a
        bank, or skip ones you&apos;d rather tag manually later. Credit-card
        spends aren&apos;t shown — they live on the card, not on a bank.
      </p>

      <ul className="multibank-migration-list">
        {groups.map((g) => {
          const value = assignments[g.paymentMode] ?? "";
          const isOpen = expanded.has(g.paymentMode);
          return (
            <li key={g.paymentMode} className="multibank-migration-row">
              <div className="multibank-migration-meta">
                <button
                  type="button"
                  className="multibank-migration-name-btn"
                  onClick={() => toggleExpanded(g.paymentMode)}
                  aria-expanded={isOpen}
                >
                  <i
                    className={`fa-solid fa-chevron-right multibank-migration-chevron${
                      isOpen ? " multibank-migration-chevron--open" : ""
                    }`}
                  />
                  <span className="multibank-migration-name">
                    {g.paymentMode}
                  </span>
                  <span className="multibank-migration-count">
                    {g.txs.length} txn{g.txs.length === 1 ? "" : "s"}
                  </span>
                </button>
              </div>
              <select
                className="multibank-migration-select"
                value={value}
                onChange={(e) =>
                  setAssignments((a) => ({
                    ...a,
                    [g.paymentMode]: e.target.value,
                  }))
                }
              >
                <option value="">Choose bank…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bank}
                  </option>
                ))}
                <option value="skip">Skip — leave untagged</option>
              </select>
              {isOpen && (
                <ul className="multibank-migration-txs">
                  {g.txs
                    .slice()
                    .sort((a, b) =>
                      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
                    )
                    .map((t) => (
                      <li key={t.id} className="multibank-migration-tx">
                        <span className="multibank-migration-tx-name">
                          {t.name || "(no name)"}
                        </span>
                        <span className="multibank-migration-tx-date">
                          {fmtDate(t.occurredAt)}
                        </span>
                        <span className="multibank-migration-tx-amt">
                          {INR.format(parseFloat(t.amount) || 0)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className="multibank-migration-footer">
        Will tag <strong>{assignedCount}</strong> transaction
        {assignedCount === 1 ? "" : "s"}. Untagged ones stay visible in the
        &quot;All&quot; view and can be tagged later.
      </p>

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Skip all
        </button>
        <button
          type="button"
          className="generic-button"
          onClick={handleApply}
          disabled={assignedCount === 0}
        >
          <i className="fa-solid fa-tag" /> Apply tagging
        </button>
      </div>
    </div>
  );
};

MultiBankMigration.propTypes = {
  accounts: PropTypes.array.isRequired,
  transactions: PropTypes.array.isRequired,
  onApply: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default memo(MultiBankMigration);
