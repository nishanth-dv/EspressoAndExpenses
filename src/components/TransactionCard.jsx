import { memo, useState } from "react";
import { useDispatch } from "react-redux";
import PropTypes from "prop-types";
import { persistDeleteTransaction } from "../redux/slices/transactionSlice";
import Modal from "../preStyledElements/modal/Modal";

const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const formatDate = (iso) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const TransactionCard = ({ transaction }) => {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { id, name: rawName, source, amount, category, paymentMode, description, occurredAt, transactionType } =
    transaction;
  const name = rawName || source;
  const isExpense = transactionType === "expense";

  function handleDeleteClick(e) {
    e.stopPropagation();
    setConfirming(true);
  }

  function handleConfirmDelete() {
    dispatch(persistDeleteTransaction(id));
    setConfirming(false);
  }

  return (
    <>
      <div
        className={`transaction-card${open ? " transaction-card--open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        role="button"
        aria-expanded={open}
      >
        {/* Always-visible summary row */}
        <div className="transaction-summary">
          <span className="transaction-name">{name}</span>
          <div className="transaction-summary-right">
            <span className={`transaction-amount ${isExpense ? "amount-expense" : "amount-income"}`}>
              {isExpense ? "-" : "+"}&nbsp;{formatter.format(amount)}
            </span>
            <i className={`fa-solid fa-chevron-down transaction-chevron${open ? " chevron-open" : ""}`} />
          </div>
        </div>

        {/* Accordion body */}
        <div className={`transaction-details${open ? " transaction-details--open" : ""}`}>
          <div className="transaction-details-inner">
            <div className="detail-rows">
              {category && (
                <div className="detail-row">
                  <span className="detail-label">Category</span>
                  <span className="transaction-category">{category}</span>
                </div>
              )}
              {paymentMode && (
                <div className="detail-row">
                  <span className="detail-label">Payment</span>
                  <span className="detail-value">{paymentMode}</span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Date</span>
                <span className="detail-value">{formatDate(occurredAt)}</span>
              </div>
              {description && (
                <div className="detail-row detail-row--wrap">
                  <span className="detail-label">Note</span>
                  <span className="detail-value detail-value--note">{description}</span>
                </div>
              )}

              <button className="delete-btn" onClick={handleDeleteClick}>
                <i className="fa-solid fa-trash-can" />
                Delete {isExpense ? "expense" : "income"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirming && (
        <Modal
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Delete ${isExpense ? "expense" : "income"}?`}
        >
          <div className="delete-confirm-body">
            <p className="delete-confirm-name">{name}</p>
            <p className={`delete-confirm-amount ${isExpense ? "amount-expense" : "amount-income"}`}>
              {isExpense ? "−" : "+"}&nbsp;{formatter.format(amount)}
            </p>
            <p className="delete-confirm-hint">This cannot be undone.</p>
            <div className="form-actions">
              <button className="cancel-button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="danger-button" onClick={handleConfirmDelete}>
                <i className="fa-solid fa-trash-can" />
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

TransactionCard.propTypes = {
  transaction: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    source: PropTypes.string,
    amount: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    transactionType: PropTypes.oneOf(["expense", "income"]).isRequired,
    category: PropTypes.string,
    paymentMode: PropTypes.string,
    description: PropTypes.string,
    occurredAt: PropTypes.string.isRequired,
    createdAt: PropTypes.string.isRequired,
  }).isRequired,
};

export default memo(TransactionCard);
