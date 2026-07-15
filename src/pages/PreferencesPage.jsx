import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Modal from "../preStyledElements/modal/Modal";
import { useTheme } from "../hooks/useTheme";
import {
  persistSetPreference,
  persistAddCategory,
  persistRenameCategory,
  persistRemoveCategory,
  persistReorderCategory,
  persistSetList,
  persistAddAutoCategoryRule,
  persistUpdateAutoCategoryRule,
  persistRemoveAutoCategoryRule,
  persistApplyRulesToPast,
  persistAddAccount,
  persistDeleteAccount,
  persistUpdateAccount,
  persistSetOpeningBalance,
  persistVerifyAccountBalance,
  persistResetOpeningBalance,
  persistBulkTagAccounts,
  persistUpdateMerchantAlias,
  persistRemoveMerchantAlias,
} from "../redux/slices/transactionSlice";
import MultiBankMigration from "../components/MultiBankMigration";
import BankLogo from "../components/BankLogo";
import AutoCapturePanel from "../components/AutoCapturePanel";
import InvestmentTypesPanel from "../components/InvestmentTypesPanel";
import SubscriptionTypesPanel from "../components/SubscriptionTypesPanel";
import NotificationsPanel from "../components/NotificationsPanel";
import PagesPanel from "../components/PagesPanel";
import BackupPanel from "../components/BackupPanel";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";
import { getPage } from "../utils/pages";
import {
  BANKS,
  CATEGORIES,
  DEFAULT_DUE_WINDOWS,
  DEFAULT_HEALTH_SCORE,
  INCOME_CATEGORIES,
  PAYMENT_MODES,
} from "../utils/constants";
import { matchAutoCategory } from "../utils/autoCategory";
import {
  computeAccountBalance,
  getReconciliationDelta,
} from "../utils/accountUtils";
import { INCOME_TYPES } from "../utils/incomeUtils";

const INR0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const SCOPES = [
  { key: "expense", label: "Expense" },
  { key: "income", label: "Income" },
];

// The category zones the Preferences sections are grouped under, in order.
const PREF_CATEGORIES = [
  { key: "general", label: "General", icon: "fa-sliders" },
  { key: "transactions", label: "Transactions & data", icon: "fa-list-ul" },
  { key: "pages", label: "Page settings", icon: "fa-layer-group" },
];

// Metadata for every section: which zone it lives in, an optional page it
// tunes (drives the page chip), the title, and search keywords. The render
// order below must keep sections grouped by category for the headings to read
// correctly — it already does.
const SECTION_META = {
  pages: {
    cat: "pages",
    title: "Pages",
    kw: "pages enable disable navigation nav menu hide show layout",
  },
  appearance: {
    cat: "general",
    title: "Appearance",
    kw: "theme dark light glass classic skin colour color appearance display field style chips dropdown one tap pick quick clicks pills",
  },
  voice: { cat: "general", title: "Voice add", kw: "voice microphone speech add dictate" },
  autoCapture: {
    cat: "transactions",
    title: "Auto-capture",
    kw: "auto capture read sms email alert bank upi automatic inbox parse gmail",
  },
  privacy: { cat: "general", title: "Privacy mode", kw: "privacy blur hide amounts incognito" },
  notifications: {
    cat: "general",
    title: "Notifications",
    kw: "notifications reminders alerts bell due card emi sip subscription renewal trial reminder surprises",
  },
  backup: {
    cat: "general",
    title: "Backup & restore",
    kw: "backup restore drive export data recovery snapshot save copy revert",
  },
  categories: {
    cat: "transactions",
    title: "Categories",
    kw: "categories expense income tags labels",
  },
  income: {
    cat: "transactions",
    title: "Income",
    kw: "income salary business monthly baseline refund reimbursement exclude cash flow coverage source type earnings",
  },
  paymentModes: {
    cat: "transactions",
    title: "Payment modes",
    kw: "payment modes cash upi debit credit card methods",
  },
  banks: { cat: "transactions", title: "Banks", kw: "banks accounts lenders" },
  multibank: {
    cat: "transactions",
    title: "Multi-bank tracking",
    kw: "multi bank accounts balance per account split",
  },
  entryTabs: {
    cat: "transactions",
    title: "Entry type tabs",
    kw: "entry type tabs expense investment subscription switch modal kind segment pick category",
  },
  tally: {
    cat: "transactions",
    title: "Toolbox",
    kw: "toolkit tally add up sum total calculator amounts tap select notes note memo checklist reminder jot calendar agenda month due dates upcoming schedule",
  },
  stmtImport: {
    cat: "transactions",
    title: "Statement import",
    kw: "statement import csv pdf excel xlsx bank merchant parse upload",
  },
  rules: {
    cat: "transactions",
    title: "Auto-categorize rules",
    kw: "auto categorize rules merchant pattern match",
  },
  solvency: {
    cat: "pages",
    page: "solvency",
    title: "Solvency tuning",
    kw: "solvency due overdue emi card window obligations dues health",
  },
  investmentTypes: {
    cat: "pages",
    page: "investments",
    title: "Investment types",
    kw: "investment types sip stock mutual fund fd ppf nps",
  },
  subscriptionTypes: {
    cat: "pages",
    page: "subscriptions",
    title: "Subscription types",
    kw: "subscription types netflix spotify brand recurring",
  },
  benchmarks: {
    cat: "pages",
    page: "investments",
    title: "Investment benchmarks",
    kw: "benchmark fd inflation rate portfolio pulse returns",
  },
};

const COLLAPSE_TRANSITION = {
  duration: 0.25,
  ease: [0.25, 0.46, 0.45, 0.94],
};

// A cash-in-hand account. Not a real bank, so it never enters the Banks list
// (or the Add-Card dropdown) — it's only trackable as a multi-bank account.
const CASH_ACCOUNT = "Cash";

const MultiBankAccountList = memo(function MultiBankAccountList({
  banks,
  accounts,
  transactions,
  onAdd,
  onEdit,
  onRemove,
  onManageBanks,
}) {
  const tracked = new Set(accounts.map((a) => a.bank));
  const available = banks.filter((b) => !tracked.has(b));
  // Cash isn't a bank (so it stays out of the Banks list / Add-Card dropdown),
  // but it can be tracked as an account like any other. Offer it once.
  const canAddCash = !tracked.has(CASH_ACCOUNT);

  return (
    <div className="pref-multibank">
      {accounts.length === 0 ? (
        <p className="pref-cat-empty">
          No accounts yet. Pick a bank below to start tracking it.
        </p>
      ) : (
        <ul className="pref-multibank-list">
          {accounts.map((a) => (
            <BankAccountRow
              key={a.id}
              account={a}
              transactions={transactions}
              onEdit={onEdit}
              onRemove={() => onRemove(a.id)}
            />
          ))}
        </ul>
      )}

      {(available.length > 0 || canAddCash) && (
        <>
          <p className="pref-section-hint pref-multibank-hint">
            Add an account
          </p>
          <div className="pref-multibank-chips">
            {canAddCash && (
              <button
                type="button"
                className="pref-multibank-chip pref-multibank-chip--cash"
                onClick={() => onAdd(CASH_ACCOUNT)}
              >
                <i className="fa-solid fa-wallet" /> {CASH_ACCOUNT}
              </button>
            )}
            {available.map((b) => (
              <button
                key={b}
                type="button"
                className="pref-multibank-chip"
                onClick={() => onAdd(b)}
              >
                <i className="fa-solid fa-plus" /> {b}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        className="pref-multibank-manage-banks"
        onClick={onManageBanks}
      >
        <i className="fa-solid fa-circle-info" />
        {available.length > 0
          ? "Don't see your bank? Add it in Banks"
          : "Need another bank? Add it in Banks"}
      </button>
    </div>
  );
});

MultiBankAccountList.propTypes = {
  banks: PropTypes.arrayOf(PropTypes.string).isRequired,
  accounts: PropTypes.array.isRequired,
  transactions: PropTypes.array.isRequired,
  onAdd: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onManageBanks: PropTypes.func.isRequired,
};

const BankAccountRow = memo(function BankAccountRow({
  account,
  transactions,
  onEdit,
  onRemove,
}) {
  const live = computeAccountBalance(account, transactions);
  // Same reconciliation source of truth as the balance carousel: drift is the
  // computed balance vs the user-verified balance (verifiedBalance/verifiedAt),
  // NOT the opening balance. This keeps both screens in agreement.
  const recon = getReconciliationDelta(account, transactions);
  const drift = recon ? recon.delta : 0;
  const driftMatters = recon != null && Math.abs(drift) > 100;
  const verifiedDate = recon
    ? new Date(recon.verifiedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <li className="pref-multibank-row">
      <BankLogo bank={account.bank} color={account.color} size={26} />
      <div className="pref-multibank-meta">
        <span className="pref-multibank-name">{account.bank}</span>
        <span className="pref-multibank-balance-live">
          {INR0.format(live)}
          {recon && driftMatters && (
            <span
              className={`pref-multibank-drift${
                drift < 0
                  ? " pref-multibank-drift--down"
                  : " pref-multibank-drift--up"
              }`}
              title={`Verified ${INR0.format(recon.verifiedBalance)} on ${verifiedDate}; computed balance is ${INR0.format(recon.computed)}.`}
            >
              <i className="fa-solid fa-triangle-exclamation" />
              {drift > 0 ? "+" : "−"}
              {INR0.format(Math.abs(drift))} drift
            </span>
          )}
          {recon && !driftMatters && (
            <span className="pref-multibank-drift pref-multibank-drift--ok">
              <i className="fa-solid fa-circle-check" /> Verified {verifiedDate}
            </span>
          )}
          {!recon && (
            <span className="pref-multibank-drift pref-multibank-drift--unset">
              Not verified
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        className="pref-cat-btn"
        onClick={() => onEdit(account)}
        aria-label={`Edit ${account.bank}`}
        title={`Edit ${account.bank}`}
      >
        <i className="fa-solid fa-pen" />
      </button>
      <button
        type="button"
        className="pref-cat-btn pref-cat-btn--danger"
        onClick={onRemove}
        aria-label={`Remove ${account.bank}`}
        title={`Remove ${account.bank}`}
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </li>
  );
});

BankAccountRow.propTypes = {
  account: PropTypes.shape({
    id: PropTypes.string.isRequired,
    bank: PropTypes.string.isRequired,
    color: PropTypes.string,
    verifiedBalance: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    verifiedAt: PropTypes.string,
    createdAt: PropTypes.string,
  }).isRequired,
  transactions: PropTypes.array.isRequired,
  onEdit: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

function randomBankColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 25);
  const l = 42 + Math.floor(Math.random() * 18);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

const BankAccountModal = ({
  bank,
  account,
  transactions,
  onSave,
  onReset,
  onClose,
}) => {
  const isEdit = !!account;
  // Computed balance from the ledger — what we reconcile the user's figure
  // against (edit mode only; a new account has no transactions yet).
  const computed = useMemo(
    () => (account ? computeAccountBalance(account, transactions) : 0),
    [account, transactions],
  );
  // Standing reconciliation drift (computed vs last verified) — surfaces the
  // "reset opening balance" repair when the opening entry looks wrong.
  const recon = useMemo(
    () => (account ? getReconciliationDelta(account, transactions) : null),
    [account, transactions],
  );
  const hasDrift = recon != null && Math.abs(recon.delta) > 100;
  const [balance, setBalance] = useState(
    isEdit
      ? String(account.verifiedBalance ?? computed.toFixed(2))
      : "",
  );
  const [color, setColor] = useState(() => account?.color || randomBankColor());
  const [confirming, setConfirming] = useState(false);

  const parsed = parseFloat(balance);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const value = valid ? parsed : 0;
  const drift = isEdit && valid ? computed - parsed : 0;

  // ── Confirmation step: nothing is saved/verified until the user confirms ──
  if (confirming) {
    return (
      <div className="bank-account-modal bank-account-confirm">
        <div className="bank-account-modal-bank">
          <BankLogo bank={bank} color={color} size={28} />
          <span className="bank-account-modal-bank-name">{bank}</span>
        </div>
        <p className="bank-account-confirm-msg">
          <i className="fa-solid fa-circle-question" />{" "}
          {isEdit ? (
            <>
              Mark <strong>{bank}</strong>&apos;s verified balance as{" "}
              <strong>{INR0.format(value)}</strong> as of today? This records a
              reconciliation checkpoint — it won&apos;t change any of your
              transactions.
            </>
          ) : (
            <>
              Start tracking <strong>{bank}</strong> with a balance of{" "}
              <strong>{INR0.format(value)}</strong>?
            </>
          )}
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="cancel-button"
            onClick={() => setConfirming(false)}
          >
            Back
          </button>
          <button
            type="button"
            className="generic-button"
            onClick={() => onSave({ color, balance: value })}
          >
            <i className="fa-solid fa-circle-check" /> Confirm
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bank-account-modal">
      <div className="bank-account-modal-bank">
        <BankLogo bank={bank} color={color} size={28} />
        <span className="bank-account-modal-bank-name">{bank}</span>
      </div>

      <div className="field">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          placeholder=" "
          autoFocus
        />
        <label>{isEdit ? "Actual balance (₹)" : "Starting balance (₹)"}</label>
      </div>

      {isEdit && valid && (
        <p
          className={`bank-account-drift-preview${
            Math.abs(drift) > 100
              ? " bank-account-drift-preview--drift"
              : " bank-account-drift-preview--ok"
          }`}
        >
          {Math.abs(drift) <= 0.5 ? (
            <>
              <i className="fa-solid fa-circle-check" /> Matches your computed
              balance exactly.
            </>
          ) : (
            <>
              <i className="fa-solid fa-scale-unbalanced" /> We computed{" "}
              <strong>{INR0.format(computed)}</strong> — drift of{" "}
              <strong>
                {drift > 0 ? "+" : "−"}
                {INR0.format(Math.abs(drift))}
              </strong>
              {drift > 0
                ? " (possible phantom / duplicate entries)"
                : " (you may be missing transactions)"}
              .
            </>
          )}
        </p>
      )}

      <div className="bank-account-color-field">
        <span className="bank-account-color-label">Account colour</span>
        <div className="bank-account-color-random">
          <div
            className="bank-account-color-preview"
            style={{ background: color }}
          />
          <button
            type="button"
            className="bank-account-color-regenerate"
            onClick={() => setColor(randomBankColor())}
          >
            <i className="fa-solid fa-shuffle" />
            New colour
          </button>
        </div>
      </div>

      {isEdit && hasDrift && (
        <div className="bank-account-reset">
          <p className="bank-account-reset-info">
            <i className="fa-solid fa-wrench" /> Computed balance is off from your
            last verified balance by{" "}
            <strong>
              {recon.delta > 0 ? "+" : "−"}
              {INR0.format(Math.abs(recon.delta))}
            </strong>
            . If that drift came from an incorrectly-entered balance (not missing
            transactions), reset the opening balance to clear it.
          </p>
          <button
            type="button"
            className="bank-account-reset-btn"
            onClick={() => onReset(account)}
          >
            <i className="fa-solid fa-rotate-left" /> Reset opening balance
          </button>
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="generic-button"
          disabled={!valid}
          onClick={() => setConfirming(true)}
        >
          {isEdit ? "Verify balance" : "Add account"}
        </button>
      </div>
    </div>
  );
};

BankAccountModal.propTypes = {
  bank: PropTypes.string.isRequired,
  account: PropTypes.object,
  transactions: PropTypes.array,
  onSave: PropTypes.func.isRequired,
  onReset: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};

const PrefSection = memo(function PrefSection({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
  pageTag,
  visible = true,
  highlighted = false,
}) {
  if (!visible) return null;
  return (
    <section
      id={`pref-section-${id}`}
      className={`pref-section${expanded ? " pref-section--open" : ""}${
        highlighted ? " pref-section--highlight" : ""
      }`}
    >
      <button
        type="button"
        className="pref-section-header"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        <span className="pref-section-header-text">
          <span className="pref-section-title-row">
            <span className="pref-section-title">{title}</span>
            {pageTag && (
              <span className="pref-page-chip">
                <i className={`fa-solid ${pageTag.icon}`} />
                {pageTag.label}
              </span>
            )}
          </span>
          {summary && (
            <span className="pref-section-summary">{summary}</span>
          )}
        </span>
        <i
          className={`fa-solid fa-chevron-down pref-section-chevron${expanded ? " pref-section-chevron--open" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={COLLAPSE_TRANSITION}
            style={{ overflow: "hidden" }}
          >
            <div className="pref-section-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
});

function ZoneHeading({ icon, label }) {
  return (
    <div className="pref-zone-heading">
      <i className={`fa-solid ${icon}`} />
      <span>{label}</span>
    </div>
  );
}
ZoneHeading.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
};

// ── MerchantMemoryPanel ────────────────────────────────
//
// Lists the learned merchant aliases — each row shows the canonical
// merchant fingerprint and what we'll auto-categorise it as next time.
// The user can change type+category inline (immediate persist), or
// forget a row. Sorted by most-recently-seen so the actively-used
// rules sit at the top.
//
// Auto-categorisation happens silently during import; this panel is
// the explainability surface that makes the "magic" inspectable +
// editable. Without it the aliases would feel like a black box.

const MerchantMemoryPanel = memo(function MerchantMemoryPanel({
  aliases,
  onUpdate,
  onRemove,
}) {
  const sorted = [...(aliases ?? [])].sort((a, b) => {
    const aTime = a.lastSeen || a.createdAt || "";
    const bTime = b.lastSeen || b.createdAt || "";
    return bTime.localeCompare(aTime);
  });

  if (sorted.length === 0) {
    return (
      <div className="pref-merchant-mem-empty">
        <p>
          As you import statements, the app remembers how you categorise each
          merchant and uses that to pre-classify future imports.
        </p>
      </div>
    );
  }

  return (
    <div className="pref-merchant-mem">
      <p className="pref-section-hint">
        Memory of how you categorise each merchant. Edit the type or category
        if you change your mind — your next import will follow the new
        rule.
      </p>
      <ul className="pref-merchant-mem-list">
        {sorted.map((a) => (
          <MerchantAliasRow
            key={a.key}
            alias={a}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </div>
  );
});

const MerchantAliasRow = memo(function MerchantAliasRow({
  alias,
  onUpdate,
  onRemove,
}) {
  const typeOptions = [
    { value: "expense", label: "Expense" },
    { value: "income", label: "Income" },
    { value: "investment", label: "Investment" },
  ];
  const catOptions =
    alias.transactionType === "income"
      ? INCOME_CATEGORIES
      : alias.transactionType === "investment"
        ? ["Investment"]
        : CATEGORIES;

  function changeType(nextType) {
    const opts =
      nextType === "income"
        ? INCOME_CATEGORIES
        : nextType === "investment"
          ? ["Investment"]
          : CATEGORIES;
    onUpdate({
      ...alias,
      transactionType: nextType,
      category: opts.includes(alias.category) ? alias.category : opts[0],
    });
  }

  return (
    <li className="pref-merchant-mem-row">
      <div className="pref-merchant-mem-main">
        <span className="pref-merchant-mem-pattern">{alias.pattern}</span>
        <span className="pref-merchant-mem-meta">
          Seen {alias.hits ?? 1}× ·{" "}
          {alias.lastSeen
            ? new Date(alias.lastSeen).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "—"}
        </span>
      </div>
      <select
        className="pref-merchant-mem-select"
        value={alias.transactionType}
        onChange={(e) => changeType(e.target.value)}
      >
        {typeOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        className="pref-merchant-mem-select"
        value={alias.category}
        onChange={(e) => onUpdate({ ...alias, category: e.target.value })}
      >
        {catOptions.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button
        type="button"
        className="pref-cat-btn pref-cat-btn--danger"
        onClick={() => onRemove(alias.key)}
        aria-label={`Forget ${alias.pattern}`}
        title="Forget this merchant"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </li>
  );
});

const CategoryRow = memo(function CategoryRow({
  name,
  isDragging,
  yOffset,
  onDragStart,
  onRename,
  onRemove,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function startEdit() {
    setDraft(name);
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    onRename(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="pref-cat-row pref-cat-row--editing">
        <input
          className="pref-cat-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button
          type="button"
          className="pref-cat-btn pref-cat-btn--save"
          onClick={commit}
          aria-label="Save"
        >
          <i className="fa-solid fa-check" />
        </button>
        <button
          type="button"
          className="pref-cat-btn"
          onClick={() => setEditing(false)}
          aria-label="Cancel"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
    );
  }

  // Inline transform drives both the dragged card (follows pointer) and
  // every other card that needs to shift out of its way.
  const style = yOffset ? { transform: `translateY(${yOffset}px)` } : undefined;

  return (
    <div
      className={`pref-cat-row${isDragging ? " pref-cat-row--dragging" : ""}`}
      style={style}
      data-cat-row
      data-name={name}
    >
      <button
        type="button"
        className="pref-cat-handle"
        onPointerDown={onDragStart}
        aria-label={`Drag ${name} to reorder`}
      >
        <span className="pref-cat-handle-stack" aria-hidden="true">
          <i className="fa-solid fa-chevron-up" />
          <i className="fa-solid fa-chevron-down" />
        </span>
      </button>
      <span className="pref-cat-name">{name}</span>
      <button
        type="button"
        className="pref-cat-btn"
        onClick={startEdit}
        aria-label={`Rename ${name}`}
      >
        <i className="fa-solid fa-pen" />
      </button>
      <button
        type="button"
        className="pref-cat-btn pref-cat-btn--danger"
        onClick={onRemove}
        aria-label={`Delete ${name}`}
      >
        <i className="fa-solid fa-trash-can" />
      </button>
    </div>
  );
});

const PreferencesPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const isAdmin = useSelector((state) => state.access.isAdmin);
  const [theme, toggleTheme, skin, setSkin] = useTheme();

  // Browser history is usually populated by react-router pushes. If the
  // user hit Preferences as the very first page (deep-link), fall back to
  // the default route instead of trying to go back to nowhere.
  function handleBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/Transactions", { replace: true });
  }

  const fdRate = useSelector(
    (state) => state.transactions.transactionData?.preferences?.fdRate ?? 7,
  );
  const inflationRate = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.inflationRate ?? 6,
  );
  const categoryMap = useSelector(
    (state) =>
      state.transactions.transactionData?.categories ?? {
        expense: CATEGORIES,
        income: INCOME_CATEGORIES,
      },
  );
  const paymentModes = useSelector(
    (state) =>
      state.transactions.transactionData?.lists?.paymentModes ?? PAYMENT_MODES,
  );
  const banks = useSelector(
    (state) => state.transactions.transactionData?.lists?.banks ?? BANKS,
  );
  const autoCategoryRules = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.autoCategoryRules ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const voiceEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.voiceAddEnabled ??
      false,
  );
  const privacyMode = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.privacyMode ?? false,
  );
  const quickSelect = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.quickSelect ?? false,
  );
  const notificationsEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.notificationsEnabled ??
      true,
  );
  const notificationTypes = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.notificationTypes ?? {},
  );
  const healthScore = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.healthScore ??
      DEFAULT_HEALTH_SCORE,
  );
  const dueWindows = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.dueWindows ??
      DEFAULT_DUE_WINDOWS,
  );
  const incomeType = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.incomeType ?? "auto",
  );
  const incomeExcludeCategories = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.incomeExcludeCategories ?? [],
  );
  const incomeCategories = useSelector(
    (state) =>
      state.transactions.transactionData?.categories?.income ??
      INCOME_CATEGORIES,
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
  const tallyEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.tallyEnabled ?? true,
  );
  const notesEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.notesEnabled ?? true,
  );
  const calendarEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.calendarEnabled ?? true,
  );
  const statementImportEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.statementImportEnabled ??
      false,
  );
  const merchantAliases = useSelector(
    (state) => state.transactions.transactionData?.merchantAliases ?? [],
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const autoReadInboxCount = useSelector(
    (state) => (state.transactions.transactionData?.autoReadInbox ?? []).length,
  );
  const enabledInvestmentTypes = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.enabledInvestmentTypes ?? [],
  );
  const subscriptionTypeCount = useSelector(
    (state) =>
      (state.transactions.transactionData?.subscriptionTypes ?? []).length,
  );
  const untaggedCount = useMemo(
    () =>
      allTransactions.filter(
        (t) =>
          !t.accountId &&
          !t.cardId &&
          t.transactionType !== "self_transfer",
      ).length,
    [allTransactions],
  );
  const [migrationOpen, setMigrationOpen] = useState(false);

  const [fdDraft, setFdDraft] = useState(String(fdRate));
  const [inflDraft, setInflDraft] = useState(String(inflationRate));
  const [scope, setScope] = useState("expense");
  const [newCat, setNewCat] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [newPayMode, setNewPayMode] = useState("");
  const [editingPayMode, setEditingPayMode] = useState(null); // { idx, draft }
  const [newBank, setNewBank] = useState("");
  const [editingBank, setEditingBank] = useState(null); // { idx, draft }
  const [newRule, setNewRule] = useState({
    scope: "expense",
    pattern: "",
    category: "",
  });
  // Collapsed by default — user expands what they need. On mount, if the
  // URL carries a #section-id hash (e.g., /Preferences#investmentTypes from
  // the "+ Add more" tile in the Add Investment form), pre-open that
  // section and scroll it into view.
  const [openSections, setOpenSections] = useState(() => {
    const hash = window.location.hash.replace(/^#/, "");
    return hash ? new Set([hash]) : new Set();
  });

  // Category zone filter + live search across all sections.
  const [activeCat, setActiveCat] = useState(() => {
    const hash = window.location.hash.replace(/^#/, "");
    return SECTION_META[hash]?.cat ?? "all";
  });
  const [query, setQuery] = useState("");
  const [highlightSection, setHighlightSection] = useState(null);
  const [bankModal, setBankModal] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);

  useLayoutEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const el = document.getElementById(`pref-section-${hash}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function toggleSection(id) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const isOpen = (id) => openSections.has(id);

  function revealSection(id) {
    const meta = SECTION_META[id];
    if (meta && activeCat !== "all" && meta.cat !== activeCat) {
      setActiveCat(meta.cat);
    }
    setQuery("");
    setOpenSections((prev) => new Set(prev).add(id));
    setHighlightSection(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`pref-section-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.setTimeout(() => {
      setHighlightSection((cur) => (cur === id ? null : cur));
    }, 1800);
  }

  function handleSaveBankAccount({ color, balance }) {
    if (!bankModal) return;
    const asOf = new Date().toISOString();
    if (bankModal.mode === "add") {
      // New account: seed the ledger's starting balance (an opening entry), and
      // mark it verified as of now so the balance carousel and this screen agree
      // and start drift-free.
      const id = crypto.randomUUID();
      dispatch(
        persistAddAccount({ id, bank: bankModal.bank, color, createdAt: asOf }),
      );
      dispatch(persistSetOpeningBalance({ accountId: id, amount: balance }));
      dispatch(persistVerifyAccountBalance({ id, balance, asOf }));
    } else {
      // Existing account: this is a reconciliation, NOT a rewrite of the opening
      // balance. Record verifiedBalance/verifiedAt (same source of truth as the
      // carousel) so we never back-date the ledger and skew the computed total.
      dispatch(persistUpdateAccount({ ...bankModal.account, color }));
      dispatch(
        persistVerifyAccountBalance({
          id: bankModal.account.id,
          balance,
          asOf,
        }),
      );
    }
    setBankModal(null);
  }

  // A section is visible when it matches the active zone tab AND the search
  // query (every typed token must appear in the section's title or keywords).
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  function sectionVisible(id) {
    const meta = SECTION_META[id];
    if (!meta) return true;
    if (activeCat !== "all" && meta.cat !== activeCat) return false;
    if (tokens.length === 0) return true;
    const hay = `${meta.title} ${meta.kw}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }
  // Whether a category has at least one visible section right now (drives the
  // zone heading + the "no results" empty state).
  function catHasVisible(cat) {
    return Object.keys(SECTION_META).some(
      (id) => SECTION_META[id].cat === cat && sectionVisible(id),
    );
  }
  const anyVisible = PREF_CATEGORIES.some((c) => catHasVisible(c.key));
  // The page chip (icon + label) for a page-settings section, if any.
  const pageTagFor = (id) => {
    const pageKey = SECTION_META[id]?.page;
    if (!pageKey) return undefined;
    const page = getPage(pageKey);
    return page ? { label: page.label, icon: page.icon } : undefined;
  };

  // Drag state.
  //   fromIndex     – original slot of the card being dragged
  //   toIndex       – slot where it would land if released right now
  //   startY        – pointer Y when the drag started
  //   pointerY      – pointer Y right now
  //   originalRects – every card's rect captured at drag start
  //   rowHeight     – distance between successive card tops (row + gap)
  const [drag, setDrag] = useState(null);
  const listRef = useRef(null);

  // FLIP — only fires when not actively dragging. During drag the inline
  // transforms do the work; on release (and on add/remove/rename) FLIP catches
  // any residual position change and animates it smoothly.
  const prevRectsRef = useRef(new Map());
  useLayoutEffect(() => {
    const rows = listRef.current?.querySelectorAll("[data-cat-row]");
    if (!rows) return;
    const dragging = drag !== null;
    rows.forEach((row) => {
      const name = row.getAttribute("data-name");
      if (!name) return;
      const curr = row.getBoundingClientRect();
      const prev = prevRectsRef.current.get(name);
      if (prev && !dragging) {
        const dy = prev.top - curr.top;
        if (Math.abs(dy) > 0.5) {
          row.style.transition = "none";
          row.style.transform = `translateY(${dy}px)`;
          void row.offsetHeight;
          row.style.transition = "";
          row.style.transform = "translateY(0)";
        }
      }
      prevRectsRef.current.set(name, curr);
    });
  });

  function commitRate(key, raw) {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    dispatch(persistSetPreference(key, parsed));
  }

  function handleAddCategory(e) {
    e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    if (categoryMap[scope]?.includes(name)) {
      setNewCat("");
      return;
    }
    dispatch(persistAddCategory(scope, name));
    setNewCat("");
  }

  function handleRemove(name) {
    setDeleteTarget({ kind: "category", scope, name });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "category") {
      dispatch(persistRemoveCategory(deleteTarget.scope, deleteTarget.name));
    } else if (deleteTarget.kind === "paymentMode") {
      dispatch(
        persistSetList(
          "paymentModes",
          paymentModes.filter((p) => p !== deleteTarget.name),
        ),
      );
    } else if (deleteTarget.kind === "bank") {
      dispatch(
        persistSetList(
          "banks",
          banks.filter((b) => b !== deleteTarget.name),
        ),
      );
    } else if (deleteTarget.kind === "rule") {
      dispatch(persistRemoveAutoCategoryRule(deleteTarget.id));
    } else if (deleteTarget.kind === "account") {
      dispatch(persistDeleteAccount(deleteTarget.id));
    }
    setDeleteTarget(null);
  }

  function handleRemoveAccount(id) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    const txCount = allTransactions.filter(
      (t) =>
        t.openingForAccount !== id &&
        (t.accountId === id || t.fromAccountId === id || t.toAccountId === id),
    ).length;
    if (txCount > 0) {
      setDeleteTarget({ kind: "account", id, name: acc.bank, count: txCount });
    } else {
      dispatch(persistDeleteAccount(id));
    }
  }

  const deleteCopy = deleteTarget
    ? {
        category: {
          title: `Delete ${deleteTarget.scope} category?`,
          hint:
            "Existing transactions keep this label; it just won't appear in the dropdown anymore.",
        },
        paymentMode: {
          title: "Delete payment mode?",
          hint:
            "Past transactions keep this label; it just won't appear in the dropdown anymore.",
        },
        bank: {
          title: "Delete bank?",
          hint:
            "Existing cards keep this bank name; it just won't appear in the Add Card dropdown.",
        },
        rule: {
          title: "Delete auto-category rule?",
          hint: "Future transactions won't be auto-categorised by this rule.",
        },
        account: {
          title: "Delete bank account?",
          hint: `${deleteTarget.count} tagged transaction${
            deleteTarget.count === 1 ? "" : "s"
          } will be kept but untagged (moved to “All”). This bank's current-balance entry will be removed.`,
        },
      }[deleteTarget.kind]
    : null;

  // ── Payment modes ──────────────────────────────────────
  function addPaymentMode(e) {
    e.preventDefault();
    const name = newPayMode.trim();
    if (!name || paymentModes.includes(name)) {
      setNewPayMode("");
      return;
    }
    dispatch(persistSetList("paymentModes", [...paymentModes, name]));
    setNewPayMode("");
  }

  function removePaymentMode(name) {
    setDeleteTarget({ kind: "paymentMode", name });
  }

  function removeRule(rule) {
    setDeleteTarget({
      kind: "rule",
      id: rule.id,
      label: `"${rule.pattern}" → ${rule.category || "—"}`,
    });
  }

  // ── Banks ──────────────────────────────────────────────
  function addBank(e) {
    e.preventDefault();
    const name = newBank.trim();
    if (!name || banks.includes(name)) {
      setNewBank("");
      return;
    }
    dispatch(persistSetList("banks", [...banks, name]));
    setNewBank("");
  }

  function removeBank(name) {
    setDeleteTarget({ kind: "bank", name });
  }

  function commitBankEdit() {
    if (!editingBank) return;
    const { idx, draft } = editingBank;
    const next = draft.trim();
    if (!next || next === banks[idx] || banks.includes(next)) {
      setEditingBank(null);
      return;
    }
    const updated = [...banks];
    updated[idx] = next;
    dispatch(persistSetList("banks", updated));
    setEditingBank(null);
  }

  // ── Health score + Due windows ─────────────────────────
  function updateHealthScore(patch) {
    dispatch(
      persistSetPreference("healthScore", { ...healthScore, ...patch }),
    );
  }
  function updateDueWindows(patch) {
    dispatch(
      persistSetPreference("dueWindows", { ...dueWindows, ...patch }),
    );
  }

  // Count of past transactions that *would* match each rule. Memoised so we
  // don't iterate the whole transaction list once per rule render.
  const ruleMatchCounts = useMemo(() => {
    const map = new Map();
    for (const rule of autoCategoryRules) map.set(rule.id, 0);
    for (const tx of allTransactions) {
      const scope =
        tx.transactionType === "income"
          ? "income"
          : tx.transactionType === "expense"
            ? "expense"
            : null;
      if (!scope) continue;
      const matched = matchAutoCategory(
        tx.name,
        scope,
        autoCategoryRules,
      );
      if (!matched) continue;
      // matchAutoCategory returns the matched category — find the rule.
      const rule = autoCategoryRules.find(
        (r) =>
          r.scope === scope &&
          (tx.name ?? "")
            .toLowerCase()
            .trim()
            .includes((r.pattern ?? "").toLowerCase().trim()),
      );
      if (rule) map.set(rule.id, (map.get(rule.id) ?? 0) + 1);
    }
    return map;
  }, [autoCategoryRules, allTransactions]);

  function handleApplyToPast() {
    dispatch(persistApplyRulesToPast());
  }

  function commitPayModeEdit() {
    if (!editingPayMode) return;
    const { idx, draft } = editingPayMode;
    const next = draft.trim();
    if (!next || next === paymentModes[idx]) {
      setEditingPayMode(null);
      return;
    }
    if (paymentModes.includes(next)) {
      setEditingPayMode(null);
      return;
    }
    const updated = [...paymentModes];
    updated[idx] = next;
    dispatch(persistSetList("paymentModes", updated));
    setEditingPayMode(null);
  }

  // ── Auto-category rules ────────────────────────────────
  function addRule(e) {
    e.preventDefault();
    const pattern = newRule.pattern.trim();
    const category = newRule.category;
    if (!pattern || !category) return;
    dispatch(
      persistAddAutoCategoryRule({
        id: crypto.randomUUID(),
        scope: newRule.scope,
        pattern,
        category,
      }),
    );
    setNewRule({ scope: newRule.scope, pattern: "", category: "" });
  }

  const ruleCategoriesFor = (s) => categoryMap[s] ?? [];

  const list = categoryMap[scope] ?? [];

  function handleDragStart(e, idx, target) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    // Locate the list container via closest() so the same handler serves
    // any sortable list — each one just wraps its rows in
    // [data-pref-drag-list].
    const container = e.currentTarget.closest("[data-pref-drag-list]");
    const rows = container?.querySelectorAll("[data-cat-row]");
    const originalRects = [];
    if (rows) {
      rows.forEach((row) => {
        const r = row.getBoundingClientRect();
        originalRects.push({ top: r.top, bottom: r.bottom, height: r.height });
      });
    }
    const rowHeight =
      originalRects.length > 1
        ? originalRects[1].top - originalRects[0].top
        : (originalRects[0]?.height ?? 0) + 6;

    setDrag({
      target,
      fromIndex: idx,
      toIndex: idx,
      startY: e.clientY,
      pointerY: e.clientY,
      pointerId: e.pointerId,
      originalRects,
      rowHeight,
    });
  }

  function handleDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;

    // Use the rects captured at drag start so midpoint detection isn't
    // confused by the same transforms we're applying to shift cards aside.
    let newIdx = drag.originalRects.length - 1;
    for (let i = 0; i < drag.originalRects.length; i++) {
      const r = drag.originalRects[i];
      const mid = (r.top + r.bottom) / 2;
      if (e.clientY < mid) {
        newIdx = i;
        break;
      }
    }

    if (newIdx !== drag.toIndex || e.clientY !== drag.pointerY) {
      setDrag((d) => ({ ...d, toIndex: newIdx, pointerY: e.clientY }));
    }
  }

  function handleDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { fromIndex, toIndex, target } = drag;
    if (fromIndex !== toIndex) {
      if (target === "category") {
        dispatch(persistReorderCategory(scope, fromIndex, toIndex));
      } else if (target === "paymentMode") {
        // No dedicated reorder thunk — payment modes are a simple string
        // list, so we rewrite the whole list via persistSetList.
        const reordered = [...paymentModes];
        const [moved] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, moved);
        dispatch(persistSetList("paymentModes", reordered));
      } else if (target === "bank") {
        const reordered = [...banks];
        const [moved] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, moved);
        dispatch(persistSetList("banks", reordered));
      }
    }
    setDrag(null);
  }

  // Y-offset for each card during drag:
  //   • The dragged card itself = pointer delta (follows finger)
  //   • Cards between fromIndex and toIndex shift by ±rowHeight to clear room
  //   • Everyone else stays put
  // Scoped to `target` so a categories drag doesn't shift payment-mode rows
  // (and vice versa) when both lists are expanded.
  function getYOffset(index, target) {
    if (!drag || drag.target !== target) return 0;
    if (index === drag.fromIndex) return drag.pointerY - drag.startY;
    if (drag.fromIndex < drag.toIndex) {
      if (index > drag.fromIndex && index <= drag.toIndex)
        return -drag.rowHeight;
    } else if (drag.fromIndex > drag.toIndex) {
      if (index >= drag.toIndex && index < drag.fromIndex)
        return drag.rowHeight;
    }
    return 0;
  }

  return (
    <div className="pref-page">
      <div className="pref-page-header">
        <button
          type="button"
          className="pref-back-btn"
          onClick={handleBack}
          aria-label="Go back"
        >
          <i className="fa-solid fa-arrow-left" />
        </button>
        <h1 className="pref-title">Preferences</h1>
      </div>

      {isAdmin && (
        <button
          type="button"
          className="pref-admin-card"
          onClick={() => navigate("/Admin")}
        >
          <span className="pref-admin-icon">
            <i className="fa-solid fa-user-shield" />
          </span>
          <span className="pref-admin-text">
            <span className="pref-admin-title">Admin · Page access</span>
            <span className="pref-admin-sub">
              Grant or revoke gated pages per user
            </span>
          </span>
          <i className="fa-solid fa-chevron-right pref-admin-arrow" />
        </button>
      )}

      <div className="pref-controls">
        <div className="pref-search">
          <i className="fa-solid fa-magnifying-glass" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
          />
          {query && (
            <button
              type="button"
              className="pref-search-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
        <div className="pref-zone-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeCat === "all"}
            className={`pref-zone-tab${activeCat === "all" ? " pref-zone-tab--active" : ""}`}
            onClick={() => setActiveCat("all")}
          >
            All
          </button>
          {PREF_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={activeCat === c.key}
              className={`pref-zone-tab${activeCat === c.key ? " pref-zone-tab--active" : ""}`}
              onClick={() => setActiveCat(c.key)}
            >
              <i className={`fa-solid ${c.icon}`} />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {!anyVisible && (
        <p className="pref-no-results">
          No settings match “{query}”.
        </p>
      )}

      {catHasVisible("general") && (
        <ZoneHeading icon="fa-sliders" label="General" />
      )}

      <PrefSection
        visible={sectionVisible("appearance")}
        id="appearance"
        title="Appearance"
        summary={`${theme === "dark" ? "Dark" : "Light"} · ${skin === "glass" ? "Glass" : "Classic"}`}
        expanded={isOpen("appearance")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Theme</p>
            <p className="pref-row-hint">
              {theme === "dark" ? "Dark" : "Light"} mode
            </p>
          </div>
          <div
            className="theme-toggle-bar"
            onClick={toggleTheme}
            role="switch"
            aria-checked={theme === "light"}
            aria-label="Toggle theme"
          >
            <div
              className={`toggle-thumb${theme === "dark" ? " toggle-thumb--right" : ""}`}
            />
            <span
              className={`toggle-icon${theme === "light" ? " toggle-icon--active" : ""}`}
            >
              <i className="fa-solid fa-sun" />
            </span>
            <span
              className={`toggle-icon${theme === "dark" ? " toggle-icon--active" : ""}`}
            >
              <i className="fa-solid fa-moon" />
            </span>
          </div>
        </div>

        <div className="pref-row" style={{ alignItems: "flex-start" }}>
          <div className="pref-row-text">
            <p className="pref-row-label">Skin</p>
            <p className="pref-row-hint">
              Classic is the original look. Glass is a translucent, iOS-26
              inspired treatment with frosted surfaces and subtle gradients.
            </p>
          </div>
        </div>
        <div className="skin-picker">
          <button
            type="button"
            className={`skin-picker-tile${skin === "classic" ? " skin-picker-tile--active" : ""}`}
            onClick={() => setSkin("classic")}
            aria-pressed={skin === "classic"}
          >
            <span className="skin-picker-preview skin-picker-preview--classic" />
            <span className="skin-picker-label">Classic</span>
            <span className="skin-picker-hint">Solid surfaces, current look</span>
          </button>
          <button
            type="button"
            className={`skin-picker-tile${skin === "glass" ? " skin-picker-tile--active" : ""}`}
            onClick={() => setSkin("glass")}
            aria-pressed={skin === "glass"}
          >
            <span className="skin-picker-preview skin-picker-preview--glass" />
            <span className="skin-picker-label">Glass</span>
            <span className="skin-picker-hint">Translucent, glossy, modern</span>
          </button>
        </div>

        <div
          className="pref-row"
          style={{
            alignItems: "flex-start",
            marginTop: 22,
            borderTop: "1px solid var(--surface-border)",
            paddingTop: 20,
          }}
        >
          <div className="pref-row-text">
            <p className="pref-row-label">Field style</p>
            <p className="pref-row-hint">
              How choices like Category and Payment mode appear in forms. Chips
              let you pick in one tap instead of opening a dropdown.
            </p>
          </div>
        </div>
        <div className="field-style-picker">
          <button
            type="button"
            className={`field-style-tile${!quickSelect ? " field-style-tile--active" : ""}`}
            onClick={() => dispatch(persistSetPreference("quickSelect", false))}
            aria-pressed={!quickSelect}
          >
            <span className="field-style-modal">
              <span className="field-style-modal-head">
                <span className="field-style-modal-title" />
                <i className="fa-solid fa-xmark field-style-modal-x" />
              </span>
              <span className="field-style-mini-label">Category</span>
              <span className="field-style-mini-select">
                Food
                <i className="fa-solid fa-chevron-down" />
              </span>
            </span>
            <span className="field-style-name">Dropdown</span>
            <span className="field-style-desc">Tap to open, then pick</span>
          </button>
          <button
            type="button"
            className={`field-style-tile${quickSelect ? " field-style-tile--active" : ""}`}
            onClick={() => dispatch(persistSetPreference("quickSelect", true))}
            aria-pressed={quickSelect}
          >
            <span className="field-style-modal">
              <span className="field-style-modal-head">
                <span className="field-style-modal-title" />
                <i className="fa-solid fa-xmark field-style-modal-x" />
              </span>
              <span className="field-style-mini-label">Category</span>
              <span className="field-style-mini-chips">
                <span className="field-style-mini-chip field-style-mini-chip--active">
                  Food
                </span>
                <span className="field-style-mini-chip">Bills</span>
                <span className="field-style-mini-chip">Fuel</span>
              </span>
            </span>
            <span className="field-style-name">One-tap chips</span>
            <span className="field-style-desc">Pick in a single tap</span>
          </button>
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("voice")}
        id="voice"
        title="Voice add"
        summary={voiceEnabled ? "On" : "Off"}
        expanded={isOpen("voice")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Enable voice capture</p>
            <p className="pref-row-hint">
              Adds a mic to the income / expense forms. Say something like
              "200 for lunch" and the fields auto-fill.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${voiceEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={voiceEnabled}
            aria-label="Toggle voice add"
            onClick={() =>
              dispatch(persistSetPreference("voiceAddEnabled", !voiceEnabled))
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("privacy")}
        id="privacy"
        title="Privacy mode"
        summary={privacyMode ? "On" : "Off"}
        expanded={isOpen("privacy")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Blur amounts</p>
            <p className="pref-row-hint">
              Hides every balance / amount across the app behind a blur.
              Tap and hold any blurred number to reveal it briefly.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${privacyMode ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={privacyMode}
            aria-label="Toggle privacy mode"
            onClick={() =>
              dispatch(persistSetPreference("privacyMode", !privacyMode))
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("notifications")}
        id="notifications"
        title="Notifications"
        summary={notificationsEnabled ? "On" : "Off"}
        expanded={isOpen("notifications")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Enable notifications</p>
            <p className="pref-row-hint">
              Shows a bell in the top bar with reminders for upcoming dues,
              renewals and SIPs. Tap any reminder to jump straight to it.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${notificationsEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={notificationsEnabled}
            aria-label="Toggle notifications"
            onClick={() =>
              dispatch(
                persistSetPreference("notificationsEnabled", !notificationsEnabled),
              )
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
        <NotificationsPanel
          types={notificationTypes}
          disabled={!notificationsEnabled}
        />
      </PrefSection>

      {dbEnabled(currentEmail()) && (
        <PrefSection
          visible={sectionVisible("backup")}
          id="backup"
          title="Backup & restore"
          summary="Google Drive"
          expanded={isOpen("backup")}
          onToggle={toggleSection}
        >
          <BackupPanel />
        </PrefSection>
      )}

      {catHasVisible("transactions") && (
        <ZoneHeading icon="fa-list-ul" label="Transactions & data" />
      )}

      <PrefSection
        visible={sectionVisible("categories")}
        id="categories"
        title="Categories"
        summary={`${(categoryMap.expense ?? []).length} expense · ${
          (categoryMap.income ?? []).length
        } income`}
        expanded={isOpen("categories")}
        onToggle={toggleSection}
      >
        <p className="pref-section-hint">Drag the grip handle to reorder.</p>
        <div className="pref-tabs">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`pref-tab${scope === s.key ? " pref-tab--active" : ""}`}
              onClick={() => setScope(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div
          className="pref-cat-list"
          ref={listRef}
          data-pref-drag-list
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          {list.length === 0 ? (
            <p className="pref-cat-empty">No categories yet.</p>
          ) : (
            list.map((name, i) => (
              <CategoryRow
                key={name}
                name={name}
                isDragging={
                  drag != null &&
                  drag.target === "category" &&
                  i === drag.fromIndex
                }
                yOffset={getYOffset(i, "category")}
                onDragStart={(e) => handleDragStart(e, i, "category")}
                onRename={(next) =>
                  dispatch(persistRenameCategory(scope, name, next))
                }
                onRemove={() => handleRemove(name)}
              />
            ))
          )}
        </div>

        <form className="pref-cat-add" onSubmit={handleAddCategory}>
          <input
            placeholder={`Add a new ${scope} category`}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          <button
            type="submit"
            className="pref-cat-add-btn"
            disabled={!newCat.trim()}
          >
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </form>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("income")}
        id="income"
        title="Income"
        summary={
          INCOME_TYPES.find((t) => t.key === incomeType)?.label ?? "Auto-detect"
        }
        expanded={isOpen("income")}
        onToggle={toggleSection}
      >
        <p className="pref-section-hint">
          How &ldquo;monthly income&rdquo; is estimated for baseline metrics
          across the app (Cash flow, income coverage), so a salary credited late
          in the month doesn&apos;t skew them.{" "}
          {INCOME_TYPES.find((t) => t.key === incomeType)?.blurb}
        </p>
        <div className="pref-grid">
          <label className="pref-field">
            <span>Income type</span>
            <select
              value={incomeType}
              onChange={(e) =>
                dispatch(persistSetPreference("incomeType", e.target.value))
              }
            >
              {INCOME_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="pref-section-hint" style={{ marginTop: 14 }}>
          Don&apos;t count these income categories toward the baseline (e.g.
          refunds, reimbursements, one-off receipts). Tap to toggle:
        </p>
        <div className="pref-multibank-chips">
          {incomeCategories.map((cat) => {
            const excluded = incomeExcludeCategories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                className="pref-multibank-chip"
                style={
                  excluded
                    ? {
                        borderStyle: "solid",
                        borderColor: "#d1483f",
                        color: "#d1483f",
                      }
                    : undefined
                }
                aria-pressed={excluded}
                onClick={() => {
                  const next = excluded
                    ? incomeExcludeCategories.filter((c) => c !== cat)
                    : [...incomeExcludeCategories, cat];
                  dispatch(
                    persistSetPreference("incomeExcludeCategories", next),
                  );
                }}
              >
                <i className={`fa-solid ${excluded ? "fa-ban" : "fa-plus"}`} />{" "}
                {cat}
              </button>
            );
          })}
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("paymentModes")}
        id="paymentModes"
        title="Payment modes"
        summary={`${paymentModes.length} mode${paymentModes.length === 1 ? "" : "s"}`}
        expanded={isOpen("paymentModes")}
        onToggle={toggleSection}
      >
        <p className="pref-section-hint">
          Drag the grip handle to reorder. Shows up in the Expense form&apos;s
          payment dropdown.
        </p>
        <div
          className="pref-cat-list"
          data-pref-drag-list
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          {paymentModes.length === 0 ? (
            <p className="pref-cat-empty">No payment modes yet.</p>
          ) : (
            paymentModes.map((name, i) => {
              const isEditing = editingPayMode?.idx === i;
              if (isEditing) {
                return (
                  <div
                    key={name}
                    className="pref-cat-row pref-cat-row--editing"
                  >
                    <input
                      className="pref-cat-input"
                      autoFocus
                      value={editingPayMode.draft}
                      onChange={(e) =>
                        setEditingPayMode({
                          ...editingPayMode,
                          draft: e.target.value,
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitPayModeEdit();
                        if (e.key === "Escape") setEditingPayMode(null);
                      }}
                    />
                    <button
                      type="button"
                      className="pref-cat-btn pref-cat-btn--save"
                      onClick={commitPayModeEdit}
                      aria-label="Save"
                    >
                      <i className="fa-solid fa-check" />
                    </button>
                    <button
                      type="button"
                      className="pref-cat-btn"
                      onClick={() => setEditingPayMode(null)}
                      aria-label="Cancel"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                );
              }
              const isDragging =
                drag != null &&
                drag.target === "paymentMode" &&
                i === drag.fromIndex;
              const yOffset = getYOffset(i, "paymentMode");
              return (
                <div
                  key={name}
                  className={`pref-cat-row${isDragging ? " pref-cat-row--dragging" : ""}`}
                  style={
                    yOffset
                      ? { transform: `translateY(${yOffset}px)` }
                      : undefined
                  }
                  data-cat-row
                  data-name={name}
                >
                  <button
                    type="button"
                    className="pref-cat-handle"
                    onPointerDown={(e) =>
                      handleDragStart(e, i, "paymentMode")
                    }
                    aria-label={`Drag ${name} to reorder`}
                  >
                    <span className="pref-cat-handle-stack" aria-hidden="true">
                      <i className="fa-solid fa-chevron-up" />
                      <i className="fa-solid fa-chevron-down" />
                    </span>
                  </button>
                  <span className="pref-cat-name">{name}</span>
                  <button
                    type="button"
                    className="pref-cat-btn"
                    onClick={() =>
                      setEditingPayMode({ idx: i, draft: name })
                    }
                    aria-label={`Rename ${name}`}
                  >
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button
                    type="button"
                    className="pref-cat-btn pref-cat-btn--danger"
                    onClick={() => removePaymentMode(name)}
                    aria-label={`Delete ${name}`}
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              );
            })
          )}
        </div>
        <form className="pref-cat-add" onSubmit={addPaymentMode}>
          <input
            placeholder="Add a payment mode"
            value={newPayMode}
            onChange={(e) => setNewPayMode(e.target.value)}
          />
          <button
            type="submit"
            className="pref-cat-add-btn"
            disabled={!newPayMode.trim()}
          >
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </form>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("banks")}
        id="banks"
        title="Banks"
        summary={`${banks.length} bank${banks.length === 1 ? "" : "s"}`}
        expanded={isOpen("banks")}
        onToggle={toggleSection}
        highlighted={highlightSection === "banks"}
      >
        <p className="pref-section-hint">
          Drag the grip handle to reorder. Shows up in the Add Card form&apos;s
          bank dropdown.
        </p>
        <div
          className="pref-cat-list"
          data-pref-drag-list
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          {banks.length === 0 ? (
            <p className="pref-cat-empty">No banks yet.</p>
          ) : (
            banks.map((name, i) => {
              const isEditing = editingBank?.idx === i;
              if (isEditing) {
                return (
                  <div key={name} className="pref-cat-row pref-cat-row--editing">
                    <input
                      className="pref-cat-input"
                      autoFocus
                      value={editingBank.draft}
                      onChange={(e) =>
                        setEditingBank({ ...editingBank, draft: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitBankEdit();
                        if (e.key === "Escape") setEditingBank(null);
                      }}
                    />
                    <button
                      type="button"
                      className="pref-cat-btn pref-cat-btn--save"
                      onClick={commitBankEdit}
                      aria-label="Save"
                    >
                      <i className="fa-solid fa-check" />
                    </button>
                    <button
                      type="button"
                      className="pref-cat-btn"
                      onClick={() => setEditingBank(null)}
                      aria-label="Cancel"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                );
              }
              const isDragging =
                drag != null &&
                drag.target === "bank" &&
                i === drag.fromIndex;
              const yOffset = getYOffset(i, "bank");
              return (
                <div
                  key={name}
                  className={`pref-cat-row${isDragging ? " pref-cat-row--dragging" : ""}`}
                  style={
                    yOffset
                      ? { transform: `translateY(${yOffset}px)` }
                      : undefined
                  }
                  data-cat-row
                  data-name={name}
                >
                  <button
                    type="button"
                    className="pref-cat-handle"
                    onPointerDown={(e) => handleDragStart(e, i, "bank")}
                    aria-label={`Drag ${name} to reorder`}
                  >
                    <span className="pref-cat-handle-stack" aria-hidden="true">
                      <i className="fa-solid fa-chevron-up" />
                      <i className="fa-solid fa-chevron-down" />
                    </span>
                  </button>
                  <span className="pref-cat-name">{name}</span>
                  <button
                    type="button"
                    className="pref-cat-btn"
                    onClick={() => setEditingBank({ idx: i, draft: name })}
                    aria-label={`Rename ${name}`}
                  >
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button
                    type="button"
                    className="pref-cat-btn pref-cat-btn--danger"
                    onClick={() => removeBank(name)}
                    aria-label={`Delete ${name}`}
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              );
            })
          )}
        </div>
        <form className="pref-cat-add" onSubmit={addBank}>
          <input
            placeholder="Add a bank"
            value={newBank}
            onChange={(e) => setNewBank(e.target.value)}
          />
          <button
            type="submit"
            className="pref-cat-add-btn"
            disabled={!newBank.trim()}
          >
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </form>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("multibank")}
        id="multibank"
        title="Multi-bank tracking"
        summary={
          multiBankEnabled
            ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}`
            : "Off"
        }
        expanded={isOpen("multibank")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Track per-bank balances</p>
            <p className="pref-row-hint">
              Tag each transaction with the bank it came from / went to.
              Adds a Self Transfer flow, per-bank balance views and a
              money-flow chart. Credit cards stay separate.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${multiBankEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={multiBankEnabled}
            aria-label="Toggle multi-bank tracking"
            onClick={() =>
              dispatch(
                persistSetPreference("multiBankEnabled", !multiBankEnabled),
              )
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>

        {multiBankEnabled && (
          <>
            <MultiBankAccountList
              banks={banks}
              accounts={accounts}
              transactions={allTransactions}
              onAdd={(bank) => setBankModal({ mode: "add", bank })}
              onEdit={(account) =>
                setBankModal({ mode: "edit", bank: account.bank, account })
              }
              onRemove={handleRemoveAccount}
              onManageBanks={() => revealSection("banks")}
            />
            {accounts.length > 0 && untaggedCount > 0 && (
              <div className="pref-multibank-migrate">
                <div className="pref-multibank-migrate-text">
                  <p className="pref-row-label">
                    Bulk-tag past transactions
                  </p>
                  <p className="pref-row-hint">
                    <strong>{untaggedCount}</strong> past transaction
                    {untaggedCount === 1 ? "" : "s"} {untaggedCount === 1 ? "is" : "are"} untagged.
                    Group them by payment mode and tag in bulk, or skip and tag later.
                  </p>
                </div>
                <button
                  type="button"
                  className="generic-button"
                  onClick={() => setMigrationOpen(true)}
                >
                  <i className="fa-solid fa-tag" /> Bulk-tag
                </button>
              </div>
            )}
          </>
        )}
      </PrefSection>

      <PrefSection
        visible={sectionVisible("entryTabs")}
        id="entryTabs"
        title="Entry type tabs"
        summary={entryTabsEnabled ? "On" : "Off"}
        expanded={isOpen("entryTabs")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Show Expense / Investment / Subscription tabs</p>
            <p className="pref-row-hint">
              Adds a tab strip at the top of the expense form so you pick the
              entry type up front. When on, Investment and Subscription are
              removed from the category list (you switch with the tabs instead).
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${entryTabsEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={entryTabsEnabled}
            aria-label="Toggle entry type tabs"
            onClick={() =>
              dispatch(
                persistSetPreference("entryTabsEnabled", !entryTabsEnabled),
              )
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("tally")}
        id="tally"
        title="Toolbox"
        summary={`Tally ${tallyEnabled ? "on" : "off"} · Notes ${notesEnabled ? "on" : "off"} · Calendar ${calendarEnabled ? "on" : "off"}`}
        expanded={isOpen("tally")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Tally</p>
            <p className="pref-row-hint">
              The floating Toolbox button lets you start Tally — tap any amounts
              on screen to add them up. Turn it off to remove Tally from the
              Toolbox.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${tallyEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={tallyEnabled}
            aria-label="Toggle Tally"
            onClick={() =>
              dispatch(persistSetPreference("tallyEnabled", !tallyEnabled))
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Notes</p>
            <p className="pref-row-hint">
              Jot free-form notes from the Toolbox — global, tied to a page, or
              to a specific item — with checklists and light formatting. Turn it
              off to remove Notes from the Toolbox.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${notesEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={notesEnabled}
            aria-label="Toggle Notes"
            onClick={() =>
              dispatch(persistSetPreference("notesEnabled", !notesEnabled))
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Calendar</p>
            <p className="pref-row-hint">
              A unified agenda + month view from the Toolbox — upcoming card
              dues, EMIs, renewals, SIP/premium debits, note reminders and past
              spending. Turn it off to remove Calendar from the Toolbox.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${calendarEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={calendarEnabled}
            aria-label="Toggle Calendar"
            onClick={() =>
              dispatch(persistSetPreference("calendarEnabled", !calendarEnabled))
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("autoCapture")}
        id="autoCapture"
        title="Auto-capture"
        summary={
          autoReadInboxCount > 0
            ? `${autoReadInboxCount} awaiting review`
            : "Paste a bank alert"
        }
        expanded={isOpen("autoCapture")}
        onToggle={toggleSection}
      >
        <AutoCapturePanel />
      </PrefSection>

      <PrefSection
        visible={sectionVisible("stmtImport")}
        id="stmtImport"
        title="Statement import"
        summary={
          statementImportEnabled
            ? merchantAliases.length > 0
              ? `On · ${merchantAliases.length} merchant${merchantAliases.length === 1 ? "" : "s"} remembered`
              : "On"
            : "Off"
        }
        expanded={isOpen("stmtImport")}
        onToggle={toggleSection}
      >
        <div className="pref-row">
          <div className="pref-row-text">
            <p className="pref-row-label">Import a bank statement</p>
            <p className="pref-row-hint">
              Adds an "Import statement" launcher to the Expenses page and
              a quick-action card on the Dashboard. Drop a CSV (or paste
              rows from your bank app) and the app auto-categorises every
              row before you confirm. Everything happens locally — nothing
              leaves your device.
            </p>
          </div>
          <button
            type="button"
            className={`pref-switch${statementImportEnabled ? " pref-switch--on" : ""}`}
            role="switch"
            aria-checked={statementImportEnabled}
            aria-label="Toggle statement import"
            onClick={() =>
              dispatch(
                persistSetPreference(
                  "statementImportEnabled",
                  !statementImportEnabled,
                ),
              )
            }
          >
            <span className="pref-switch-thumb" />
          </button>
        </div>

        {statementImportEnabled && (
          <MerchantMemoryPanel
            aliases={merchantAliases}
            onUpdate={(alias) => dispatch(persistUpdateMerchantAlias(alias))}
            onRemove={(key) => dispatch(persistRemoveMerchantAlias(key))}
          />
        )}
      </PrefSection>

      <PrefSection
        visible={sectionVisible("rules")}
        id="rules"
        title="Auto-categorize rules"
        summary={`${autoCategoryRules.length} rule${autoCategoryRules.length === 1 ? "" : "s"}`}
        expanded={isOpen("rules")}
        onToggle={toggleSection}
      >
        <p className="pref-section-hint">
          When the expense / income name contains the pattern, the category
          auto-fills. First match wins.
        </p>
        {autoCategoryRules.length > 0 && (
          <div className="pref-rule-list">
            {autoCategoryRules.map((rule) => {
              const cats = ruleCategoriesFor(rule.scope);
              const matchCount = ruleMatchCounts.get(rule.id) ?? 0;
              return (
                <div key={rule.id} className="pref-rule-row">
                  <select
                    className="pref-rule-select"
                    value={rule.scope}
                    onChange={(e) =>
                      dispatch(
                        persistUpdateAutoCategoryRule({
                          ...rule,
                          scope: e.target.value,
                          // Reset category if it's not valid for the new scope
                          category: (
                            categoryMap[e.target.value] ?? []
                          ).includes(rule.category)
                            ? rule.category
                            : "",
                        }),
                      )
                    }
                    aria-label="Scope"
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                  <input
                    className="pref-rule-input"
                    value={rule.pattern}
                    placeholder="contains…"
                    onChange={(e) =>
                      dispatch(
                        persistUpdateAutoCategoryRule({
                          ...rule,
                          pattern: e.target.value,
                        }),
                      )
                    }
                    aria-label="Pattern"
                  />
                  <span className="pref-rule-arrow">→</span>
                  <select
                    className="pref-rule-select"
                    value={rule.category}
                    onChange={(e) =>
                      dispatch(
                        persistUpdateAutoCategoryRule({
                          ...rule,
                          category: e.target.value,
                        }),
                      )
                    }
                    aria-label="Category"
                  >
                    <option value="">— Category —</option>
                    {cats.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {matchCount > 0 && (
                    <span
                      className="pref-rule-badge"
                      title={`Matches ${matchCount} past transaction${matchCount === 1 ? "" : "s"}`}
                    >
                      {matchCount}×
                    </span>
                  )}
                  <button
                    type="button"
                    className="pref-cat-btn pref-cat-btn--danger"
                    onClick={() => removeRule(rule)}
                    aria-label="Delete rule"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {autoCategoryRules.length > 0 && (
          <button
            type="button"
            className="pref-apply-past-btn"
            onClick={handleApplyToPast}
          >
            <i className="fa-solid fa-wand-magic-sparkles" />
            Apply rules to past transactions
          </button>
        )}

        <form className="pref-rule-add" onSubmit={addRule}>
          <select
            value={newRule.scope}
            onChange={(e) =>
              setNewRule({ ...newRule, scope: e.target.value, category: "" })
            }
            className="pref-rule-select"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <input
            className="pref-rule-input"
            placeholder="if name contains…"
            value={newRule.pattern}
            onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
          />
          <span className="pref-rule-arrow">→</span>
          <select
            value={newRule.category}
            onChange={(e) =>
              setNewRule({ ...newRule, category: e.target.value })
            }
            className="pref-rule-select"
          >
            <option value="">— Category —</option>
            {ruleCategoriesFor(newRule.scope).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="pref-cat-add-btn"
            disabled={!newRule.pattern.trim() || !newRule.category}
          >
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </form>
      </PrefSection>

      {catHasVisible("pages") && (
        <ZoneHeading icon="fa-layer-group" label="Page settings" />
      )}

      <PrefSection
        id="pages"
        title="Pages"
        summary="Turn pages on or off"
        expanded={isOpen("pages")}
        onToggle={toggleSection}
        visible={sectionVisible("pages")}
      >
        <PagesPanel />
      </PrefSection>

      <PrefSection
        visible={sectionVisible("solvency")}
        pageTag={pageTagFor("solvency")}
        id="solvency"
        title="Solvency tuning"
        summary={`Overdue ${dueWindows.overdueDays}d · Soon ${dueWindows.soonDays}d · Window ${dueWindows.upcomingDays}d`}
        expanded={isOpen("solvency")}
        onToggle={toggleSection}
      >
        <p className="pref-section-hint">
          Controls how Solvency flags overdue payments, what counts as
          &ldquo;due soon&rdquo;, and how far the upcoming-dues list looks
          ahead.
        </p>
        <div className="pref-grid">
          <label className="pref-field">
            <span>Lookahead window (days)</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={dueWindows.upcomingDays}
              onChange={(e) =>
                updateDueWindows({
                  upcomingDays: Math.max(1, parseInt(e.target.value) || 1),
                })
              }
            />
          </label>
          <label className="pref-field">
            <span>&ldquo;Due soon&rdquo; within (days)</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={dueWindows.soonDays}
              onChange={(e) =>
                updateDueWindows({
                  soonDays: Math.max(0, parseInt(e.target.value) || 0),
                })
              }
            />
          </label>
          <label className="pref-field">
            <span>&ldquo;Overdue&rdquo; after (days)</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={dueWindows.overdueDays}
              onChange={(e) =>
                updateDueWindows({
                  overdueDays: Math.max(0, parseInt(e.target.value) || 0),
                })
              }
            />
          </label>
        </div>


        <p
          className="pref-section-hint"
          style={{ marginTop: 18 }}
        >
          Health-score penalty caps. Each input is the maximum penalty in
          points for that category.
        </p>
        <div className="pref-grid">
          <label className="pref-field">
            <span>Max utilisation penalty</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={
                healthScore.utilThresholds?.[
                  healthScore.utilThresholds.length - 1
                ]?.penalty ?? 40
              }
              onChange={(e) => {
                const max = Math.max(0, parseInt(e.target.value) || 0);
                const t = [...(healthScore.utilThresholds ?? [])];
                if (t.length) {
                  t[t.length - 1] = { ...t[t.length - 1], penalty: max };
                  updateHealthScore({ utilThresholds: t });
                }
              }}
            />
          </label>
          <label className="pref-field">
            <span>Max borrowing penalty</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={healthScore.borrowingCap ?? 25}
              onChange={(e) =>
                updateHealthScore({
                  borrowingCap: Math.max(0, parseInt(e.target.value) || 0),
                })
              }
            />
          </label>
          <label className="pref-field">
            <span>Max overdue-commitments penalty</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={healthScore.commitmentOverdueCap ?? 20}
              onChange={(e) =>
                updateHealthScore({
                  commitmentOverdueCap: Math.max(
                    0,
                    parseInt(e.target.value) || 0,
                  ),
                })
              }
            />
          </label>
          <label className="pref-field">
            <span>Max overdue-cards penalty</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={healthScore.cardOverdueCap ?? 15}
              onChange={(e) =>
                updateHealthScore({
                  cardOverdueCap: Math.max(0, parseInt(e.target.value) || 0),
                })
              }
            />
          </label>
        </div>
      </PrefSection>

      <PrefSection
        visible={sectionVisible("investmentTypes")}
        pageTag={pageTagFor("investmentTypes")}
        id="investmentTypes"
        title="Investment types"
        summary={`${enabledInvestmentTypes.length} enabled`}
        expanded={isOpen("investmentTypes")}
        onToggle={toggleSection}
      >
        <InvestmentTypesPanel />
      </PrefSection>

      <PrefSection
        visible={sectionVisible("subscriptionTypes")}
        pageTag={pageTagFor("subscriptionTypes")}
        id="subscriptionTypes"
        title="Subscription types"
        summary={
          subscriptionTypeCount > 0
            ? `${subscriptionTypeCount} custom`
            : "Built-in brands"
        }
        expanded={isOpen("subscriptionTypes")}
        onToggle={toggleSection}
      >
        <SubscriptionTypesPanel />
      </PrefSection>

      <PrefSection
        visible={sectionVisible("benchmarks")}
        pageTag={pageTagFor("benchmarks")}
        id="benchmarks"
        title="Investment benchmarks"
        summary={`FD ${fdRate}% · Inflation ${inflationRate}%`}
        expanded={isOpen("benchmarks")}
        onToggle={toggleSection}
      >
        <p className="pref-section-hint">
          Used by the Portfolio Pulse cards on the Investments page.
        </p>
        <div className="pref-grid">
          <label className="pref-field">
            <span>FD benchmark (% p.a.)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={fdDraft}
              onChange={(e) => setFdDraft(e.target.value)}
              onBlur={() => commitRate("fdRate", fdDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitRate("fdRate", fdDraft);
                  e.target.blur();
                }
              }}
            />
          </label>
          <label className="pref-field">
            <span>Inflation (% p.a.)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={inflDraft}
              onChange={(e) => setInflDraft(e.target.value)}
              onBlur={() => commitRate("inflationRate", inflDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitRate("inflationRate", inflDraft);
                  e.target.blur();
                }
              }}
            />
          </label>
        </div>
      </PrefSection>

      {bankModal && (
        <Modal
          open={!!bankModal}
          onClose={() => setBankModal(null)}
          title={bankModal.mode === "edit" ? "Edit account" : "Add account"}
        >
          <BankAccountModal
            bank={bankModal.bank}
            account={bankModal.account}
            transactions={allTransactions}
            onSave={handleSaveBankAccount}
            onReset={(account) => {
              setBankModal(null);
              setResetTarget(account);
            }}
            onClose={() => setBankModal(null)}
          />
        </Modal>
      )}

      {resetTarget && (
        <Modal
          open={!!resetTarget}
          onClose={() => setResetTarget(null)}
          title="Reset opening balance?"
        >
          <div className="bank-account-reset-confirm">
            <div className="bank-account-modal-bank">
              <BankLogo
                bank={resetTarget.bank}
                color={resetTarget.color}
                size={28}
              />
              <span className="bank-account-modal-bank-name">
                {resetTarget.bank}
              </span>
            </div>
            <p className="bank-account-confirm-msg">
              <i className="fa-solid fa-circle-info" /> This adjusts{" "}
              <strong>{resetTarget.bank}</strong>&apos;s{" "}
              <strong>opening (&ldquo;Current Balance&rdquo;) entry</strong> so
              the computed balance lines up with your last verified balance,
              clearing the current drift. Your real transactions are{" "}
              <strong>not</strong> changed. Use this only when the drift came
              from an incorrectly-entered balance — not from missing
              transactions.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setResetTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="generic-button"
                onClick={() => {
                  dispatch(persistResetOpeningBalance(resetTarget.id));
                  setResetTarget(null);
                }}
              >
                <i className="fa-solid fa-rotate-left" /> Reset balance
              </button>
            </div>
          </div>
        </Modal>
      )}

      {migrationOpen && (
        <Modal
          open={migrationOpen}
          onClose={() => setMigrationOpen(false)}
          title="Bulk-tag past transactions"
        >
          <MultiBankMigration
            accounts={accounts}
            transactions={allTransactions}
            onClose={() => setMigrationOpen(false)}
            onApply={(pairs) => {
              dispatch(persistBulkTagAccounts(pairs));
              setMigrationOpen(false);
            }}
          />
        </Modal>
      )}

      {deleteTarget && deleteCopy && (
        <Modal
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title={deleteCopy.title}
        >
          <div className="delete-confirm-body">
            <p className="delete-confirm-name">
              {deleteTarget.name ?? deleteTarget.label}
            </p>
            <p className="delete-confirm-hint">{deleteCopy.hint}</p>
            <div className="form-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={confirmDelete}
              >
                <i className="fa-solid fa-trash-can" /> Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default memo(PreferencesPage);
