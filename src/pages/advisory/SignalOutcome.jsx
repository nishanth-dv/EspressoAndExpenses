const VERDICT = {
  win: {
    icon: "fa-circle-check",
    label: "Hit its target",
    why: "price reached the target before it ever touched the stop",
  },
  loss: {
    icon: "fa-circle-xmark",
    label: "Stopped out",
    why: "price hit the stop first — a bar that touched both counts as a loss here, never a win",
  },
  flat: {
    icon: "fa-circle-minus",
    label: "Closed flat",
    why: "neither target nor stop was reached, so it closed at the end of the hold window",
  },
};

export default function SignalOutcome({ outcome, horizonBars = 10 }) {
  if (!outcome) return null;

  if (outcome.status === "pending") {
    const left = Math.max(0, horizonBars - (outcome.bars ?? 0));
    return (
      <div className="grow-oc grow-oc--pending">
        <span className="grow-oc-head">
          <i className="fa-solid fa-hourglass-half" />
          Not settled yet
        </span>
        <span className="grow-oc-why">
          {left > 0
            ? `Still inside its hold window — ${left} more ${left === 1 ? "bar" : "bars"} before it can be scored.`
            : "Waiting on the next bar before it can be scored."}
        </span>
      </div>
    );
  }

  const v = VERDICT[outcome.status];
  if (!v) return null;
  const pct = (outcome.returnPct * 100).toFixed(1);
  const bars = outcome.bars;

  return (
    <div className={`grow-oc grow-oc--${outcome.status}`}>
      <span className="grow-oc-head">
        <i className={`fa-solid ${v.icon}`} />
        {v.label}
        <b>
          {outcome.returnPct >= 0 ? "+" : ""}
          {pct}%
        </b>
      </span>
      <span className="grow-oc-why">
        What actually happened after this signal, not a projection — {v.why}
        {bars != null && `, ${bars === 1 ? "one bar" : `${bars} bars`} later`}. Net of trading costs.
      </span>
    </div>
  );
}
