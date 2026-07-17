import { memo, useState, useEffect, useRef, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  persistTransaction,
  persistAddInvestment,
  persistUpdateInvestment,
  persistSelfTransfer,
} from "../redux/slices/transactionSlice";
import { persistAddSubscription } from "../redux/slices/solvencySlice";
import ActionButton from "../preStyledElements/actionButton/ActionButton";
import ActionLauncher from "./ActionLauncher";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";
import InvestmentForm from "../Forms/InvestmentForm";
import SelfTransferForm from "../Forms/SelfTransferForm";
import SubscriptionForm from "../Forms/SubscriptionForm";

const Actions = () => {
  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(
    () => window.location.hash.toLowerCase() === "#expense",
  );
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [isInvestFormOpen, setIsInvestFormOpen] = useState(false);
  const [isTransferFormOpen, setIsTransferFormOpen] = useState(false);
  const [isSubFormOpen, setIsSubFormOpen] = useState(false);
  const [subPrefill, setSubPrefill] = useState(null);
  const [investPrefillAmount, setInvestPrefillAmount] = useState("");
  const [investPreExisting, setInvestPreExisting] = useState(null);
  const [investPrefillType, setInvestPrefillType] = useState("");
  const [expenseInvestTarget, setExpenseInvestTarget] = useState(null);
  const [expenseAutoVoice, setExpenseAutoVoice] = useState(false);
  const dispatch = useDispatch();
  const driveReady = useSelector(
    (state) => state.transactions.status === "ready",
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accountCount = useSelector(
    (state) =>
      (state.transactions.transactionData?.accounts ?? []).length,
  );
  const actionStyle = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.actionStyle ?? "docked",
  );
  const voiceEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.voiceAddEnabled ?? false,
  );
  const recentTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions,
  );
  const canSelfTransfer = multiBankEnabled && accountCount >= 2;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onInvestPage = pathname.toLowerCase().includes("invest");
  const onSolvencyPage = pathname.toLowerCase().includes("solvency");
  const onPreferencesPage = pathname.toLowerCase().includes("preferences");
  const onSubscriptionsPage = pathname.toLowerCase().includes("subscriptions");
  const onAdvisoryPage = pathname.toLowerCase().includes("advisory");
  const hasFooter = !(onSolvencyPage || onPreferencesPage || onAdvisoryPage);
  const floating = actionStyle === "floating";
  const showDockedFooter = !floating && hasFooter;
  const showTransfer = !onInvestPage && !onSubscriptionsPage && canSelfTransfer;

  useEffect(() => {
    if (window.location.hash.toLowerCase() === "#expense") {
      navigate(window.location.pathname, { replace: true });
    }
  }, [navigate]);

  // Publish the fixed footer's height as --footer-h so .outlet can reserve
  // exactly that much bottom padding (and 0 when there's no footer).
  const footerRef = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = footerRef.current;
    if (!showDockedFooter || !el) {
      root.style.setProperty("--footer-h", "0px");
      return;
    }
    const apply = () =>
      root.style.setProperty("--footer-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--footer-h", "0px");
    };
  }, [showDockedFooter]);

  const adaptivePrimary = useMemo(() => {
    const list = recentTransactions ?? [];
    const recent = [...list]
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
      .slice(0, 10);
    let inc = 0;
    let exp = 0;
    for (const t of recent) {
      if (t.transactionType === "income") inc += 1;
      else if (t.transactionType === "expense") exp += 1;
    }
    return inc > exp ? "income" : "expense";
  }, [recentTransactions]);

  const addActions = useMemo(() => {
    if (onSubscriptionsPage)
      return [
        {
          key: "subscription",
          label: "Add Subscription",
          sub: "Track a recurring charge",
          icon: "fa-rotate",
          tone: "var(--amount-repayment)",
          primary: true,
          needsDrive: true,
          onClick: () => setIsSubFormOpen(true),
        },
      ];
    if (onInvestPage)
      return [
        {
          key: "investment",
          label: "Add Investment",
          sub: "Log a new holding",
          icon: "fa-seedling",
          tone: "var(--amount-investment)",
          primary: true,
          needsDrive: true,
          onClick: () => setIsInvestFormOpen(true),
        },
      ];
    if (onSolvencyPage || onAdvisoryPage) return [];

    const income = {
      key: "income",
      label: "Add Income",
      sub: "Money in",
      icon: "fa-money-bill-trend-up",
      tone: "var(--amount-income)",
      needsDrive: true,
      onClick: () => setIsIncomeFormOpen(true),
    };
    const expense = {
      key: "expense",
      label: "Add Expense",
      sub: "Money out",
      icon: "fa-bag-shopping",
      tone: "var(--amount-expense)",
      needsDrive: true,
      onClick: () => setIsExpenseFormOpen(true),
    };
    const ordered =
      adaptivePrimary === "income"
        ? [{ ...income, primary: true }, expense]
        : [{ ...expense, primary: true }, income];

    if (voiceEnabled)
      ordered.push({
        key: "voice",
        label: "Speak to add",
        sub: 'Say "200 for lunch"',
        icon: "fa-microphone",
        tone: "var(--amount-investment)",
        needsDrive: true,
        onClick: () => {
          setExpenseAutoVoice(true);
          setIsExpenseFormOpen(true);
        },
      });
    if (showTransfer)
      ordered.push({
        key: "transfer",
        label: "Self Transfer",
        sub: "Move between your accounts",
        icon: "fa-arrow-right-arrow-left",
        tone: "var(--text-secondary)",
        needsDrive: true,
        onClick: () => setIsTransferFormOpen(true),
      });
    return ordered;
  }, [
    onSubscriptionsPage,
    onInvestPage,
    onSolvencyPage,
    onAdvisoryPage,
    adaptivePrimary,
    voiceEnabled,
    showTransfer,
  ]);

  const handleTransaction = (transaction) => {
    setIsIncomeFormOpen(false);
    setIsExpenseFormOpen(false);
    setExpenseInvestTarget(null);
    setExpenseAutoVoice(false);
    dispatch(persistTransaction(transaction));
  };

  const handlePayInvestment = (inv) => {
    setIsInvestFormOpen(false);
    setInvestPrefillAmount("");
    setInvestPrefillType("");
    setInvestPreExisting(null);
    setExpenseInvestTarget(inv);
    setIsExpenseFormOpen(true);
  };

  const handleChangeInvestment = () => {
    setIsExpenseFormOpen(false);
    setExpenseInvestTarget(null);
    setInvestPrefillAmount("");
    setInvestPrefillType("");
    setInvestPreExisting(null);
    setIsInvestFormOpen(true);
  };

  const handleInvestment = (investment) => {
    setIsInvestFormOpen(false);
    setInvestPrefillAmount("");
    setInvestPrefillType("");
    if (investPreExisting) {
      dispatch(persistUpdateInvestment(investment));
    } else {
      dispatch(persistAddInvestment(investment));
    }
    setInvestPreExisting(null);
  };

  const handleSelfTransfer = (payload) => {
    setIsTransferFormOpen(false);
    dispatch(persistSelfTransfer(payload));
  };

  const handleSubscription = (subscription) => {
    setIsSubFormOpen(false);
    setSubPrefill(null);
    dispatch(persistAddSubscription(subscription));
  };

  const modals = (
    <>
      {isIncomeFormOpen && (
        <Modal
          open={isIncomeFormOpen}
          onClose={() => setIsIncomeFormOpen(false)}
          title="Add Income"
        >
          <IncomeForm
            onSubmit={handleTransaction}
            onCancel={() => setIsIncomeFormOpen(false)}
          />
        </Modal>
      )}
      {isExpenseFormOpen && (
        <Modal
          open={isExpenseFormOpen}
          onClose={() => {
            setIsExpenseFormOpen(false);
            setExpenseInvestTarget(null);
            setExpenseAutoVoice(false);
          }}
          title={expenseInvestTarget ? "Pay Premium" : "Add Expense"}
        >
          <ExpenseForm
            onSubmit={handleTransaction}
            investmentTarget={expenseInvestTarget}
            autoVoice={expenseAutoVoice}
            onChangeInvestmentTarget={handleChangeInvestment}
            onCancel={() => {
              setIsExpenseFormOpen(false);
              setExpenseInvestTarget(null);
              setExpenseAutoVoice(false);
            }}
            onInvestmentSelect={({ amount, existing, type } = {}) => {
              setIsExpenseFormOpen(false);
              setExpenseAutoVoice(false);
              setInvestPrefillAmount(amount ?? "");
              setInvestPreExisting(existing ?? null);
              setInvestPrefillType(existing ? "" : (type ?? ""));
              setIsInvestFormOpen(true);
            }}
            onSubscriptionSelect={({ name, amount } = {}) => {
              setIsExpenseFormOpen(false);
              setExpenseInvestTarget(null);
              setExpenseAutoVoice(false);
              setSubPrefill({ name: name ?? "", amount: amount ?? "" });
              setIsSubFormOpen(true);
            }}
          />
        </Modal>
      )}
      {isInvestFormOpen && (
        <Modal
          open={isInvestFormOpen}
          onClose={() => {
            setIsInvestFormOpen(false);
            setInvestPrefillAmount("");
            setInvestPreExisting(null);
            setInvestPrefillType("");
          }}
          title={investPreExisting ? "Update Investment" : "Add Investment"}
        >
          <InvestmentForm
            onSubmit={handleInvestment}
            onPayExisting={handlePayInvestment}
            onCancel={() => {
              setIsInvestFormOpen(false);
              setInvestPrefillAmount("");
              setInvestPreExisting(null);
              setInvestPrefillType("");
            }}
            prefillAmount={investPrefillAmount}
            existing={investPreExisting}
            prefillType={investPrefillType}
          />
        </Modal>
      )}
      {isTransferFormOpen && (
        <Modal
          open={isTransferFormOpen}
          onClose={() => setIsTransferFormOpen(false)}
          title="Self Transfer"
        >
          <SelfTransferForm
            onSubmit={handleSelfTransfer}
            onCancel={() => setIsTransferFormOpen(false)}
          />
        </Modal>
      )}
      {isSubFormOpen && (
        <Modal
          open={isSubFormOpen}
          onClose={() => {
            setIsSubFormOpen(false);
            setSubPrefill(null);
          }}
          title="Add Subscription"
        >
          <SubscriptionForm
            onSubmit={handleSubscription}
            prefill={subPrefill}
            onCancel={() => {
              setIsSubFormOpen(false);
              setSubPrefill(null);
            }}
          />
        </Modal>
      )}
    </>
  );

  if (floating) {
    return (
      <>
        <ActionLauncher addActions={addActions} driveReady={driveReady} />
        {modals}
      </>
    );
  }

  if (!hasFooter) return null;

  return (
    <>
      <footer ref={footerRef} className="action-footer">
        {/* Left spacer mirrors the right "side" slot so the centered group
            stays visually centred when the transfer button is present. */}
        {showTransfer && (
          <div className="action-footer-side" aria-hidden="true" />
        )}
        <div className="action-footer-main">
          {onSubscriptionsPage ? (
            <ActionButton
              className="generic-button income-button"
              disabled={!driveReady}
              onClick={() => setIsSubFormOpen(true)}
            >
              <i className="fa-solid fa-rotate" />
              Add Subscription
            </ActionButton>
          ) : onInvestPage ? (
            <ActionButton
              className="generic-button income-button"
              disabled={!driveReady}
              onClick={() => setIsInvestFormOpen(true)}
            >
              <i className="fa-solid fa-seedling" />
              Add Investment
            </ActionButton>
          ) : (
            <>
              <ActionButton
                className="generic-button income-button"
                disabled={!driveReady}
                onClick={() => setIsIncomeFormOpen(true)}
              >
                <i className="fa-solid fa-money-bill-trend-up" />
                Income
              </ActionButton>
              <ActionButton
                className="generic-button expense-button"
                disabled={!driveReady}
                onClick={() => setIsExpenseFormOpen(true)}
              >
                <i className="fa-solid fa-bag-shopping" />
                Expense
              </ActionButton>
            </>
          )}
        </div>
        {showTransfer && (
          <div className="action-footer-side action-footer-side--right">
            <button
              type="button"
              className="action-transfer-btn"
              disabled={!driveReady}
              onClick={() => setIsTransferFormOpen(true)}
              aria-label="Add Self Transfer"
              title="Self Transfer between your bank accounts"
            >
              <i className="fa-solid fa-arrow-right-arrow-left" />
            </button>
          </div>
        )}
      </footer>

      {modals}
    </>
  );
};

export default memo(Actions);
