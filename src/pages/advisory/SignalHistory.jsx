export default function SignalHistory({ history, name }) {
  if (!history || !history.resolved) return null;
  const { resolved, wins, hitRate, medianWinBars, horizon } = history;
  const thin = resolved < 5;
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
      {thin && <span className="grow-hist-warn">too few to lean on</span>}
    </div>
  );
}
