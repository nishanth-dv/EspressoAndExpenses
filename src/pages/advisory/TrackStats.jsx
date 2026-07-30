export default function TrackStats({ hitRate, avgReturn, resolved }) {
  return (
    <div className="grow-score-hero">
      <div className="grow-score-stat">
        <span className="grow-score-val">{Math.round(hitRate * 100)}%</span>
        <span className="grow-score-lbl">hit rate</span>
        <span className="grow-score-cap">reached the target before the stop</span>
      </div>
      <div className="grow-score-stat">
        <span className={`grow-score-val ${avgReturn >= 0 ? "is-up" : "is-down"}`}>
          {avgReturn >= 0 ? "+" : ""}
          {(avgReturn * 100).toFixed(1)}%
        </span>
        <span className="grow-score-lbl">average result</span>
        <span className="grow-score-cap">per signal, after trading costs</span>
      </div>
      <div className="grow-score-stat">
        <span className="grow-score-val">{resolved}</span>
        <span className="grow-score-lbl">signals scored</span>
        <span className="grow-score-cap">{resolved < 20 ? "too few to lean on" : "enough for a rough read"}</span>
      </div>
    </div>
  );
}
