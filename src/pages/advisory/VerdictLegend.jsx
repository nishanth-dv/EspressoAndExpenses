import { VERDICTS } from "../../utils/advisory/reviewEngine";

// Explains the Review verdict chips. Tapping a chip on a holding opens a guide.
const ITEMS = [
  { v: "keep", desc: "on track" },
  { v: "watch", desc: "monitor it" },
  { v: "trim", desc: "reduce it" },
  { v: "switch", desc: "replace it" },
  { v: "exit", desc: "get out" },
];

export default function VerdictLegend() {
  return (
    <div className="adv-legend adv-vlegend">
      {ITEMS.map((it) => (
        <span key={it.v} className="adv-legend-item">
          <span className={`adv-verdict adv-verdict--${it.v} adv-vlegend-chip`}>
            <i className={`fa-solid ${VERDICTS[it.v].icon}`} />
          </span>
          <span>
            <strong>{VERDICTS[it.v].label}</strong> — {it.desc}
          </span>
        </span>
      ))}
      <span className="adv-legend-note">
        Tap a verdict on a holding for a step-by-step guide.
      </span>
    </div>
  );
}
