import { memo, useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import { setFilter } from "../redux/slices/filterSlice";
import { getFilterLabel } from "../utils/filterUtils";
import ExportButton from "./ExportButton";
import BankLogo from "./BankLogo";

const PERIOD_OPTIONS = [
  { value: "all",        label: "All Time" },
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "this-year",  label: "This Year" },
  { value: "custom",     label: "Custom" },
];

// extraFilters shape:
// [{
//   key: string,
//   sectionLabel: string,
//   type: "pills" | "select" | "tags",
//   value: string | string[] (tags),
//   defaultValue: string | string[] (tags),
//   options: [{ value, label }] or grouped [{ group, options }],
//   onChange: (value | values) => void,
// }]

function flattenOptions(options) {
  return options.flatMap((o) => (o.group ? o.options : [o]));
}

const FilterBar = ({
  extraFilters = [],
  scope = "transactions",
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search transactions",
}) => {
  const dispatch = useDispatch();
  const [searchOpen, setSearchOpen] = useState(false);
  // Keep the field mounted briefly while it animates shut so closing mirrors
  // the open transition instead of snapping away.
  const [searchClosing, setSearchClosing] = useState(false);
  const closeSearch = () => {
    setSearchClosing(true);
    window.setTimeout(() => {
      setSearchOpen(false);
      setSearchClosing(false);
    }, 240);
  };
  const searchable = typeof onSearchChange === "function";
  const filter = useSelector((state) => state.filter[scope]);
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const cards = useSelector(
    (state) => state.transactions.transactionData?.cards ?? [],
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const bankFilterAvailable =
    scope === "transactions" && multiBankEnabled && accounts.length > 0;
  const selectedAccount =
    bankFilterAvailable && filter.accountId
      ? accounts.find((a) => a.id === filter.accountId)
      : null;
  // Credit-card filtering is independent of multi-bank — it's available
  // whenever the user has cards, since card spends exist either way.
  const cardFilterAvailable = scope === "transactions" && cards.length > 0;
  const selectedCard =
    cardFilterAvailable && filter.cardId
      ? cards.find((c) => c.id === filter.cardId)
      : null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const periodLabel = filter.mode !== "all" ? getFilterLabel(filter) : null;

  const extraChips = extraFilters.flatMap((f) => {
    if (f.type === "tags") {
      const flat = flattenOptions(f.options);
      const values = Array.isArray(f.value) ? f.value : [];
      return values.map((v) => ({
        key: `${f.key}-${v}`,
        label: flat.find((o) => o.value === v)?.label ?? v,
        onRemove: () => f.onChange(values.filter((x) => x !== v)),
      }));
    }
    if (f.value === f.defaultValue) return [];
    const flat = flattenOptions(f.options);
    return [
      {
        key: f.key,
        label: flat.find((o) => o.value === f.value)?.label ?? f.value,
        onRemove: () => f.onChange(f.defaultValue),
      },
    ];
  });

  const chips = [
    // Active search shows as a removable chip when the input is collapsed —
    // same affordance as every other filter, so clearing it is consistent.
    ...(searchable && searchValue && !searchOpen
      ? [{ key: "search", label: `“${searchValue}”`, onRemove: () => onSearchChange("") }]
      : []),
    ...(periodLabel
      ? [{ key: "period", label: periodLabel, onRemove: () => dispatch(setFilter({ scope, mode: "all", from: "", to: "" })) }]
      : []),
    ...(selectedAccount
      ? [
          {
            key: "bank",
            label: selectedAccount.bank,
            onRemove: () => dispatch(setFilter({ scope, accountId: "" })),
          },
        ]
      : []),
    ...(selectedCard
      ? [
          {
            key: "card",
            label: selectedCard.name,
            onRemove: () => dispatch(setFilter({ scope, cardId: "" })),
          },
        ]
      : []),
    ...extraChips,
  ];

  const activeCount = chips.length;

  const clearAll = () => {
    dispatch(
      setFilter({ scope, mode: "all", from: "", to: "", accountId: "", cardId: "" }),
    );
    if (searchable) onSearchChange("");
    extraFilters.forEach((f) => f.onChange(f.defaultValue));
  };

  return (
    <div className="fbar-wrap" ref={wrapRef}>
      <div className="fbar">
        {searchable && searchOpen ? (
          // Search takes over the whole bar: chips + Filters + Export are
          // hidden and the field animates out to full width.
          <div className={`fbar-search${searchClosing ? " fbar-search--closing" : ""}`}>
            <i className="fa-solid fa-magnifying-glass fbar-search-icon" />
            <input
              className="fbar-search-input"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoFocus
              value={searchValue}
              placeholder={searchPlaceholder}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              onBlur={() => {
                if (!searchValue) closeSearch();
              }}
            />
            <button
              type="button"
              className="fbar-search-clear"
              onClick={() => {
                onSearchChange("");
                closeSearch();
              }}
              aria-label="Clear search"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        ) : (
          <>
            {chips.map((chip) => (
              <button
                key={chip.key}
                className="fbar-chip"
                onClick={chip.onRemove}
              >
                {chip.label}
                <i className="fa-solid fa-xmark fbar-chip-x" />
              </button>
            ))}

            <div className="fbar-spacer" />

            {searchable && (
              <button
                className={`fbar-btn fbar-icon-btn${searchValue ? " fbar-btn--active" : ""}`}
                onClick={() => setSearchOpen(true)}
                aria-label="Search transactions"
              >
                <i className="fa-solid fa-magnifying-glass" />
              </button>
            )}

            <button
              className={`fbar-btn${open ? " fbar-btn--open" : ""}${activeCount ? " fbar-btn--active" : ""}`}
              onClick={() => setOpen((o) => !o)}
            >
              <i className="fa-solid fa-sliders" />
              Filters{activeCount > 0 && ` (${activeCount})`}
            </button>

            <ExportButton scope={scope} />
          </>
        )}
      </div>

      {open && (
        <div className="fbar-panel">
          <p className="fbar-section-label">Period</p>
          <div className="fbar-pill-row">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`fbar-pill${filter.mode === opt.value ? " fbar-pill--active" : ""}`}
                onClick={() => {
                  dispatch(setFilter({ scope, mode: opt.value, from: "", to: "" }));
                  if (opt.value !== "custom" && extraFilters.length === 0) setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {filter.mode === "custom" && (
            <div className="fbar-custom">
              <input
                type="date"
                className="fbar-custom-input"
                value={filter.from}
                onChange={(e) => dispatch(setFilter({ scope, ...filter, from: e.target.value }))}
              />
              <span className="fbar-custom-sep">→</span>
              <input
                type="date"
                className="fbar-custom-input"
                value={filter.to}
                onChange={(e) => dispatch(setFilter({ scope, ...filter, to: e.target.value }))}
              />
            </div>
          )}

          {bankFilterAvailable && (
            <>
              <p className="fbar-section-label">Bank</p>
              <div className="fbar-pill-row">
                <button
                  className={`fbar-pill${!filter.accountId ? " fbar-pill--active" : ""}`}
                  onClick={() =>
                    dispatch(setFilter({ scope, accountId: "" }))
                  }
                >
                  All
                </button>
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    className={`fbar-pill${filter.accountId === a.id ? " fbar-pill--active" : ""}`}
                    onClick={() =>
                      dispatch(setFilter({ scope, accountId: a.id, cardId: "" }))
                    }
                    style={
                      filter.accountId === a.id && a.color
                        ? { borderColor: a.color, color: a.color }
                        : undefined
                    }
                  >
                    <BankLogo bank={a.bank} color={a.color} size={16} />
                    {a.bank}
                  </button>
                ))}
              </div>
            </>
          )}

          {cardFilterAvailable && (
            <>
              <p className="fbar-section-label">Credit cards</p>
              <div className="fbar-pill-row">
                <button
                  className={`fbar-pill${!filter.cardId ? " fbar-pill--active" : ""}`}
                  onClick={() => dispatch(setFilter({ scope, cardId: "" }))}
                >
                  All
                </button>
                {cards.map((c) => (
                  <button
                    key={c.id}
                    className={`fbar-pill${filter.cardId === c.id ? " fbar-pill--active" : ""}`}
                    onClick={() =>
                      dispatch(setFilter({ scope, cardId: c.id, accountId: "" }))
                    }
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {extraFilters.map((f) => (
            <div key={f.key}>
              <p className="fbar-section-label">{f.sectionLabel}</p>
              {f.type === "pills" && (
                <div className="fbar-pill-row">
                  {f.options.map((opt) => (
                    <button
                      key={opt.value}
                      className={`fbar-pill${f.value === opt.value ? " fbar-pill--active" : ""}`}
                      onClick={() => f.onChange(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {f.type === "select" && (
                <select
                  className="fbar-select"
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                >
                  {f.options.map((opt) =>
                    opt.group ? (
                      <optgroup key={opt.group} label={opt.group}>
                        {opt.options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                    ) : (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    )
                  )}
                </select>
              )}
              {f.type === "tags" && (() => {
                const values = Array.isArray(f.value) ? f.value : [];
                const toggle = (v) =>
                  f.onChange(
                    values.includes(v)
                      ? values.filter((x) => x !== v)
                      : [...values, v],
                  );
                const renderTag = (opt) => {
                  const selected = values.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`fbar-tag${selected ? " fbar-tag--selected" : ""}`}
                      onClick={() => toggle(opt.value)}
                    >
                      {opt.label}
                    </button>
                  );
                };
                const renderAll = (opts, key) => {
                  const vals = opts.map((o) => o.value);
                  const allSelected =
                    vals.length > 0 && vals.every((v) => values.includes(v));
                  return (
                    <button
                      key={`all-${key}`}
                      type="button"
                      className={`fbar-tag fbar-tag--all${allSelected ? " fbar-tag--selected" : ""}`}
                      onClick={() =>
                        f.onChange(
                          allSelected
                            ? values.filter((v) => !vals.includes(v))
                            : [...new Set([...values, ...vals])],
                        )
                      }
                    >
                      All
                    </button>
                  );
                };
                const hasGroups = f.options.some((o) => o.group);
                return hasGroups ? (
                  f.options.map((g) =>
                    g.group ? (
                      <div key={g.group} className="fbar-tag-group">
                        <p className="fbar-tag-group-label">{g.group}</p>
                        <div className="fbar-tag-row">
                          {renderAll(g.options, g.group)}
                          {g.options.map(renderTag)}
                        </div>
                      </div>
                    ) : (
                      <div key={g.value} className="fbar-tag-row">
                        {renderTag(g)}
                      </div>
                    ),
                  )
                ) : (
                  <div className="fbar-tag-row">
                    {renderAll(f.options, f.key)}
                    {f.options.map(renderTag)}
                  </div>
                );
              })()}
            </div>
          ))}

          {activeCount > 0 && (
            <button
              type="button"
              className="fbar-clear-all"
              onClick={clearAll}
            >
              <i className="fa-solid fa-xmark" /> Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};

FilterBar.propTypes = {
  extraFilters: PropTypes.array,
  scope: PropTypes.oneOf(["transactions", "investments"]),
  searchValue: PropTypes.string,
  onSearchChange: PropTypes.func,
  searchPlaceholder: PropTypes.string,
};

export default memo(FilterBar);
