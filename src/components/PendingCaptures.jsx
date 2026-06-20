import { memo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";
import {
  persistAcceptInboxItem,
  persistRejectInboxItem,
  persistTransaction,
} from "../redux/slices/transactionSlice";
import { buildCaptureTransaction } from "../utils/autoRead/emailParser";

// Auto-captured alerts awaiting review, rendered inline at the top of the
// ledger as dotted "ghost" rows. Accept posts the (enriched) transaction;
// Edit opens it in the normal form prefilled; Reject discards it.
const PendingCaptures = () => {
  const dispatch = useDispatch();
  const inbox = useSelector(
    (s) => s.transactions.transactionData?.autoReadInbox ?? [],
  );
  const transactions = useSelector(
    (s) => s.transactions.transactionData?.transactions ?? [],
  );
  const accounts = useSelector(
    (s) => s.transactions.transactionData?.accounts ?? [],
  );
  const [editItem, setEditItem] = useState(null);

  // Defensive: skip any malformed/empty inbox entries so a bad record can
  // never crash the whole ledger.
  const items = inbox.filter((i) => i && i.parsed);
  if (items.length === 0) return null;

  const fmt = (a) => `₹${Number(a).toLocaleString("en-IN")}`;

  const editTx = editItem?.parsed
    ? buildCaptureTransaction(editItem.parsed, {
        transactions,
        accounts,
        receivedAt: editItem.capturedAt,
      })
    : null;
  const editIsIncome = editTx?.transactionType === "income";

  const finishEdit = (tx) => {
    const id = editItem?.id;
    dispatch(persistTransaction(tx));
    if (id) dispatch(persistRejectInboxItem(id));
    setEditItem(null);
  };

  return (
    <>
      {items.map((item) => {
        const p = item.parsed;
        const isCredit = p.direction === "credit";
        const sub = [p.mode, p.dateISO, p.bank, p.last4 ? `⋯${p.last4}` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={item.id} className="tx-pending">
            <span className="tx-pending-tag">
              <i className="fa-solid fa-inbox" /> Captured · review
            </span>
            <div className="tx-pending-body">
              <div className="tx-pending-meta">
                <span className="tx-pending-name">
                  {p.merchant || p.vpa || "UPI transaction"}
                </span>
                <span className="tx-pending-sub">{sub}</span>
              </div>
              <span
                className={`tx-pending-amt${isCredit ? " tx-pending-amt--in" : ""}`}
              >
                {isCredit ? "+" : "−"}
                {fmt(p.amount)}
              </span>
            </div>
            <div className="tx-pending-actions">
              <button
                type="button"
                className="tx-pending-accept"
                onClick={() => dispatch(persistAcceptInboxItem(item.id))}
              >
                <i className="fa-solid fa-check" /> Accept
              </button>
              <button
                type="button"
                className="tx-pending-btn"
                onClick={() => setEditItem(item)}
                aria-label="Edit before adding"
                title="Edit"
              >
                <i className="fa-solid fa-pen" />
              </button>
              <button
                type="button"
                className="tx-pending-btn"
                onClick={() => dispatch(persistRejectInboxItem(item.id))}
                aria-label="Reject"
                title="Reject"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          </div>
        );
      })}

      {editItem && editTx && (
        <Modal
          open
          onClose={() => setEditItem(null)}
          title="Review captured transaction"
        >
          {editIsIncome ? (
            <IncomeForm
              existing={editTx}
              onCancel={() => setEditItem(null)}
              onSubmit={finishEdit}
            />
          ) : (
            <ExpenseForm
              existing={editTx}
              onCancel={() => setEditItem(null)}
              onSubmit={finishEdit}
            />
          )}
        </Modal>
      )}
    </>
  );
};

export default memo(PendingCaptures);
