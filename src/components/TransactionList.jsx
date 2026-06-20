import { memo, useMemo } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import TransactionCard from "./TransactionCard";
import PendingCaptures from "./PendingCaptures";

function dateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatSeparatorDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const TransactionList = ({ transactions, emptyMessage }) => {
  const sorted = useMemo(
    () =>
      [...transactions].sort(
        (a, b) => new Date(b.occurredAt) - new Date(a.occurredAt),
      ),
    [transactions],
  );

  const pendingCount = useSelector(
    (s) => (s.transactions.transactionData?.autoReadInbox ?? []).length,
  );

  if (!sorted.length && pendingCount === 0) {
    return (
      <div className="transaction-empty">
        <p>{emptyMessage ?? "No transactions yet."}</p>
      </div>
    );
  }

  return (
    <div className="transaction-list">
      <PendingCaptures />
      {sorted.map((t, i) => {
        const showSeparator =
          i === 0 ||
          dateKey(t.occurredAt) !== dateKey(sorted[i - 1].occurredAt);
        return (
          <div key={t.id}>
            {showSeparator && (
              <div className="tx-date-separator">
                {formatSeparatorDate(t.occurredAt)}
              </div>
            )}
            <TransactionCard transaction={t} />
          </div>
        );
      })}
    </div>
  );
};

TransactionList.propTypes = {
  transactions: PropTypes.arrayOf(PropTypes.object).isRequired,
  emptyMessage: PropTypes.string,
};

export default memo(TransactionList);
