import { memo } from "react";
import useInvestmentInsights from "../hooks/useInvestmentInsights";
import { getTypeInfo } from "../utils/investmentUtils";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const HOLDING_THRESHOLD = 0.25;
const TYPE_THRESHOLD = 0.4;
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

const ServerInsightsCard = () => {
  const enabled = dbEnabled(currentEmail());
  const { loading, data, error } = useInvestmentInsights(enabled);
  if (!enabled) return null;

  const conc = data?.concentration;
  const alloc = data?.allocationByType;

  const suggestions = [];
  if (conc && conc.totalValue > 0) {
    const h = conc.topHolding;
    const t = conc.topType;
    if (h && h.pct >= HOLDING_THRESHOLD) {
      suggestions.push({
        kind: "warn",
        text: `${h.label} is ${pct(h.pct)} of your portfolio. Consider trimming it — holding more than ∼25% in a single position concentrates your risk.`,
      });
    }
    if (t && t.pct >= TYPE_THRESHOLD) {
      suggestions.push({
        kind: "warn",
        text: `${getTypeInfo(t.type).label} makes up ${pct(t.pct)} of your portfolio. Consider spreading across more asset types to diversify.`,
      });
    }
    if (suggestions.length === 0) {
      suggestions.push({
        kind: "ok",
        text: "No single holding or asset type dominates — your portfolio looks reasonably diversified.",
      });
    }
  }

  return (
    <div className="server-card">
      <div className="server-card-head">
        <span className="server-card-title">
          <i className="fa-solid fa-scale-balanced" /> Portfolio insights
        </span>
        <span className="server-card-tag">advisory</span>
      </div>

      {loading && <p className="server-card-msg">Analyzing…</p>}
      {error && (
        <p className="server-card-msg server-card-msg--err">
          Couldn&apos;t load: {error}
        </p>
      )}

      {suggestions.map((s, i) => (
        <p key={i} className={`server-insight server-insight--${s.kind}`}>
          <i
            className={`fa-solid ${s.kind === "warn" ? "fa-triangle-exclamation" : "fa-circle-check"}`}
          />{" "}
          {s.text}
        </p>
      ))}

      {alloc && alloc.length > 0 && (
        <>
          <p className="server-card-subhead">Allocation by type</p>
          <ul className="server-card-list">
            {alloc.map((r) => {
              const info = getTypeInfo(r.type);
              return (
                <li key={r.type} className="server-card-row">
                  <span
                    className="server-card-dot"
                    style={{ background: info.color }}
                  />
                  <span className="server-card-name">{info.label}</span>
                  <span className="server-card-amt">
                    {INR.format(r.invested ?? 0)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {conc && conc.totalValue > 0 && (
        <p className="server-card-disclaimer">
          Educational insight, not investment advice.
        </p>
      )}
    </div>
  );
};

export default memo(ServerInsightsCard);
