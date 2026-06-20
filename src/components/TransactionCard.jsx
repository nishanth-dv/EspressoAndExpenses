import {memo, useState} from "react";
import {motion, AnimatePresence} from "framer-motion";
import {useDispatch, useSelector} from "react-redux";
import {useNavigate} from "react-router-dom";
import PropTypes from "prop-types";
import {
  persistUpdateTransaction,
  persistDeleteTransaction,
  persistUpdateInvestment,
} from "../redux/slices/transactionSlice";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";
import InvestmentForm from "../Forms/InvestmentForm";
import SelfTransferForm from "../Forms/SelfTransferForm";
import BankChipSelector from "./BankChipSelector";
import DateField from "./DateField";
import { NoteContent, NoteBulletHint } from "./NoteText";
import { getInvestmentTypeSchema } from "../utils/investmentTypeSchemas";
import { getTypeInfo } from "../utils/investmentUtils";

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

const accordionTransition = {
  height: {duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94]},
  opacity: {duration: 0.2},
};

const TransactionCard = ({transaction}) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  // 'choose' | 'entry' | 'investment' | null — investment edit flow. The
  // user picks between editing the raw ledger entry or the prefilled,
  // type-specific investment form.
  const [investEditMode, setInvestEditMode] = useState(null);
  const [entryDraft, setEntryDraft] = useState(null);

  const {
    id,
    source,
    amount,
    category,
    paymentMode,
    description,
    occurredAt,
    transactionType,
    cardId,
    repaymentFor,
    sipInvestmentId,
    licPolicyId,
    autoDeductInvestmentId,
    subscriptionId,
    accountId,
    fromAccountId,
    toAccountId,
  } = transaction;
  const isExpense = transactionType === "expense";
  const isInvestment = transactionType === "investment";
  const isSelfTransfer = transactionType === "self_transfer";
  const amountClass = isExpense
    ? "amount-expense"
    : isInvestment
    ? "amount-investment"
    : isSelfTransfer
    ? "amount-transfer"
    : "amount-income";

  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ?? false,
  );
  const accountById = (aid) => accounts.find((a) => a.id === aid);
  const taggedAccount = accountId ? accountById(accountId) : null;
  const fromAccount = fromAccountId ? accountById(fromAccountId) : null;
  const toAccount = toAccountId ? accountById(toAccountId) : null;

  const solvencyCards = useSelector((state) => state.transactions.transactionData?.cards ?? []);
  const solvencyCommitments = useSelector(
    (state) => state.transactions.transactionData?.commitments ?? [],
  );
  const linkedCard = cardId ? solvencyCards.find((c) => c.id === cardId) : null;
  const cardName = linkedCard?.name ?? null;
  const cardColor = linkedCard?.color ?? null;
  const repaymentName = repaymentFor
    ? (
        solvencyCards.find((c) => c.id === repaymentFor)?.name ??
        solvencyCommitments.find((c) => c.id === repaymentFor)?.name ??
        null
      )
    : null;

  // Match by direct id (linked transaction), sipInvestmentId (SIP instalment),
  // licPolicyId (LIC premium payment) or autoDeductInvestmentId (recurring
  // cash-flow contribution — APY / VPF / chit, etc.)
  const investment = useSelector((state) => {
    if (
      !isInvestment &&
      !sipInvestmentId &&
      !licPolicyId &&
      !autoDeductInvestmentId
    )
      return null;
    const investments = state.transactions.transactionData?.investments ?? [];
    return (
      investments.find(
        (i) =>
          i.id === id ||
          i.id === sipInvestmentId ||
          i.id === licPolicyId ||
          i.id === autoDeductInvestmentId,
      ) ?? null
    );
  });

  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.investmentTypes ?? [],
  );
  const investSchema = investment
    ? getInvestmentTypeSchema(investment.type, userTypes)
    : null;
  const investInfo = investment ? getTypeInfo(investment.type) : null;
  const investType = investment
    ? {
        label:
          investment.type === "lic"
            ? "Premium"
            : investSchema?.label ?? investInfo?.label,
        color: investSchema?.color ?? investInfo?.color,
        icon: investSchema?.icon ?? investInfo?.icon,
      }
    : null;

  const displayName = transaction.name || (isInvestment ? "Investment" : source);

  function handleDeleteClick(e) {
    e.stopPropagation();
    setConfirming(true);
  }
  function handleEditClick(e) {
    e.stopPropagation();
    if (isInvestment) {
      setInvestEditMode("choose");
    } else {
      setEditing(true);
    }
  }

  function handleConfirmDelete() {
    dispatch(persistDeleteTransaction(id));
    setConfirming(false);
  }

  function handleSaveEdit(updated) {
    if (isInvestment) dispatch(persistUpdateInvestment(updated));
    else dispatch(persistUpdateTransaction(transaction, updated));
    setEditing(false);
  }

  // Uniform ledger tint: green for inflow, blue for investment outflow,
  // gray default for spend. Credit-card-paid expenses retain their own
  // muted style via `.transaction-card--credit`, so we skip the tint for
  // them — that class' background rule wins anyway and the credit styling
  // carries its own semantic meaning (debt-not-yet-cash).
  //
  // Self transfers are direction-aware: when the user is filtering by the
  // DESTINATION bank, the row reads as incoming (green). When filtering by
  // the SOURCE bank or in the unfiltered "All" view, it stays neutral.
  const transactionFilterAccountId = useSelector(
    (state) => state.filter?.transactions?.accountId ?? null,
  );
  let tintClass = "";
  if (!cardColor) {
    if (transactionType === "income") {
      tintClass = " ledger-tint-income";
    } else if (transactionType === "investment") {
      tintClass = " ledger-tint-invest";
    } else if (transactionType === "expense") {
      tintClass =
        category === "Repayment"
          ? " ledger-tint-repay"
          : " ledger-tint-expense";
    } else if (
      transactionType === "self_transfer" &&
      transactionFilterAccountId &&
      transactionFilterAccountId === toAccountId
    ) {
      tintClass = " ledger-tint-income";
    }
  }

  return (
    <>
      <div
        className={`transaction-card${open ? " transaction-card--open" : ""}${cardColor ? " transaction-card--credit" : ""}${tintClass}`}
        style={cardColor ? { "--credit-color": cardColor } : undefined}
        onClick={() => setOpen((p) => !p)}
        role="button"
        aria-expanded={open}
      >
        <div className="transaction-summary">
          <span className="transaction-name">{displayName}</span>
          <div className="transaction-summary-right">
            {investType && (
              <span
                className="tx-recurring-tag tx-investment-tag"
                style={{
                  background: investType.color + "22",
                  color: investType.color,
                }}
              >
                <i className={`fa-solid ${investType.icon}`} /> {investType.label}
              </span>
            )}
            {subscriptionId && (
              <span className="tx-recurring-tag tx-recurring-tag--sub">
                <i className="fa-solid fa-rotate" /> Subscription
              </span>
            )}
            {isSelfTransfer && (
              <span className="tx-recurring-tag tx-recurring-tag--transfer">
                <i className="fa-solid fa-arrow-right-arrow-left" /> Transfer
              </span>
            )}
            <span className={`transaction-amount ${amountClass}`}>
              {isSelfTransfer
                ? ""
                : !isInvestment && !isExpense
                  ? "+"
                  : ""}
              &nbsp;
              {formatter.format(amount)}
            </span>
            <motion.i
              className="fa-solid fa-chevron-down transaction-chevron"
              animate={{rotate: open ? 180 : 0}}
              transition={{duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94]}}
            />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{height: 0, opacity: 0}}
              animate={{height: "auto", opacity: 1}}
              exit={{height: 0, opacity: 0}}
              transition={accordionTransition}
              style={{overflow: "hidden"}}
            >
              <div className="detail-rows">
              {isSelfTransfer && (fromAccount || toAccount) && (
                  <div className="detail-row">
                    <span className="detail-label">Route</span>
                    <span className="detail-value detail-value--transfer">
                      {fromAccount ? (
                        <span
                          className="detail-bank-chip"
                          style={{
                            background: fromAccount.color || "var(--surface-active)",
                          }}
                        >
                          {fromAccount.bank}
                        </span>
                      ) : (
                        <span className="detail-bank-chip detail-bank-chip--missing">
                          Removed
                        </span>
                      )}
                      <i className="fa-solid fa-arrow-right detail-transfer-arrow" />
                      {toAccount ? (
                        <span
                          className="detail-bank-chip"
                          style={{
                            background: toAccount.color || "var(--surface-active)",
                          }}
                        >
                          {toAccount.bank}
                        </span>
                      ) : (
                        <span className="detail-bank-chip detail-bank-chip--missing">
                          Removed
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {!isSelfTransfer && taggedAccount && (
                  <div className="detail-row">
                    <span className="detail-label">Bank</span>
                    <span
                      className="detail-bank-chip"
                      style={{
                        background:
                          taggedAccount.color || "var(--surface-active)",
                      }}
                    >
                      {taggedAccount.bank}
                    </span>
                  </div>
                )}
                {category && (
                  <div className="detail-row">
                    <span className="detail-label">Category</span>
                    <span className="transaction-category">{category}</span>
                  </div>
                )}
                {paymentMode && (
                  <div className="detail-row">
                    <span className="detail-label">Payment</span>
                    <span className="detail-value">
                      {paymentMode}
                      {cardName && (
                        <span className="detail-card-tag">{cardName}</span>
                      )}
                    </span>
                  </div>
                )}
                {repaymentName && (
                  <div className="detail-row">
                    <span className="detail-label">For</span>
                    <span className="detail-value">{repaymentName}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Date</span>
                  <span className="detail-value">{formatDate(occurredAt)}</span>
                </div>
                {description && (
                  <div className="detail-row detail-row--wrap">
                    <span className="detail-label">Note</span>
                    <span className="detail-value detail-value--note">
                      <NoteContent text={description} />
                    </span>
                  </div>
                )}
                <div className="tx-actions">
                  {subscriptionId && (
                    <button
                      className="tx-action-btn tx-action-btn--invest"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/Subscriptions?highlight=${subscriptionId}`);
                      }}
                    >
                      <i className="fa-solid fa-rotate" /> View
                    </button>
                  )}
                  {isInvestment && investment && (
                    <button
                      className="tx-action-btn tx-action-btn--invest"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sipInvestmentId) {
                          navigate(`/Invest?ledger=${sipInvestmentId}&highlightTx=${id}`);
                        } else if (licPolicyId) {
                          navigate(`/Invest?ledger=${licPolicyId}&highlightTx=${id}`);
                        } else if (autoDeductInvestmentId) {
                          navigate(`/Invest?ledger=${autoDeductInvestmentId}&highlightTx=${id}`);
                        } else {
                          navigate(`/Invest?highlight=${investment.id}`);
                        }
                      }}
                    >
                      <i className="fa-solid fa-chart-line" /> View
                    </button>
                  )}
                  <button
                    className="tx-action-btn tx-action-btn--edit"
                    onClick={handleEditClick}
                  >
                    <i className="fa-solid fa-pen" /> Edit
                  </button>
                  {!isInvestment && (
                    <button
                      className="tx-action-btn tx-action-btn--delete"
                      onClick={handleDeleteClick}
                    >
                      <i className="fa-solid fa-trash-can" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {editing && (
        <Modal
          open={editing}
          onClose={() => setEditing(false)}
          title={
            isExpense
              ? "Edit Expense"
              : isInvestment
                ? "Edit Investment"
                : isSelfTransfer
                  ? "Edit Self Transfer"
                  : "Edit Income"
          }
        >
          {isExpense && (
            <ExpenseForm
              onSubmit={handleSaveEdit}
              onCancel={() => setEditing(false)}
              existing={transaction}
            />
          )}
          {isInvestment && (
            <InvestmentForm
              onSubmit={handleSaveEdit}
              onCancel={() => setEditing(false)}
              existing={investment}
            />
          )}
          {isSelfTransfer && (
            <SelfTransferForm
              onSubmit={(payload) =>
                handleSaveEdit({ ...transaction, ...payload })
              }
              onCancel={() => setEditing(false)}
              existing={transaction}
            />
          )}
          {!isExpense && !isInvestment && !isSelfTransfer && (
            <IncomeForm
              onSubmit={handleSaveEdit}
              onCancel={() => setEditing(false)}
              existing={transaction}
            />
          )}
        </Modal>
      )}

      {investEditMode === "choose" && (
        <Modal
          open
          onClose={() => setInvestEditMode(null)}
          title="Edit investment"
        >
          <div className="invest-edit-choices">
            <button
              type="button"
              className="invest-edit-option"
              onClick={() => {
                setEntryDraft({
                  amount: String(transaction.amount ?? ""),
                  occurredAt: (transaction.occurredAt ?? "").slice(0, 16),
                  description: transaction.description ?? "",
                  accountId: transaction.accountId ?? "",
                });
                setInvestEditMode("entry");
              }}
            >
              <span className="invest-edit-option-icon">
                <i className="fa-solid fa-receipt" />
              </span>
              <span className="invest-edit-option-text">
                <span className="invest-edit-option-title">
                  Edit{" "}
                  {licPolicyId
                    ? "this premium"
                    : sipInvestmentId
                      ? "this installment"
                      : "this entry"}
                </span>
                <span className="invest-edit-option-sub">
                  Change the amount, date or notes on this ledger record.
                </span>
              </span>
              <i className="fa-solid fa-chevron-right invest-edit-option-arrow" />
            </button>

            <button
              type="button"
              className="invest-edit-option"
              onClick={() => setInvestEditMode("investment")}
            >
              <span className="invest-edit-option-icon">
                <i className="fa-solid fa-sliders" />
              </span>
              <span className="invest-edit-option-text">
                <span className="invest-edit-option-title">
                  Edit{" "}
                  {licPolicyId ? "policy" : sipInvestmentId ? "SIP" : "investment"}
                </span>
                <span className="invest-edit-option-sub">
                  Open the full investment form, prefilled, to update its details.
                </span>
              </span>
              <i className="fa-solid fa-chevron-right invest-edit-option-arrow" />
            </button>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={() => setInvestEditMode(null)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {investEditMode === "entry" && entryDraft && (
        <Modal
          open
          onClose={() => setInvestEditMode(null)}
          title={
            licPolicyId
              ? "Edit premium entry"
              : sipInvestmentId
                ? "Edit installment entry"
                : "Edit ledger entry"
          }
        >
          <form
            className="expense-form"
            onSubmit={(e) => {
              e.preventDefault();
              dispatch(
                persistUpdateTransaction(transaction, {
                  ...transaction,
                  amount: entryDraft.amount,
                  occurredAt: entryDraft.occurredAt
                    ? new Date(entryDraft.occurredAt).toISOString()
                    : transaction.occurredAt,
                  description: entryDraft.description,
                  ...(multiBankEnabled
                    ? { accountId: entryDraft.accountId || undefined }
                    : {}),
                }),
              );
              setInvestEditMode(null);
            }}
          >
            <div className="field">
              <input
                type="number"
                inputMode="decimal"
                value={entryDraft.amount}
                onChange={(e) =>
                  setEntryDraft((d) => ({ ...d, amount: e.target.value }))
                }
                required
              />
              <label>Amount</label>
            </div>
            <DateField
              value={entryDraft.occurredAt}
              onChange={(e) =>
                setEntryDraft((d) => ({ ...d, occurredAt: e.target.value }))
              }
              label="Date & time"
              withTime
              required
            />
            {multiBankEnabled && accounts.length > 0 && (
              <BankChipSelector
                accounts={accounts}
                value={entryDraft.accountId}
                onChange={(aid) =>
                  setEntryDraft((d) => ({ ...d, accountId: aid }))
                }
                label="Account"
              />
            )}
            <div className="field">
              <textarea
                value={entryDraft.description}
                onChange={(e) =>
                  setEntryDraft((d) => ({ ...d, description: e.target.value }))
                }
                rows="3"
              />
              <label>Description / Notes</label>
              <NoteBulletHint text={entryDraft.description} />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setInvestEditMode(null)}
              >
                Cancel
              </button>
              <button type="submit" className="generic-button">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {investEditMode === "investment" && (
        <Modal
          open
          onClose={() => setInvestEditMode(null)}
          title={
            licPolicyId
              ? "Edit policy"
              : sipInvestmentId
                ? "Edit SIP"
                : "Edit investment"
          }
        >
          {investment ? (
            <InvestmentForm
              onSubmit={(updated) => {
                dispatch(persistUpdateInvestment(updated));
                setInvestEditMode(null);
              }}
              onCancel={() => setInvestEditMode(null)}
              existing={investment}
            />
          ) : (
            <div className="delete-confirm-body">
              <p className="delete-confirm-hint">
                No linked investment record was found for this transaction.
              </p>
              <div className="form-actions">
                <button
                  className="cancel-button"
                  onClick={() => setInvestEditMode(null)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {confirming && (
        <Modal
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Delete ${
            isExpense ? "expense" : isInvestment ? "investment" : "income"
          }?`}
        >
          <div className="delete-confirm-body">
            <p className="delete-confirm-name">{displayName}</p>
            <p className={`delete-confirm-amount ${amountClass}`}>
              {!isInvestment && !isExpense ? "+" : ""}&nbsp;
              {formatter.format(amount)}
            </p>
            <p className="delete-confirm-hint">This cannot be undone.</p>
            <div className="form-actions">
              <button
                className="cancel-button"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button className="danger-button" onClick={handleConfirmDelete}>
                <i className="fa-solid fa-trash-can" /> Delete
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
    amount: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
      .isRequired,
    transactionType: PropTypes.oneOf(["expense", "income", "investment"])
      .isRequired,
    category: PropTypes.string,
    paymentMode: PropTypes.string,
    description: PropTypes.string,
    occurredAt: PropTypes.string.isRequired,
    createdAt: PropTypes.string.isRequired,
  }).isRequired,
};

export default memo(TransactionCard);
