import { memo, useState } from "react";
import PropTypes from "prop-types";

const EMPTY = {
  name: "",
  direction: "lent",
  amount: "",
  outstanding: "",
  date: "",
  expectedReturn: "",
  notes: "",
};

function fromExisting(e) {
  return {
    name: e.name ?? "",
    direction: e.direction ?? "lent",
    amount: e.amount ?? "",
    outstanding: e.outstanding ?? "",
    date: e.date ?? "",
    expectedReturn: e.expectedReturn ?? "",
    notes: e.notes ?? "",
  };
}

const LendingForm = ({ onSubmit, onCancel, existing }) => {
  const [form, setForm] = useState(existing ? fromExisting(existing) : EMPTY);

  function handleChange(e) {
    const val = e.target.value;
    const name = e.target.name;
    setForm((f) => {
      const next = { ...f, [name]: val };
      // When amount changes and outstanding is still the same as amount, keep them in sync
      if (name === "amount" && f.outstanding === f.amount) {
        next.outstanding = val;
      }
      return next;
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    const l = existing
      ? {
          ...existing,
          ...form,
          amount: parseFloat(form.amount),
          outstanding: parseFloat(form.outstanding),
        }
      : {
          ...form,
          id: crypto.randomUUID(),
          amount: parseFloat(form.amount),
          outstanding: parseFloat(form.outstanding),
          createdAt: new Date().toISOString(),
        };
    onSubmit(l);
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      <div className="sol-direction-toggle">
        {["lent", "borrowed"].map((d) => (
          <button
            key={d}
            type="button"
            className={`sol-dir-btn${form.direction === d ? " sol-dir-btn--active" : ""}`}
            onClick={() => setForm((f) => ({ ...f, direction: d }))}
          >
            <i
              className={`fa-solid ${d === "lent" ? "fa-arrow-up-right-from-square" : "fa-arrow-down-left"}`}
            />
            {d === "lent" ? "I lent" : "I borrowed"}
          </button>
        ))}
      </div>

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
        <label>{form.direction === "lent" ? "Lent to (name)" : "Borrowed from (name)"}</label>
      </div>

      <div className="sol-form-row">
        <div className="field">
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            value={form.amount}
            onChange={handleChange}
            required
            placeholder=" "
          />
          <label>Total amount (₹)</label>
        </div>
        <div className="field">
          <input
            name="outstanding"
            type="number"
            inputMode="decimal"
            value={form.outstanding}
            onChange={handleChange}
            required
            placeholder=" "
          />
          <label>Outstanding (₹)</label>
        </div>
      </div>

      <div className="sol-form-row">
        <div className="field">
          <input
            name="date"
            type="date"
            value={form.date}
            onChange={handleChange}
            required
            placeholder=" "
          />
          <label>Date</label>
        </div>
        <div className="field">
          <input
            name="expectedReturn"
            type="date"
            value={form.expectedReturn}
            onChange={handleChange}
            placeholder=" "
          />
          <label>Expected return</label>
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
          {existing ? "Update" : form.direction === "lent" ? "Add Lending" : "Add Borrowing"}
        </button>
      </div>
    </form>
  );
};

LendingForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
};

export default memo(LendingForm);
