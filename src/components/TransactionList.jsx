import { memo, useMemo } from "react";
import PropTypes from "prop-types";
import { motion } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";
import TransactionCard from "./TransactionCard";
import PendingCaptures from "./PendingCaptures";
import { computeRunningBalances } from "../utils/accountUtils";
import { INR } from "../utils/dashboardUtils";
import { useTally } from "../context/TallyContext";
import { persistDeleteTally } from "../redux/slices/transactionSlice";

function dateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatSeparatorDate(iso) {
  const d = new Date(iso);
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-IN", opts);
}

function isWeekend(iso) {
  const day = new Date(iso).getDay();
  return day === 0 || day === 6;
}

const TransactionList = ({ transactions, emptyMessage, highlightId }) => {
  const dispatch = useDispatch();
  const tallyApi = useTally();

  const tallies = useSelector(
    (s) => s.transactions.transactionData?.tallies ?? [],
  );

  const items = useMemo(() => {
    const tx = transactions.map((t) => ({
      kind: "tx",
      id: t.id,
      date: t.occurredAt,
      data: t,
    }));
    const ty = tallies.map((t) => ({
      kind: "tally",
      id: t.id,
      date: t.createdAt,
      data: t,
    }));
    return [...tx, ...ty].sort((a, b) => {
      // Sort by the logged date+time (occurredAt), newest first — so entries
      // order by the time you set on them, backdated ones included, and the
      // latest of a day sits on top. Adding for "now" uses the current time, so
      // it lands at the top.
      const byLogged = new Date(b.date) - new Date(a.date);
      if (byLogged !== 0) return byLogged;
      // Exact tie (e.g. two date-only entries on the same day) → most recently
      // added on top.
      const addedA = a.data.createdAt ?? a.date;
      const addedB = b.data.createdAt ?? b.date;
      return new Date(addedB) - new Date(addedA);
    });
  }, [transactions, tallies]);

  // Per-day in/out totals → each date separator shows the day's net.
  const dayTotals = useMemo(() => {
    const m = new Map();
    for (const t of transactions) {
      const k = dateKey(t.occurredAt);
      const cur = m.get(k) ?? { in: 0, out: 0 };
      const amt = parseFloat(t.amount) || 0;
      if (t.transactionType === "income") cur.in += amt;
      else if (t.transactionType === "expense") cur.out += amt;
      m.set(k, cur);
    }
    return m;
  }, [transactions]);

  // Group consecutive items by day so each separator can stick over its group.
  const groups = useMemo(() => {
    const gs = [];
    let cur = null;
    for (const item of items) {
      const k = dateKey(item.date);
      if (!cur || cur.key !== k) {
        cur = { key: k, date: item.date, items: [] };
        gs.push(cur);
      }
      cur.items.push(item);
    }
    return gs;
  }, [items]);

  const pendingCount = useSelector(
    (s) => (s.transactions.transactionData?.autoReadInbox ?? []).length,
  );

  const allTransactions = useSelector(
    (s) => s.transactions.transactionData?.transactions ?? [],
  );
  const multiBankEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.multiBankEnabled ?? false,
  );
  const runningBalances = useMemo(
    () => computeRunningBalances(allTransactions, multiBankEnabled),
    [allTransactions, multiBankEnabled],
  );

  if (!items.length && pendingCount === 0) {
    return (
      <div className="transaction-empty">
        <i className="fa-solid fa-receipt transaction-empty-icon" />
        <p>{emptyMessage ?? "No transactions yet."}</p>
        <span className="transaction-empty-hint">
          Use the buttons below to add one, or adjust your filters above.
        </span>
      </div>
    );
  }

  return (
    <div className="transaction-list">
      <PendingCaptures />
      {groups.map((g) => {
        const tot = dayTotals.get(g.key) ?? { in: 0, out: 0 };
        const net = tot.in - tot.out;
        const hasFlow = tot.in > 0 || tot.out > 0;
        return (
          <motion.div
            key={g.key}
            className="tx-day-group"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <div
              className={`tx-date-separator${isWeekend(g.date) ? " tx-date-separator--weekend" : ""}`}
            >
              <span className="tx-date-separator-label">
                {formatSeparatorDate(g.date)}
              </span>
              {hasFlow && (
                <span
                  className="tx-date-separator-net"
                  style={{
                    color:
                      net >= 0
                        ? "var(--amount-income)"
                        : "var(--amount-expense)",
                  }}
                >
                  {net >= 0
                    ? `+${INR.format(net)}`
                    : `${INR.format(-net)} spent`}
                </span>
              )}
            </div>
            {g.items.map((item) =>
              item.kind === "tx" ? (
                <TransactionCard
                  key={`tx-${item.id}`}
                  transaction={item.data}
                  balanceAfter={runningBalances.get(item.id)}
                  highlightId={highlightId}
                />
              ) : (
                <div
                  key={`tally-${item.id}`}
                  className="tally-ledger-card"
                  role="button"
                  onClick={() => tallyApi?.openSaved(item.data)}
                >
                  <i className="fa-solid fa-calculator tally-ledger-icon" />
                  <div className="tally-ledger-info">
                    <span className="tally-ledger-name">
                      {item.data.title || "Tally"}
                    </span>
                    <span className="tally-ledger-meta">
                      {item.data.entries?.length ?? 0} item
                      {(item.data.entries?.length ?? 0) === 1 ? "" : "s"} · tap to
                      view
                    </span>
                  </div>
                  <span className="tally-ledger-amount">
                    {INR.format(item.data.total)}
                  </span>
                  <button
                    type="button"
                    className="tally-ledger-del"
                    aria-label="Remove tally"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(persistDeleteTally(item.id));
                    }}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ),
            )}
          </motion.div>
        );
      })}
    </div>
  );
};

TransactionList.propTypes = {
  transactions: PropTypes.arrayOf(PropTypes.object).isRequired,
  emptyMessage: PropTypes.string,
  highlightId: PropTypes.string,
};

export default memo(TransactionList);
