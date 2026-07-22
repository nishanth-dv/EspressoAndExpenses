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


const TYPE_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "expense",    label: "Expense" },
  { value: "income",     label: "Income" },
  { value: "investment", label: "Investment" },
];

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
        <TransactionList
          transactions={transactions}
          emptyMessage={emptyMessage}
          highlightId={highlightId}
        />
      )}
    </>
  );
};

export default memo(Expense);
