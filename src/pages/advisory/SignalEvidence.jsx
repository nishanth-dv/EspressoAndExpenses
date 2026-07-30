import { rawEdgeFor, edgeFor } from "../../utils/grow/signals/contract";

const NUM = new Intl.NumberFormat("en-IN");

export default function SignalEvidence({ type, interval }) {
  const row = rawEdgeFor(type, interval);
  if (!row) {
    return (
      <div className="grow-ev grow-ev--none">
        <i className="fa-solid fa-circle-question" />
        <span>
          <strong>Not benchmarked yet</strong> — this lane has never been tested against a random entry, so its score
          falls back to a raw win rate.
        </span>
      </div>
    );
  }
  const eff = edgeFor(type, interval);
  return (
    <div className="grow-ev">
      <span className="grow-ev-head">
        <i className="fa-solid fa-flask-vial" />
        Why this pattern is trusted
      </span>
      <span className="grow-ev-main">
        <strong>
          {eff >= 0 ? "+" : ""}
          {eff.toFixed(2)}pp
        </strong>{" "}
        per trade over buying the same stock on a random day
      </span>
      <span className="grow-ev-sub">
        from <strong>{NUM.format(row.n)}</strong> tested trades
        {row.pos != null && row.windows != null && (
          <>
            {" · positive in "}
            <strong>
              {row.pos} of {row.windows}
            </strong>{" "}
            six-month test windows
          </>
        )}
        {row.edge !== eff && (
          <>
            {" · raw "}
            {row.edge >= 0 ? "+" : ""}
            {row.edge.toFixed(2)}pp, discounted for sample size and how much it varied period to period
          </>
        )}
      </span>
    </div>
  );
}
