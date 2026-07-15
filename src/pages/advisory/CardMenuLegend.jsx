// Explains the per-card Done / Snooze / Dismiss controls. Shown on both the
// Actions and Review lenses so the icon buttons are self-describing.
export default function CardMenuLegend() {
  return (
    <div className="adv-legend">
      <span className="adv-legend-item">
        <i className="fa-solid fa-check adv-legend-ic adv-legend-ic--done" />
        <span>
          <strong>Done</strong> — you acted on it
        </span>
      </span>
      <span className="adv-legend-item">
        <i className="fa-solid fa-clock adv-legend-ic adv-legend-ic--snooze" />
        <span>
          <strong>Snooze</strong> — hide 30 days
        </span>
      </span>
      <span className="adv-legend-item">
        <i className="fa-solid fa-xmark adv-legend-ic adv-legend-ic--dismiss" />
        <span>
          <strong>Dismiss</strong> — not for me
        </span>
      </span>
      <span className="adv-legend-note">
        Hidden cards move to the “Hidden” tab — tap to undo.
      </span>
    </div>
  );
}
