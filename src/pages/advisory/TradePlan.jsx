const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function pctOf(v, entry) {
  if (!entry) return "";
  const p = (v / entry - 1) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function horizonLabel(interval, bars) {
  if (interval === "btst") return "exit next day";
  if (interval === "1d") return `~${bars}d hold`;
  if (interval === "1wk") return `~${bars}w hold`;
  if (interval === "1mo") return `~${bars}mo hold`;
  return `~${bars} bars`;
}

export default function TradePlan({ plan, tradeType, interval }) {
  if (!plan) return null;
  return (
    <div className="grow-plan">
      <span className="grow-plan-action">BUY</span>
      <span className="grow-plan-cell">
        <span className="grow-plan-k">Entry</span>
        <span className="grow-plan-v">{INR.format(plan.entry)}</span>
      </span>
      <span className="grow-plan-cell grow-plan-cell--target">
        <span className="grow-plan-k">Target</span>
        <span className="grow-plan-v">
          {INR.format(plan.target)} <em>{pctOf(plan.target, plan.entry)}</em>
        </span>
      </span>
      <span className="grow-plan-cell grow-plan-cell--stop">
        <span className="grow-plan-k">Stop</span>
        <span className="grow-plan-v">
          {INR.format(plan.stop)} <em>{pctOf(plan.stop, plan.entry)}</em>
        </span>
      </span>
      <span className="grow-plan-cell">
        <span className="grow-plan-k">R:R</span>
        <span className="grow-plan-v">{plan.rr}</span>
      </span>
      {tradeType && (
        <span className="grow-plan-tag">
          {tradeType} · {horizonLabel(interval, plan.horizonBars)}
        </span>
      )}
    </div>
  );
}
