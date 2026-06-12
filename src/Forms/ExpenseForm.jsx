import { memo, useState, useMemo } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import { CATEGORIES, PAYMENT_MODES } from "../utils/constants";
import { matchAutoCategory } from "../utils/autoCategory";
import { parseVoiceTranscript } from "../utils/voiceParser";
import { useVoiceCapture } from "../hooks/useVoiceCapture";
import { showToast } from "../redux/slices/toastSlice";
import BankChipSelector from "../components/BankChipSelector";
import { computeCardOutstanding } from "../utils/solvencyUtils";

const EMPTY = {
  name: "",
  amount: "",
  category: "",
  paymentMode: "",
  description: "",
  occurredAt: "",
  cardId: "",
  repaymentFor: "",
  accountId: "",
};

function fromExisting(existing) {
  return {
    name: existing.name ?? "",
    amount: existing.amount ?? "",
    category: existing.category ?? "",
    paymentMode: existing.paymentMode ?? "",
    description: existing.description ?? "",
    occurredAt: existing.occurredAt ?? "",
    cardId: existing.cardId ?? "",
    repaymentFor: existing.repaymentFor ?? "",
    accountId: existing.accountId ?? "",
  };
}

const ExpenseForm = ({ onSubmit, onCancel, existing, onInvestmentSelect }) => {
  const [form, setForm] = useState(existing ? fromExisting(existing) : EMPTY);
  const dispatch = useDispatch();

  const cards = useSelector((state) => state.transactions.transactionData?.cards ?? []);
  const commitments = useSelector(
    (state) => state.transactions.transactionData?.commitments ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const categories = useSelector(
    (state) =>
      state.transactions.transactionData?.categories?.expense ?? CATEGORIES,
  );
  const paymentModes = useSelector(
    (state) =>
      state.transactions.transactionData?.lists?.paymentModes ?? PAYMENT_MODES,
  );
  const autoCategoryRules = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.autoCategoryRules ?? [],
  );
  const voiceEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.voiceAddEnabled ??
      false,
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );

  const [parserText, setParserText] = useState("");

  function applyParsed(parsed) {
    setForm((f) => {
      const next = { ...f };
      if (parsed.name) next.name = parsed.name;
      if (parsed.amount) next.amount = parsed.amount;
      next.occurredAt = parsed.occurredAt;
      if (parsed.paymentMode && paymentModes.includes(parsed.paymentMode)) {
        next.paymentMode = parsed.paymentMode;
      }
      if (parsed.category && categories.includes(parsed.category)) {
        next.category = parsed.category;
      } else {
        const match = matchAutoCategory(
          parsed.name || f.name,
          "expense",
          autoCategoryRules,
        );
        if (match && categories.includes(match)) next.category = match;
      }
      return next;
    });
  }

  function applyParserText() {
    const text = parserText.trim();
    if (!text) return;
    applyParsed(parseVoiceTranscript(text, { categories, paymentModes }));
    setParserText("");
  }

  const voice = useVoiceCapture({
    enabled: voiceEnabled,
    onResult: ({ transcript }) => {
      applyParsed(parseVoiceTranscript(transcript, { categories, paymentModes }));
    },
    onError: (message) =>
      dispatch(showToast({ message, type: "error", duration: 4500 })),
  });

  function handleNameChange(value) {
    setForm((f) => {
      const next = { ...f, name: value };
      if (!f.category) {
        const match = matchAutoCategory(value, "expense", autoCategoryRules);
        if (match && categories.includes(match)) next.category = match;
      }
      return next;
    });
  }

  const isRepayment = form.category === "Repayment";
  const paidByCard = form.paymentMode === "Credit Card";

  function handleChange(e) {
    if (
      e.target.name === "category" &&
      e.target.value === "Investment" &&
      onInvestmentSelect
    ) {
      onInvestmentSelect(form.amount);
      return;
    }
    if (e.target.name === "name") {
      handleNameChange(e.target.value);
      return;
    }
    if (e.target.name === "repaymentFor") {
      // Picking a repayment target auto-fills the amount with the
      // outstanding bill (card) or the EMI amount (commitment). The
      // user can override afterwards — useful for partial payments.
      const id = e.target.value;
      const target = repaymentTargets.find((t) => t.id === id);
      setForm((f) => ({
        ...f,
        repaymentFor: id,
        amount:
          target?.amount && target.amount > 0
            ? String(target.amount)
            : f.amount,
      }));
      return;
    }
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const extra = {};
    if (paidByCard && form.cardId) extra.cardId = form.cardId;
    if (isRepayment && form.repaymentFor) extra.repaymentFor = form.repaymentFor;

    const transaction = existing
      ? { ...existing, ...form, ...extra }
      : {
          ...form,
          ...extra,
          createdAt: new Date().toISOString(),
          transactionType: "expense",
          id: crypto.randomUUID(),
        };

    // Strip empty optional fields
    if (!transaction.cardId) delete transaction.cardId;
    if (!transaction.repaymentFor) delete transaction.repaymentFor;
    // Card-paid expenses don't touch a bank account directly — the bank
    // only moves when the card bill is repaid. Drop accountId so the
    // per-bank balance math stays correct.
    if (transaction.cardId || !transaction.accountId) delete transaction.accountId;

    onSubmit(transaction);
  }

  // Repayment targets:
  //   • Cards with an outstanding balance (i.e., there's a current bill
  //     to pay). Cards with zero outstanding don't appear — there's
  //     nothing to repay against them.
  //   • Commitments that are NOT funded by a credit card. Card-funded
  //     EMIs are already covered by the card's bill above, so showing
  //     them separately would double-tag the same money.
  // Each entry carries the auto-populate amount: the card's outstanding
  // or the EMI's per-period amount. When the user picks a target, the
  // expense amount input gets prefilled with this value (overridable).
  const repaymentTargets = useMemo(() => {
    const now = new Date();
    const cardTargets = cards
      .map((c) => ({
        id: c.id,
        label: c.name,
        amount: computeCardOutstanding(c, allTransactions, commitments, now),
      }))
      .filter((t) => t.amount > 0);
    const emiTargets = commitments
      .filter((c) => c.paymentMedium !== "credit_card")
      .map((c) => ({
        id: c.id,
        label: c.name,
        amount: parseFloat(c.emiAmount) || 0,
      }));
    return [...cardTargets, ...emiTargets];
  }, [cards, commitments, allTransactions]);

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      {voiceEnabled && (
        <div
          className={`voice-bar${voice.listening ? " voice-bar--on" : ""}`}
        >
          {voice.supported && (
            <button
              type="button"
              className="voice-bar-mic"
              onClick={voice.listening ? voice.stop : voice.start}
              aria-label={
                voice.listening ? "Stop voice capture" : "Start voice capture"
              }
              title={
                voice.listening ? "Listening… tap to stop" : "Speak the expense"
              }
            >
              <i
                className={`fa-solid ${voice.listening ? "fa-stop" : "fa-microphone"}`}
              />
            </button>
          )}
          <input
            type="text"
            className="voice-bar-input"
            placeholder={
              voice.listening
                ? "Listening…"
                : voice.supported
                  ? 'Type or tap mic: "200 by upi for lunch"'
                  : 'Type to auto-fill: "200 by upi for lunch"'
            }
            value={parserText}
            onChange={(e) => setParserText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyParserText();
              }
            }}
            aria-label="Type a transaction to auto-fill"
          />
          <button
            type="button"
            className="voice-bar-apply"
            onClick={applyParserText}
            disabled={!parserText.trim()}
            aria-label="Apply text"
            title="Apply"
          >
            <i className="fa-solid fa-wand-magic-sparkles" />
          </button>
        </div>
      )}

      <div className="field">
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          required
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
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label>Category</label>
      </div>

      {isRepayment && repaymentTargets.length > 0 && (
        <div className="field">
          <select
            name="repaymentFor"
            value={form.repaymentFor}
            onChange={handleChange}
          >
            <option value="">— Select obligation (optional) —</option>
            {repaymentTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <label>Repayment for</label>
        </div>
      )}

      <div className="field">
        <select
          name="paymentMode"
          value={form.paymentMode}
          onChange={handleChange}
          required
        >
          <option value="" disabled hidden />
          {paymentModes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label>Payment mode</label>
      </div>

      {paidByCard && cards.length > 0 && (
        <div className="field">
          <select
            name="cardId"
            value={form.cardId}
            onChange={handleChange}
          >
            <option value="">— Select card (optional) —</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.bank})
              </option>
            ))}
          </select>
          <label>Credit card used</label>
        </div>
      )}

      {multiBankEnabled && !paidByCard && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={form.accountId}
          onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
          label={isRepayment ? "Paid from" : "Spent from"}
        />
      )}

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
          {existing ? "Update Expense" : "Save Expense"}
        </button>
      </div>
    </form>
  );
};

ExpenseForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
  onInvestmentSelect: PropTypes.func,
};

export default memo(ExpenseForm);
