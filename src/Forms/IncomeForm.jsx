import { memo, useState } from "react";
import PropTypes from "prop-types";

const IncomeForm = ({ onSubmit, onCancel }) => {
  const [form, setForm] = useState({
    name: "",
    amount: "",
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
      transactionType: "income",
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
        <label>Income source</label>
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
          Save Income
        </button>
      </div>
    </form>
  );
};

IncomeForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default memo(IncomeForm);
