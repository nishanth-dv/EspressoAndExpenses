import { memo, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import Insights from "../components/Insights";
import TransactionList from "../components/TransactionList";
import FilterBar from "../components/FilterBar";
import StatementImportButton from "../components/StatementImportButton";
import { applyFilter, getFilterLabel } from "../utils/filterUtils";
import { CATEGORIES, INCOME_CATEGORIES } from "../utils/constants";


const TYPE_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "expense",    label: "Expense" },
  { value: "income",     label: "Income" },
  { value: "investment", label: "Investment" },
];

const Expense = () => {
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const filter = useSelector((state) => state.filter.transactions);
  const statementImportEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.statementImportEnabled ??
      false,
  );

  const [typeFilter, setTypeFilter]         = useState("all");
  const [categoryFilter, setCategoryFilter] = useState([]);

  const dateFiltered = useMemo(
    () => applyFilter(allTransactions, filter),
    [allTransactions, filter],
  );

  const transactions = useMemo(() => {
    let result = dateFiltered;
    if (typeFilter !== "all")
      result = result.filter((t) => t.transactionType === typeFilter);
    if (categoryFilter.length > 0)
      result = result.filter((t) => categoryFilter.includes(t.category));
    return result;
  }, [dateFiltered, typeFilter, categoryFilter]);

  const categoryOptions = useMemo(() => {
    if (typeFilter === "expense")
      return CATEGORIES.map((c) => ({ value: c, label: c }));
    if (typeFilter === "income")
      return INCOME_CATEGORIES.map((c) => ({ value: c, label: c }));
    if (typeFilter === "investment") return null;
    return [
      { group: "Expense", options: CATEGORIES.map((c) => ({ value: c, label: c })) },
      { group: "Income", options: INCOME_CATEGORIES.map((c) => ({ value: c, label: c })) },
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

  return (
    <>
      <Insights />
      {statementImportEnabled && (
        <div className="exp-page-actions">
          <StatementImportButton />
        </div>
      )}
      <FilterBar scope="transactions" extraFilters={extraFilters} />
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
