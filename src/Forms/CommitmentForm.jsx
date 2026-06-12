import { memo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import { COMMITMENT_TYPES } from "../utils/solvencyUtils";
import DayPicker from "./DayPicker";

const EMPTY = {
  name: "",
  type: "emi",
  emiAmount: "",
  interestRate: "",
  tenureMonths: "",
  startDate: "",
  firstPaymentMonth: "",
  currentOutstanding: "",
  billingDay: "",
  dueDay: "",
  paymentMedium: "",
  cardId: "",
  notes: "",
};

function fromExisting(e) {
  return {
    name: e.name ?? "",
    type: e.type ?? "emi",
    emiAmount: e.emiAmount ?? "",
    interestRate: e.interestRate ?? "",
    tenureMonths: e.tenureMonths ?? "",
    startDate: e.startDate ?? "",
    firstPaymentMonth: e.firstPaymentMonth ?? "",
    currentOutstanding: e.currentOutstanding != null ? String(e.currentOutstanding) : "",
    billingDay: e.billingDay ? String(e.billingDay) : "",
    dueDay: e.dueDay ? String(e.dueDay) : "",
    paymentMedium: e.paymentMedium ?? "",
    cardId: e.cardId ?? "",
    notes: e.notes ?? "",
  };
}

// "YYYY-MM" of the month after a given YYYY-MM-DD date. Standard banking
// convention: loan disbursed in March → first EMI billed in April.
function defaultFirstPaymentMonth(startDateStr) {
  if (!startDateStr) return "";
  const d = new Date(startDateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const CommitmentForm = ({ onSubmit, onCancel, existing }) => {
  const [form, setForm] = useState(existing ? fromExisting(existing) : EMPTY);

  const cards = useSelector((state) => state.transactions.transactionData?.cards ?? []);
  const isLoan = form.type === "emi";
  const paidByCard = form.paymentMedium === "credit_card";

  // Auto-derive firstPaymentMonth from startDate when the user hasn't picked
  // one yet. Intentional one-way sync from disbursement → first-bill default.
  useEffect(() => {
    if (!isLoan || !form.startDate) return;
    if (form.firstPaymentMonth) return;
    const derived = defaultFirstPaymentMonth(form.startDate);
    if (!derived) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) =>
      f.firstPaymentMonth ? f : { ...f, firstPaymentMonth: derived },
    );
  }, [form.startDate, form.firstPaymentMonth, isLoan]);

  // Auto-populate billing/due dates from the selected card
  useEffect(() => {
    if (!paidByCard || !form.cardId) return;
    const card = cards.find((c) => c.id === form.cardId);
    // Intentional one-way sync from selected card → dependent date fields.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => ({
      ...f,
      ...(card?.dueDay ? { dueDay: String(card.dueDay) } : {}),
      ...(card?.statementDay ? { billingDay: String(card.statementDay) } : {}),
    }));
  }, [form.cardId, paidByCard, cards]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({
      ...f,
      [name]: value,
      ...(name === "paymentMedium" && value !== "credit_card" ? { cardId: "" } : {}),
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const hasSnapshot = form.currentOutstanding !== "";
    const parsed = {
      emiAmount: parseFloat(form.emiAmount) || 0,
      interestRate: parseFloat(form.interestRate) || 0,
      tenureMonths: parseInt(form.tenureMonths) || 0,
      billingDay: form.billingDay ? parseInt(form.billingDay) : null,
      dueDay: form.dueDay ? parseInt(form.dueDay) : null,
      currentOutstanding: hasSnapshot ? parseFloat(form.currentOutstanding) : null,
      currentOutstandingDate: hasSnapshot ? new Date().toISOString().slice(0, 10) : null,
    };
    const c = existing
      ? { ...existing, ...form, ...parsed }
      : { ...form, ...parsed, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    if (!c.cardId) delete c.cardId;
    if (!c.paymentMedium) delete c.paymentMedium;
    if (c.currentOutstanding == null) { delete c.currentOutstanding; delete c.currentOutstandingDate; }
    if (c.billingDay == null) delete c.billingDay;
    // Persist firstPaymentMonth only for EMIs; subscriptions/rent/insurance
    // don't have a tenure or projection model.
    if (!isLoan || !c.firstPaymentMonth) delete c.firstPaymentMonth;
    onSubmit(c);
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
        <label>Name</label>
      </div>

      <div className="field">
        <select name="type" value={form.type} onChange={handleChange} required>
          {COMMITMENT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <label>Type</label>
      </div>

      {isLoan && (
        <div className="sol-form-row">
          <div className="field">
            <input
              name="interestRate"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.interestRate}
              onChange={handleChange}
              placeholder=" "
            />
            <label>Interest rate (% p.a.)</label>
          </div>
          <div className="field">
            <input
              name="tenureMonths"
              type="number"
              inputMode="numeric"
              value={form.tenureMonths}
              onChange={handleChange}
              placeholder=" "
            />
            <label>Tenure (months)</label>
          </div>
        </div>
      )}

      <div className="field">
        <input
          name="emiAmount"
          type="number"
          inputMode="decimal"
          value={form.emiAmount}
          onChange={handleChange}
          required
          placeholder=" "
        />
        <label>Monthly EMI (₹)</label>
      </div>
      {isLoan && <p className="form-field-hint">Full EMI — principal + interest combined</p>}

      <div className="sol-form-row">
        <div className="field">
          <select name="paymentMedium" value={form.paymentMedium} onChange={handleChange}>
            <option value="" disabled hidden />
            <option value="bank">Bank / Auto Debit</option>
            <option value="credit_card">Credit Card</option>
          </select>
          <label>Payment via</label>
        </div>
        {paidByCard && cards.length > 0 && (
          <div className="field">
            <select name="cardId" value={form.cardId} onChange={handleChange}>
              <option value="" disabled hidden />
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label>Card</label>
          </div>
        )}
      </div>

      {isLoan ? (
        <div className="sol-form-row">
          <DayPicker
            label="Billing date"
            value={form.billingDay}
            onChange={(v) => setForm((f) => ({ ...f, billingDay: v }))}
          />
          <DayPicker
            label="Payment due date"
            value={form.dueDay}
            onChange={(v) => setForm((f) => ({ ...f, dueDay: v }))}
            required
          />
        </div>
      ) : (
        <DayPicker
          label="Payment due date"
          value={form.dueDay}
          onChange={(v) => setForm((f) => ({ ...f, dueDay: v }))}
          required
        />
      )}

      {isLoan && (
        <>
          <div className="sol-form-row">
            <div className="field">
              <input
                name="startDate"
                type="date"
                value={form.startDate}
                onChange={handleChange}
                placeholder=" "
              />
              <label>Start date (disbursed on)</label>
            </div>
            <div className="field">
              <input
                name="firstPaymentMonth"
                type="month"
                value={form.firstPaymentMonth}
                onChange={handleChange}
                placeholder=" "
              />
              <label>First payment month</label>
            </div>
          </div>
          <p className="form-field-hint">
            Banks usually bill the first EMI the month after disbursement.
            Auto-set from start date — change it if your lender bills earlier.
          </p>
          <div className="field">
            <input
              name="currentOutstanding"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.currentOutstanding}
              onChange={handleChange}
              placeholder=" "
            />
            <label>Current outstanding (₹)</label>
          </div>
        </>
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
          {existing ? "Update" : "Add Commitment"}
        </button>
      </div>
    </form>
  );
};

CommitmentForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
};

export default memo(CommitmentForm);
