import { memo, useState, useMemo } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import { INCOME_CATEGORIES } from "../utils/constants";
import { matchAutoCategory } from "../utils/autoCategory";
import { parseVoiceTranscript } from "../utils/voiceParser";
import { useVoiceCapture } from "../hooks/useVoiceCapture";
import { showToast } from "../redux/slices/toastSlice";
import BankChipSelector from "../components/BankChipSelector";
import OptionField from "../components/OptionField";
import DateField from "../components/DateField";
import FormError from "../components/FormError";
import SmartFillBar from "../components/SmartFillBar";
import { predictEntry, normalizeName } from "../utils/smartFill";
import { NoteBulletHint } from "../components/NoteText";
import { computeCardOutstanding } from "../utils/solvencyUtils";

const EMPTY = {
  name: "",
  amount: "",
  category: "",
  description: "",
  occurredAt: "",
  accountId: "",
  repaymentFor: "",
};

function fromExisting(existing) {
  return {
    name: existing.name ?? existing.source ?? "",
    amount: existing.amount ?? "",
    category: existing.category ?? "",
    description: existing.description ?? "",
    occurredAt: existing.occurredAt ?? "",
    accountId: existing.accountId ?? "",
    repaymentFor: existing.repaymentFor ?? "",
  };
}

function isCashbackCategory(category) {
  return (category ?? "").trim().toLowerCase().replace(/\s+/g, "") === "cashback";
}

const IncomeForm = ({ onSubmit, onCancel, existing }) => {
  const [form, setForm] = useState(existing ? fromExisting(existing) : EMPTY);
  const dispatch = useDispatch();
  const categories = useSelector(
    (state) =>
      state.transactions.transactionData?.categories?.income ?? INCOME_CATEGORIES,
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
  const cards = useSelector(
    (state) => state.transactions.transactionData?.cards ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const commitments = useSelector(
    (state) => state.transactions.transactionData?.commitments ?? [],
  );

  const isCashback = isCashbackCategory(form.category);

  const [parserText, setParserText] = useState("");
  const [formError, setFormError] = useState(null);
  const [smartHide, setSmartHide] = useState("");
  const invalidKeys = new Set((formError ?? []).map((m) => m.key));

  const prediction = useMemo(
    () => predictEntry(form.name, allTransactions, { type: "income" }),
    [form.name, allTransactions],
  );
  const showSmartFill =
    !!prediction && !form.amount && smartHide !== normalizeName(form.name);

  function applySmartFill() {
    setForm((f) => ({
      ...f,
      amount: prediction.amount || f.amount,
      category: prediction.category || f.category,
      accountId: prediction.accountId || f.accountId,
    }));
    setSmartHide(normalizeName(form.name));
  }

  function applyParsed(parsed) {
    setForm((f) => {
      const next = { ...f };
      if (parsed.name) next.name = parsed.name;
      if (parsed.amount) next.amount = parsed.amount;
      next.occurredAt = parsed.occurredAt;
      if (parsed.category && categories.includes(parsed.category)) {
        next.category = parsed.category;
      } else {
        const match = matchAutoCategory(
          parsed.name || f.name,
          "income",
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
    applyParsed(parseVoiceTranscript(text, { categories }));
    setParserText("");
  }

  const voice = useVoiceCapture({
    enabled: voiceEnabled,
    onResult: ({ transcript }) => {
      applyParsed(parseVoiceTranscript(transcript, { categories }));
    },
    onError: (message) =>
      dispatch(showToast({ message, type: "error", duration: 4500 })),
  });

  function handleChange(e) {
    setFormError(null);
    if (e.target.name === "name") {
      const value = e.target.value;
      setForm((f) => {
        const next = { ...f, name: value };
        if (!f.category) {
          const match = matchAutoCategory(value, "income", autoCategoryRules);
          if (match && categories.includes(match)) next.category = match;
        }
        return next;
      });
      return;
    }
    if (e.target.name === "category") {
      const value = e.target.value;
      setForm((f) => ({
        ...f,
        category: value,
        repaymentFor: isCashbackCategory(value) ? f.repaymentFor : "",
      }));
      return;
    }
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e) {
    e.preventDefault();

    const missing = [];
    if (!form.name.trim())
      missing.push({ key: "name", label: "Income source" });
    if (!form.amount) missing.push({ key: "amount", label: "Amount" });
    if (!form.category) missing.push({ key: "category", label: "Category" });
    if (!form.occurredAt)
      missing.push({ key: "occurredAt", label: "Date & time" });
    if (missing.length > 0) {
      setFormError(missing);
      return;
    }
    setFormError(null);

    const creditsCard = isCashback && !!form.repaymentFor;
    const transaction = existing
      ? { ...existing, ...form }
      : {
          ...form,
          createdAt: new Date().toISOString(),
          transactionType: "income",
          id: crypto.randomUUID(),
        };
    if (creditsCard) {
      transaction.repaymentFor = form.repaymentFor;
      delete transaction.accountId;
    } else {
      delete transaction.repaymentFor;
      if (!transaction.accountId) delete transaction.accountId;
    }
    onSubmit(transaction);
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit} noValidate>
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
                voice.listening ? "Listening… tap to stop" : "Speak the income"
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
                  ? 'Type or tap mic: "50000 salary today"'
                  : 'Type to auto-fill: "50000 salary today"'
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
        <label>Income source</label>
      </div>

      {showSmartFill && (
        <SmartFillBar
          prediction={prediction}
          accounts={accounts}
          onApply={applySmartFill}
          onDismiss={() => setSmartHide(normalizeName(form.name))}
        />
      )}

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

      <OptionField
        name="category"
        value={form.category}
        onChange={handleChange}
        label="Category"
        required
        placeholder=""
        options={categories}
        invalid={invalidKeys.has("category")}
      />

      {isCashback && (
        <OptionField
          name="repaymentFor"
          value={form.repaymentFor}
          onChange={handleChange}
          label="Apply cashback to"
          options={[
            ...cards.map((c) => ({
              value: c.id,
              label: `${c.name}${c.bank ? ` (${c.bank})` : ""} · ₹${computeCardOutstanding(
                c,
                allTransactions,
                commitments,
              ).toLocaleString("en-IN")} due`,
              bank: c.bank,
              color: c.color,
            })),
            { value: "", label: "Other" },
          ]}
        />
      )}

      {multiBankEnabled &&
        accounts.length > 0 &&
        !(isCashback && form.repaymentFor) && (
          <BankChipSelector
            accounts={accounts}
            value={form.accountId}
            onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
            label="Received in"
          />
        )}

      <DateField
        name="occurredAt"
        value={form.occurredAt}
        onChange={handleChange}
        label="Date & time"
        withTime
        required
        invalid={invalidKeys.has("occurredAt")}
      />

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
        <NoteBulletHint text={form.description} />
      </div>

      <FormError fields={formError?.map((m) => m.label)} />

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="generic-button">
          {existing ? "Update Income" : "Save Income"}
        </button>
      </div>
    </form>
  );
};

IncomeForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
};

export default memo(IncomeForm);
