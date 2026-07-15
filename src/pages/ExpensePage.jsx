import { memo, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import Insights from "../components/Insights";
import TransactionList from "../components/TransactionList";
import FilterBar from "../components/FilterBar";
import StatementImportButton from "../components/StatementImportButton";
import { applyFilter, getFilterLabel } from "../utils/filterUtils";
import { CATEGORIES, INCOME_CATEGORIES } from "../utils/constants";
import { useLedger, useLedgerLoading } from "../hooks/useLedger";
import Skeleton from "../components/Skeleton";
import { motion } from "framer-motion";
import useCountUp from "../hooks/useCountUp";


const TYPE_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "expense",    label: "Expense" },
  { value: "income",     label: "Income" },
  { value: "investment", label: "Investment" },
];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// A filter-aware summary of the CURRENT view — the ledger's missing "what am I
// looking at" total. Sums the already-filtered list (date/type/category/search).
function LedgerSummary({ transactions }) {
  const t = useMemo(() => {
    let inc = 0;
    let exp = 0;
    let inv = 0;
    for (const tx of transactions) {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.transactionType === "income") inc += amt;
      else if (tx.transactionType === "expense") exp += amt;
      else if (tx.transactionType === "investment") inv += amt;
    }
    return { inc, exp, inv, net: inc - exp, count: transactions.length };
  }, [transactions]);

  const aCount = useCountUp(t.count, 600);
  const aIn = useCountUp(t.inc);
  const aOut = useCountUp(t.exp);
  const aInv = useCountUp(t.inv);
  const aNet = useCountUp(Math.abs(t.net));

  if (t.count === 0) return null;
  const netPos = t.net >= 0;

  return (
    <div className="ledger-summary">
      <div className="ledger-summary-count">
        <span className="ledger-summary-count-num">{Math.round(aCount)}</span>
        <span className="ledger-summary-count-lbl">
          {t.count === 1 ? "entry" : "entries"}
        </span>
      </div>
      <div className="ledger-summary-stats">
        <div className="ledger-summary-stat">
          <span className="ledger-summary-stat-lbl">In</span>
          <span
            className="ledger-summary-stat-val"
            style={{ color: "var(--amount-income)" }}
          >
            {INR.format(Math.round(aIn))}
          </span>
        </div>
        <div className="ledger-summary-stat">
          <span className="ledger-summary-stat-lbl">Out</span>
          <span
            className="ledger-summary-stat-val"
            style={{ color: "var(--amount-expense)" }}
          >
            {INR.format(Math.round(aOut))}
          </span>
        </div>
        {t.inv > 0 && (
          <div className="ledger-summary-stat">
            <span className="ledger-summary-stat-lbl">Invested</span>
            <span
              className="ledger-summary-stat-val"
              style={{ color: "var(--amount-investment)" }}
            >
              {INR.format(Math.round(aInv))}
            </span>
          </div>
        )}
        <div className="ledger-summary-stat ledger-summary-stat--net">
          <span className="ledger-summary-stat-lbl">Net</span>
          <span
            className="ledger-summary-stat-val"
            style={{
              color: netPos
                ? "var(--amount-income)"
                : "var(--amount-expense)",
            }}
          >
            {netPos ? "+" : "−"}
            {INR.format(Math.round(aNet))}
          </span>
        </div>
      </div>
    </div>
  );
}

const Expense = () => {
  // DB users: seeded from the page-wise `transactions` API into the blob.
  // Drive users: the in-memory blob. Either way we read one source (the blob),
  // so optimistic writes reflect instantly and filtering/rendering is identical.
  const allTransactions = useLedger();
  const ledgerLoading = useLedgerLoading();
  const showSkeleton = ledgerLoading && allTransactions.length === 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const filter = useSelector((state) => state.filter.transactions);

  useEffect(() => {
    if (!highlightId) return;
    document.body.classList.add("tx-highlighting");
    const t = setTimeout(() => setSearchParams({}, { replace: true }), 2500);
    return () => {
      clearTimeout(t);
      document.body.classList.remove("tx-highlighting");
    };
  }, [highlightId, setSearchParams]);
  const statementImportEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.statementImportEnabled ??
      false,
  );

  const [typeFilter, setTypeFilter]         = useState("all");
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [search, setSearch]                 = useState("");

  const dateFiltered = useMemo(
    () => applyFilter(allTransactions, filter),
    [allTransactions, filter],
  );

  const transactions = useMemo(() => {
    let result = dateFiltered;
    if (typeFilter !== "all")
      result = result.filter((t) => t.transactionType === typeFilter);
    if (categoryFilter.length > 0)
      result = result.filter((t) =>
        categoryFilter.includes(`${t.transactionType}:${t.category}`),
      );
    const q = search.trim().toLowerCase();
    if (q)
      result = result.filter((t) =>
        `${t.name ?? ""} ${t.source ?? ""} ${t.description ?? ""} ${t.category ?? ""} ${t.paymentMode ?? ""} ${t.amount ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    return result;
  }, [dateFiltered, typeFilter, categoryFilter, search]);

  const categoryOptions = useMemo(() => {
    if (typeFilter === "expense")
      return CATEGORIES.map((c) => ({ value: `expense:${c}`, label: c }));
    if (typeFilter === "income")
      return INCOME_CATEGORIES.map((c) => ({ value: `income:${c}`, label: c }));
    if (typeFilter === "investment") return null;
    return [
      {
        group: "Expense",
        options: CATEGORIES.map((c) => ({ value: `expense:${c}`, label: c })),
      },
      {
        group: "Income",
        options: INCOME_CATEGORIES.map((c) => ({ value: `income:${c}`, label: c })),
      },
    ];
  }, [typeFilter]);

  function handleTypeChange(value) {
    setTypeFilter(value);
    setCategoryFilter([]);
  }

  const extraFilters = [
    {
      key: "type",
      sectionLabel: "Type",
      type: "pills",
      value: typeFilter,
      defaultValue: "all",
      options: TYPE_OPTIONS,
      onChange: handleTypeChange,
    },
    ...(categoryOptions
      ? [{
          key: "category",
          sectionLabel: "Category",
          type: "tags",
          value: categoryFilter,
          defaultValue: [],
          options: categoryOptions,
          onChange: setCategoryFilter,
        }]
      : []),
  ];

  const label = getFilterLabel(filter);

  const emptyMessage = search.trim()
    ? `No transactions match “${search.trim()}”.`
    : label
      ? `No transactions found for ${label}.`
      : "No transactions yet. Tap Add Expense or Add Income to get started.";

  return (
    <>
      <Insights />
      {statementImportEnabled && (
        <div className="exp-page-actions">
          <StatementImportButton />
        </div>
      )}
      <FilterBar
        scope="transactions"
        extraFilters={extraFilters}
        searchValue={search}
        onSearchChange={setSearch}
      />
      {showSkeleton ? (
        <div className="transaction-list">
          <Skeleton className="transaction-card" count={7} lines={2} />
        </div>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <LedgerSummary transactions={transactions} />
          </motion.div>
          <TransactionList
            transactions={transactions}
            emptyMessage={emptyMessage}
            highlightId={highlightId}
          />
        </>
      )}
    </>
  );
};

export default memo(Expense);
