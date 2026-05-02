import { memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setFilter } from "../redux/slices/filterSlice";
import { getFilterLabel } from "../utils/filterUtils";
import ExportButton from "./ExportButton";

const MODES = [
  { key: "all", label: "All Time" },
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "this-year", label: "This Year" },
  { key: "custom", label: "Custom" },
];

const DateFilter = () => {
  const dispatch = useDispatch();
  const filter = useSelector((state) => state.filter);
  const label = getFilterLabel(filter);

  function handleMode(mode) {
    dispatch(setFilter({ mode, from: "", to: "" }));
  }

  return (
    <div className="date-filter">
      <div className="filter-top-row">
        <div className="filter-pills">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={`filter-pill${filter.mode === m.key ? " filter-pill--active" : ""}`}
            onClick={() => handleMode(m.key)}
          >
            {m.label}
          </button>
        ))}
        </div>
        <ExportButton />
      </div>

      {filter.mode === "custom" && (
        <div className="filter-custom">
          <input
            type="date"
            className="filter-custom-input"
            value={filter.from}
            onChange={(e) => dispatch(setFilter({ ...filter, from: e.target.value }))}
          />
          <span className="filter-custom-sep">→</span>
          <input
            type="date"
            className="filter-custom-input"
            value={filter.to}
            onChange={(e) => dispatch(setFilter({ ...filter, to: e.target.value }))}
          />
        </div>
      )}

      {label && filter.mode !== "custom" && (
        <p className="filter-active-label">Showing: {label}</p>
      )}
    </div>
  );
};

export default memo(DateFilter);
