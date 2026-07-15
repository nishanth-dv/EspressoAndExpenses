import { memo, useState, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import { useDeepLinkNav } from "../hooks/useDeepLinkNav";
import PropTypes from "prop-types";

function DropdownPortal({ anchorRef, children }) {
  // Read anchor geometry inside useLayoutEffect rather than during render —
  // React Compiler forbids accessing refs in render, and this also keeps
  // the dropdown position responsive to anchor changes.
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const { bottom, left, width } = el.getBoundingClientRect();
    setPos({ top: bottom + 4, left, width });
  }, [anchorRef]);
  if (!pos) return null;
  const target = document.querySelector("dialog[open]") ?? document.body;
  return createPortal(
    <div
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
    >
      {children}
    </div>,
    target,
  );
}
import DayPicker from "./DayPicker";
import DynamicInvestmentForm from "./DynamicInvestmentForm";
import "../styles/investment.css";
import BankChipSelector from "../components/BankChipSelector";
import OptionField from "../components/OptionField";
import DateField from "../components/DateField";
import LoggingModeSelector from "../components/LoggingModeSelector";
import { recommendedLogMode } from "../utils/loggingMode";
import { INVESTMENT_TYPES, EQUITY_SECTORS, MF_CATEGORIES } from "../utils/constants";
import {
  getTypeInfo,
  getGraceDefault,
  typeHasGrace,
  graceLabel,
} from "../utils/investmentUtils";
import {
  BUILTIN_INVESTMENT_TYPES,
  getAllInvestmentTypes,
  getInvestmentTypeSchema,
} from "../utils/investmentTypeSchemas";
import { DISCOVER_INVESTMENT_TYPES } from "../data/investmentTypesDiscover";
import {
  fetchCurrentPrice,
  fetchSIPData,
  searchMFSchemes,
  searchStockTickers,
  tickerPlaceholder,
} from "../utils/priceService";

const EMPTY_FORM = {
  name: "",
  type: "",
  ticker: "",
  quantity: "",
  buyPrice: "",
  currentPrice: "",
  investedAmount: "",
  interestRate: "",
  tenureMonths: "",
  maturityAmount: "",
  maturityDate: "",
  lastPremiumDate: "",
  currentValue: "",
  monthlyAmount: "",
  sipDay: "",
  startDate: "",
  category: "",
  notes: "",
  affectsBalance: true,
  // Which bank the invested amount is deducted from (multi-bank only).
  accountId: "",
  // LIC-specific
  policyNumber: "",
  premiumAmount: "",
  frequency: 1,
  premiumMonths: [],
  currentInstallmentPaid: false,
  graceValue: "",
  graceUnit: "days",
  penaltyEnabled: false,
  penaltyMode: "flat",
  penaltyAmount: "",
  logMode: "",
};

function formFromInvestment(inv) {
  return {
    name: inv.name ?? "",
    type: inv.type ?? "",
    ticker: inv.ticker ?? "",
    quantity: inv.quantity ?? "",
    buyPrice: inv.buyPrice ?? "",
    currentPrice: inv.currentPrice ?? "",
    investedAmount: inv.investedAmount ??
      (inv.type === "mf" && inv.quantity && inv.buyPrice
        ? String(+(parseFloat(inv.quantity) * parseFloat(inv.buyPrice)).toFixed(2))
        : ""),
    interestRate: inv.interestRate ?? "",
    tenureMonths: inv.tenureMonths ?? "",
    maturityAmount: inv.maturityAmount ?? "",
    // For LIC, prefer the stored maturityDate; fall back to deriving it
    // from startDate + tenureMonths so legacy records open with the date
    // already populated.
    maturityDate:
      inv.maturityDate ??
      (inv.type === "lic" && inv.startDate && inv.tenureMonths
        ? (() => {
            const d = new Date(inv.startDate);
            d.setMonth(d.getMonth() + parseInt(inv.tenureMonths));
            return d.toISOString().slice(0, 10);
          })()
        : ""),
    lastPremiumDate: inv.lastPremiumDate ?? "",
    currentValue: inv.currentValue ?? "",
    category: inv.category ?? "",
    monthlyAmount: inv.monthlyAmount ?? "",
    sipDay: inv.sipDay ? String(inv.sipDay) : "",
    startDate: inv.startDate ?? "",
    notes: inv.notes ?? "",
    affectsBalance: inv.affectsBalance !== false,
    accountId: inv.accountId ?? "",
    // LIC fields
    policyNumber: inv.policyNumber ?? "",
    premiumAmount: inv.premiumAmount != null ? String(inv.premiumAmount) : "",
    frequency: inv.frequency || 1,
    premiumMonths: Array.isArray(inv.premiumMonths) ? inv.premiumMonths : [],
    // Persisted as { yearMonth, paid } — only relevant for the CURRENT
    // calendar month. If the marker is for an older month, treat the
    // checkbox as unchecked.
    currentInstallmentPaid: (() => {
      const mark = inv.currentInstallmentPaid;
      if (!mark || typeof mark !== "object") return false;
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return mark.yearMonth === ym && mark.paid === true;
    })(),
    ...(() => {
      const g = inv.gracePeriod ?? getGraceDefault(inv.type);
      return {
        graceValue: g?.value != null ? String(g.value) : "",
        graceUnit: g?.unit ?? "days",
      };
    })(),
    penaltyEnabled: !!inv.latePenalty?.enabled,
    penaltyMode: inv.latePenalty?.mode ?? "flat",
    penaltyAmount:
      inv.latePenalty?.amount != null ? String(inv.latePenalty.amount) : "",
    logMode: inv.autoDeduct?.mode ?? "",
  };
}

// Count of premium installments paid through the END of last calendar
// month, given startDate + premiumMonths. The current month is excluded
// from this — it requires explicit acknowledgement via the form checkbox.
function countPaidInstallments(startDate, premiumMonths) {
  if (!startDate || !premiumMonths?.length) return 0;
  const start = new Date(startDate);
  const now = new Date();
  // First-of-current-month — anything strictly before this counts as paid.
  const cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < cutoff) {
    const monthNum = cursor.getMonth() + 1; // 1..12
    if (premiumMonths.includes(monthNum)) count += 1;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return count;
}

const InvestmentForm = ({ onSubmit, onCancel, existing, prefillAmount, prefillType, onPayExisting }) => {
  // User-extended types live alongside the built-ins. Built-in keys are
  // identified by membership in INVESTMENT_TYPES — anything else is a
  // user-added / Discover-imported type that goes through the schema-driven
  // DynamicInvestmentForm renderer.
  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.investmentTypes ?? [],
  );
  // Existing investments — used to enforce the singleton flag on types
  // like APY where the user can only legally hold one account. The picker
  // shows an inline block + link to the existing record instead of opening
  // a fresh form.
  const existingInvestments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? [],
  );
  const enabledTypeKeys = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.enabledInvestmentTypes ?? [],
  );
  const typeOrder = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.investmentTypeOrder ?? [],
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const isBuiltInKey = (key) =>
    INVESTMENT_TYPES.some((t) => t.key === key);
  const userOnlyTypes = userTypes.filter((t) => !isBuiltInKey(t.key));
  const deepNav = useDeepLinkNav();
  // Universe of types the user could potentially enable: built-ins + the
  // Discover catalog + anything already in their user-types catalog.
  const enabledSet = new Set(enabledTypeKeys);
  const allCandidates = [...INVESTMENT_TYPES, ...userOnlyTypes];
  // Apply the user's preferred order (set in Preferences → Investment
  // types). Any candidates not in the order array fall through to the end
  // — keeps brand-new types (e.g., freshly-added user customs) discoverable.
  const orderedCandidates = (() => {
    if (!typeOrder.length) return allCandidates;
    const byKey = new Map(allCandidates.map((t) => [t.key, t]));
    const seen = new Set();
    const out = [];
    for (const k of typeOrder) {
      if (byKey.has(k) && !seen.has(k)) {
        out.push(byKey.get(k));
        seen.add(k);
      }
    }
    for (const t of allCandidates) {
      if (!seen.has(t.key)) out.push(t);
    }
    return out;
  })();
  const filteredCandidates = orderedCandidates.filter((t) =>
    enabledSet.has(t.key),
  );
  // "Add more" tile shows when there are still un-enabled types available
  // anywhere in the universe (built-ins + Discover + user). Discover entries
  // count even before they've been imported into the user-types catalog.
  const universeSize =
    INVESTMENT_TYPES.length + DISCOVER_INVESTMENT_TYPES.length +
    userOnlyTypes.filter(
      (u) => !DISCOVER_INVESTMENT_TYPES.some((d) => d.key === u.key),
    ).length;
  const canAddMore = enabledTypeKeys.length < universeSize;

  const [form, setForm] = useState(() => {
    if (existing) return formFromInvestment(existing);
    if (prefillType) {
      const info = getTypeInfo(prefillType);
      const seeded =
        prefillAmount && info?.subtype !== "unit"
          ? { investedAmount: String(prefillAmount) }
          : {};
      return { ...EMPTY_FORM, type: prefillType, ...seeded };
    }
    return EMPTY_FORM;
  });
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState(null); // { ok: bool, text: string }
  const [mfResults, setMfResults] = useState([]);
  const [mfSearching, setMfSearching] = useState(false);
  const [stockResults, setStockResults] = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [stockSearchErr, setStockSearchErr] = useState(null);
  // Singleton-block state — populated when the user taps a type that's
  // marked singleton: true and they already have an active record of
  // that type. Holds the type label + existing record's name so the
  // notice can name them. Cleared on next tile selection.
  const [singletonBlock, setSingletonBlock] = useState(null);
  const [editTarget, setEditTarget] = useState(existing ?? null);
  const [forceCreate, setForceCreate] = useState(false);
  const debounceRef = useRef(null);
  const stockDebounceRef = useRef(null);
  const mfAnchorRef = useRef(null);
  const stockAnchorRef = useRef(null);

  const typeInfo = form.type ? getTypeInfo(form.type) : null;
  const activeOfSelectedType =
    form.type && !editTarget
      ? existingInvestments.filter(
          (i) => i.type === form.type && !i.inHistory,
        )
      : [];
  const showExistingChooser =
    !editTarget &&
    !forceCreate &&
    !!form.type &&
    activeOfSelectedType.length > 0;
  const subtype = typeInfo?.subtype;
  const isMF = form.type === "mf" || form.type === "sip";
  const isStockSearch = form.type === "stock" || form.type === "etf";
  // Unit holdings (stock/ETF/gold) are multi-lot: picking an existing one in
  // the chooser means "buy more" → a new lot, so units accumulate with a
  // weighted average and a fresh purchase transaction. (MF/SIP stay single-record.)
  const isLotBuyMore = subtype === "unit" && !isMF;

  const categoryOptions =
    form.type === "stock" || form.type === "etf" ? EQUITY_SECTORS :
    form.type === "mf"    || form.type === "sip"  ? MF_CATEGORIES :
    form.type === "other" ? [...new Set(["Fixed Income", "Commodities", "Real Estate", "Crypto", ...EQUITY_SECTORS, ...MF_CATEGORIES])] :
    null;
  const categoryLabel =
    form.type === "mf" || form.type === "sip" ? "Fund category (optional)" : "Sector (optional)";

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // ── Stock / ETF ticker search ───────────────────────
  const handleStockSearch = useCallback((q, indiaOnly = false) => {
    setStockResults([]);
    setStockSearchErr(null);
    if (q.trim().length < 2) return;
    clearTimeout(stockDebounceRef.current);
    stockDebounceRef.current = setTimeout(async () => {
      setStockSearching(true);
      try {
        const results = await searchStockTickers(q, indiaOnly);
        setStockResults(results);
      } catch (e) {
        setStockSearchErr(e.message);
      } finally {
        setStockSearching(false);
      }
    }, 350);
  }, []);

  function selectStockTicker(item) {
    setForm((f) => ({ ...f, name: item.name, ticker: item.symbol }));
    setStockResults([]);
    setStockSearchErr(null);
  }

  // ── MF name search ──────────────────────────────────
  const handleMFSearch = useCallback((q) => {
    setMfResults([]);
    if (q.trim().length < 2) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setMfSearching(true);
      try {
        const results = await searchMFSchemes(q);
        setMfResults(results);
      } catch {
        setMfResults([]);
      } finally {
        setMfSearching(false);
      }
    }, 350);
  }, []);

  function selectMFScheme(scheme) {
    clearTimeout(debounceRef.current);
    setForm((f) => ({
      ...f,
      name: scheme.schemeName,
      ticker: String(scheme.schemeCode),
    }));
    setMfResults([]);
  }

  // ── Fetch current price / SIP data ──────────────────
  async function handleFetchPrice() {
    if (!form.ticker) return;
    setFetching(true);
    setFetchMsg(null);
    try {
      if (form.type === "sip") {
        if (!form.monthlyAmount || !form.startDate) {
          setFetchMsg({ ok: false, text: "Enter monthly amount and start date first" });
          return;
        }
        const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
        const result = await fetchSIPData(form.ticker, form.monthlyAmount, form.startDate, form.sipDay);
        setForm((f) => ({
          ...f,
          quantity: String(result.totalUnits),
          buyPrice: String(result.avgNav),
          currentPrice: String(result.currentNav),
        }));
        setFetchMsg({
          ok: true,
          text: `${result.instalments} instalments · ${result.totalUnits.toFixed(3)} units · Avg NAV ₹${result.avgNav.toFixed(2)} · Current NAV ₹${result.currentNav.toFixed(2)} · Value ${INR.format(Math.round(result.totalUnits * result.currentNav))}`,
        });
      } else {
        const price = await fetchCurrentPrice(form.type, form.ticker);
        set("currentPrice", String(price));
        setFetchMsg({ ok: true, text: `Fetched: ${price}` });
      }
    } catch (e) {
      setFetchMsg({ ok: false, text: e.message });
    } finally {
      setFetching(false);
    }
  }

  // ── Submit ──────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();

    // A self-logging SIP must debit a real account when multi-bank is on,
    // otherwise the auto-posted instalment would never touch a balance.
    const mode = form.logMode || recommendedLogMode("sip").mode;
    if (
      form.type === "sip" &&
      (mode === "auto" || mode === "manual") &&
      multiBankEnabled &&
      accounts.length > 0 &&
      !form.accountId
    ) {
      setFetchMsg({ ok: false, text: "Choose the bank this SIP debits" });
      return;
    }

    const createdAt = editTarget?.createdAt ?? new Date().toISOString();
    // MF has no Start date field — fall back to createdAt so date filters
    // and the ledger's "since" line still have something to anchor on.
    const startDate =
      form.startDate ||
      (form.type === "mf" ? createdAt : "");
    const payload = {
      id: editTarget?.id ?? crypto.randomUUID(),
      createdAt,
      name: form.name.trim(),
      type: form.type,
      ticker: form.ticker.trim() || undefined,
      startDate,
      category: categoryOptions && form.category ? form.category : undefined,
      notes: form.notes.trim(),
    };

    if (form.type !== "sip") {
      payload.affectsBalance = !!form.affectsBalance;
      payload.accountId =
        form.affectsBalance && form.accountId ? form.accountId : undefined;
    }

    if (subtype === "unit") {
      payload.quantity =
        form.type === "mf" && parseFloat(form.investedAmount) > 0 && parseFloat(form.buyPrice) > 0
          ? parseFloat(form.investedAmount) / parseFloat(form.buyPrice)
          : parseFloat(form.quantity) || 0;
      payload.buyPrice = parseFloat(form.buyPrice) || 0;
      payload.currentPrice = parseFloat(form.currentPrice) || 0;
      if (form.type === "sip") {
        payload.monthlyAmount = parseFloat(form.monthlyAmount) || 0;
        if (form.sipDay) payload.sipDay = parseInt(form.sipDay);
        const mode = form.logMode || recommendedLogMode("sip").mode;
        payload.autoDeduct = { ...(editTarget?.autoDeduct || {}), mode };
        // A SIP always debits a real account, so tag the auto-logged
        // instalment to the linked bank when multi-bank is on.
        payload.accountId = form.accountId || undefined;
      }
      if (form.ticker) payload.priceUpdatedAt = editTarget?.priceUpdatedAt;
    } else if (subtype === "fixed") {
      payload.investedAmount = parseFloat(form.investedAmount);
      if (form.type === "lic") {
        // LIC: user enters policy details + premium schedule. The total
        // invested is *derived* from premium × installments paid so it
        // stays in sync with the schedule.
        payload.policyNumber = form.policyNumber?.trim() || "";
        payload.premiumAmount = parseFloat(form.premiumAmount) || 0;
        payload.frequency = parseInt(form.frequency) || 1;
        payload.premiumMonths = Array.isArray(form.premiumMonths)
          ? form.premiumMonths.slice().sort((a, b) => a - b)
          : [];
        if (form.maturityDate) {
          payload.maturityDate = form.maturityDate;
          const start = new Date(form.startDate || new Date());
          const mat = new Date(form.maturityDate);
          const months =
            (mat.getFullYear() - start.getFullYear()) * 12 +
            (mat.getMonth() - start.getMonth());
          payload.tenureMonths = Math.max(0, months);
        } else {
          payload.tenureMonths = parseInt(form.tenureMonths) || 0;
        }
        if (form.maturityAmount)
          payload.maturityAmount = parseFloat(form.maturityAmount);
        if (form.lastPremiumDate)
          payload.lastPremiumDate = form.lastPremiumDate;
        // Mark current-month payment status (only meaningful when the
        // current calendar month is one of the policy's premium months).
        const now = new Date();
        const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const isPremiumMonthNow = payload.premiumMonths.includes(
          now.getMonth() + 1,
        );
        if (isPremiumMonthNow) {
          payload.currentInstallmentPaid = {
            yearMonth: currentYM,
            paid: !!form.currentInstallmentPaid,
          };
        }
        // Total invested = premium × (paid past installments + this month if confirmed)
        const pastInstallments = countPaidInstallments(
          form.startDate,
          payload.premiumMonths,
        );
        const thisMonthInstallment =
          isPremiumMonthNow && form.currentInstallmentPaid ? 1 : 0;
        const installmentsPaid = pastInstallments + thisMonthInstallment;
        payload.investedAmount =
          installmentsPaid * (payload.premiumAmount || 0);
        payload.installmentsPaid = installmentsPaid;
      } else if (form.type === "plan") {
        payload.tenureMonths = parseInt(form.tenureMonths);
        if (form.maturityAmount)
          payload.maturityAmount = parseFloat(form.maturityAmount);
        if (form.lastPremiumDate)
          payload.lastPremiumDate = form.lastPremiumDate;
      } else {
        payload.tenureMonths = parseInt(form.tenureMonths);
        payload.interestRate = parseFloat(form.interestRate);
      }
    } else {
      payload.investedAmount = parseFloat(form.investedAmount);
      payload.currentValue = parseFloat(form.currentValue);
    }

    if (typeHasGrace(payload.type)) {
      const def = getGraceDefault(payload.type);
      payload.gracePeriod = {
        value: parseFloat(form.graceValue) || def?.value || 0,
        unit: form.graceUnit || def?.unit || "days",
      };
      payload.latePenalty = {
        enabled: !!form.penaltyEnabled,
        mode: form.penaltyMode || "flat",
        amount: parseFloat(form.penaltyAmount) || 0,
      };
    }

    onSubmit(payload);
  }

  const computedMFQty =
    form.type === "mf" && parseFloat(form.investedAmount) > 0 && parseFloat(form.buyPrice) > 0
      ? parseFloat(form.investedAmount) / parseFloat(form.buyPrice)
      : null;

  const quantityLabel =
    form.type === "gold" ? "Quantity (grams)"
    : form.type === "sip" ? "Total units held"
    : "Quantity / Units";
  const buyLabel =
    form.type === "gold" ? "Buy price per gram (₹)"
    : form.type === "sip" ? "Avg purchase NAV (₹)"
    : "Buy price per unit (₹)";

  // Weighted average buy price across every lot of this same holding (matched
  // by ticker, or type|name when there's no ticker), folding in the values
  // currently typed into the form. Surfaced read-only for multi-lot stock
  // positions so the user sees their blended cost basis as they add a lot.
  // Returns null for single-lot / non-stock cases where it'd just echo the
  // Buy price field.
  const avgBuyAcrossLots = (() => {
    if (typeInfo?.subtype !== "unit" || form.type === "sip" || form.type === "mf") {
      return null;
    }
    const key = form.ticker
      ? form.ticker.toUpperCase()
      : `${form.type}|${form.name}`;
    let totQty = 0;
    let totCost = 0;
    let lots = 0;
    for (const lot of existingInvestments) {
      if (getTypeInfo(lot.type).subtype !== "unit") continue;
      if (existing && lot.id === existing.id) continue;
      const lotKey = lot.ticker
        ? lot.ticker.toUpperCase()
        : `${lot.type}|${lot.name}`;
      if (lotKey !== key) continue;
      const lq = parseFloat(lot.quantity) || 0;
      const lp = parseFloat(lot.buyPrice) || 0;
      if (lq <= 0) continue;
      totQty += lq;
      totCost += lq * lp;
      lots += 1;
    }
    const q = parseFloat(form.quantity) || 0;
    const p = parseFloat(form.buyPrice) || 0;
    if (q > 0) {
      totQty += q;
      totCost += q * p;
      lots += 1;
    }
    if (lots < 2 || totQty <= 0) return null;
    return totCost / totQty;
  })();
  const curLabel =
    form.type === "gold" ? "Current price per gram (₹)"
    : form.type === "sip" ? "Current NAV (₹)"
    : "Current price per unit (₹)";
  const principalLabel =
    form.type === "rd"
      ? "Monthly deposit (₹)"
      : form.type === "lic"
        ? "Annual premium (₹)"
        : form.type === "plan"
          ? "Monthly contribution (₹)"
          : "Principal amount (₹)";

  // If the active type is a user-added schema (custom or Discover-imported),
  // delegate to DynamicInvestmentForm entirely — the schema is the source of
  // truth for both fields and layout, no built-in form branches apply.
  const activeUserType = form.type && !isBuiltInKey(form.type)
    ? userTypes.find((t) => t.key === form.type)
    : null;
  if (activeUserType && !showExistingChooser) {
    return (
      <DynamicInvestmentForm
        schema={activeUserType}
        existing={editTarget}
        prefillAmount={prefillAmount}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  // A SIP that logs itself (Auto / Remind me) always moves money out of a real
  // account, so — when multi-bank is on and accounts exist — it must be tagged
  // to one. "I'll log it myself" tags each entry at log time, so no link here.
  const sipMode = form.logMode || recommendedLogMode("sip").mode;
  const sipNeedsAccount =
    form.type === "sip" &&
    (sipMode === "auto" || sipMode === "manual") &&
    multiBankEnabled &&
    accounts.length > 0;

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      {/* ── Type selector (Add only) ── */}
      {!editTarget && !prefillType && (
        <>
          <p className="inv-form-section-label">Investment type</p>
          <div className="inv-type-grid">
            {filteredCandidates.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`inv-type-btn${form.type === t.key ? " inv-type-btn--active" : ""}`}
                style={
                  form.type === t.key
                    ? { borderColor: t.color, color: t.color }
                    : {}
                }
                onClick={() => {
                  // Singleton gate — types like APY can only be held once
                  // per individual. If the user already has an active
                  // record of this type, surface a block notice instead
                  // of opening the form.
                  if (t.singleton) {
                    const existingActive = existingInvestments.find(
                      (i) => i.type === t.key && !i.inHistory,
                    );
                    if (existingActive) {
                      setSingletonBlock({
                        typeKey: t.key,
                        typeLabel: t.label,
                        existingName: existingActive.name,
                      });
                      return;
                    }
                  }
                  setSingletonBlock(null);
                  setEditTarget(null);
                  setForceCreate(false);
                  // User-added types short-circuit the built-in form — just
                  // set the type and re-render; the activeUserType branch
                  // above will hand off to DynamicInvestmentForm.
                  if (!isBuiltInKey(t.key)) {
                    setForm({ ...EMPTY_FORM, type: t.key });
                    return;
                  }
                  const info = getTypeInfo(t.key);
                  const seeded =
                    prefillAmount && info?.subtype !== "unit"
                      ? { investedAmount: String(prefillAmount) }
                      : {};
                  const gDef = getGraceDefault(t.key);
                  const graceSeed = gDef
                    ? { graceValue: String(gDef.value), graceUnit: gDef.unit }
                    : {};
                  setForm({ ...EMPTY_FORM, type: t.key, ...graceSeed, ...seeded });
                  setFetchMsg(null);
                  setMfResults([]);
                  setStockResults([]);
                  setStockSearchErr(null);
                }}
              >
                <i className={`fa-solid ${t.icon}`} />
                <span>{t.label}</span>
              </button>
            ))}
            {/* "+ Add more" tile — appears when the universe has types the
                user hasn't enabled. Navigates to Preferences with the
                Investment Types section auto-opened (via #hash). */}
            {canAddMore && (
              <button
                type="button"
                className="inv-type-btn inv-type-btn--add-more"
                onClick={() => {
                  onCancel();
                  setTimeout(
                    () => deepNav("/Preferences#investmentTypes"),
                    200,
                  );
                }}
                title="Enable more investment types in Preferences"
              >
                <i className="fa-solid fa-plus" />
                <span>Add more</span>
              </button>
            )}
          </div>
          {singletonBlock && (
            <div className="inv-singleton-block" role="alert">
              <i className="fa-solid fa-circle-info" />
              <div className="inv-singleton-block-text">
                You already have a <strong>{singletonBlock.typeLabel}</strong>
                {" "}account on record
                {singletonBlock.existingName
                  ? ` (${singletonBlock.existingName})`
                  : ""}.{" "}
                {singletonBlock.typeLabel} is one-account-per-individual.
                Edit the existing record from your holdings list to update
                contributions.
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Type locked (Edit only) ── */}
      {editTarget && form.type && typeInfo && (
        <div className="inv-form-type-locked">
          <span
            className="inv-type-badge"
            style={{
              background: typeInfo.color + "22",
              color: typeInfo.color,
            }}
          >
            <i className={`fa-solid ${typeInfo.icon}`} /> {typeInfo.label}
          </span>
          <span className="inv-form-type-locked-hint">
            Type can't change during edit — delete and re-add to switch
          </span>
        </div>
      )}

      {showExistingChooser && (
        <div className="inv-existing-chooser">
          <p className="inv-form-section-label">
            Existing {typeInfo?.label ?? "investments"}
          </p>
          {activeOfSelectedType.map((inv) => (
            <button
              key={inv.id}
              type="button"
              className="inv-existing-row"
              onClick={() => {
                if (form.type === "lic" && onPayExisting) {
                  onPayExisting(inv);
                  return;
                }
                if (isLotBuyMore) {
                  // New lot prefilled from this holding (same name/ticker/type/
                  // account) but a fresh id and blank quantity/price — the user
                  // enters just the new purchase. Editing a specific lot is done
                  // from the holdings list.
                  setForceCreate(true);
                  setEditTarget(null);
                  setForm({
                    ...formFromInvestment(inv),
                    quantity: "",
                    buyPrice: "",
                    investedAmount: "",
                    // Blank the old lot's date/value so this purchase dates to
                    // now (or a date the user picks), not the original lot's.
                    startDate: "",
                    currentValue: "",
                  });
                  return;
                }
                setEditTarget(inv);
                setForm(formFromInvestment(inv));
              }}
            >
              <span className="inv-existing-row-name">{inv.name}</span>
              <span className="inv-existing-row-cta">
                {form.type === "lic" && onPayExisting
                  ? "Pay premium"
                  : isLotBuyMore
                    ? "Buy more"
                    : "Add / update"}
                <i className="fa-solid fa-arrow-right" />
              </span>
            </button>
          ))}
          <button
            type="button"
            className="inv-existing-create"
            onClick={() => setForceCreate(true)}
          >
            <i className="fa-solid fa-plus" />
            <span>Create new {typeInfo?.label ?? "investment"}</span>
          </button>
        </div>
      )}

      {form.type && !showExistingChooser && (
        <>
          {/* ── MF fund search (name field doubles as search) ── */}
          {isMF && (
            <>
              <div className="inv-mf-search" ref={mfAnchorRef}>
                <div className="field">
                  <input
                    name="name"
                    value={form.name}
                    onChange={(e) => {
                      setForm((f) => ({
                        ...f,
                        name: e.target.value,
                        ticker: "",
                      }));
                      handleMFSearch(e.target.value);
                    }}
                    onBlur={() => setTimeout(() => setMfResults([]), 150)}
                    required
                    placeholder=" "
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <label>Fund name</label>
                </div>
                {mfSearching && (
                  <i className="fa-solid fa-spinner fa-spin inv-field-spinner" />
                )}
              </div>
              {mfResults.length > 0 && (
                <DropdownPortal anchorRef={mfAnchorRef}>
                  <div className="inv-mf-results">
                    {mfResults.map((r) => (
                      <button
                        key={r.schemeCode}
                        type="button"
                        className="inv-mf-result-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectMFScheme(r)}
                      >
                        {r.schemeName}
                      </button>
                    ))}
                  </div>
                </DropdownPortal>
              )}
              {form.name && !form.ticker && (
                <p className="inv-fetch-msg inv-fetch-msg--err" style={{ marginTop: 2, marginBottom: 6 }}>
                  <i className="fa-solid fa-triangle-exclamation" /> Select a fund from the search results
                </p>
              )}
              {form.ticker && (
                <div className="field">
                  <input value={form.ticker} readOnly placeholder=" " />
                  <label>Scheme code</label>
                </div>
              )}
            </>
          )}

          {/* ── Name / Stock search ── */}
          {isStockSearch ? (
            <>
              <div className="inv-mf-search" ref={stockAnchorRef}>
                <div className="field">
                  <input
                    name="name"
                    value={form.name}
                    onChange={(e) => {
                      set("name", e.target.value);
                      handleStockSearch(e.target.value, form.type === "stock");
                    }}
                    onBlur={() => setTimeout(() => setStockResults([]), 150)}
                    required
                    placeholder=" "
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <label>Company name</label>
                </div>
                {stockSearching && (
                  <i className="fa-solid fa-spinner fa-spin inv-field-spinner" />
                )}
              </div>
              {stockResults.length > 0 && (
                <DropdownPortal anchorRef={stockAnchorRef}>
                  <div className="inv-mf-results">
                    {stockResults.map((r) => (
                      <button
                        key={r.symbol}
                        type="button"
                        className="inv-mf-result-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectStockTicker(r)}
                      >
                        <strong>{r.symbol}</strong> — {r.name}
                        {r.exchange && (
                          <span
                            style={{
                              opacity: 0.55,
                              marginLeft: 6,
                              fontSize: 12,
                            }}
                          >
                            {r.exchange}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </DropdownPortal>
              )}
              {stockSearchErr && (
                <p className="inv-fetch-msg inv-fetch-msg--err inv-fetch-msg--search">
                  <i className="fa-solid fa-triangle-exclamation" />{" "}
                  {stockSearchErr}
                </p>
              )}
            </>
          ) : !isMF ? (
            <div className="field">
              <input
                name="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                placeholder=" "
                autoCorrect="off"
                spellCheck={false}
              />
              <label>Investment name</label>
            </div>
          ) : null}

          {/* ── Unit fields ── */}
          {subtype === "unit" && (
            <>
              {/* Ticker — hidden for MF/SIP since scheme code is shown above */}
              {!isMF && (
                <div className="field">
                  <input
                    value={form.ticker}
                    onChange={(e) => {
                      set("ticker", e.target.value);
                      setFetchMsg(null);
                    }}
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <label>{tickerPlaceholder(form.type)}</label>
                </div>
              )}

              {/* SIP: monthly amount + SIP day + start date (all needed before compute) */}
              {form.type === "sip" ? (
                <>
                  <div className="sol-form-row">
                    <div className="field">
                      <input
                        name="monthlyAmount"
                        type="number"
                        inputMode="decimal"
                        value={form.monthlyAmount}
                        onChange={(e) => { set("monthlyAmount", e.target.value); setFetchMsg(null); }}
                        required
                        placeholder=" "
                      />
                      <label>Monthly SIP (₹)</label>
                    </div>
                    <DayPicker
                      value={form.sipDay}
                      onChange={(v) => { set("sipDay", v); setFetchMsg(null); }}
                      label="SIP date (day)"
                    />
                  </div>
                  <DateField
                    name="startDate"
                    value={form.startDate}
                    onChange={(e) => { set("startDate", e.target.value); setFetchMsg(null); }}
                    label="SIP start date"
                    required
                  />
                  <LoggingModeSelector
                    typeKey="sip"
                    value={form.logMode || recommendedLogMode("sip").mode}
                    onChange={(m) => set("logMode", m)}
                  />
                  {sipNeedsAccount && (
                    <BankChipSelector
                      accounts={accounts}
                      value={form.accountId}
                      onChange={(id) => set("accountId", id)}
                      label="Debited from"
                      allowUntagged={false}
                    />
                  )}
                </>
              ) : form.type === "mf" ? (
                <>
                  <div className="sol-form-row">
                    <div className="field">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={form.investedAmount}
                        onChange={(e) => set("investedAmount", e.target.value)}
                        required
                        placeholder=" "
                      />
                      <label>Amount invested (₹)</label>
                    </div>
                    <div className="field">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={form.buyPrice}
                        onChange={(e) => set("buyPrice", e.target.value)}
                        required
                        placeholder=" "
                      />
                      <label>NAV at purchase (₹)</label>
                    </div>
                  </div>
                  {computedMFQty !== null && (
                    <div className="field">
                      <input value={computedMFQty.toFixed(3)} readOnly placeholder=" " />
                      <label>Units allotted (auto-calculated)</label>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="field">
                    <input
                      name="quantity"
                      type="number"
                      inputMode="decimal"
                      value={form.quantity}
                      onChange={(e) => set("quantity", e.target.value)}
                      required
                      placeholder=" "
                    />
                    <label>{quantityLabel}</label>
                  </div>
                  <div className="field">
                    <input
                      name="buyPrice"
                      type="number"
                      inputMode="decimal"
                      value={form.buyPrice}
                      onChange={(e) => set("buyPrice", e.target.value)}
                      required
                      placeholder=" "
                    />
                    <label>{buyLabel}</label>
                  </div>
                  {avgBuyAcrossLots !== null && (
                    <div className="field">
                      <input
                        value={`₹ ${avgBuyAcrossLots.toLocaleString("en-IN", {
                          maximumFractionDigits: 2,
                        })}`}
                        readOnly
                        placeholder=" "
                      />
                      <label>Avg buy across all lots</label>
                    </div>
                  )}
                </>
              )}

              {/* Current price + fetch button — for SIP the Fetch computes everything */}
              <div className="inv-price-row">
                {form.type !== "sip" && (
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <input
                      name="currentPrice"
                      type="number"
                      inputMode="decimal"
                      value={form.currentPrice}
                      onChange={(e) => {
                        set("currentPrice", e.target.value);
                        setFetchMsg(null);
                      }}
                      required
                      placeholder=" "
                    />
                    <label>{curLabel}</label>
                  </div>
                )}
                <button
                  type="button"
                  className={`inv-fetch-btn${fetching ? " inv-fetch-btn--loading" : ""}${form.type === "sip" ? " inv-fetch-btn--full" : ""}`}
                  onClick={handleFetchPrice}
                  disabled={
                    fetching || !form.ticker ||
                    (form.type === "sip" && (!form.monthlyAmount || !form.startDate))
                  }
                  title={
                    form.type === "sip"
                      ? !form.ticker ? "Select a fund first"
                        : !form.monthlyAmount ? "Enter monthly amount first"
                        : !form.startDate ? "Enter SIP start date first"
                        : "Compute units from historical NAVs"
                      : form.ticker ? "Fetch current price" : "Enter a ticker first"
                  }
                >
                  <i className={`fa-solid ${fetching ? "fa-spinner fa-spin" : "fa-rotate"}`} />
                  {!fetching && (form.type === "sip" ? "Compute from history" : "Fetch")}
                </button>
              </div>
              {fetchMsg && (
                <p className={`inv-fetch-msg${fetchMsg.ok ? " inv-fetch-msg--ok" : " inv-fetch-msg--err"}`}>
                  {fetchMsg.ok ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-triangle-exclamation" />}{" "}
                  {fetchMsg.text}
                </p>
              )}
              {form.type === "sip" && parseFloat(form.quantity) > 0 && (
                <div className="sol-form-row">
                  <div className="field">
                    <input value={Number(form.quantity).toFixed(3)} readOnly placeholder=" " />
                    <label>Accumulated units</label>
                  </div>
                  <div className="field">
                    <input
                      value={`₹ ${Math.round(parseFloat(form.quantity) * parseFloat(form.currentPrice)).toLocaleString("en-IN")}`}
                      readOnly
                      placeholder=" "
                    />
                    <label>Current value</label>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Fixed fields ── */}
          {subtype === "fixed" && form.type !== "lic" && (
            <>
              <div className="field">
                <input
                  name="investedAmount"
                  type="number"
                  inputMode="decimal"
                  value={form.investedAmount}
                  onChange={(e) => set("investedAmount", e.target.value)}
                  required
                  placeholder=" "
                />
                <label>{principalLabel}</label>
              </div>
              {form.type !== "plan" && (
                <div className="field">
                  <input
                    name="interestRate"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={form.interestRate}
                    onChange={(e) => set("interestRate", e.target.value)}
                    required
                    placeholder=" "
                  />
                  <label>Interest rate (% p.a.)</label>
                </div>
              )}
              <div className="field">
                <input
                  name="tenureMonths"
                  type="number"
                  inputMode="numeric"
                  value={form.tenureMonths}
                  onChange={(e) => set("tenureMonths", e.target.value)}
                  required
                  placeholder=" "
                />
                <label>Tenure (months)</label>
              </div>
              {form.type === "plan" && (
                <>
                  <div className="field">
                    <input
                      name="maturityAmount"
                      type="number"
                      inputMode="decimal"
                      value={form.maturityAmount}
                      onChange={(e) => set("maturityAmount", e.target.value)}
                      placeholder=" "
                    />
                    <label>Maturity amount (₹) — optional</label>
                  </div>
                  <DateField
                    name="lastPremiumDate"
                    value={form.lastPremiumDate}
                    onChange={(e) => set("lastPremiumDate", e.target.value)}
                    label="Last contribution date"
                  />
                  <p className="inv-field-hint">
                    For limited-pay plans, contributions stop before maturity.
                    Leave blank if you contribute for the full tenure.
                  </p>
                </>
              )}
            </>
          )}

          {/* ── LIC fields ──
              Standalone block: policy number, start/maturity dates back to
              back, premium amount, frequency, premium-month picker, total
              paid display, and the conditional "paid this month" toggle. */}
          {form.type === "lic" && (() => {
            const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const now = new Date();
            const currentMonthNum = now.getMonth() + 1;
            const isPremiumMonthNow = form.premiumMonths.includes(currentMonthNum);
            const pastInstallments = countPaidInstallments(
              form.startDate,
              form.premiumMonths,
            );
            const thisMonthCount =
              isPremiumMonthNow && form.currentInstallmentPaid ? 1 : 0;
            const totalInstallments = pastInstallments + thisMonthCount;
            const premium = parseFloat(form.premiumAmount) || 0;
            const totalPaid = totalInstallments * premium;

            function toggleMonth(m) {
              if (form.frequency === 1) {
                set("premiumMonths", [m]);
                return;
              }
              const selected = form.premiumMonths.includes(m);
              if (selected) {
                set(
                  "premiumMonths",
                  form.premiumMonths.filter((x) => x !== m),
                );
              } else if (form.premiumMonths.length < form.frequency) {
                set("premiumMonths", [...form.premiumMonths, m]);
              }
            }

            return (
              <>
                <div className="field">
                  <input
                    name="policyNumber"
                    type="text"
                    value={form.policyNumber}
                    onChange={(e) => set("policyNumber", e.target.value)}
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder=" "
                  />
                  <label>Policy number</label>
                </div>
                <div className="sol-form-row">
                  <DateField
                    name="startDate"
                    value={form.startDate}
                    onChange={(e) => set("startDate", e.target.value)}
                    label="Start date"
                    required
                  />
                  <DateField
                    name="maturityDate"
                    value={form.maturityDate}
                    onChange={(e) => set("maturityDate", e.target.value)}
                    label="Maturity date"
                    required
                  />
                </div>
                <DateField
                  name="lastPremiumDate"
                  value={form.lastPremiumDate}
                  onChange={(e) => set("lastPremiumDate", e.target.value)}
                  label="Last premium payable date"
                  max={form.maturityDate || undefined}
                />
                <p className="inv-field-hint">
                  For limited-premium policies, premiums stop before maturity.
                  Leave blank if you pay until the maturity date.
                </p>
                <div className="sol-form-row">
                  <div className="field">
                    <input
                      name="premiumAmount"
                      type="number"
                      inputMode="decimal"
                      value={form.premiumAmount}
                      onChange={(e) => set("premiumAmount", e.target.value)}
                      required
                      placeholder=" "
                    />
                    <label>Premium amount (₹)</label>
                  </div>
                  <OptionField
                    name="frequency"
                    value={form.frequency}
                    onChange={(e) => {
                      const next = parseInt(e.target.value);
                      set("frequency", next);
                      if (next === 12) {
                        set("premiumMonths", [1,2,3,4,5,6,7,8,9,10,11,12]);
                      } else if (form.premiumMonths.length > next) {
                        set("premiumMonths", form.premiumMonths.slice(0, next));
                      }
                    }}
                    label="Premium frequency"
                    required
                    options={[
                      { value: 1, label: "Yearly (1×/yr)" },
                      { value: 2, label: "Half-yearly (2×/yr)" },
                      { value: 4, label: "Quarterly (4×/yr)" },
                      { value: 12, label: "Monthly (12×/yr)" },
                    ]}
                  />
                </div>

                <div className="lic-months-wrap">
                  <div className="lic-months-header">
                    <span>
                      Premium month{form.frequency === 1 ? "" : "s"}
                    </span>
                    <span className="lic-months-counter">
                      {form.premiumMonths.length}/{form.frequency}
                    </span>
                  </div>
                  <div className="lic-month-grid">
                    {MONTH_NAMES.map((label, i) => {
                      const m = i + 1;
                      const selected = form.premiumMonths.includes(m);
                      const atLimit =
                        !selected &&
                        form.frequency !== 1 &&
                        form.premiumMonths.length >= form.frequency;
                      return (
                        <button
                          key={m}
                          type="button"
                          className={`lic-month-btn${selected ? " lic-month-btn--active" : ""}`}
                          onClick={() => toggleMonth(m)}
                          disabled={atLimit || form.frequency === 12}
                          aria-pressed={selected}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field">
                  <input
                    name="maturityAmount"
                    type="number"
                    inputMode="decimal"
                    value={form.maturityAmount}
                    onChange={(e) => set("maturityAmount", e.target.value)}
                    placeholder=" "
                  />
                  <label>Maturity amount (₹) — optional</label>
                </div>

                <div className="lic-total-paid">
                  <div className="lic-total-paid-label">Total premium paid</div>
                  <div className="lic-total-paid-value">
                    ₹{totalPaid.toLocaleString("en-IN")}
                    <span className="lic-total-paid-sub">
                      {" "}({totalInstallments} of {form.frequency}×/yr · ₹
                      {premium.toLocaleString("en-IN")} each)
                    </span>
                  </div>
                </div>

                {isPremiumMonthNow && (
                  <label className="lic-paid-checkbox">
                    <input
                      type="checkbox"
                      checked={form.currentInstallmentPaid}
                      onChange={(e) =>
                        set("currentInstallmentPaid", e.target.checked)
                      }
                    />
                    <span>
                      I've paid this month's installment ({MONTH_NAMES[currentMonthNum - 1]})
                    </span>
                  </label>
                )}
              </>
            );
          })()}

          {/* ── Manual fields ── */}
          {subtype === "manual" && (
            <>
              <div className="field">
                <input
                  name="investedAmount"
                  type="number"
                  inputMode="decimal"
                  value={form.investedAmount}
                  onChange={(e) => set("investedAmount", e.target.value)}
                  required
                  placeholder=" "
                />
                <label>Total invested (₹)</label>
              </div>
              <div className="field">
                <input
                  name="currentValue"
                  type="number"
                  inputMode="decimal"
                  value={form.currentValue}
                  onChange={(e) => set("currentValue", e.target.value)}
                  required
                  placeholder=" "
                />
                <label>Current value (₹)</label>
              </div>
            </>
          )}

          {form.type !== "sip" &&
            form.type !== "mf" &&
            form.type !== "lic" && (
              <DateField
                name="startDate"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                label="Start date"
                required
              />
            )}

          {categoryOptions && (
            <OptionField
              name="category"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              label={categoryLabel}
              placeholder=""
              options={categoryOptions}
            />
          )}

          <div className="field">
            <textarea
              name="notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder=" "
              rows="2"
              autoCorrect="off"
              spellCheck={false}
            />
            <label>Notes (optional)</label>
          </div>

          {typeHasGrace(form.type) && (
            <div className="inv-grace-section">
              <p className="inv-grace-msg">
                <i className="fa-solid fa-circle-info" />
                <span>
                  {typeInfo?.label} has a grace period of{" "}
                  <strong>
                    {graceLabel({
                      value:
                        form.graceValue ||
                        getGraceDefault(form.type)?.value,
                      unit: form.graceUnit,
                    })}
                  </strong>{" "}
                  after each due date before a missed contribution is treated
                  as lapsed. Change it below.
                </span>
              </p>
              <div className="inv-grace-row">
                <div className="field inv-grace-value">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={form.graceValue}
                    onChange={(e) => set("graceValue", e.target.value)}
                    placeholder=" "
                  />
                  <label>Grace period</label>
                </div>
                <OptionField
                  name="graceUnit"
                  className="inv-grace-unit"
                  value={form.graceUnit}
                  onChange={(e) => set("graceUnit", e.target.value)}
                  label="Unit"
                  options={[
                    { value: "days", label: "days" },
                    { value: "months", label: "months" },
                    { value: "instalments", label: "missed instalments" },
                  ]}
                />
              </div>
              <label className="inv-balance-toggle">
                <input
                  type="checkbox"
                  checked={!!form.penaltyEnabled}
                  onChange={(e) => set("penaltyEnabled", e.target.checked)}
                />
                <span className="inv-balance-toggle-text">
                  Charge a late penalty past grace
                  <span className="inv-balance-toggle-sub">
                    Added to a catch-up payment when you record an overdue
                    instalment
                  </span>
                </span>
              </label>
              {form.penaltyEnabled && (
                <div className="inv-grace-row">
                  <OptionField
                    name="penaltyMode"
                    className="inv-grace-unit"
                    value={form.penaltyMode}
                    onChange={(e) => set("penaltyMode", e.target.value)}
                    label="Penalty type"
                    options={[
                      { value: "flat", label: "Flat ₹" },
                      { value: "percent", label: "% of instalment" },
                    ]}
                  />
                  <div className="field inv-grace-value">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={form.penaltyAmount}
                      onChange={(e) => set("penaltyAmount", e.target.value)}
                      placeholder=" "
                    />
                    <label>
                      {form.penaltyMode === "percent"
                        ? "Percent"
                        : "Amount (₹)"}
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {form.type !== "sip" && (
            <label className="inv-balance-toggle">
              <input
                type="checkbox"
                checked={!!form.affectsBalance}
                onChange={(e) => set("affectsBalance", e.target.checked)}
              />
              <span className="inv-balance-toggle-text">
                Deduct from current balance
                <span className="inv-balance-toggle-sub">
                  {form.affectsBalance
                    ? "Invested amount will reduce your balance"
                    : "Portfolio tracking only — balance unaffected"}
                </span>
              </span>
            </label>
          )}

          {form.type !== "sip" &&
            form.affectsBalance &&
            multiBankEnabled &&
            accounts.length > 0 && (
              <BankChipSelector
                accounts={accounts}
                value={form.accountId}
                onChange={(id) => set("accountId", id)}
                label="Deducted from"
              />
            )}

          <div className="form-actions">
            <button type="button" className="cancel-button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="generic-button">
              {editTarget ? "Update" : "Add Investment"}
            </button>
          </div>
        </>
      )}
    </form>
  );
};

InvestmentForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  existing: PropTypes.object,
  prefillAmount: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  prefillType: PropTypes.string,
  onPayExisting: PropTypes.func,
};

export default memo(InvestmentForm);
