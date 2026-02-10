import { memo, useState } from "react";
import { useDispatch } from "react-redux";
import { addTransaction } from "../redux/slices/transactionSlice";
import ActionButton from "../preStyledElements/actionButton/ActionButton";
import Modal from "../preStyledElements/modal/Modal";
import ExpenseForm from "../Forms/ExpenseForm";
import IncomeForm from "../Forms/IncomeForm";

const Actions = () => {
  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(false);
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const dispatch = useDispatch();

  const handleTransaction = (transaction) => {
    setIsIncomeFormOpen(false);
    setIsExpenseFormOpen(false);
    dispatch(addTransaction(transaction));
  };

  return (
    <>
      <footer className="action-footer">
        <ActionButton
          className="generic-button income-button"
          onClick={() => {
            setIsIncomeFormOpen(true);
          }}
        >
          <i className="fa-solid fa-plus" />
          Add Income
        </ActionButton>
        <ActionButton
          className="generic-button expense-button"
          onClick={() => {
            setIsExpenseFormOpen(true);
          }}
        >
          <i className="fa-solid fa-minus" />
          Add Expense
        </ActionButton>
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
          />
        </Modal>
      )}
    </>
  );
};

export default memo(Actions);
