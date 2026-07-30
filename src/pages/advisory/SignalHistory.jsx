const MIN_RESOLVED = 5;

export default function SignalHistory({ history, name }) {
  if (!history || history.resolved < MIN_RESOLVED) return null;
  const { resolved, wins, hitRate, medianWinBars, horizon } = history;
  const thin = resolved < 10;
  return (
    <div className={`grow-hist${thin ? " grow-hist--thin" : ""}`}>
      <i className="fa-solid fa-clock-rotate-left" />
      <span className="grow-hist-txt">
        <strong>{resolved}</strong> past {name.toLowerCase()} on this symbol ·{" "}
        <strong>{wins}</strong> hit target within {horizon} bars ({Math.round(hitRate * 100)}%)
        {medianWinBars != null && (
          <>
            {" · usually by bar "}
            <strong>{medianWinBars}</strong>
          </>
        )}
      </span>
      <span className="grow-hist-warn">
        {thin ? "too few to lean on" : "raw win rate — not compared against a random entry"}
      </span>
    </div>
  );
}
