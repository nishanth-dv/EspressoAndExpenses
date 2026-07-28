import { BIAS_PARTS } from "../../utils/grow/signals/bias";

const ICON = { bullish: "fa-arrow-trend-up", bearish: "fa-arrow-trend-down", neutral: "fa-arrows-left-right" };
const WORD = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" };

export default function SymbolBias({ bias, compact = false, conflict = false }) {
  if (!bias) return null;
  const pct = Math.round(Math.abs(bias.score) * 100);
  return (
    <div className={`grow-bias grow-bias--${bias.label}${compact ? " grow-bias--compact" : ""}`}>
      <span className="grow-bias-chip">
        <i className={`fa-solid ${ICON[bias.label]}`} />
        {WORD[bias.label]}
        <em>{pct}%</em>
      </span>
      {conflict && (
        <span
          className="grow-bias-conflict"
          title="Just context — in 5 years of testing, setups that disagreed with the symbol's lean did no worse."
        >
          <i className="fa-solid fa-code-compare" /> symbol leans the other way
        </span>
      )}
      {!compact && (
        <div className="grow-bias-parts">
          {BIAS_PARTS.map((p) => {
            const v = bias.parts[p.key] ?? 0;
            return (
              <div key={p.key} className="grow-bias-part" title={p.hint}>
                <span className="grow-bias-part-label">{p.label}</span>
                <span className="grow-bias-bar">
                  <span
                    className={`grow-bias-fill${v < 0 ? " is-neg" : ""}`}
                    style={{ width: `${Math.abs(v) * 50}%`, [v < 0 ? "right" : "left"]: "50%" }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
