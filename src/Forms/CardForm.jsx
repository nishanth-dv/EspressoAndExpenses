import { memo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import DayPicker from "./DayPicker";
import { BANKS as DEFAULT_BANKS } from "../utils/constants";

function randomColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 25);
  const l = 42 + Math.floor(Math.random() * 18);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

const makeEmpty = () => ({
  name: "",
  bank: "",
  limit: "",
  statementDay: "",
  dueDay: "",
  color: randomColor(),
  notes: "",
});

function fromExisting(e) {
  return {
    name: e.name ?? "",
    bank: e.bank ?? "",
    limit: e.limit ?? "",
    statementDay: e.statementDay ? String(e.statementDay) : "",
    dueDay: e.dueDay ? String(e.dueDay) : "",
    color: e.color ?? randomColor(),
    notes: e.notes ?? "",
  };
}

const CardForm = ({ onSubmit, onCancel, existing, cards = [] }) => {
  const [form, setForm] = useState(() => existing ? fromExisting(existing) : makeEmpty());
  const [combine, setCombine] = useState(() => !!existing?.creditGroupId);
  const BANKS = useSelector(
    (state) =>
      state.transactions.transactionData?.lists?.banks ?? DEFAULT_BANKS,
  );

  const siblings = form.bank
    ? cards.filter((c) => c.bank === form.bank && c.id !== existing?.id)
    : [];

  // Sum of remaining (limit - outstanding) across same-bank siblings.
  // Uses the enriched `outstanding` already computed per card by SolvencyPage.
  const computedSiblingAvailable = siblings.reduce((sum, s) => {
    const lim = parseFloat(s.limit) || 0;
    const out = parseFloat(s.outstanding ?? s.ownOutstanding ?? 0) || 0;
    return sum + Math.max(0, lim - out);
  }, 0);

  // Auto-populate the new card's limit with the siblings' computed available
  // when the user enables Combine balance. Only for new cards — editing keeps
  // the saved limit untouched.
  useEffect(() => {
    if (existing) return;
    if (!combine) return;
    if (computedSiblingAvailable <= 0) return;
    // Pre-fill limit field when user toggles Combine on — intentional one-way
    // sync from a UI control to a form value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => ({ ...f, limit: String(computedSiblingAvailable) }));
    // We intentionally only re-run on `combine` toggle, not on every change of
    // the prefilled values — that's what makes this a "pre-fill on enable".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combine]);

  function handleChange(e) {
    if (e.target.name === "bank") {
      // Reset combine toggle when bank changes — sibling list will change
      setCombine(false);
    }
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.dueDay) return;
    const card = existing
      ? {
          ...existing,
          ...form,
          limit: parseFloat(form.limit),
          statementDay: form.statementDay ? parseInt(form.statementDay) : null,
          dueDay: parseInt(form.dueDay),
        }
      : {
          ...form,
          id: crypto.randomUUID(),
          limit: parseFloat(form.limit),
          statementDay: form.statementDay ? parseInt(form.statementDay) : null,
          dueDay: parseInt(form.dueDay),
          createdAt: new Date().toISOString(),
        };
    const combineBank = combine && siblings.length > 0 ? form.bank : null;
    onSubmit(card, { combineBank });
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      <div className="field">
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          required
          autoCorrect="off"
          spellCheck={false}
          placeholder=" "
        />
        <label>Card name</label>
      </div>

      <div className="field">
        <select name="bank" value={form.bank} onChange={handleChange} required>
          <option value="" disabled hidden />
          {BANKS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <label>Bank</label>
      </div>

      {siblings.length > 0 && (
        <label className="card-combine-toggle">
          <input
            type="checkbox"
            checked={combine}
            onChange={(e) => setCombine(e.target.checked)}
          />
          <span className="card-combine-toggle-text">
            Combine balance with {form.bank}
            {siblings.length === 1
              ? ` (${siblings[0].name})`
              : ` (${siblings.length} cards)`}
            <span className="card-combine-toggle-sub">
              {combine
                ? `Will share the pool — limit prefilled with available ₹${computedSiblingAvailable.toLocaleString("en-IN")}`
                : "Limits and transactions stay independent"}
            </span>
          </span>
        </label>
      )}

      <div className="field">
        <input
          name="limit"
          type="number"
          inputMode="decimal"
          value={form.limit}
          onChange={handleChange}
          required
          placeholder=" "
        />
        <label>Credit limit (₹)</label>
      </div>

      <DayPicker
        label="Statement date"
        value={form.statementDay}
        onChange={(v) => setForm((f) => ({ ...f, statementDay: v }))}
      />

      <DayPicker
        label="Payment due date"
        value={form.dueDay}
        onChange={(v) => setForm((f) => ({ ...f, dueDay: v }))}
        required
      />

      <div className="sol-color-field">
        <span className="sol-color-label">Card colour</span>
        <div className="sol-color-random">
          <div className="sol-color-preview" style={{ background: form.color }} />
          <button
            type="button"
            className="sol-color-regenerate"
            onClick={() => setForm((f) => ({ ...f, color: randomColor() }))}
          >
            <i className="fa-solid fa-shuffle" />
            New colour
          </button>
        </div>
      </div>

      <div className="field">
        <textarea
          name="notes"
          value={form.notes}
          onChange={handleChange}
          rows="2"
          autoCorrect="off"
          spellCheck={false}
          placeholder=" "
        />
        <label>Notes (optional)</label>
      </div>

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="generic-button">
          {existing ? "Update Card" : "Add Card"}
        </button>
      </div>
    </form>
  );
};

CardForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
  cards: PropTypes.array,
};

export default memo(CardForm);
