import { memo } from "react";
import PropTypes from "prop-types";
import TransactionCard from "./TransactionCard";

const TransactionList = ({ transactions, emptyMessage }) => {
  if (!transactions.length) {
    return (
      <div className="transaction-empty">
        <p>{emptyMessage ?? "No transactions yet."}</p>
      </div>
    );
  }

  return (
    <div className="transaction-list">
      {transactions.map((t) => (
        <TransactionCard key={t.id} transaction={t} />
      ))}
    </div>
  );
};

TransactionList.propTypes = {
  transactions: PropTypes.arrayOf(PropTypes.object).isRequired,
  emptyMessage: PropTypes.string,
};

export default memo(TransactionList);
