import { memo, useState, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  persistTransaction,
  persistAddInvestment,
  persistSelfTransfer,
} from "../redux/slices/transactionSlice";
import ActionButton from "../preStyledElements/actionButton/ActionButton";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";
import InvestmentForm from "../Forms/InvestmentForm";
import SelfTransferForm from "../Forms/SelfTransferForm";

const Actions = () => {
  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(
    () => window.location.hash.toLowerCase() === "#expense",
  );
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [isInvestFormOpen, setIsInvestFormOpen] = useState(false);
  const [isTransferFormOpen, setIsTransferFormOpen] = useState(false);
  const [investPrefillAmount, setInvestPrefillAmount] = useState("");
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
    dispatch(persistTransaction(transaction));
  };

  const handleInvestment = (investment) => {
    setIsInvestFormOpen(false);
    setInvestPrefillAmount("");
    dispatch(persistAddInvestment(investment));
  };

  const handleSelfTransfer = (payload) => {
    setIsTransferFormOpen(false);
    dispatch(persistSelfTransfer(payload));
  };

  if (onSolvencyPage || onPreferencesPage) return null;

  const showTransfer = !onInvestPage && canSelfTransfer;

  return (
    <>
      <footer
        ref={footerRef}
        className={`action-footer${(onTransactionsPage || onInvestPage || onDashboardPage) ? " action-footer--sticky" : ""}`}
      >
        {/* Left spacer mirrors the right "side" slot so the centered group
            stays visually centred when the transfer button is present. */}
        {showTransfer && (
          <div className="action-footer-side" aria-hidden="true" />
        )}
        <div className="action-footer-main">
          {onInvestPage ? (
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
          onClose={() => setIsExpenseFormOpen(false)}
          title="Add Expense"
        >
          <ExpenseForm
            onSubmit={handleTransaction}
            onCancel={() => setIsExpenseFormOpen(false)}
            onInvestmentSelect={(amount) => {
              setIsExpenseFormOpen(false);
              setInvestPrefillAmount(amount ?? "");
              setIsInvestFormOpen(true);
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
          }}
          title="Add Investment"
        >
          <InvestmentForm
            onSubmit={handleInvestment}
            onCancel={() => {
              setIsInvestFormOpen(false);
              setInvestPrefillAmount("");
            }}
            prefillAmount={investPrefillAmount}
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
    </>
  );
};

export default memo(Actions);
