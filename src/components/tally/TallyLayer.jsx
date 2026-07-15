import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { INR } from "../../utils/dashboardUtils";
import { captureNumberAt } from "../../utils/tallyCapture";
import { useTally } from "../../context/TallyContext";
import TallyModal from "./TallyModal";
import "../../styles/tally.css";

const POP = { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] };

const IGNORE = ".tally-hud, .tally-fab, .tally-flash, .modal, .modal-overlay";

export default function TallyLayer() {
  const {
    recording,
    reviewOpen,
    entries,
    total,
    start,
    stop,
    cancel,
    addEntry,
    undoLast,
  } = useTally();

  const [flashes, setFlashes] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const suppressRef = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const { pathname } = useLocation();
  const tallyEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.tallyEnabled ?? true,
  );
  const active = tallyEnabled && !/^\/(Preferences|Admin)/i.test(pathname);

  const flash = useCallback((rect, value, kind = "add") => {
    if (!rect) return;
    const id = `${Date.now()}_${Math.random()}`;
    setFlashes((f) => [
      ...f,
      { id, x: rect.left + rect.width / 2, y: rect.top, value, kind },
    ]);
    setTimeout(() => setFlashes((f) => f.filter((x) => x.id !== id)), 850);
  }, []);

  useEffect(() => {
    if (!recording) setExpanded(false);
  }, [recording]);

  // Capture taps on numbers while recording (capture phase so the underlying
  // card's own onClick never fires).
  useEffect(() => {
    if (!recording || !active) return undefined;
    const onClick = (e) => {
      if (Date.now() < suppressRef.current) return;
      if (e.target.closest && e.target.closest(IGNORE)) return;
      const hit = captureNumberAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      if (
        hit.sourceKey &&
        entriesRef.current.some((x) => x.sourceKey === hit.sourceKey)
      ) {
        flash(hit.rect, hit.value, "dup");
        return;
      }
      addEntry(hit.value, hit.label, hit.hint, hit.sourceKey);
      flash(hit.rect, hit.value);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [recording, active, addEntry, flash]);

  // Long-press any number to arm Tally and capture that first number.
  useEffect(() => {
    if (!active) return undefined;
    let timer = null;
    let sx = 0;
    let sy = 0;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onDown = (e) => {
      if (recording || reviewOpen) return;
      if (
        e.target.closest &&
        e.target.closest("button, a, input, textarea, select, .tally-fab")
      )
        return;
      sx = e.clientX;
      sy = e.clientY;
      timer = setTimeout(() => {
        const hit = captureNumberAt(sx, sy);
        if (!hit) return;
        suppressRef.current = Date.now() + 600;
        start();
        addEntry(hit.value, hit.label, hit.hint, hit.sourceKey);
        flash(hit.rect, hit.value);
      }, 500);
    };
    const onMove = (e) => {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10))
        clear();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", clear);
    document.addEventListener("pointercancel", clear);
    return () => {
      clear();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", clear);
      document.removeEventListener("pointercancel", clear);
    };
  }, [recording, reviewOpen, active, start, addEntry, flash]);

  if (!active) return null;

  return (
    <>
      {/* Idle entry lives in the Toolbox launcher now (ToolkitLayer). This FAB
          only appears once Tally is recording — showing the running total and
          expanding into the HUD on tap. */}
      <AnimatePresence>
        {recording && !reviewOpen && !expanded && (
          <motion.button
            type="button"
            className="tally-fab tally-fab--rec"
            onClick={() => setExpanded(true)}
            title="Tap to review or add more"
            aria-label="Expand Tally"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.92, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            whileHover={{ scale: 1.06, y: -2, opacity: 1 }}
            whileTap={{ scale: 0.92 }}
            transition={POP}
          >
            <span className="tally-rec-dot" />
            {INR.format(total)}
            <span className="tally-fab-count">{entries.length}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {recording && expanded && (
          <motion.div
            className="tally-hud"
            initial={{ opacity: 0, x: "-50%", y: 24, scale: 0.92 }}
            animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
            exit={{ opacity: 0, x: "-50%", y: 24, scale: 0.92 }}
            transition={POP}
          >
            <button
              type="button"
              className="tally-hud-btn"
              onClick={() => setExpanded(false)}
              aria-label="Collapse"
            >
              <i className="fa-solid fa-chevron-down" />
            </button>
            <div className="tally-hud-info">
              <span className="tally-hud-total">{INR.format(total)}</span>
              <span className="tally-hud-count">
                {entries.length} item{entries.length === 1 ? "" : "s"}
                {entries.length === 0 && " · tap any amount"}
              </span>
            </div>
            <div className="tally-hud-actions">
              <button
                type="button"
                className="tally-hud-btn"
                onClick={undoLast}
                disabled={!entries.length}
                aria-label="Undo last"
              >
                <i className="fa-solid fa-rotate-left" />
              </button>
              <button
                type="button"
                className="tally-hud-btn tally-hud-btn--done"
                onClick={stop}
              >
                Review
              </button>
              <button
                type="button"
                className="tally-hud-btn"
                onClick={cancel}
                aria-label="Cancel"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {flashes.map((f) => (
        <span
          key={f.id}
          className={`tally-flash${f.kind === "dup" ? " tally-flash--dup" : ""}`}
          style={{ left: f.x, top: f.y }}
        >
          {f.kind === "dup" ? (
            <>
              <i className="fa-solid fa-check" /> Added
            </>
          ) : (
            `+${INR.format(f.value)}`
          )}
        </span>
      ))}

      <TallyModal />
    </>
  );
}
