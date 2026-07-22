import { memo, useState, useMemo, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import { CATEGORIES, PAYMENT_MODES, INVESTMENT_TYPES } from "../utils/constants";
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
import { getCardDue, isCardFundedEmi } from "../utils/solvencyUtils";

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
    repaymentFor: existing.repaymentFor ?? existing.lendingId ?? "",
    accountId: existing.accountId ?? "",
  };
}

function fromInvestmentTarget(inv) {
  return {
    ...EMPTY,
    name: inv.name ?? "",
    amount: inv.premiumAmount != null ? String(inv.premiumAmount) : "",
    category: "Investment",
    occurredAt: new Date().toISOString().slice(0, 16),
    accountId: inv.accountId ?? "",
  };
}

const ExpenseForm = ({
  onSubmit,
  onCancel,
  existing,
  onInvestmentSelect,
  investmentTarget,
  onChangeInvestmentTarget,
  onSubscriptionSelect,
  autoVoice = false,
}) => {
  const [form, setForm] = useState(() =>
    existing
      ? fromExisting(existing)
      : investmentTarget
        ? fromInvestmentTarget(investmentTarget)
        : EMPTY,
  );
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
  const entryTabsEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.entryTabsEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const investments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const lendings = useSelector(
    (state) => state.transactions.transactionData?.lendings ?? [],
  );
  const userInvestmentTypes = useSelector(
    (state) => state.transactions.transactionData?.investmentTypes ?? [],
  );

  const [parserText, setParserText] = useState("");
  const [investPicker, setInvestPicker] = useState({ type: "", id: "" });
  const [formError, setFormError] = useState(null);
  const [smartHide, setSmartHide] = useState("");

  const prediction = useMemo(
    () => predictEntry(form.name, allTransactions, { type: "expense" }),
    [form.name, allTransactions],
  );
  const showSmartFill =
    !!prediction &&
    !form.amount &&
    !investmentTarget &&
    smartHide !== normalizeName(form.name);

  function applySmartFill() {
    setForm((f) => ({
      ...f,
      amount: prediction.amount || f.amount,
      category: prediction.category || f.category,
      paymentMode: prediction.paymentMode || f.paymentMode,
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

  const autoVoiceStartedRef = useRef(false);
  useEffect(() => {
    if (!autoVoice || autoVoiceStartedRef.current || !voice.supported) return;
    autoVoiceStartedRef.current = true;
    voice.start();
  }, [autoVoice, voice]);

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
  const isInvestmentPick =
    form.category === "Investment" && !!onInvestmentSelect && !investmentTarget;
  const invalidKeys = new Set((formError ?? []).map((m) => m.key));

  const categoryOptions = useMemo(
    () =>
      entryTabsEnabled
        ? categories.filter(
            (c) => c !== "Investment" && c !== "Subscription",
          )
        : categories,
    [categories, entryTabsEnabled],
  );

  const investTargetLabel = useMemo(() => {
    if (!investmentTarget) return "";
    const match =
      INVESTMENT_TYPES.find((b) => b.key === investmentTarget.type) ??
      userInvestmentTypes.find((t) => t.key === investmentTarget.type);
    return match?.label ?? investmentTarget.type ?? "";
  }, [investmentTarget, userInvestmentTypes]);

  const allInvestTypes = useMemo(
    () =>
      userInvestmentTypes.filter(
        (t) => !t.archived && !INVESTMENT_TYPES.some((b) => b.key === t.key),
      ),
    [userInvestmentTypes],
  );
  const investsOfType = useMemo(
    () => investments.filter((i) => i.type === investPicker.type && !i.inHistory),
    [investments, investPicker.type],
  );

  function handleChange(e) {
    setFormError(null);
    if (e.target.name === "category") {
      if (
        !entryTabsEnabled &&
        e.target.value === "Investment" &&
        onInvestmentSelect &&
        !investmentTarget
      ) {
        onInvestmentSelect({ amount: form.amount, existing: null, type: "" });
        return;
      }
      if (
        !entryTabsEnabled &&
        e.target.value === "Subscription" &&
        onSubscriptionSelect &&
        !investmentTarget
      ) {
        onSubscriptionSelect({ name: form.name, amount: form.amount });
        return;
      }
      setInvestPicker({ type: "", id: "" });
      setForm((f) => ({ ...f, category: e.target.value }));
      return;
    }
    if (e.target.name === "name") {
      handleNameChange(e.target.value);
      return;
    }
    if (e.target.name === "repaymentFor") {
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
    if (isInvestmentPick) return;

    const missing = [];
    if (!form.name.trim()) missing.push({ key: "name", label: "Expense name" });
    if (!form.amount) missing.push({ key: "amount", label: "Amount" });
    if (!form.category) missing.push({ key: "category", label: "Category" });
    if (!form.paymentMode)
      missing.push({ key: "paymentMode", label: "Payment mode" });
    if (!form.occurredAt)
      missing.push({ key: "occurredAt", label: "Date & time" });
    if (paidByCard && cards.length > 0 && !form.cardId)
      missing.push({ key: "cardId", label: "Credit card" });
    if (isRepayment && repaymentTargets.length > 0 && !form.repaymentFor)
      missing.push({ key: "repaymentFor", label: "Repayment target" });
    if (missing.length > 0) {
      setFormError(missing);
      return;
    }
    setFormError(null);

    // A repayment targets EITHER a card/commitment (tagged repaymentFor) or a
    // borrowed lending (tagged lendingId) — never both. Card/commitment dues
    // are computed live from repaymentFor txns; a lending's outstanding is a
    // stored field drawn down (and reversed) via the lendingId tag.
    const repayLending =
      isRepayment && form.repaymentFor
        ? lendings.find(
            (l) => l.id === form.repaymentFor && l.direction === "borrowed",
          )
        : null;

    const extra = {};
    if (paidByCard && form.cardId) extra.cardId = form.cardId;
    if (isRepayment && form.repaymentFor) {
      if (repayLending) extra.lendingId = form.repaymentFor;
      else extra.repaymentFor = form.repaymentFor;
    }

    const transaction = existing
      ? { ...existing, ...form, ...extra }
      : {
          ...form,
          ...extra,
          createdAt: new Date().toISOString(),
          transactionType: "expense",
          id: crypto.randomUUID(),
        };

    // Strip optional fields that don't apply — a stale cardId/repaymentFor/
    // lendingId must never ride along on an expense that isn't card-paid / the
    // matching kind of repayment.
    if (!paidByCard || !transaction.cardId) delete transaction.cardId;
    if (!isRepayment || !extra.repaymentFor) delete transaction.repaymentFor;
    if (!isRepayment || !extra.lendingId) delete transaction.lendingId;
    // Card-paid expenses don't touch a bank account directly — the bank
    // only moves when the card bill is repaid. Drop accountId so the
    // per-bank balance math stays correct.
    if (transaction.cardId || !transaction.accountId) delete transaction.accountId;

    if (investmentTarget) {
      if (investmentTarget.type === "lic") {
        transaction.licPolicyId = investmentTarget.id;
      } else {
        transaction.investmentId = investmentTarget.id;
      }
    }

    onSubmit(transaction);
  }

  // Everything the app knows you owe and can repay:
  //   • Cards with an outstanding balance (statement-cycle-aware bill via
  //     getCardDue — the same figure Solvency shows). Zero-balance cards
  //     are skipped: nothing to repay.
  //   • Commitments (EMIs / loans) that are NOT funded by a credit card —
  //     card-funded EMIs already ride the card's bill above, so listing
  //     them again would double-tag the same money.
  //   • Borrowed lendings with a positive outstanding — money you took from
  //     someone and still owe back.
  // Each entry carries the auto-populate amount used to prefill the amount
  // input when a target is picked (overridable).
  const repaymentTargets = useMemo(() => {
    const now = new Date();
    const cardTargets = cards
      .map((c) => ({
        id: c.id,
        label: c.name,
        amount: getCardDue(c, allTransactions, commitments, now)?.amount ?? 0,
      }))
      .filter((t) => t.amount > 0);
    const emiTargets = commitments
      .filter((c) => !isCardFundedEmi(c))
      .map((c) => ({
        id: c.id,
        label: c.name,
        amount: parseFloat(c.emiAmount) || 0,
      }));
    const lendingTargets = lendings
      .filter(
        (l) =>
          l.direction === "borrowed" && (parseFloat(l.outstanding) || 0) > 0,
      )
      .map((l) => ({
        id: l.id,
        label: `Return to ${l.name}`,
        amount: parseFloat(l.outstanding) || 0,
      }));
    return [...cardTargets, ...emiTargets, ...lendingTargets];
  }, [cards, commitments, allTransactions, lendings]);

  // Both the card and repayment pickers default to "None" — the user must
  // consciously pick a target, and submit is blocked (validated) until they do.
  return (
    <form className="expense-form" onSubmit={handleSubmit} noValidate>
      {entryTabsEnabled &&
        !existing &&
        !investmentTarget &&
        (onInvestmentSelect || onSubscriptionSelect) && (
          <div className="expense-kind" role="tablist" aria-label="Entry type">
            <span className="expense-kind-pill expense-kind-pill--active">
              <i className="fa-solid fa-cart-arrow-down" />
              Expense
            </span>
            {onInvestmentSelect && (
              <button
                type="button"
                className="expense-kind-pill"
                onClick={() =>
                  onInvestmentSelect({
                    amount: form.amount,
                    existing: null,
                    type: "",
                  })
                }
              >
                <i className="fa-solid fa-seedling" />
                Investment
              </button>
            )}
            {onSubscriptionSelect && (
              <button
                type="button"
                className="expense-kind-pill"
                onClick={() =>
                  onSubscriptionSelect({ name: form.name, amount: form.amount })
                }
              >
                <i className="fa-solid fa-rotate" />
                Subscription
              </button>
            )}
          </div>
        )}
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
        disabled={!!investmentTarget}
        placeholder=""
        options={categoryOptions}
        invalid={invalidKeys.has("category")}
      />

      {investmentTarget && (
        <div className="expense-invest-target">
          <i className="fa-solid fa-shield-halved" />
          <span className="expense-invest-target-text">
            {investTargetLabel} premium · {investmentTarget.name}
          </span>
          {onChangeInvestmentTarget && (
            <button
              type="button"
              className="expense-invest-target-change"
              onClick={onChangeInvestmentTarget}
            >
              Change
            </button>
          )}
        </div>
      )}

      {isInvestmentPick ? (
        <>
          {allInvestTypes.length === 0 ? (
            <p className="dyn-form-hint dyn-form-hint--soft">
              <i className="fa-solid fa-circle-info" />
              No investment types configured yet. Add one under Preferences →
              Investment types to record investment payments here.
            </p>
          ) : (
            <div className="field">
              <select
                value={investPicker.type}
                onChange={(e) => {
                  const type = e.target.value;
                  setInvestPicker({ type, id: "" });
                  const matches = investments.filter(
                    (i) => i.type === type && !i.inHistory,
                  );
                  if (type && matches.length === 0) {
                    onInvestmentSelect({
                      amount: form.amount,
                      existing: null,
                      type,
                    });
                  }
                }}
                required
              >
                <option value="" disabled hidden />
                {allInvestTypes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label>Investment type</label>
            </div>
          )}

          {investPicker.type && investsOfType.length > 0 && (
            <div className="field">
              <select
                value={investPicker.id}
                onChange={(e) =>
                  setInvestPicker((p) => ({ ...p, id: e.target.value }))
                }
              >
                <option value="">— Create new —</option>
                {investsOfType.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <label>Select existing</label>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="cancel-button" onClick={onCancel}>
              Cancel
            </button>
            {investPicker.type && investsOfType.length > 0 && (
              <button
                type="button"
                className="generic-button"
                onClick={() => {
                  const selectedInv = investPicker.id
                    ? investments.find((i) => i.id === investPicker.id) ?? null
                    : null;
                  onInvestmentSelect({
                    amount: form.amount,
                    existing: selectedInv,
                    type: investPicker.type,
                  });
                }}
              >
                {investPicker.id ? "Pay into this" : "Create new"}&nbsp;
                <i className="fa-solid fa-arrow-right" />
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {isRepayment && repaymentTargets.length > 0 && (
            <OptionField
              name="repaymentFor"
              value={form.repaymentFor}
              onChange={handleChange}
              label="Repayment for"
              options={[
                { value: "", label: "None", dashed: true },
                ...repaymentTargets.map((t) => ({
                  value: t.id,
                  label: t.label,
                })),
              ]}
              invalid={invalidKeys.has("repaymentFor")}
            />
          )}

          <OptionField
            name="paymentMode"
            value={form.paymentMode}
            onChange={handleChange}
            label="Payment mode"
            required
            placeholder=""
            options={paymentModes}
            invalid={invalidKeys.has("paymentMode")}
          />

          {paidByCard && cards.length > 0 && (
            <OptionField
              name="cardId"
              value={form.cardId}
              onChange={handleChange}
              label="Credit card used"
              options={[
                { value: "", label: "None", dashed: true },
                ...cards.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${c.bank})`,
                  bank: c.bank,
                  color: c.color,
                })),
              ]}
              invalid={invalidKeys.has("cardId")}
            />
          )}

          {multiBankEnabled && !paidByCard && accounts.length > 0 && (
            <BankChipSelector
              accounts={accounts}
              value={form.accountId}
              onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
              label={isRepayment ? "Paid from" : "Spent from"}
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
              {existing ? "Update Expense" : "Save Expense"}
            </button>
          </div>
        </>
      )}
    </form>
  );
};

ExpenseForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
  onInvestmentSelect: PropTypes.func,
  investmentTarget: PropTypes.object,
  onChangeInvestmentTarget: PropTypes.func,
  onSubscriptionSelect: PropTypes.func,
  autoVoice: PropTypes.bool,
};

export default memo(ExpenseForm);
