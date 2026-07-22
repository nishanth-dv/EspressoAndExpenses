// The one confidence control used by every advisory tab — a distinct coloured
// score pill that opens a transparent, line-by-line breakdown of how the number
// was reached. Rendering it from a single component keeps Understand, Review and
// Actions pixel-identical, and the reveal animates a padding-free wrapper (the
// padded panel sits inside it) so the card grows cleanly instead of jumping.
import { motion, AnimatePresence } from "framer-motion";
import { confClass } from "../../utils/advisory/confidence";

const EASE = [0.25, 0.46, 0.45, 0.94];

// The clickable score pill. Pass onToggle to make it a button; omit it for a
// static badge (e.g. the "Do this next" highlight).
const BAND_CLASS = { high: "adv-conf--high", moderate: "adv-conf--mid", low: "adv-conf--low" };

export function ConfidenceBadge({ score, band, open = false, onToggle }) {
  const cls = `adv-conf ${(band && BAND_CLASS[band]) || confClass(score)}`;
  if (!onToggle) return <span className={cls}>{score}</span>;
  return (
    <button
      type="button"
      className={`${cls} adv-conf--btn`}
      aria-expanded={open}
      title="How sure we are — tap for the breakdown"
      onClick={onToggle}
    >
      {score}
      <i
        className={`fa-solid fa-chevron-down adv-conf-chev${open ? " adv-conf-chev--open" : ""}`}
      />
    </button>
  );
}

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

// The breakdown accordion. `card` carries `confidenceBreakdown` (from
// withConfidence) and, optionally, `math` — a one-line calculation to append.
export function ConfidenceReveal({ open, card }) {
  const bd = card.confidenceBreakdown;
  return (
    <AnimatePresence initial={false}>
      {open && bd && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          style={{ overflow: "hidden" }}
        >
          <div className="adv-conf-panel">
            <div className="adv-conf-panel-head">
              <span>Confidence</span>
              <strong>
                {bd.total}
                <span className="adv-conf-panel-max">/100</span> · {bd.band}
              </strong>
            </div>
            <ul className="adv-conf-rows">
              {bd.rows.map((r) => (
                <li key={r.label} className="adv-conf-row">
                  <span className="adv-conf-row-label">{r.label}</span>
                  <span className="adv-conf-row-hint">{r.hint}</span>
                  <span
                    className={`adv-conf-row-pts${r.points < 0 ? " adv-conf-row-pts--neg" : ""}`}
                  >
                    {fmt(r.points)}
                  </span>
                </li>
              ))}
              <li className="adv-conf-row adv-conf-row--total">
                <span className="adv-conf-row-label">Score</span>
                <span className="adv-conf-row-hint" />
                <span className="adv-conf-row-pts">{bd.total}</span>
              </li>
            </ul>
            {card.math && <p className="adv-conf-math">{card.math}</p>}
            <p className="adv-conf-meaning">{bd.meaning}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
