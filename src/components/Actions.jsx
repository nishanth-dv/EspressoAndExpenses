import { memo, useState, useEffect, useRef } from "react";
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
  const canSelfTransfer = multiBankEnabled && accountCount >= 2;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onInvestPage = pathname.toLowerCase().includes("invest");
  const onTransactionsPage = pathname.toLowerCase().includes("transactions");
  const onSolvencyPage = pathname.toLowerCase().includes("solvency");
  const onPreferencesPage = pathname.toLowerCase().includes("preferences");
  const onDashboardPage = pathname.toLowerCase().includes("dashboard");
  const onSubscriptionsPage = pathname.toLowerCase().includes("subscriptions");

  useEffect(() => {
    if (window.location.hash.toLowerCase() === "#expense") {
      navigate(window.location.pathname, { replace: true });
    }
  }, [navigate]);

  // Mobile browsers can anchor `position: fixed` to the layout viewport, so
  // the footer drifts when the URL bar collapses/expands. Track the visual
  // viewport and shift the footer by the offset between layout and visual
  // bottoms so it always sits at the visible bottom edge.
  const footerRef = useRef(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (!footerRef.current) return;
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      footerRef.current.style.bottom = `${Math.max(0, offset)}px`;
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const handleTransaction = (transaction) => {
    setIsIncomeFormOpen(false);
    setIsExpenseFormOpen(false);
    setExpenseInvestTarget(null);
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

  if (onSolvencyPage || onPreferencesPage) return null;

  const showTransfer = !onInvestPage && !onSubscriptionsPage && canSelfTransfer;

  return (
    <>
      <footer
        ref={footerRef}
        className={`action-footer${(onTransactionsPage || onInvestPage || onDashboardPage || onSubscriptionsPage) ? " action-footer--sticky" : ""}`}
      >
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
                <i className="fa-solid fa-money-bills" />
                Income
              </ActionButton>
              <ActionButton
                className="generic-button expense-button"
                disabled={!driveReady}
                onClick={() => setIsExpenseFormOpen(true)}
              >
                <i className="fa-solid fa-cart-arrow-down" />
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
          }}
          title={expenseInvestTarget ? "Pay Premium" : "Add Expense"}
        >
          <ExpenseForm
            onSubmit={handleTransaction}
            investmentTarget={expenseInvestTarget}
            onChangeInvestmentTarget={handleChangeInvestment}
            onCancel={() => {
              setIsExpenseFormOpen(false);
              setExpenseInvestTarget(null);
            }}
            onInvestmentSelect={({ amount, existing, type } = {}) => {
              setIsExpenseFormOpen(false);
              setInvestPrefillAmount(amount ?? "");
              setInvestPreExisting(existing ?? null);
              setInvestPrefillType(existing ? "" : (type ?? ""));
              setIsInvestFormOpen(true);
            }}
            onSubscriptionSelect={({ name, amount } = {}) => {
              setIsExpenseFormOpen(false);
              setExpenseInvestTarget(null);
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
};

export default memo(Actions);
