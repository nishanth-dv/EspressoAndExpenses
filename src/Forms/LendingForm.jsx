import { memo, useState } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import BankChipSelector from "../components/BankChipSelector";
import DateField from "../components/DateField";

const EMPTY = {
  name: "",
  direction: "lent",
  amount: "",
  outstanding: "",
  date: "",
  notes: "",
  accountId: "",
  affectBalance: true,
};

function fromExisting(e) {
  return {
    name: e.name ?? "",
    direction: e.direction ?? "lent",
    amount: e.amount ?? "",
    outstanding: e.outstanding ?? "",
    date: e.date ?? "",
    notes: e.notes ?? "",
    accountId: e.accountId ?? "",
    // Legacy entries (created before this feature) default to off so editing
    // them doesn't silently create a balance transaction.
    affectBalance: e.affectBalance ?? false,
  };
}

const LendingForm = ({ onSubmit, onCancel, existing }) => {
  const [form, setForm] = useState(existing ? fromExisting(existing) : EMPTY);

  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );

  const isLent = form.direction === "lent";

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
    const base = {
      ...form,
      amount: parseFloat(form.amount),
      outstanding: parseFloat(form.outstanding),
    };
    if (!base.affectBalance || !base.accountId) delete base.accountId;
    const l = existing
      ? { ...existing, ...base }
      : { ...base, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
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
        <label>{isLent ? "Lent to (name)" : "Borrowed from (name)"}</label>
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

      <DateField
        name="date"
        value={form.date}
        onChange={handleChange}
        label="Date"
        required
      />

      <label className="card-combine-toggle">
        <input
          type="checkbox"
          checked={form.affectBalance}
          onChange={(e) =>
            setForm((f) => ({ ...f, affectBalance: e.target.checked }))
          }
        />
        <span className="card-combine-toggle-text">
          {isLent
            ? "Deduct this from my balance"
            : "Add this to my balance"}
          <span className="card-combine-toggle-sub">
            {form.affectBalance
              ? isLent
                ? "Logs an expense for the money you lent"
                : "Logs an income for the money you borrowed"
              : "Just records the entry — no balance change"}
          </span>
        </span>
      </label>

      {form.affectBalance && multiBankEnabled && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={form.accountId}
          onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
          label={isLent ? "Paid from" : "Received into"}
        />
      )}

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
          {existing ? "Update" : isLent ? "Add Lending" : "Add Borrowing"}
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
