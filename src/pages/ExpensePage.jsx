import { memo, useMemo } from "react";
import { useSelector } from "react-redux";
import Insights from "../components/Insights";
import TransactionList from "../components/TransactionList";
import { applyFilter, getFilterLabel } from "../utils/filterUtils";

const Expense = () => {
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? []
  );
  const filter = useSelector((state) => state.filter);
  const transactions = useMemo(
    () => applyFilter(allTransactions, filter),
    [allTransactions, filter]
  );
  const label = getFilterLabel(filter);

  return (
    <>
      <Insights />
      <TransactionList
        transactions={transactions}
        emptyMessage={
          label
            ? `No transactions found for ${label}.`
            : "No transactions yet. Tap Add Expense or Add Income to get started."
        }
      />
    </>
  );
};

export default memo(Expense);
