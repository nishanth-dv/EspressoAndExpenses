import { memo, useState, useMemo, useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import Modal from "../preStyledElements/modal/Modal";
import InvestmentForm from "../Forms/InvestmentForm";
import { INVESTMENT_TYPES } from "../utils/constants";
import { INR } from "../utils/dashboardUtils";
import {
  calcReturns, getPortfolioSummary, getAllocationData,
  getInvestmentInsights, getTypeInfo,
} from "../utils/investmentUtils";
import {
  persistAddInvestment, persistUpdateInvestment, persistDeleteInvestment,
} from "../redux/slices/transactionSlice";
import { fetchCurrentPrice } from "../utils/priceService";
import { filterInvestmentsByDate, getFilterLabel } from "../utils/filterUtils";
import "../styles/investment.css";

function useCurrentTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark"
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute("data-theme") || "dark")
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ── Portfolio Hero ────────────────────────────────────

function PortfolioHero({ investments }) {
  const { totalInvested, totalCurrent, totalReturn, returnPct } = useMemo(
    () => getPortfolioSummary(investments),
    [investments]
  );
  const pos = totalReturn >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";

  if (investments.length === 0) return null;

  return (
    <div className="inv-hero">
      <div className="inv-hero-card">
        <p className="inv-hero-label">Total Invested</p>
        <p className="inv-hero-value">{INR.format(totalInvested)}</p>
      </div>
      <div className="inv-hero-card">
        <p className="inv-hero-label">Current Value</p>
        <p className="inv-hero-value" style={{ color: retColor }}>{INR.format(totalCurrent)}</p>
      </div>
      <div className="inv-hero-card">
        <p className="inv-hero-label">Total Returns</p>
        <p className="inv-hero-value" style={{ color: retColor }}>
          {pos ? "+" : ""}{INR.format(totalReturn)}
        </p>
      </div>
      <div className="inv-hero-card">
        <p className="inv-hero-label">Return %</p>
        <p className="inv-hero-value" style={{ color: retColor }}>
          {pos ? "+" : ""}{returnPct.toFixed(2)}%
        </p>
      </div>
    </div>
  );
}

// ── Insight Cards ─────────────────────────────────────

function InsightCards({ investments }) {
  const insights = useMemo(() => getInvestmentInsights(investments), [investments]);
  if (insights.length === 0) return null;
  return (
    <div className="dash-section">
      <p className="dash-section-title">Portfolio Pulse</p>
      <div className="inv-insight-strip">
        {insights.map((ins, i) => (
          <div key={i} className={`inv-insight-card${ins.positive ? "" : " inv-insight--neg"}`}>
            <i className={`fa-solid ${ins.icon} inv-insight-icon`} />
            <div>
              <p className="inv-insight-label">{ins.label}</p>
              <p className="inv-insight-value">{ins.value}</p>
              <p className="inv-insight-sub">{ins.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Holdings List ─────────────────────────────────────

function fmtUpdated(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SellModal({ inv, investments, onConfirm, onClose }) {
  const [qty, setQty] = useState("");
  const totalQty = inv.quantity;
  const sellQty = parseFloat(qty) || 0;
  const remaining = Math.max(0, totalQty - sellQty);
  const isValid = sellQty > 0 && sellQty <= totalQty;
  const isAll = isValid && remaining < 0.00001;

  return (
    <div className="inv-sell-form">
      <p className="inv-sell-total">
        Currently holding <strong>{totalQty} units</strong>
        {inv._lots > 1 && <span className="inv-orders-badge" style={{ marginLeft: 6 }}>{inv._lots} orders</span>}
      </p>
      <div className="field">
        <input
          type="number" inputMode="decimal" min="0.0001" max={totalQty} step="any"
          value={qty} onChange={(e) => setQty(e.target.value)}
          placeholder=" " autoFocus
        />
        <label>Quantity to sell</label>
      </div>
      {isValid && (
        <p className={`inv-sell-remaining${isAll ? " inv-sell-remaining--all" : ""}`}>
          {isAll
            ? "Selling all units will remove this holding"
            : `${+remaining.toFixed(6)} units remaining after sell`}
        </p>
      )}
      <div className="form-actions inv-sell-actions">
        <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
        <button
          type="button" className="inv-sell-confirm-btn"
          disabled={!isValid} onClick={() => onConfirm(sellQty)}
        >
          <i className="fa-solid fa-arrow-trend-down" /> Sell
        </button>
      </div>
    </div>
  );
}

function HoldingCard({ inv, onEdit, onDelete, onSell }) {
  const { investedAmount, currentValue, absoluteReturn, returnPct } = calcReturns(inv);
  const info = getTypeInfo(inv.type);
  const pos = absoluteReturn >= 0;
  const retColor = pos ? "var(--amount-income)" : "var(--amount-expense)";

  return (
    <div className="inv-holding-card">
      <div className="inv-holding-header">
        <span className="inv-type-badge" style={{ background: info.color + "22", color: info.color }}>
          <i className={`fa-solid ${info.icon}`} /> {info.label}
        </span>
        <div className="inv-holding-actions">
          {(!inv._lots || inv._lots === 1) && (
            <button className="inv-icon-btn" onClick={() => onEdit(inv)} title="Edit">
              <i className="fa-solid fa-pen" />
            </button>
          )}
          {info.subtype === "unit" && (
            <button className="inv-icon-btn inv-icon-btn--sell" onClick={() => onSell(inv)} title="Sell">
              <i className="fa-solid fa-arrow-trend-down" />
            </button>
          )}
          <button className="inv-icon-btn inv-icon-btn--del" onClick={() => onDelete(inv._ids ?? inv.id, inv.name, inv._lots)} title="Delete">
            <i className="fa-solid fa-trash" />
          </button>
        </div>
      </div>
      <p className="inv-holding-name">{inv.name}</p>

      {info.subtype === "unit" && (
        <p className="inv-holding-meta">
          {inv.quantity} units
          {inv._lots > 1 && <span className="inv-orders-badge"> {inv._lots} orders</span>}
          {" · "}{inv._lots > 1 ? "Avg buy" : "Buy"} {INR.format(inv.buyPrice)} → Now {INR.format(inv.currentPrice)}
          {inv.priceUpdatedAt && (
            <span className="inv-price-updated"> · updated {fmtUpdated(inv.priceUpdatedAt)}</span>
          )}
        </p>
      )}
      {info.subtype === "fixed" && (
        <p className="inv-holding-meta">
          {inv.interestRate}% p.a. · {inv.tenureMonths} months
        </p>
      )}

      <div className="inv-holding-amounts">
        <div>
          <p className="inv-holding-amt-label">Invested</p>
          <p className="inv-holding-amt">{INR.format(investedAmount)}</p>
        </div>
        <div>
          <p className="inv-holding-amt-label">Current</p>
          <p className="inv-holding-amt" style={{ color: retColor }}>{INR.format(currentValue)}</p>
        </div>
        <div>
          <p className="inv-holding-amt-label">Returns</p>
          <p className="inv-holding-amt" style={{ color: retColor }}>
            {pos ? "+" : ""}{INR.format(absoluteReturn)}
            <span className="inv-holding-pct"> ({pos ? "+" : ""}{returnPct.toFixed(1)}%)</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Allocation Ring ───────────────────────────────────

const RADIAN = Math.PI / 180;
function AllocationLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct }) {
  if (pct < 5) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {pct}%
    </text>
  );
}

function AllocationRing({ investments, theme }) {
  const data = useMemo(() => getAllocationData(investments), [investments]);
  if (data.length === 0) return null;

  const tooltipStyle = {
    background: theme === "light" ? "#e0d6d5" : "#1a1a2e",
    border: "1px solid rgba(128,128,128,0.2)",
    borderRadius: 8,
    fontSize: 13,
  };

  return (
    <div className="dash-section inv-allocation">
      <p className="dash-section-title">Portfolio Allocation</p>
      <div className="inv-allocation-inner">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              dataKey="value"
              labelLine={false}
              label={AllocationLabel}
            >
              {data.map((entry) => (
                <Cell key={entry.type} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v) => INR.format(v)}
              contentStyle={tooltipStyle}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="inv-alloc-legend">
          {data.map((d) => (
            <div key={d.type} className="inv-alloc-legend-item">
              <span className="inv-alloc-dot" style={{ background: d.color }} />
              <span className="inv-alloc-label">{d.label}</span>
              <span className="inv-alloc-pct">{d.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────

const InvestmentPage = () => {
  const dispatch = useDispatch();
  const theme = useCurrentTheme();
  const driveReady = useSelector((state) => state.transactions.status === "ready");
  const investments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? []
  );
  const filter = useSelector((state) => state.filter);
  const filteredInvestments = useMemo(
    () => filterInvestmentsByDate(investments, filter),
    [investments, filter]
  );
  const isFiltered = filter.mode !== "all";
  const filterLabel = isFiltered ? getFilterLabel(filter) : null;

  const [invModal, setInvModal] = useState(null); // null | "add" | investment object
  const [sortBy, setSortBy] = useState("returns"); // "returns" | "value" | "name"
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null); // { updated, failed }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { ids: string[], name: string, count: number }
  const [sellTarget, setSellTarget] = useState(null); // grouped inv object

  const sortedInvestments = useMemo(() => {
    // Group unit-type investments by type+ticker (or type+name if no ticker)
    const grouped = new Map();
    for (const inv of filteredInvestments) {
      const info = getTypeInfo(inv.type);
      if (info.subtype !== "unit") {
        grouped.set(inv.id, inv);
        continue;
      }
      const key = `${inv.type}|${inv.ticker || inv.name}`;
      if (!grouped.has(key)) {
        grouped.set(key, { ...inv, _ids: [inv.id], _lots: 1 });
      } else {
        const g = grouped.get(key);
        const totalQty = g.quantity + inv.quantity;
        const weightedBuy = (g.buyPrice * g.quantity + inv.buyPrice * inv.quantity) / totalQty;
        const latestPrice = (!g.priceUpdatedAt || (inv.priceUpdatedAt && inv.priceUpdatedAt > g.priceUpdatedAt))
          ? { currentPrice: inv.currentPrice, priceUpdatedAt: inv.priceUpdatedAt }
          : { currentPrice: g.currentPrice, priceUpdatedAt: g.priceUpdatedAt };
        grouped.set(key, {
          ...g,
          quantity: totalQty,
          buyPrice: weightedBuy,
          ...latestPrice,
          _ids: [...g._ids, inv.id],
          _lots: g._lots + 1,
        });
      }
    }
    return [...grouped.values()].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const ra = calcReturns(a);
      const rb = calcReturns(b);
      if (sortBy === "returns") return rb.returnPct - ra.returnPct;
      return rb.currentValue - ra.currentValue;
    });
  }, [filteredInvestments, sortBy]);

  const handleSaveInvestment = useCallback((inv) => {
    if (invModal && typeof invModal === "object") {
      dispatch(persistUpdateInvestment(inv));
    } else {
      dispatch(persistAddInvestment(inv));
    }
    setInvModal(null);
  }, [dispatch, invModal]);

  const handleDeleteInvestment = useCallback((ids, name, count) => {
    const many = Array.isArray(ids) ? ids : [ids];
    setDeleteConfirm({ ids: many, name, count: many.length });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    deleteConfirm?.ids.forEach((id) => dispatch(persistDeleteInvestment(id)));
    setDeleteConfirm(null);
  }, [deleteConfirm, dispatch]);

  const handleConfirmSell = useCallback((qtyToSell) => {
    const inv = sellTarget;
    const lots = (inv._ids
      ? inv._ids.map((id) => investments.find((i) => i.id === id)).filter(Boolean)
      : [inv]
    ).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")); // newest first (LIFO)

    let remaining = qtyToSell;
    for (const lot of lots) {
      if (remaining <= 0) break;
      if (lot.quantity <= remaining + 0.00001) {
        dispatch(persistDeleteInvestment(lot.id));
        remaining -= lot.quantity;
      } else {
        dispatch(persistUpdateInvestment({ ...lot, quantity: +(lot.quantity - remaining).toFixed(6) }));
        remaining = 0;
      }
    }
    setSellTarget(null);
  }, [sellTarget, investments, dispatch]);

  const handleRefreshPrices = useCallback(async () => {
    const refreshable = investments.filter(
      (inv) => getTypeInfo(inv.type).subtype === "unit" && inv.ticker
    );
    if (refreshable.length === 0) return;
    setRefreshing(true);
    setRefreshResult(null);
    let updated = 0, failed = 0;
    for (const inv of refreshable) {
      try {
        const price = await fetchCurrentPrice(inv.type, inv.ticker);
        dispatch(persistUpdateInvestment({
          ...inv,
          currentPrice: price,
          priceUpdatedAt: new Date().toISOString(),
        }));
        updated++;
      } catch {
        failed++;
      }
    }
    setRefreshing(false);
    setRefreshResult({ updated, failed });
    setTimeout(() => setRefreshResult(null), 4000);
  }, [investments, dispatch]);

  const isEmpty = investments.length === 0;
  const isFilteredEmpty = isFiltered && filteredInvestments.length === 0 && !isEmpty;

  return (
    <div className="dashboard">
      {/* ── Filter banner ── */}
      {isFiltered && (
        <p className="inv-filter-banner">
          <i className="fa-solid fa-filter" /> Investments started in <strong>{filterLabel}</strong>
          {isFilteredEmpty
            ? " — none found"
            : ` — ${filteredInvestments.length} holding${filteredInvestments.length !== 1 ? "s" : ""}`}
        </p>
      )}

      {/* ── Hero ── */}
      <PortfolioHero investments={filteredInvestments} />

      {/* ── Allocation + Holdings ── */}
      <div className="inv-two-col">
        <AllocationRing investments={filteredInvestments} theme={theme} />

        <div className="dash-section inv-holdings-section">
          <div className="inv-holdings-header">
            <p className="dash-section-title" style={{ margin: 0 }}>Holdings</p>
            <div className="inv-holdings-toolbar">
              <select
                className="inv-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="returns">Sort: Returns</option>
                <option value="value">Sort: Value</option>
                <option value="name">Sort: Name</option>
              </select>
              {investments.some((i) => getTypeInfo(i.type).subtype === "unit" && i.ticker) && (
                <button
                  className="inv-add-btn"
                  onClick={handleRefreshPrices}
                  disabled={refreshing}
                  title="Refresh live prices for all holdings with a ticker"
                >
                  <i className={`fa-solid ${refreshing ? "fa-spinner fa-spin" : "fa-rotate"}`} />
                  {refreshing ? "" : "Refresh"}
                </button>
              )}
              <button
                className="inv-add-btn"
                disabled={!driveReady}
                onClick={() => setInvModal("add")}
              >
                <i className="fa-solid fa-plus" /> Add
              </button>
            </div>
            {refreshResult && (
              <p className="inv-refresh-result">
                {refreshResult.updated > 0 && <span className="inv-fetch-msg--ok">✓ {refreshResult.updated} updated</span>}
                {refreshResult.failed > 0 && <span className="inv-fetch-msg--err"> · {refreshResult.failed} failed</span>}
              </p>
            )}
          </div>

          {isEmpty ? (
            <div className="inv-empty">
              <i className="fa-solid fa-seedling inv-empty-icon" />
              <p>No investments yet.</p>
              <p className="inv-empty-sub">Add your first one to start tracking growth.</p>
              <button className="generic-button" onClick={() => setInvModal("add")} disabled={!driveReady}>
                Add Investment
              </button>
            </div>
          ) : isFilteredEmpty ? (
            <div className="inv-empty">
              <i className="fa-solid fa-calendar-xmark inv-empty-icon" />
              <p>No investments in this period.</p>
              <p className="inv-empty-sub">No holdings were started in <strong>{filterLabel}</strong>.</p>
            </div>
          ) : (
            <div className="inv-holdings-list">
              {sortedInvestments.map((inv) => (
                <HoldingCard
                  key={inv.id}
                  inv={inv}
                  onEdit={(i) => setInvModal(i)}
                  onDelete={handleDeleteInvestment}
                  onSell={(i) => setSellTarget(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Portfolio Pulse ── */}
      <InsightCards investments={filteredInvestments} />

      {/* ── Modals ── */}
      {invModal && (
        <Modal
          open={!!invModal}
          onClose={() => setInvModal(null)}
          title={typeof invModal === "object" ? "Edit Investment" : "Add Investment"}
        >
          <InvestmentForm
            onSubmit={handleSaveInvestment}
            onCancel={() => setInvModal(null)}
            existing={typeof invModal === "object" ? invModal : undefined}
          />
        </Modal>
      )}

      {deleteConfirm && (
        <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Remove Investment">
          <div className="inv-delete-confirm">
            <p className="inv-delete-confirm-msg">
              {deleteConfirm.count > 1
                ? <>Remove <strong>{deleteConfirm.name}</strong> and all <strong>{deleteConfirm.count} orders</strong>? This cannot be undone.</>
                : <>Remove <strong>{deleteConfirm.name}</strong>? This cannot be undone.</>
              }
            </p>
            <div className="form-actions">
              <button type="button" className="cancel-button" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button type="button" className="inv-delete-confirm-btn" onClick={handleConfirmDelete}>
                <i className="fa-solid fa-trash" /> Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {sellTarget && (
        <Modal open={!!sellTarget} onClose={() => setSellTarget(null)} title={`Sell ${sellTarget.name}`}>
          <SellModal
            inv={sellTarget}
            investments={investments}
            onConfirm={handleConfirmSell}
            onClose={() => setSellTarget(null)}
          />
        </Modal>
      )}
    </div>
  );
};

export default memo(InvestmentPage);
