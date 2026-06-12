import { memo, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";

const SelfTransferForm = ({ onSubmit, onCancel, existing }) => {
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );

  const initial = useMemo(
    () => ({
      fromAccountId: existing?.fromAccountId ?? "",
      toAccountId: existing?.toAccountId ?? "",
      amount: existing?.amount ?? "",
      occurredAt: existing?.occurredAt
        ? existing.occurredAt.slice(0, 16)
        : new Date().toISOString().slice(0, 16),
      description: existing?.description ?? "",
    }),
    [existing],
  );
  const [form, setForm] = useState(initial);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const amount = parseFloat(form.amount) || 0;
  const sameAccount =
    form.fromAccountId &&
    form.toAccountId &&
    form.fromAccountId === form.toAccountId;
  const canSubmit =
    !!form.fromAccountId &&
    !!form.toAccountId &&
    !sameAccount &&
    amount > 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      fromAccountId: form.fromAccountId,
      toAccountId: form.toAccountId,
      amount: amount,
      occurredAt: new Date(form.occurredAt).toISOString(),
      description: form.description?.trim() || undefined,
    });
  }

  if (accounts.length < 2) {
    return (
      <div className="self-transfer-empty">
        <i className="fa-solid fa-exchange-alt self-transfer-empty-icon" />
        <p>Need at least two accounts.</p>
        <p className="self-transfer-empty-sub">
          Add another bank in Preferences → Multi-bank tracking to start
          recording self transfers.
        </p>
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      <div className="self-transfer-row">
        <div className="field">
          <select
            name="fromAccountId"
            value={form.fromAccountId}
            onChange={(e) => set("fromAccountId", e.target.value)}
            required
          >
            <option value="" disabled hidden />
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank}
              </option>
            ))}
          </select>
          <label>From</label>
        </div>
        <i className="fa-solid fa-arrow-right self-transfer-arrow" />
        <div className="field">
          <select
            name="toAccountId"
            value={form.toAccountId}
            onChange={(e) => set("toAccountId", e.target.value)}
            required
          >
            <option value="" disabled hidden />
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank}
              </option>
            ))}
          </select>
          <label>To</label>
        </div>
      </div>

      {sameAccount && (
        <p className="self-transfer-warn">
          <i className="fa-solid fa-triangle-exclamation" /> From and To must be
          different accounts.
        </p>
      )}

      <div className="field">
        <input
          name="amount"
          type="number"
          inputMode="decimal"
          step="any"
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
          required
        />
        <label>Amount (₹)</label>
      </div>

      <div className="field">
        <input
          name="occurredAt"
          type="datetime-local"
          value={form.occurredAt}
          onChange={(e) => set("occurredAt", e.target.value)}
          required
        />
        <label>Date &amp; time</label>
      </div>

      <div className="field">
        <textarea
          name="description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows="2"
          autoCorrect="off"
          spellCheck={false}
        />
        <label>Description / Notes</label>
      </div>

      <p className="self-transfer-hint">
        Self transfers move money between your own accounts. The total balance
        doesn&apos;t change — only the per-bank balances do.
      </p>

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="generic-button"
          disabled={!canSubmit}
        >
          <i className="fa-solid fa-arrow-right-arrow-left" />{" "}
          {existing ? "Update Transfer" : "Save Transfer"}
        </button>
      </div>
    </form>
  );
};

SelfTransferForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
};

export default memo(SelfTransferForm);
