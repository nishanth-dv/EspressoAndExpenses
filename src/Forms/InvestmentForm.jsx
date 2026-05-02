import { memo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

function DropdownPortal({ anchorRef, children }) {
  const el = anchorRef.current;
  if (!el) return null;
  const { bottom, left, width } = el.getBoundingClientRect();
  const target = document.querySelector("dialog[open]") ?? document.body;
  return createPortal(
    <div style={{ position: "fixed", top: bottom + 4, left, width, zIndex: 9999 }}>
      {children}
    </div>,
    target
  );
}
import PropTypes from "prop-types";
import { INVESTMENT_TYPES } from "../utils/constants";
import { getTypeInfo } from "../utils/investmentUtils";
import { fetchCurrentPrice, searchMFSchemes, searchStockTickers, tickerPlaceholder } from "../utils/priceService";

const EMPTY_FORM = {
  name: "", type: "",
  ticker: "",
  quantity: "", buyPrice: "", currentPrice: "",
  investedAmount: "", interestRate: "", tenureMonths: "",
  currentValue: "",
  startDate: "", notes: "",
};

function formFromInvestment(inv) {
  return {
    name: inv.name ?? "",
    type: inv.type ?? "",
    ticker: inv.ticker ?? "",
    quantity: inv.quantity ?? "",
    buyPrice: inv.buyPrice ?? "",
    currentPrice: inv.currentPrice ?? "",
    investedAmount: inv.investedAmount ?? "",
    interestRate: inv.interestRate ?? "",
    tenureMonths: inv.tenureMonths ?? "",
    currentValue: inv.currentValue ?? "",
    startDate: inv.startDate ?? "",
    notes: inv.notes ?? "",
  };
}

const InvestmentForm = ({ onSubmit, onCancel, existing }) => {
  const [form, setForm] = useState(existing ? formFromInvestment(existing) : EMPTY_FORM);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState(null); // { ok: bool, text: string }
  const [mfResults, setMfResults] = useState([]);
  const [mfSearching, setMfSearching] = useState(false);
  const [stockResults, setStockResults] = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [stockSearchErr, setStockSearchErr] = useState(null);
  const debounceRef = useRef(null);
  const stockDebounceRef = useRef(null);
  const mfAnchorRef = useRef(null);
  const stockAnchorRef = useRef(null);

  const typeInfo = form.type ? getTypeInfo(form.type) : null;
  const subtype = typeInfo?.subtype;
  const isMF = form.type === "mf" || form.type === "sip";
  const isStockSearch = form.type === "stock" || form.type === "etf";

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
    setForm((f) => ({ ...f, name: scheme.schemeName, ticker: String(scheme.schemeCode) }));
    setMfResults([]);
  }

  // ── Fetch current price ─────────────────────────────
  async function handleFetchPrice() {
    if (!form.ticker) return;
    setFetching(true);
    setFetchMsg(null);
    try {
      const price = await fetchCurrentPrice(form.type, form.ticker);
      set("currentPrice", String(price));
      setFetchMsg({ ok: true, text: `Fetched: ${price}` });
    } catch (e) {
      setFetchMsg({ ok: false, text: e.message });
    } finally {
      setFetching(false);
    }
  }

  // ── Submit ──────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      name: form.name.trim(),
      type: form.type,
      ticker: form.ticker.trim() || undefined,
      startDate: form.startDate,
      notes: form.notes.trim(),
    };

    if (subtype === "unit") {
      payload.quantity = parseFloat(form.quantity);
      payload.buyPrice = parseFloat(form.buyPrice);
      payload.currentPrice = parseFloat(form.currentPrice);
      if (form.ticker) payload.priceUpdatedAt = existing?.priceUpdatedAt;
    } else if (subtype === "fixed") {
      payload.investedAmount = parseFloat(form.investedAmount);
      payload.interestRate = parseFloat(form.interestRate);
      payload.tenureMonths = parseInt(form.tenureMonths);
    } else {
      payload.investedAmount = parseFloat(form.investedAmount);
      payload.currentValue = parseFloat(form.currentValue);
    }

    onSubmit(payload);
  }

  const quantityLabel = form.type === "gold" ? "Quantity (grams)" : "Quantity / Units";
  const buyLabel = form.type === "gold" ? "Buy price per gram (₹)" : "Buy price per unit (₹)";
  const curLabel = form.type === "gold" ? "Current price per gram (₹)" : "Current price per unit (₹)";
  const principalLabel = form.type === "rd" ? "Monthly deposit (₹)" : "Principal amount (₹)";

  return (
    <form className="expense-form" onSubmit={handleSubmit}>
      {/* ── Type selector ── */}
      <p className="inv-form-section-label">Investment type</p>
      <div className="inv-type-grid">
        {INVESTMENT_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`inv-type-btn${form.type === t.key ? " inv-type-btn--active" : ""}`}
            style={form.type === t.key ? { borderColor: t.color, color: t.color } : {}}
            onClick={() => {
              setForm({ ...EMPTY_FORM, type: t.key });
              setFetchMsg(null);
              setMfResults([]);
              setStockResults([]); setStockSearchErr(null);
            }}
          >
            <i className={`fa-solid ${t.icon}`} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {form.type && (
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
                      setForm((f) => ({ ...f, name: e.target.value, ticker: "" }));
                      handleMFSearch(e.target.value);
                    }}
                    onBlur={() => setTimeout(() => setMfResults([]), 150)}
                    required
                    placeholder=" "
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
                        {r.exchange && <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 12 }}>{r.exchange}</span>}
                      </button>
                    ))}
                  </div>
                </DropdownPortal>
              )}
              {stockSearchErr && (
                <p className="inv-fetch-msg inv-fetch-msg--err inv-fetch-msg--search">
                  <i className="fa-solid fa-triangle-exclamation" /> {stockSearchErr}
                </p>
              )}
            </>
          ) : !isMF ? (
            <div className="field">
              <input name="name" value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required placeholder=" " autoCorrect="off" spellCheck={false} />
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
                    onChange={(e) => { set("ticker", e.target.value); setFetchMsg(null); }}
                    placeholder=" "
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <label>{tickerPlaceholder(form.type)}</label>
                </div>
              )}

              <div className="field">
                <input name="quantity" type="number" inputMode="decimal" value={form.quantity}
                  onChange={(e) => set("quantity", e.target.value)} required placeholder=" " />
                <label>{quantityLabel}</label>
              </div>

              <div className="field">
                <input name="buyPrice" type="number" inputMode="decimal" value={form.buyPrice}
                  onChange={(e) => set("buyPrice", e.target.value)} required placeholder=" " />
                <label>{buyLabel}</label>
              </div>

              {/* Current price + fetch button */}
              <div className="inv-price-row">
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <input name="currentPrice" type="number" inputMode="decimal" value={form.currentPrice}
                    onChange={(e) => { set("currentPrice", e.target.value); setFetchMsg(null); }}
                    required placeholder=" " />
                  <label>{curLabel}</label>
                </div>
                <button
                  type="button"
                  className={`inv-fetch-btn${fetching ? " inv-fetch-btn--loading" : ""}`}
                  onClick={handleFetchPrice}
                  disabled={fetching || !form.ticker}
                  title={form.ticker ? "Fetch current price" : "Enter a ticker first"}
                >
                  <i className={`fa-solid ${fetching ? "fa-spinner fa-spin" : "fa-rotate"}`} />
                  {!fetching && "Fetch"}
                </button>
              </div>
              {fetchMsg && (
                <p className={`inv-fetch-msg${fetchMsg.ok ? " inv-fetch-msg--ok" : " inv-fetch-msg--err"}`}>
                  {fetchMsg.ok ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-triangle-exclamation" />}
                  {" "}{fetchMsg.text}
                </p>
              )}
            </>
          )}

          {/* ── Fixed fields ── */}
          {subtype === "fixed" && (
            <>
              <div className="field">
                <input name="investedAmount" type="number" inputMode="decimal" value={form.investedAmount}
                  onChange={(e) => set("investedAmount", e.target.value)} required placeholder=" " />
                <label>{principalLabel}</label>
              </div>
              <div className="field">
                <input name="interestRate" type="number" inputMode="decimal" step="0.01" value={form.interestRate}
                  onChange={(e) => set("interestRate", e.target.value)} required placeholder=" " />
                <label>Interest rate (% p.a.)</label>
              </div>
              <div className="field">
                <input name="tenureMonths" type="number" inputMode="numeric" value={form.tenureMonths}
                  onChange={(e) => set("tenureMonths", e.target.value)} required placeholder=" " />
                <label>Tenure (months)</label>
              </div>
            </>
          )}

          {/* ── Manual fields ── */}
          {subtype === "manual" && (
            <>
              <div className="field">
                <input name="investedAmount" type="number" inputMode="decimal" value={form.investedAmount}
                  onChange={(e) => set("investedAmount", e.target.value)} required placeholder=" " />
                <label>Total invested (₹)</label>
              </div>
              <div className="field">
                <input name="currentValue" type="number" inputMode="decimal" value={form.currentValue}
                  onChange={(e) => set("currentValue", e.target.value)} required placeholder=" " />
                <label>Current value (₹)</label>
              </div>
            </>
          )}

          <div className="field">
            <input name="startDate" type="date" value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)} required placeholder=" " />
            <label>Start date</label>
          </div>

          <div className="field">
            <textarea name="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder=" " rows="2" autoCorrect="off" spellCheck={false} />
            <label>Notes (optional)</label>
          </div>

          <div className="form-actions">
            <button type="button" className="cancel-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="generic-button">
              {existing ? "Update" : "Add Investment"}
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
};

export default memo(InvestmentForm);
