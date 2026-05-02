import { memo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { persistTransaction, persistAddInvestment } from "../redux/slices/transactionSlice";
import ActionButton from "../preStyledElements/actionButton/ActionButton";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";
import InvestmentForm from "../Forms/InvestmentForm";

const Actions = () => {
  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(false);
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [isInvestFormOpen, setIsInvestFormOpen] = useState(false);
  const dispatch = useDispatch();
  const driveReady = useSelector((state) => state.transactions.status === "ready");
  const { pathname } = useLocation();
  const onInvestPage = pathname.toLowerCase().includes("invest");

  const handleTransaction = (transaction) => {
    setIsIncomeFormOpen(false);
    setIsExpenseFormOpen(false);
    dispatch(persistTransaction(transaction));
  };

  const handleInvestment = (investment) => {
    setIsInvestFormOpen(false);
    dispatch(persistAddInvestment(investment));
  };

  return (
    <>
      <footer className="action-footer">
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
              <i className="fa-solid fa-plus" />
              Add Income
            </ActionButton>
            <ActionButton
              className="generic-button expense-button"
              disabled={!driveReady}
              onClick={() => setIsExpenseFormOpen(true)}
            >
              <i className="fa-solid fa-minus" />
              Add Expense
            </ActionButton>
          </>
        )}
      </footer>

      {isIncomeFormOpen && (
        <Modal open={isIncomeFormOpen} onClose={() => setIsIncomeFormOpen(false)} title="Add Income">
          <IncomeForm onSubmit={handleTransaction} onCancel={() => setIsIncomeFormOpen(false)} />
        </Modal>
      )}
      {isExpenseFormOpen && (
        <Modal open={isExpenseFormOpen} onClose={() => setIsExpenseFormOpen(false)} title="Add Expense">
          <ExpenseForm onSubmit={handleTransaction} onCancel={() => setIsExpenseFormOpen(false)} />
        </Modal>
      )}
      {isInvestFormOpen && (
        <Modal open={isInvestFormOpen} onClose={() => setIsInvestFormOpen(false)} title="Add Investment">
          <InvestmentForm onSubmit={handleInvestment} onCancel={() => setIsInvestFormOpen(false)} />
        </Modal>
      )}
    </>
  );
};

export default memo(Actions);
