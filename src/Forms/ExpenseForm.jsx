import { memo, useState } from "react";

const CATEGORIES = [
  "Food",
  "Transport",
  "Fuel",
  "Shopping",
  "Utilities",
  "Entertainment",
  "Rent",
  "Other",
];

const PAYMENT_MODES = ["Cash", "UPI", "Debit Card", "Credit Card", "Other"];

const ExpenseForm = ({ onSubmit, onCancel }) => {
  const [form, setForm] = useState({
    name: "",
    amount: "",
    category: "",
    paymentMode: "",
    description: "",
    occurredAt: "",
  });

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const expense = {
      ...form,
      createdAt: new Date().toISOString(),
      transactionType: "expense",
      id: crypto.randomUUID(),
    };

    onSubmit(expense);
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      <div className="field">
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          required
          placeholder=" "
          autoCorrect="off"
          spellCheck={false}
        />
        <label>Expense name</label>
      </div>

      <div className="field">
        <input
          name="amount"
          type="number"
          inputMode="decimal"
          value={form.amount}
          onChange={handleChange}
          required
          placeholder=" "
          autoCorrect="off"
          spellCheck={false}
        />
        <label>Amount</label>
      </div>

      <div className="field">
        <select
          name="category"
          value={form.category}
          onChange={handleChange}
          required
        >
          <option value="" disabled hidden />
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label>Category</label>
      </div>

      <div className="field">
        <select
          name="paymentMode"
          value={form.paymentMode}
          onChange={handleChange}
          required
        >
          <option value="" disabled hidden />
          {PAYMENT_MODES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label>Payment mode</label>
      </div>

      <div className="field">
        <input
          name="occurredAt"
          type="datetime-local"
          value={form.occurredAt}
          onChange={handleChange}
          required
        />
        <label>Date & time</label>
      </div>

      <div className="field">
        <textarea
          name="description"
          value={form.description}
          onChange={handleChange}
          placeholder=" "
          rows="3"
          autoCorrect="off"
          spellCheck={false}
        />
        <label>Description / Notes</label>
      </div>

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="generic-button">
          Save Expense
        </button>
      </div>
    </form>
  );
};

export default memo(ExpenseForm);
