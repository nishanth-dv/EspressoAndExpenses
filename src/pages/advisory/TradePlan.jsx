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

export default function TradePlan({ plan, tradeType, interval, direction }) {
  if (!plan) return null;
  if (direction === "bearish") {
    return (
      <div className="grow-plan grow-plan--noplan">
        <span className="grow-plan-action grow-plan-action--bear">Bearish</span>
        <span className="grow-plan-noplan-txt">
          No trade plan — this engine only issues long calls, so a short entry has never been tested and is not
          something you can act on here. Shown as context for what the chart is doing.
        </span>
      </div>
    );
  }
  return (
    <div className="grow-plan">
      <span className="grow-plan-action">Bullish</span>
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
      {tradeType && (
        <span className="grow-plan-tag">
          {tradeType} · {horizonLabel(interval, plan.horizonBars)}
        </span>
      )}
      <span className="grow-plan-note">
        These exits define the trade the measured edge was scored on — target at 2× this stock’s typical move, stop at
        1.5×, closed after {plan.horizonBars} bars either way. Change them and that number no longer applies.
      </span>
    </div>
  );
}
