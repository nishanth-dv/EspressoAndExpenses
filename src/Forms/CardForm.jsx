import { memo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import DayPicker from "./DayPicker";
import OptionField from "../components/OptionField";
import { BANKS as DEFAULT_BANKS, CATEGORIES } from "../utils/constants";

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
  annualFee: "",
  feeWaiverSpend: "",
  rewardBase: "",
  rewardCategories: [],
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
    annualFee: e.annualFee ?? "",
    feeWaiverSpend: e.feeWaiverSpend ?? "",
    rewardBase: e.rewardBase ?? "",
    rewardCategories: Array.isArray(e.rewardCategories)
      ? e.rewardCategories.map((r) => ({
          category: r.category ?? "",
          rate: r.rate ?? "",
          _k: crypto.randomUUID(),
        }))
      : [],
  };
}

const CardForm = ({ onSubmit, onCancel, existing, cards = [] }) => {
  const [form, setForm] = useState(() => existing ? fromExisting(existing) : makeEmpty());
  const [combine, setCombine] = useState(() => !!existing?.creditGroupId);
  const [showRewards, setShowRewards] = useState(
    () =>
      !!existing &&
      (existing.annualFee ||
        existing.rewardBase ||
        (existing.rewardCategories?.length ?? 0) > 0),
  );
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

  const addRewardCat = () =>
    setForm((f) => ({
      ...f,
      rewardCategories: [
        ...f.rewardCategories,
        { category: "", rate: "", _k: crypto.randomUUID() },
      ],
    }));
  const updateRewardCat = (i, key, val) =>
    setForm((f) => {
      const rc = f.rewardCategories.map((r, idx) =>
        idx === i ? { ...r, [key]: val } : r,
      );
      return { ...f, rewardCategories: rc };
    });
  const removeRewardCat = (i) =>
    setForm((f) => ({
      ...f,
      rewardCategories: f.rewardCategories.filter((_, idx) => idx !== i),
    }));

  // Categories still available to add as a bonus row (no duplicates).
  const usedCats = new Set(form.rewardCategories.map((r) => r.category));

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.dueDay) return;
    const numOrNull = (v) => (v === "" || v == null ? null : parseFloat(v));
    const rewardFields = {
      annualFee: numOrNull(form.annualFee),
      feeWaiverSpend: numOrNull(form.feeWaiverSpend),
      rewardBase: numOrNull(form.rewardBase),
      rewardCategories: form.rewardCategories
        .filter(
          (r) =>
            r.category &&
            r.rate !== "" &&
            Number.isFinite(parseFloat(r.rate)),
        )
        .map((r) => ({ category: r.category, rate: parseFloat(r.rate) })),
    };
    const card = existing
      ? {
          ...existing,
          ...form,
          limit: parseFloat(form.limit),
          statementDay: form.statementDay ? parseInt(form.statementDay) : null,
          dueDay: parseInt(form.dueDay),
          ...rewardFields,
        }
      : {
          ...form,
          id: crypto.randomUUID(),
          limit: parseFloat(form.limit),
          statementDay: form.statementDay ? parseInt(form.statementDay) : null,
          dueDay: parseInt(form.dueDay),
          createdAt: new Date().toISOString(),
          ...rewardFields,
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

      <OptionField
        name="bank"
        value={form.bank}
        onChange={handleChange}
        label="Bank"
        required
        placeholder=""
        options={BANKS.map((b) => ({ value: b, label: b, bank: b }))}
      />

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

      <div className="card-rewards">
        <button
          type="button"
          className="card-rewards-toggle"
          onClick={() => setShowRewards((s) => !s)}
          aria-expanded={showRewards}
        >
          <i
            className={`fa-solid fa-chevron-${showRewards ? "down" : "right"}`}
          />
          Rewards &amp; fees (optional)
        </button>

        {showRewards && (
          <div className="card-rewards-body">
            <p className="card-rewards-hint">
              Add these to unlock best-card routing and fee-vs-benefit tips in
              Advisory.
            </p>

            <div className="field">
              <input
                name="annualFee"
                type="number"
                inputMode="decimal"
                value={form.annualFee}
                onChange={handleChange}
                placeholder=" "
              />
              <label>Annual fee (₹)</label>
            </div>

            <div className="field">
              <input
                name="feeWaiverSpend"
                type="number"
                inputMode="decimal"
                value={form.feeWaiverSpend}
                onChange={handleChange}
                placeholder=" "
              />
              <label>Fee waived at yearly spend (₹)</label>
            </div>

            <div className="field">
              <input
                name="rewardBase"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={form.rewardBase}
                onChange={handleChange}
                placeholder=" "
              />
              <label>Base reward rate (%)</label>
            </div>

            <div className="card-reward-cats">
              <span className="card-reward-cats-label">
                Bonus categories (optional)
              </span>
              {form.rewardCategories.map((r, i) => (
                <div className="card-reward-row" key={r._k}>
                  <select
                    className="card-reward-select"
                    value={r.category}
                    onChange={(e) =>
                      updateRewardCat(i, "category", e.target.value)
                    }
                  >
                    <option value="">Category…</option>
                    {CATEGORIES.filter(
                      (c) => c === r.category || !usedCats.has(c),
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    className="card-reward-rate"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={r.rate}
                    onChange={(e) => updateRewardCat(i, "rate", e.target.value)}
                    placeholder="%"
                  />
                  <button
                    type="button"
                    className="card-reward-remove"
                    onClick={() => removeRewardCat(i)}
                    aria-label="Remove category"
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="card-reward-add"
                onClick={addRewardCat}
              >
                <i className="fa-solid fa-plus" /> Add category
              </button>
            </div>
          </div>
        )}
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
