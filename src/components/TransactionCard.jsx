import {memo, useMemo, useState, useRef, useEffect} from "react";
import {motion, AnimatePresence} from "framer-motion";
import {useDispatch, useSelector} from "react-redux";
import { useDeepLinkNav } from "../hooks/useDeepLinkNav";
import PropTypes from "prop-types";
import {
  persistUpdateTransaction,
  persistDeleteTransaction,
  persistUpdateInvestment,
  persistAddAutoCategoryRule,
} from "../redux/slices/transactionSlice";
import { showToast } from "../redux/slices/toastSlice";
import { computePulse, computeMerchantStats } from "../utils/pulse";
import { categoryVisual } from "../utils/categoryVisual";
import MerchantSheet from "./MerchantSheet";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";
import InvestmentForm from "../Forms/InvestmentForm";
import SelfTransferForm from "../Forms/SelfTransferForm";
import BankChipSelector from "./BankChipSelector";
import BankLogo from "./BankLogo";
import DateField from "./DateField";
import { NoteContent, NoteBulletHint } from "./NoteText";
import { getInvestmentTypeSchema } from "../utils/investmentTypeSchemas";
import { getTypeInfo } from "../utils/investmentUtils";
import { subscriptionVisual } from "../utils/subscriptionUtils";

const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
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

const TransactionCard = ({transaction, balanceAfter, highlightId}) => {
  const dispatch = useDispatch();
  const deepNav = useDeepLinkNav();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  // 'choose' | 'entry' | 'investment' | null — investment edit flow. The
  // user picks between editing the raw ledger entry or the prefilled,
  // type-specific investment form.
  const [investEditMode, setInvestEditMode] = useState(null);
  const [entryDraft, setEntryDraft] = useState(null);
  const [merchantOpen, setMerchantOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const cardRef = useRef(null);
  const scrolledRef = useRef(false);
  const [highlightActive, setHighlightActive] = useState(false);
  const isHighlighted = highlightId != null && highlightId === transaction.id;

  useEffect(() => {
    if (!isHighlighted) {
      scrolledRef.current = false;
      return;
    }
    setHighlightActive(true);
    if (cardRef.current && !scrolledRef.current) {
      scrolledRef.current = true;
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const t = setTimeout(() => setHighlightActive(false), 1800);
    return () => clearTimeout(t);
  }, [isHighlighted]);

  const {
    id,
    source,
    amount,
    category,
    paymentMode,
    description,
    occurredAt,
    createdAt,
    updatedAt,
    transactionType,
    cardId,
    repaymentFor,
    lendingId,
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

  const subscriptions = useSelector(
    (state) => state.transactions.transactionData?.subscriptions ?? [],
  );
  const subscriptionTypes = useSelector(
    (state) => state.transactions.transactionData?.subscriptionTypes ?? [],
  );
  const subscription = subscriptionId
    ? subscriptions.find((s) => s.id === subscriptionId)
    : null;
  const subVisual =
    subscriptionId
      ? subscriptionVisual(subscription ?? { name: source }, subscriptionTypes)
      : null;

  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const budgets = useSelector(
    (state) => state.transactions.transactionData?.budgets ?? {},
  );
  const autoCategoryRules = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.autoCategoryRules ?? [],
  );
  const pulse = useMemo(
    () => (open ? computePulse(transaction, allTransactions, budgets) : null),
    [open, transaction, allTransactions, budgets],
  );
  const pulseLabelLower = (pulse?.label ?? "").toLowerCase();
  const canAddRule =
    !!pulse &&
    !pulse.isFirst &&
    isExpense &&
    !!category &&
    !!pulse.label &&
    !autoCategoryRules.some(
      (r) =>
        r.scope === "expense" &&
        pulseLabelLower.includes((r.pattern ?? "").toLowerCase()),
    );
  const handleAddRule = (e) => {
    e.stopPropagation();
    if (!pulse?.label || !category) return;
    dispatch(
      persistAddAutoCategoryRule({
        id: crypto.randomUUID(),
        scope: "expense",
        pattern: pulse.label,
        category,
      }),
    );
    dispatch(
      showToast({ message: `Future “${pulse.label}” → ${category}` }),
    );
  };

  const solvencyCards = useSelector((state) => state.transactions.transactionData?.cards ?? []);
  const solvencyCommitments = useSelector(
    (state) => state.transactions.transactionData?.commitments ?? [],
  );
  const solvencyLendings = useSelector(
    (state) => state.transactions.transactionData?.lendings ?? [],
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
    : lendingId
      ? solvencyLendings.find((l) => l.id === lendingId)?.name ?? null
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

  // Buy/Sell signal for investment activity in the ledger: a purchase/instalment
  // (investment type) is a Buy; sale/surrender/maturity proceeds (income tagged
  // to the Investment category) are a Sell.
  const investSignal = isInvestment
    ? "buy"
    : transactionType === "income" && category === "Investment"
      ? "sell"
      : null;
  // The Sell badge already conveys "sold", so drop a redundant "Sold:" prefix.
  const summaryName =
    investSignal === "sell" ? displayName.replace(/^Sold:\s*/i, "") : displayName;

  // Avatar ICON is chosen by specificity (subscription brand → investment type
  // → transfer → category). Avatar COLOR is unified by money-type using the
  // app's semantic amount tokens, so the whole ledger reads in one cohesive
  // palette (green in / red out / blue invest / violet transfer·repay) rather
  // than a per-category rainbow.
  const catVisual = categoryVisual(category, transactionType);
  const avatarIcon = isSelfTransfer
    ? "fa-arrow-right-arrow-left"
    : subscriptionId && subVisual
      ? subVisual.icon
      : investType?.icon || catVisual.icon;
  const avatarIconStyle =
    subscriptionId && subVisual ? subVisual.iconStyle : "fa-solid";
  const typeAccent = isSelfTransfer
    ? "var(--amount-repayment)"
    : transactionType === "income"
      ? "var(--amount-income)"
      : transactionType === "investment"
        ? "var(--amount-investment)"
        : category === "Repayment"
          ? "var(--amount-repayment)"
          : "var(--amount-expense)";
  const avatar = {
    icon: avatarIcon,
    iconStyle: avatarIconStyle,
    color: typeAccent,
  };
  const hasFacts =
    !!category ||
    !!paymentMode ||
    (!isSelfTransfer && !!taggedAccount) ||
    balanceAfter != null ||
    !!repaymentName;

  const merchantStats = useMemo(
    () =>
      merchantOpen ? computeMerchantStats(transaction, allTransactions) : null,
    [merchantOpen, transaction, allTransactions],
  );
  const canOpenMerchant = !isSelfTransfer && !!(transaction.name || source);

  const pulseCard = pulse && (
    <div className="tx-pulse">
      <div className="tx-pulse-stats">
        <div className="tx-pulse-stat">
          <i className="fa-solid fa-arrows-rotate tx-pulse-ic" />
          <span>
            {pulse.isFirst ? (
              <>
                First time with <b>{pulse.label}</b>
              </>
            ) : (
              <>
                {pulse.ordinalWord} this month ·{" "}
                <b>{inr0.format(pulse.monthTotal)}</b> so far
              </>
            )}
          </span>
        </div>
        {pulse.vsUsual && (
          <div
            className={`tx-pulse-stat tx-pulse-stat--${
              pulse.vsUsual.pct > 5
                ? "up"
                : pulse.vsUsual.pct < -5
                  ? "down"
                  : "flat"
            }`}
          >
            <i
              className={`fa-solid ${
                pulse.vsUsual.pct > 5
                  ? "fa-arrow-trend-up"
                  : pulse.vsUsual.pct < -5
                    ? "fa-arrow-trend-down"
                    : "fa-equals"
              } tx-pulse-ic`}
            />
            <span>
              {Math.abs(pulse.vsUsual.pct) <= 5 ? (
                <>
                  in line with your usual{" "}
                  <b>{inr0.format(pulse.vsUsual.usual)}</b>
                </>
              ) : (
                <>
                  {Math.abs(pulse.vsUsual.pct)}%{" "}
                  {pulse.vsUsual.pct > 0 ? "above" : "below"} your usual{" "}
                  <b>{inr0.format(pulse.vsUsual.usual)}</b>
                </>
              )}
            </span>
          </div>
        )}
      </div>
      {pulse.budget && (
        <div className="tx-pulse-budget">
          <div className="tx-pulse-budget-head">
            <span>{category}</span>
            <span className={pulse.budget.pct >= 100 ? "tx-pulse-over" : ""}>
              {pulse.budget.pct}% of {inr0.format(pulse.budget.limit)}
            </span>
          </div>
          <div className="tx-pulse-bar">
            <div
              className={`tx-pulse-bar-fill${
                pulse.budget.pct >= 100 ? " tx-pulse-bar-fill--over" : ""
              }`}
              style={{ width: `${Math.min(100, pulse.budget.pct)}%` }}
            />
            {pulse.budget.projected != null &&
              pulse.budget.projectedPct > pulse.budget.pct && (
                <span
                  className="tx-pulse-bar-pace"
                  style={{
                    left: `${Math.min(100, pulse.budget.projectedPct)}%`,
                  }}
                  title="Projected month-end"
                />
              )}
          </div>
          {pulse.budget.projected != null && (
            <div className="tx-pulse-forecast">
              <span
                className={
                  pulse.budget.projected > pulse.budget.limit
                    ? "tx-pulse-over"
                    : ""
                }
              >
                <i className="fa-solid fa-arrow-trend-up" /> On pace for{" "}
                {inr0.format(pulse.budget.projected)} by month-end
              </span>
              {pulse.budget.daysLeft > 0 && pulse.budget.remaining > 0 && (
                <span className="tx-pulse-safe">
                  <i className="fa-solid fa-shield-halved" /> Safe:{" "}
                  {inr0.format(pulse.budget.dailyAllowance)}/day
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {!pulse.budget && pulse.budgetNudge && (
        <p className="tx-pulse-nudge">
          <i className="fa-solid fa-circle-info" /> Set a {category} budget on the
          Dashboard to see your spending pace here.
        </p>
      )}
      {pulse.headline && <p className="tx-pulse-headline">{pulse.headline}</p>}
      {canAddRule && (
        <button
          type="button"
          className="tx-pulse-action"
          onClick={handleAddRule}
        >
          <i className="fa-solid fa-bolt" /> Auto-tag “{pulse.label}” as{" "}
          {category}
        </button>
      )}
    </div>
  );

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
        ref={cardRef}
        className={`transaction-card${open ? " transaction-card--open" : ""}${cardColor ? " transaction-card--credit" : ""}${tintClass}${highlightActive ? " transaction-card--highlight" : ""}`}
        style={cardColor ? { "--credit-color": cardColor } : undefined}
        onClick={() => setOpen((p) => !p)}
        role="button"
        aria-expanded={open}
      >
        <div className="transaction-summary">
          <span
            className={`tx-avatar${canOpenMerchant ? " tx-avatar--tappable" : ""}`}
            style={{ "--tx-accent": avatar.color }}
            role={canOpenMerchant ? "button" : undefined}
            aria-label={canOpenMerchant ? `${summaryName} history` : undefined}
            onClick={
              canOpenMerchant
                ? (e) => {
                    e.stopPropagation();
                    setMerchantOpen(true);
                  }
                : undefined
            }
          >
            <i className={`${avatar.iconStyle} ${avatar.icon}`} />
            {investSignal && (
              <span className={`tx-avatar-sig tx-avatar-sig--${investSignal}`}>
                <i
                  className={`fa-solid ${
                    investSignal === "buy" ? "fa-arrow-down" : "fa-arrow-up"
                  }`}
                />
              </span>
            )}
          </span>
          <div className="tx-main">
            <span className="transaction-name">{summaryName}</span>
          </div>
          <div className="transaction-summary-right">
            <span className={`transaction-amount ${amountClass}`}>
              {isSelfTransfer ? "" : !isInvestment && !isExpense ? "+" : ""}
              {formatter.format(amount)}
            </span>
          </div>
          <motion.i
            className="fa-solid fa-chevron-down transaction-chevron"
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
          />
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
                <div className="tx-meta-footer">
                  <span>
                    <i className="fa-regular fa-clock" /> Added{" "}
                    <span className="tx-meta-time">
                      {formatDate(occurredAt || createdAt)}
                    </span>
                  </span>
                  {updatedAt &&
                    new Date(updatedAt) - new Date(createdAt || updatedAt) >
                      1000 && (
                      <span>
                        <i className="fa-solid fa-pen" /> Updated{" "}
                        <span className="tx-meta-time">
                          {formatDate(updatedAt)}
                        </span>
                      </span>
                    )}
                </div>
              {isSelfTransfer && (fromAccount || toAccount) && (
                  <div className="detail-row">
                    <span className="detail-label">Route</span>
                    <span className="detail-value detail-value--transfer">
                      {fromAccount ? (
                        <span className="detail-bank-value">
                          <BankLogo
                            bank={fromAccount.bank}
                            color={fromAccount.color}
                            size={18}
                          />
                          {fromAccount.bank}
                        </span>
                      ) : (
                        <span className="detail-bank-chip detail-bank-chip--missing">
                          Removed
                        </span>
                      )}
                      <i className="fa-solid fa-arrow-right detail-transfer-arrow" />
                      {toAccount ? (
                        <span className="detail-bank-value">
                          <BankLogo
                            bank={toAccount.bank}
                            color={toAccount.color}
                            size={18}
                          />
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
                {hasFacts && (
                <div className="tx-facts">
                  {category && (
                    <div className="tx-fact">
                      <span
                        className="tx-fact-ic tx-fact-ic--accent"
                        style={{ "--tx-accent": typeAccent }}
                      >
                        <i className={`${catVisual.iconStyle} ${catVisual.icon}`} />
                      </span>
                      <div className="tx-fact-body">
                        <span className="tx-fact-label">Category</span>
                        <span className="tx-fact-value">{category}</span>
                      </div>
                    </div>
                  )}
                  {paymentMode && (
                    <div className="tx-fact">
                      <span className="tx-fact-ic">
                        <i
                          className={`fa-solid ${
                            cardName ? "fa-credit-card" : "fa-wallet"
                          }`}
                        />
                      </span>
                      <div className="tx-fact-body">
                        <span className="tx-fact-label">Payment</span>
                        <span className="tx-fact-value">
                          {paymentMode}
                          {cardName && (
                            <span className="detail-card-tag">{cardName}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                  {!isSelfTransfer && taggedAccount && (
                    <div className="tx-fact">
                      <span className="tx-fact-ic">
                        <BankLogo
                          bank={taggedAccount.bank}
                          color={taggedAccount.color}
                          size={18}
                        />
                      </span>
                      <div className="tx-fact-body">
                        <span className="tx-fact-label">Bank</span>
                        <span className="tx-fact-value">{taggedAccount.bank}</span>
                      </div>
                    </div>
                  )}
                  {balanceAfter != null && (
                    <div className="tx-fact">
                      <span className="tx-fact-ic">
                        <i className="fa-solid fa-scale-balanced" />
                      </span>
                      <div className="tx-fact-body">
                        <span className="tx-fact-label">Balance after</span>
                        <span className="tx-fact-value transaction-balance">
                          {formatter.format(balanceAfter)}
                        </span>
                      </div>
                    </div>
                  )}
                  {repaymentName && (
                    <div className="tx-fact">
                      <span className="tx-fact-ic">
                        <i className="fa-solid fa-link" />
                      </span>
                      <div className="tx-fact-body">
                        <span className="tx-fact-label">For</span>
                        <span className="tx-fact-value">{repaymentName}</span>
                      </div>
                    </div>
                  )}
                </div>
                )}
                {description && (
                  <div className="tx-note">
                    <span className="tx-note-label">
                      <i className="fa-solid fa-pen-nib" /> Note
                    </span>
                    <span className="detail-value--note">
                      <NoteContent text={description} />
                    </span>
                  </div>
                )}
                {(pulse || canOpenMerchant) && (
                  <div
                    className={`tx-seemore-wrap${showMore ? " tx-seemore-wrap--open" : ""}`}
                  >
                    <button
                      type="button"
                      className={`tx-seemore${showMore ? " tx-seemore--open" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMore((v) => !v);
                      }}
                      aria-expanded={showMore}
                    >
                      <span>
                        <i className="fa-solid fa-wand-magic-sparkles" />{" "}
                        {showMore ? "See less" : "Smart insights"}
                      </span>
                      <i
                        className={`fa-solid fa-chevron-down tx-seemore-chev${
                          showMore ? " tx-seemore-chev--open" : ""
                        }`}
                      />
                    </button>
                    {showMore && (
                      <div className="tx-more">
                        {canOpenMerchant && (
                          <button
                            className="tx-action-btn tx-action-btn--history tx-more-history"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMerchantOpen(true);
                            }}
                          >
                            <i className="fa-solid fa-clock-rotate-left" />{" "}
                            Merchant history
                          </button>
                        )}
                        {pulseCard}
                      </div>
                    )}
                  </div>
                )}
                <div className="tx-actions">
                  {subscriptionId && (
                    <button
                      className="tx-action-btn tx-action-btn--invest"
                      onClick={(e) => {
                        e.stopPropagation();
                        deepNav(`/Subscriptions?highlight=${subscriptionId}`);
                      }}
                    >
                      <i className="fa-solid fa-rotate" /> View
                    </button>
                  )}
                  {isInvestment && (
                    <button
                      className="tx-action-btn tx-action-btn--invest"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sipInvestmentId) {
                          deepNav(`/Invest?ledger=${sipInvestmentId}&highlightTx=${id}`);
                        } else if (licPolicyId) {
                          deepNav(`/Invest?ledger=${licPolicyId}&highlightTx=${id}`);
                        } else if (autoDeductInvestmentId) {
                          deepNav(`/Invest?ledger=${autoDeductInvestmentId}&highlightTx=${id}`);
                        } else {
                          deepNav(`/Invest?highlight=${investment?.id ?? id}`);
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
      <MerchantSheet
        open={merchantOpen}
        onClose={() => setMerchantOpen(false)}
        stats={merchantStats}
        accent={avatar.color}
      />
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
    updatedAt: PropTypes.string,
  }).isRequired,
  balanceAfter: PropTypes.number,
  highlightId: PropTypes.string,
};

export default memo(TransactionCard);
