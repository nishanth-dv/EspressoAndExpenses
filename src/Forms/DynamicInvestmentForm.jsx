// ── DynamicInvestmentForm ─────────────────────────────
//
// Schema-driven Add/Edit Investment form. Renders the rows × fields layout
// declared in a type's schema (see src/utils/investmentTypeSchemas.js).
//
// Field-type → renderer dispatch happens in <FieldRenderer>. The form's
// internal state is a flat { [fieldKey]: value } map; on submit we shallow-
// merge that map onto either a fresh investment record (with id + createdAt)
// or the `existing` record being edited.
//
// Phase 2 scope:
//   • Renders the basic palette: text / textarea / number / currency /
//     percentage / date / month / day-of-month / dropdown / multi-select /
//     checkbox / ticker (basic) / deduct-from-balance / auto-deduct.
//   • Built-in special behaviour (ticker price fetch, premium-month picker
//     micro-UI, generic scheduler) ships in later phases — for now ticker
//     is just a plain text input, auto-deduct just captures config, and
//     the scheduler runs on the existing per-type thunks.

import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import DayPicker from "./DayPicker";
import BankChipSelector from "../components/BankChipSelector";
import OptionField from "../components/OptionField";
import DateField from "../components/DateField";
import {
  fetchCurrentPrice,
  searchStockTickers,
  searchMFSchemes,
  tickerPlaceholder,
} from "../utils/priceService";

// ── Helpers ───────────────────────────────────────────

function buildFormFromSchema(schema, existing) {
  const out = {};
  for (const row of schema?.rows ?? []) {
    for (const f of row?.fields ?? []) {
      const ex = existing?.[f.key];
      if (ex !== undefined && ex !== null) out[f.key] = ex;
      else if (f.defaultValue !== undefined) out[f.key] = f.defaultValue;
      else if (f.type === "checkbox") out[f.key] = false;
      else if (f.type === "multi-select") out[f.key] = [];
      else if (f.type === "month-grid") out[f.key] = [];
      else if (f.type === "deduct-from-balance") out[f.key] = false;
      else if (f.type === "auto-deduct") {
        out[f.key] =
          ex && typeof ex === "object"
            ? ex
            : {
                enabled: !!f.locked,
                frequency: f.config?.frequency ?? "monthly",
                dayOfMonth: f.config?.dayOfMonth ?? 1,
                variableAmount: !!f.config?.variableAmount,
                accountId: "",
              };
      } else out[f.key] = "";
    }
  }
  return out;
}

// ── Field renderer ────────────────────────────────────

function FieldRenderer({ field, value, onChange, accounts, multiBankEnabled, formState, setFormField }) {
  const setVal = (v) => onChange(v);

  switch (field.type) {
    case "text":
      return (
        <div className="field">
          <input
            type="text"
            value={value ?? ""}
            onChange={(e) => setVal(e.target.value)}
            placeholder=" "
            required={field.required}
            autoCorrect="off"
            spellCheck={false}
          />
          <label>{field.label}</label>
        </div>
      );

    case "ticker":
      return (
        <TickerSearchField
          field={field}
          value={value}
          onChange={setVal}
          formState={formState}
          setFormField={setFormField}
        />
      );

    case "month-grid":
      return (
        <MonthGridPicker
          label={field.label}
          value={Array.isArray(value) ? value : []}
          onChange={setVal}
          maxSelections={field.config?.maxSelections ?? 12}
          required={field.required}
        />
      );

    case "textarea":
      return (
        <div className="field">
          <textarea
            value={value ?? ""}
            onChange={(e) => setVal(e.target.value)}
            rows="2"
            placeholder=" "
            required={field.required}
            autoCorrect="off"
            spellCheck={false}
          />
          <label>{field.label}</label>
        </div>
      );

    case "number":
    case "currency":
    case "percentage":
      return (
        <div className="field">
          <input
            type="number"
            inputMode="decimal"
            step={field.type === "percentage" ? "0.01" : "any"}
            value={value ?? ""}
            onChange={(e) => setVal(e.target.value)}
            placeholder=" "
            required={field.required}
          />
          <label>
            {field.label}
            {field.type === "currency" ? " (₹)" : ""}
            {field.type === "percentage" ? " (%)" : ""}
          </label>
        </div>
      );

    case "date":
      return (
        <DateField
          value={value ?? ""}
          onChange={(e) => setVal(e.target.value)}
          label={field.label}
          required={field.required}
        />
      );

    case "month":
      return (
        <div className="field">
          <input
            type="month"
            value={value ?? ""}
            onChange={(e) => setVal(e.target.value)}
            placeholder=" "
            required={field.required}
          />
          <label>{field.label}</label>
        </div>
      );

    case "day-of-month":
      return (
        <DayPicker
          label={field.label}
          value={value ? String(value) : ""}
          onChange={setVal}
          required={field.required}
        />
      );

    case "dropdown":
      return (
        <OptionField
          value={value ?? ""}
          onChange={(e) => {
            // Preserve numeric option values (e.g., LIC frequency: 1/2/4/12)
            // by parsing them back when all options are numeric strings.
            const raw = e.target.value;
            const numeric = Number(raw);
            setVal(
              field.options?.every((o) => typeof o.value === "number") &&
                !Number.isNaN(numeric)
                ? numeric
                : raw,
            );
          }}
          label={field.label}
          required={field.required}
          placeholder=""
          options={field.options ?? []}
        />
      );

    case "multi-select":
      return (
        <MultiSelectChips
          label={field.label}
          options={field.options ?? []}
          value={Array.isArray(value) ? value : []}
          onChange={setVal}
        />
      );

    case "checkbox":
      return (
        <label className="dyn-form-checkbox">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => setVal(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );

    case "deduct-from-balance":
      return (
        <DeductFromBalanceField
          field={field}
          value={value}
          onChange={setVal}
          accounts={accounts}
          multiBankEnabled={multiBankEnabled}
        />
      );

    case "auto-deduct":
      return (
        <AutoDeductField
          field={field}
          value={value}
          onChange={setVal}
          accounts={accounts}
          multiBankEnabled={multiBankEnabled}
        />
      );

    default:
      // Unknown field type — render as plain text so the form still works.
      return (
        <div className="field">
          <input
            type="text"
            value={value ?? ""}
            onChange={(e) => setVal(e.target.value)}
            placeholder=" "
          />
          <label>
            {field.label} <em>(unknown field type: {field.type})</em>
          </label>
        </div>
      );
  }
}

FieldRenderer.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  accounts: PropTypes.array,
  multiBankEnabled: PropTypes.bool,
  formState: PropTypes.object,
  setFormField: PropTypes.func,
};

// ── Multi-select chips (used for LIC premium months, tags, etc.) ──

function MultiSelectChips({ label, options, value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (v) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <div className="dyn-multi-field">
      <span className="dyn-multi-label">
        {label}
        {selected.length > 0 && (
          <span className="dyn-multi-count"> ({selected.length})</span>
        )}
      </span>
      <div className="dyn-multi-chips">
        {options.map((opt) => {
          const isSel = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={`dyn-multi-chip${isSel ? " dyn-multi-chip--on" : ""}`}
              onClick={() => toggle(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

MultiSelectChips.propTypes = {
  label: PropTypes.string.isRequired,
  options: PropTypes.array.isRequired,
  value: PropTypes.array,
  onChange: PropTypes.func.isRequired,
};

// ── Month grid (12-month picker — generalised from the LIC field) ──
//
// Renders a 4×3 grid of month chips. Designed for "premium months" style
// fields where the user picks N months out of the year. `maxSelections`
// caps how many can be chosen at once; pre-existing extra picks (if data
// came in over the limit) stay selected until the user untoggles them.

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function MonthGridPicker({ label, value, onChange, maxSelections, required }) {
  const selected = Array.isArray(value) ? value : [];
  const limit = Number(maxSelections) || 12;

  function toggle(m) {
    if (selected.includes(m)) {
      onChange(selected.filter((x) => x !== m));
    } else if (selected.length < limit) {
      onChange([...selected, m].sort((a, b) => a - b));
    }
  }

  return (
    <div className="lic-months-wrap dyn-month-grid">
      <div className="lic-months-header">
        <span>
          {label}
          {required && <span className="itd-field-req"> *</span>}
        </span>
        <span className="lic-months-counter">
          {selected.length}/{limit}
        </span>
      </div>
      <div className="lic-month-grid">
        {MONTH_NAMES.map((name, i) => {
          const m = i + 1;
          const isSel = selected.includes(m);
          const atLimit = !isSel && selected.length >= limit;
          return (
            <button
              key={m}
              type="button"
              className={`lic-month-btn${isSel ? " lic-month-btn--active" : ""}`}
              onClick={() => toggle(m)}
              disabled={atLimit}
              aria-pressed={isSel}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

MonthGridPicker.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.array,
  onChange: PropTypes.func.isRequired,
  maxSelections: PropTypes.number,
  required: PropTypes.bool,
};

// ── Ticker search field (Yahoo / MFAPI / CoinGecko) ───────────
//
// Replaces the plain text input for ticker fields on user-added types.
// The field's `config.kind` selects the API:
//   • "stock" → searchStockTickers (Yahoo via CORS proxy)
//   • "mf"    → searchMFSchemes (MFAPI.in)
//   • "crypto"→ no search; CoinGecko ID is entered as plain text
//
// On selection, the field writes the ticker symbol/code into its own
// form key. If sibling keys `name` or `currentPrice` exist on the form
// (common convention across built-ins and Discover), it fills those too
// to save the user a step. The "Fetch price" action calls fetchCurrentPrice
// and lands the result in `currentPrice` (when present on the schema).

function TickerSearchField({ field, value, onChange, formState, setFormField }) {
  const kind = field.config?.kind ?? "stock";
  const placeholder = tickerPlaceholder(kind === "mf" ? "mf" : kind === "crypto" ? "crypto" : "stock");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState(null);
  const debounceRef = useRef(null);

  const hasName = formState && Object.prototype.hasOwnProperty.call(formState, "name");
  const hasCurrentPrice =
    formState && Object.prototype.hasOwnProperty.call(formState, "currentPrice");

  // Reset transient state if the form gets reset externally (existing→null).
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const runSearch = useCallback(
    (q) => {
      setResults([]);
      setSearchErr(null);
      if (kind === "crypto") return; // no search API for crypto
      if (q.trim().length < 2) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const r =
            kind === "mf"
              ? await searchMFSchemes(q)
              : await searchStockTickers(q);
          setResults(r);
        } catch (e) {
          setSearchErr(e.message);
        } finally {
          setSearching(false);
        }
      }, 350);
    },
    [kind],
  );

  function handleQueryChange(e) {
    const q = e.target.value;
    setQuery(q);
    runSearch(q);
  }

  function pickResult(item) {
    // Normalise both shapes — MFAPI returns { schemeCode, schemeName } while
    // stock search returns { symbol, name, exchange }.
    const symbol = item.symbol ?? String(item.schemeCode);
    const name = item.name ?? item.schemeName;
    onChange(symbol);
    if (hasName && name && setFormField) setFormField("name", name);
    setResults([]);
    setQuery("");
    setSearchErr(null);
  }

  async function handleFetchPrice() {
    if (!value?.trim()) return;
    setFetching(true);
    setFetchMsg(null);
    try {
      const apiType = kind === "mf" ? "mf" : kind === "crypto" ? "crypto" : "stock";
      const price = await fetchCurrentPrice(apiType, value);
      if (hasCurrentPrice && setFormField) setFormField("currentPrice", String(price));
      setFetchMsg({ ok: true, text: `Fetched: ${price}` });
    } catch (e) {
      setFetchMsg({ ok: false, text: e.message });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="dyn-ticker-field">
      <div className="dyn-ticker-row">
        <div className="field dyn-ticker-input">
          <input
            type="text"
            value={value ?? ""}
            onChange={(e) => {
              onChange(e.target.value);
              // Typing directly into the ticker input also drives the
              // suggestion search, so users don't need a separate search box.
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            onFocus={(e) => {
              if (e.target.value && kind !== "crypto") runSearch(e.target.value);
            }}
            placeholder=" "
            required={field.required}
            autoCorrect="off"
            spellCheck={false}
          />
          <label>
            {field.label} <span className="dyn-ticker-hint">({placeholder})</span>
          </label>
        </div>
        <button
          type="button"
          className="dyn-ticker-fetch"
          onClick={handleFetchPrice}
          disabled={!value || fetching}
          title="Fetch latest price"
        >
          {fetching ? (
            <i className="fa-solid fa-spinner fa-spin" />
          ) : (
            <i className="fa-solid fa-arrows-rotate" />
          )}
        </button>
      </div>

      {searching && <p className="dyn-ticker-msg">Searching…</p>}
      {searchErr && <p className="dyn-ticker-msg dyn-ticker-msg--err">{searchErr}</p>}
      {results.length > 0 && (
        <ul className="dyn-ticker-results">
          {results.map((r) => {
            const symbol = r.symbol ?? String(r.schemeCode);
            const name = r.name ?? r.schemeName;
            const sub = r.exchange ?? "MF";
            return (
              <li key={symbol}>
                <button
                  type="button"
                  className="dyn-ticker-result"
                  onClick={() => pickResult(r)}
                >
                  <span className="dyn-ticker-symbol">{symbol}</span>
                  <span className="dyn-ticker-name">{name}</span>
                  <span className="dyn-ticker-exch">{sub}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {fetchMsg && (
        <p className={`dyn-ticker-msg${fetchMsg.ok ? "" : " dyn-ticker-msg--err"}`}>
          {fetchMsg.text}
        </p>
      )}
    </div>
  );
}

TickerSearchField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  formState: PropTypes.object,
  setFormField: PropTypes.func,
};

// ── Deduct-from-balance (checkbox + multi-bank pill picker) ───

function DeductFromBalanceField({ field, value, onChange, accounts, multiBankEnabled }) {
  // `value` for this field is a boolean (legacy `affectsBalance`). When
  // multi-bank is on we also need an account id — we use a sibling key
  // `accountId` carried on the same form. Phase 6 dedicated bank picker
  // here, kept inline for atomic UX.
  const enabled = !!value;
  return (
    <div className="dyn-deduct-field">
      <label className="dyn-form-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{field.label}</span>
      </label>
      {/* When multi-bank is on AND the toggle is checked, render the bank
          picker so the user can declare which account funds this. The
          form's `accountId` slot is populated by the BankChipSelector via
          a hoisted onChange that the DynamicInvestmentForm wires up.
          For minimal coupling, the bank picker writes to a global form
          property — DynamicInvestmentForm threads it through. */}
      {enabled && multiBankEnabled && accounts?.length > 0 && (
        <p className="dyn-form-hint">
          <i className="fa-solid fa-circle-info" /> Pick the bank below to tag
          where this investment is funded from.
        </p>
      )}
    </div>
  );
}

DeductFromBalanceField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  accounts: PropTypes.array,
  multiBankEnabled: PropTypes.bool,
};

// ── Auto-deduct schedule (frequency + day + bank picker) ──────

const FREQUENCY_OPTIONS = [
  { value: "monthly",   label: "Monthly"  },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly",    label: "Yearly"   },
];

function AutoDeductField({ field, value, onChange, accounts, multiBankEnabled }) {
  const v = value ?? {};
  const update = (patch) => onChange({ ...v, ...patch });
  const locked = !!field.locked; // anchor → always-on; extras → user toggles
  const enabled = locked ? true : !!v.enabled;
  return (
    <div className="dyn-auto-deduct">
      <div className="dyn-auto-deduct-head">
        {locked ? (
          <span className="dyn-auto-deduct-locked">
            <i className="fa-solid fa-rotate" /> {field.label}
          </span>
        ) : (
          <label className="dyn-form-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span>{field.label}</span>
          </label>
        )}
      </div>
      {enabled && (
        <div className="dyn-auto-deduct-body">
          <div className="dyn-form-row dyn-form-row--cols-2">
            <OptionField
              value={v.frequency ?? "monthly"}
              onChange={(e) => update({ frequency: e.target.value })}
              label="Frequency"
              options={FREQUENCY_OPTIONS}
            />
            <DayPicker
              label="Auto-debit day"
              value={v.dayOfMonth ? String(v.dayOfMonth) : ""}
              onChange={(d) => update({ dayOfMonth: parseInt(d) || 1 })}
            />
          </div>
          <p className="dyn-form-hint dyn-form-hint--soft">
            <i className="fa-solid fa-circle-info" /> Treat this as an
            approximate day — real NACH debits drift by a few days for
            weekends, holidays, and bank cut-offs. We won't write a
            ledger entry on this date; instead, the activity view will
            show a pending row each {v.frequency === "yearly"
              ? "year"
              : v.frequency === "quarterly"
                ? "quarter"
                : "month"} that you tap to confirm with the actual date
            (or just import your statement and we'll reconcile in bulk).
          </p>
          <label className="dyn-form-checkbox">
            <input
              type="checkbox"
              checked={!!v.variableAmount}
              onChange={(e) => update({ variableAmount: e.target.checked })}
            />
            <span>Amount varies each period</span>
          </label>
          {v.variableAmount && (
            <p className="dyn-form-hint dyn-form-hint--soft">
              <i className="fa-solid fa-circle-info" /> Each pending row lets you
              edit the amount before logging — handy for chit auctions or any
              instalment that changes month to month.
            </p>
          )}
          {multiBankEnabled && accounts?.length > 0 && (
            <BankChipSelector
              accounts={accounts}
              value={v.accountId ?? ""}
              onChange={(id) => update({ accountId: id })}
              label="From bank (required)"
              allowUntagged={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

AutoDeductField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  accounts: PropTypes.array,
  multiBankEnabled: PropTypes.bool,
};

// ── Main form ─────────────────────────────────────────

const DynamicInvestmentForm = ({
  schema,
  existing,
  onSubmit,
  onCancel,
  prefillAmount,
}) => {
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );

  const initialForm = useMemo(() => {
    const base = buildFormFromSchema(schema, existing);
    // Honour a prefilled amount when adding from the Expense → Investment
    // bridge. The first currency-typed anchor is the natural target (e.g.,
    // investedAmount for fixed/manual profiles).
    if (!existing && prefillAmount) {
      const target =
        schema?.rows
          ?.flatMap((r) => r.fields ?? [])
          .find((f) => f.type === "currency");
      if (target && base[target.key] === "") base[target.key] = prefillAmount;
    }
    // accountId is a side-channel slot used when multi-bank is on. Carry
    // forward an existing value, or start blank.
    base.accountId = existing?.accountId ?? "";
    return base;
  }, [schema, existing, prefillAmount]);

  const [form, setForm] = useState(initialForm);

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSubmit(e) {
    e.preventDefault();
    const investment = existing
      ? { ...existing, ...form, type: schema.key }
      : {
          ...form,
          id: crypto.randomUUID(),
          type: schema.key,
          createdAt: new Date().toISOString(),
        };
    // Drop empty optional keys so the saved record stays clean. Only strip
    // empty STRINGS — numbers (0), booleans (false), arrays ([]) are kept.
    for (const k of Object.keys(investment)) {
      if (investment[k] === "" || investment[k] === undefined) delete investment[k];
    }
    onSubmit(investment);
  }

  return (
    <form className="expense-form dyn-investment-form" onSubmit={handleSubmit}>
      {(schema?.rows ?? []).map((row, ri) => {
        const cols = Math.min(3, Math.max(1, row.fields?.length || 1));
        return (
          <div
            key={row.id ?? `r-${ri}`}
            className={`dyn-form-row dyn-form-row--cols-${cols}`}
          >
            {(row.fields ?? []).map((f) => (
              <FieldRenderer
                key={f.id}
                field={f}
                value={form[f.key]}
                onChange={(v) => setField(f.key, v)}
                accounts={accounts}
                multiBankEnabled={multiBankEnabled}
                formState={form}
                setFormField={setField}
              />
            ))}
          </div>
        );
      })}

      {/* Inline bank picker for "Deduct from balance" — placed once at the
          schema's natural deduct position would be ideal, but for now we
          surface it at the bottom whenever the schema has a deduct field
          AND the user has toggled it AND multi-bank is on. */}
      {multiBankEnabled && accounts.length > 0 &&
        schema?.rows?.some((r) =>
          r.fields?.some(
            (f) => f.type === "deduct-from-balance" && !!form[f.key],
          ),
        ) && (
          <BankChipSelector
            accounts={accounts}
            value={form.accountId ?? ""}
            onChange={(id) => setField("accountId", id)}
            label="Funded from"
          />
        )}

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="generic-button">
          {existing ? "Update" : "Save"} {schema?.label ?? "Investment"}
        </button>
      </div>
    </form>
  );
};

DynamicInvestmentForm.propTypes = {
  schema: PropTypes.object.isRequired,
  existing: PropTypes.object,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  prefillAmount: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default memo(DynamicInvestmentForm);
