import { memo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import { useDeepLinkNav } from "../hooks/useDeepLinkNav";
import BankChipSelector from "../components/BankChipSelector";
import OptionField from "../components/OptionField";
import DateField from "../components/DateField";
import DayPicker from "./DayPicker";
import {
  BILLING_CYCLES,
  KNOWN_BRANDS,
  matchBrand,
  getCycleInfo,
  applyTypeOrder,
} from "../utils/subscriptionUtils";
import "../styles/subscriptions.css";

const pad = (n) => String(n).padStart(2, "0");

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function ordinalDay(day) {
  const n = parseInt(day);
  if (!n) return "—";
  const v = n % 100;
  const suffix = ["th", "st", "nd", "rd"][v % 10] ?? "th";
  return v >= 11 && v <= 13 ? `${n}th` : `${n}${suffix}`;
}

// The charge day-of-month, derived from an existing subscription's anchor
// date (or today for a new one).
function dayOfMonthFrom(e) {
  if (e?.billingDay) return String(e.billingDay);
  if (e?.anchorDate) {
    const d = new Date(e.anchorDate);
    if (!Number.isNaN(d.getTime())) return String(d.getDate());
  }
  return String(new Date().getDate());
}

// Build a concrete anchorDate (YYYY-MM-DD) from a chosen day-of-month. The
// month/year context is preserved from the existing subscription when editing
// (so changing the day doesn't shift a yearly renewal's month), or taken from
// the current month for a new one. Clamped to the month's length, and built
// as a local date string to avoid timezone off-by-one.
function anchorFromDay(billingDay, existing) {
  const base =
    existing?.anchorDate && !Number.isNaN(new Date(existing.anchorDate).getTime())
      ? new Date(existing.anchorDate)
      : new Date();
  const y = base.getFullYear();
  const m = base.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const day = Math.min(Math.max(parseInt(billingDay) || 1, 1), lastDay);
  return `${y}-${pad(m + 1)}-${pad(day)}`;
}

// The charge weekday (0=Sun..6=Sat) from an existing weekly subscription's
// anchor, or today for a new one.
function weekdayFrom(e) {
  if (e?.anchorDate) {
    const d = new Date(e.anchorDate);
    if (!Number.isNaN(d.getTime())) return String(d.getDay());
  }
  return String(new Date().getDay());
}

// Build an anchorDate (YYYY-MM-DD) landing on the chosen weekday — the next
// occurrence on/after the base date (existing anchor when editing, else today).
// Weekly renewal walks in 7-day steps, so any date on that weekday anchors the
// schedule correctly.
function anchorFromWeekday(weekday, existing) {
  const base =
    existing?.anchorDate && !Number.isNaN(new Date(existing.anchorDate).getTime())
      ? new Date(existing.anchorDate)
      : new Date();
  const target = Math.min(Math.max(parseInt(weekday) || 0, 0), 6);
  const diff = (target - base.getDay() + 7) % 7;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY = {
  name: "",
  brandKey: null,
  amount: "",
  recurring: true,
  cycle: "monthly",
  billingDay: String(new Date().getDate()),
  weekday: String(new Date().getDay()),
  oneTimeDate: todayISO(),
  category: "Entertainment",
  paymentMethod: "bank",
  cardId: "",
  accountId: "",
  status: "active",
  trialEndsOn: "",
  notes: "",
};

function fromExisting(e) {
  return {
    name: e.name ?? "",
    brandKey: e.brandKey ?? null,
    amount: e.amount != null ? String(e.amount) : "",
    recurring: e.recurring !== false,
    cycle: e.cycle ?? "monthly",
    billingDay: dayOfMonthFrom(e),
    weekday: weekdayFrom(e),
    oneTimeDate:
      e.recurring === false && e.anchorDate
        ? String(e.anchorDate).slice(0, 10)
        : todayISO(),
    category: e.category ?? "Entertainment",
    paymentMethod: e.paymentMethod ?? "bank",
    cardId: e.cardId ?? "",
    accountId: e.accountId ?? "",
    status: e.status ?? "active",
    trialEndsOn: e.trialEndsOn ?? "",
    notes: e.notes ?? "",
  };
}

const SubscriptionForm = ({ onSubmit, onCancel, existing, prefill }) => {
  const [form, setForm] = useState(() => {
    if (existing) return fromExisting(existing);
    if (prefill) {
      return {
        ...EMPTY,
        name: prefill.name ?? "",
        amount: prefill.amount ?? "",
      };
    }
    return EMPTY;
  });

  const deepNav = useDeepLinkNav();

  const cards = useSelector(
    (state) => state.transactions.transactionData?.cards ?? [],
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const categories = useSelector(
    (state) =>
      state.transactions.transactionData?.categories?.expense ?? [
        "Entertainment",
      ],
  );
  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.subscriptionTypes ?? [],
  );
  const typeOrder = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.subscriptionTypeOrder ??
      [],
  );

  // Built-ins + user types in the order set on the Preferences → Subscription
  // types screen. No "Custom" pick here — leaving the brand unselected already
  // yields the generic icon, and creating reusable custom types lives in
  // Preferences (reached via the "Add more" chip).
  const brandChips = applyTypeOrder([...KNOWN_BRANDS, ...userTypes], typeOrder);

  const paidByCard = form.paymentMethod === "credit_card";
  const isTrial = form.status === "trial";
  const isRecurring = form.recurring;
  const isWeekly = isRecurring && form.cycle === "weekly";

  // Auto-match a brand from the typed name — but only when a known brand is
  // actually recognised, so it never overrides an explicit "Custom" pick or
  // clears a chosen brand when the name has no match.
  useEffect(() => {
    if (existing) return;
    const key = matchBrand(form.name);
    if (!key) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => (f.brandKey === key ? f : { ...f, brandKey: key }));
  }, [form.name, existing]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({
      ...f,
      [name]: value,
      ...(name === "paymentMethod" && value !== "credit_card"
        ? { cardId: "" }
        : {}),
    }));
  }

  function pickBrand(b) {
    setForm((f) => ({
      ...f,
      brandKey: f.brandKey === b.key ? null : b.key,
      name: f.name || b.label,
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const base = {
      ...form,
      amount: parseFloat(form.amount) || 0,
      recurring: form.recurring,
      // anchorDate stays the canonical field the renewal math reads. Recurring
      // weekly subs derive it from the chosen weekday, monthly+ from the chosen
      // day-of-month; one-time charges use the single chosen date directly.
      anchorDate: !form.recurring
        ? form.oneTimeDate || todayISO()
        : form.cycle === "weekly"
          ? anchorFromWeekday(form.weekday, existing)
          : anchorFromDay(form.billingDay, existing),
    };
    // billingDay / weekday / oneTimeDate are transient form helpers — the saved
    // record carries only the derived anchorDate.
    delete base.billingDay;
    delete base.weekday;
    delete base.oneTimeDate;
    if (!paidByCard || !base.cardId) delete base.cardId;
    if (!base.accountId) delete base.accountId;
    if (base.status !== "trial" || !base.trialEndsOn) delete base.trialEndsOn;
    if (!base.brandKey) base.brandKey = null;
    const sub = existing
      ? { ...existing, ...base }
      : {
          ...base,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
    onSubmit(sub);
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      <div className="sub-brand-block">
        <div className="sub-brand-label-row">Pick a service</div>
        <div className="sub-brand-strip">
          {brandChips.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`sub-brand-chip${form.brandKey === b.key ? " sub-brand-chip--active" : ""}`}
            style={{ "--brand-color": b.color }}
            onClick={() => pickBrand(b)}
          >
            <i className={`${b.iconStyle || "fa-solid"} ${b.icon}`} />
            <span className="sub-brand-chip-label">{b.label}</span>
          </button>
          ))}
          {/* "Add more" — mirrors the investment modal's tile. Type creation
              lives in Preferences; this just navigates there with the
              Subscription Types section auto-opened (via #hash). */}
          <button
            type="button"
            className="sub-brand-chip sub-brand-chip--add-more"
            onClick={() => {
              onCancel();
              setTimeout(
                () => deepNav("/Preferences#subscriptionTypes"),
                200,
              );
            }}
            title="Add more subscription types in Preferences"
          >
            <i className="fa-solid fa-plus" />
            <span className="sub-brand-chip-label">Add more</span>
          </button>
        </div>
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
        <label>Name</label>
      </div>

      <div className="sub-form-row">
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
          <label>Amount (₹)</label>
        </div>
        {isRecurring ? (
          <OptionField
            name="cycle"
            value={form.cycle}
            onChange={handleChange}
            label="Billing cycle"
            options={BILLING_CYCLES.map((c) => ({
              value: c.key,
              label: c.label,
            }))}
          />
        ) : (
          <DateField
            name="oneTimeDate"
            value={form.oneTimeDate}
            onChange={handleChange}
            label="Charge date"
          />
        )}
      </div>

      <label className="sub-recurring-toggle">
        <input
          type="checkbox"
          checked={isRecurring}
          onChange={(e) =>
            setForm((f) => ({ ...f, recurring: e.target.checked }))
          }
        />
        <span className="sub-recurring-text">
          Recurring
          <span className="sub-recurring-sub">
            {isRecurring
              ? "Renews automatically each billing cycle"
              : "One-time charge — won't repeat"}
          </span>
        </span>
      </label>

      {isWeekly && (
        <div className="sub-weekday-block">
          <div className="sub-brand-label-row">Charge weekday</div>
          <div className="sub-weekday-grid">
            {WEEKDAYS_SHORT.map((w, i) => (
              <button
                key={w}
                type="button"
                className={`sub-weekday-btn${parseInt(form.weekday) === i ? " sub-weekday-btn--active" : ""}`}
                onClick={() => setForm((f) => ({ ...f, weekday: String(i) }))}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sub-form-row">
        {isRecurring && !isWeekly && (
          <DayPicker
            label="Charge day"
            value={form.billingDay}
            onChange={(v) => setForm((f) => ({ ...f, billingDay: v }))}
            required
          />
        )}
        <OptionField
          name="category"
          value={form.category}
          onChange={handleChange}
          label="Category"
          options={categories}
        />
      </div>
      <p className="form-field-hint">
        {!isRecurring
          ? `Charged once on ${new Date(`${form.oneTimeDate}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
          : isWeekly
            ? `Charges every ${WEEKDAYS_LONG[parseInt(form.weekday) || 0]}`
            : `Charges on the ${ordinalDay(form.billingDay)} · ${getCycleInfo(form.cycle).label.toLowerCase()}`}
      </p>

      <div className="sub-form-row">
        <OptionField
          name="status"
          value={form.status}
          onChange={handleChange}
          label="Status"
          options={[
            { value: "active", label: "Active" },
            { value: "trial", label: "Free trial" },
            { value: "paused", label: "Paused" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        {isTrial && (
          <DateField
            name="trialEndsOn"
            value={form.trialEndsOn}
            onChange={handleChange}
            label="Trial ends on"
          />
        )}
      </div>

      <div className="sub-form-row">
        <OptionField
          name="paymentMethod"
          value={form.paymentMethod}
          onChange={handleChange}
          label="Payment via"
          options={[
            { value: "bank", label: "Bank / Auto Debit" },
            { value: "credit_card", label: "Credit Card" },
          ]}
        />
        {paidByCard && cards.length > 0 && (
          <OptionField
            name="cardId"
            value={form.cardId}
            onChange={handleChange}
            label="Card"
            placeholder=""
            options={cards.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </div>

      {!paidByCard && multiBankEnabled && accounts.length > 0 && (
        <BankChipSelector
          accounts={accounts}
          value={form.accountId}
          onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
          label="Charged from"
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
          {existing ? "Update" : "Add Subscription"}
        </button>
      </div>
    </form>
  );
};

SubscriptionForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
  prefill: PropTypes.object,
};

export default memo(SubscriptionForm);
