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
  persistBulkTagAccounts,
  persistUpdateMerchantAlias,
  persistRemoveMerchantAlias,
} from "../redux/slices/transactionSlice";
import MultiBankMigration from "../components/MultiBankMigration";
import InvestmentTypesPanel from "../components/InvestmentTypesPanel";
import {
  BANKS,
  CATEGORIES,
  DEFAULT_DUE_WINDOWS,
  DEFAULT_HEALTH_SCORE,
  INCOME_CATEGORIES,
  PAYMENT_MODES,
} from "../utils/constants";
import { matchAutoCategory } from "../utils/autoCategory";

const SCOPES = [
  { key: "expense", label: "Expense" },
  { key: "income", label: "Income" },
];

const COLLAPSE_TRANSITION = {
  duration: 0.25,
  ease: [0.25, 0.46, 0.45, 0.94],
};

// Random pleasant hue for new bank account chips. Same scheme as CardForm.
function randomBankColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 25);
  const l = 42 + Math.floor(Math.random() * 18);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

const MultiBankAccountList = memo(function MultiBankAccountList({
  banks,
  accounts,
  onAdd,
  onRemove,
  onUpdate,
}) {
  const tracked = new Set(accounts.map((a) => a.bank));
  const available = banks.filter((b) => !tracked.has(b));

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
              onRemove={() => onRemove(a.id)}
              onUpdate={onUpdate}
            />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <>
          <p className="pref-section-hint pref-multibank-hint">
            Add an account
          </p>
          <div className="pref-multibank-chips">
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
    </div>
  );
});

MultiBankAccountList.propTypes = {
  banks: PropTypes.arrayOf(PropTypes.string).isRequired,
  accounts: PropTypes.array.isRequired,
  onAdd: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
};

const BankAccountRow = memo(function BankAccountRow({
  account,
  onRemove,
  onUpdate,
}) {
  const [openingDraft, setOpeningDraft] = useState(
    String(account.openingBalance ?? 0),
  );
  const [editing, setEditing] = useState(false);

  function commit() {
    const next = parseFloat(openingDraft) || 0;
    if (next === (parseFloat(account.openingBalance) || 0)) {
      setEditing(false);
      return;
    }
    onUpdate({ ...account, openingBalance: next });
    setEditing(false);
  }

  return (
    <li className="pref-multibank-row">
      <span
        className="pref-multibank-dot"
        style={{ background: account.color || "var(--text-secondary)" }}
      />
      <div className="pref-multibank-meta">
        <span className="pref-multibank-name">{account.bank}</span>
        {editing ? (
          <input
            className="pref-multibank-balance-input"
            type="number"
            inputMode="decimal"
            autoFocus
            value={openingDraft}
            onChange={(e) => setOpeningDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setOpeningDraft(String(account.openingBalance ?? 0));
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="pref-multibank-balance"
            onClick={() => setEditing(true)}
          >
            Opening ₹
            {(parseFloat(account.openingBalance) || 0).toLocaleString("en-IN")}
            <i className="fa-solid fa-pen" />
          </button>
        )}
      </div>
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
    openingBalance: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
  onRemove: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
};

const PrefSection = memo(function PrefSection({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
}) {
  return (
    <section
      id={`pref-section-${id}`}
      className={`pref-section${expanded ? " pref-section--open" : ""}`}
    >
      <button
        type="button"
        className="pref-section-header"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        <span className="pref-section-header-text">
          <span className="pref-section-title">{title}</span>
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
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
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
  const enabledInvestmentTypes = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.enabledInvestmentTypes ?? [],
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
    }
    setDeleteTarget(null);
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

      <PrefSection
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
      </PrefSection>

      <PrefSection
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
        id="banks"
        title="Banks"
        summary={`${banks.length} bank${banks.length === 1 ? "" : "s"}`}
        expanded={isOpen("banks")}
        onToggle={toggleSection}
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
              onAdd={(bank) =>
                dispatch(
                  persistAddAccount({
                    id: crypto.randomUUID(),
                    bank,
                    color: randomBankColor(),
                    openingBalance: 0,
                    openingDate: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                  }),
                )
              }
              onRemove={(id) => dispatch(persistDeleteAccount(id))}
              onUpdate={(acc) => dispatch(persistUpdateAccount(acc))}
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

      <PrefSection
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
        id="investmentTypes"
        title="Investment types"
        summary={`${enabledInvestmentTypes.length} enabled`}
        expanded={isOpen("investmentTypes")}
        onToggle={toggleSection}
      >
        <InvestmentTypesPanel />
      </PrefSection>

      <PrefSection
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
