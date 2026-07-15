import { useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import Modal from "../../preStyledElements/modal/Modal";
import { INR } from "../../utils/dashboardUtils";
import { useTally } from "../../context/TallyContext";
import TallyCalculator from "./TallyCalculator";
import {
  persistSaveTally,
  persistUpdateTally,
  persistDeleteTally,
} from "../../redux/slices/transactionSlice";

export default function TallyModal() {
  const dispatch = useDispatch();
  const {
    reviewOpen,
    entries,
    total,
    smartSigns,
    savedId,
    closeReview,
    resume,
    removeEntry,
    toggleSign,
    toggleSmart,
    clearEntries,
    openCalc,
    closeCalc,
    calcView,
  } = useTally();

  if (!reviewOpen) return null;

  const count = entries.length;

  const copyBreakdown = () => {
    const lines = entries.map(
      (e) =>
        `${e.sign < 0 ? "-" : ""}${INR.format(e.value)}${e.label ? `  · ${e.label}` : ""}`,
    );
    lines.push(`Total: ${INR.format(total)}`);
    navigator.clipboard?.writeText(lines.join("\n"));
  };

  const saveNew = () => {
    dispatch(
      persistSaveTally({
        id: `tly_${Date.now()}`,
        createdAt: new Date().toISOString(),
        title: "Tally",
        total,
        entries,
      }),
    );
    closeReview();
  };

  const saveChanges = () => {
    dispatch(
      persistUpdateTally({
        id: savedId,
        createdAt: new Date().toISOString(),
        title: "Tally",
        total,
        entries,
      }),
    );
    closeReview();
  };

  const removeSaved = () => {
    dispatch(persistDeleteTally(savedId));
    closeReview();
  };

  return (
    <Modal open onClose={closeReview} title="Tally">
      <AnimatePresence mode="wait" initial={false}>
      {calcView ? (
        <motion.div
          key="calc"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
        >
          <TallyCalculator seed={total} onBack={closeCalc} />
        </motion.div>
      ) : (
      <motion.div
        key="list"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.16 }}
      ><div className="tally-modal">
        <div className="tally-head">
          <span className="tally-head-total">{INR.format(total)}</span>
          <span className="tally-head-meta">
            {count} item{count === 1 ? "" : "s"}
            {count > 1 && ` · avg ${INR.format(total / count)}`}
          </span>
          <div className="tally-head-controls">
            <button
              type="button"
              className={`tally-smart${smartSigns ? " tally-smart--on" : ""}`}
              onClick={toggleSmart}
              title="Net income minus expenses automatically"
            >
              <i className="fa-solid fa-wand-magic-sparkles" /> Smart signs
            </button>
            {count > 0 &&
              (savedId ? (
                <button
                  type="button"
                  className="tally-clear"
                  onClick={removeSaved}
                >
                  <i className="fa-solid fa-trash-can" /> Delete
                </button>
              ) : (
                <button
                  type="button"
                  className="tally-clear"
                  onClick={clearEntries}
                >
                  <i className="fa-solid fa-eraser" /> Clear all
                </button>
              ))}
          </div>
        </div>

        {count === 0 ? (
          <p className="tally-empty">
            Nothing here yet — resume tapping to add amounts.
          </p>
        ) : (
          <ul className="tally-rows">
            {entries.map((e) => (
              <li key={e.id} className="tally-row">
                <button
                  type="button"
                  className={`tally-sign${e.sign < 0 ? " tally-sign--neg" : ""}`}
                  onClick={() => toggleSign(e.id)}
                  title="Toggle add / subtract"
                >
                  {e.sign < 0 ? "−" : "+"}
                </button>
                <span className="tally-row-value">{INR.format(e.value)}</span>
                {e.label && <span className="tally-row-label">{e.label}</span>}
                <button
                  type="button"
                  className="tally-row-remove"
                  onClick={() => removeEntry(e.id)}
                  aria-label="Remove"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="tally-foot">
          <div className="tally-foot-tools">
            <button type="button" className="tally-tool" onClick={openCalc}>
              <i className="fa-solid fa-calculator" /> Calculator
            </button>
            {count > 0 && (
              <button
                type="button"
                className="tally-tool"
                onClick={copyBreakdown}
              >
                <i className="fa-solid fa-clipboard" /> Copy
              </button>
            )}
            <button type="button" className="tally-tool" onClick={resume}>
              <i className="fa-solid fa-plus" /> Add more
            </button>
          </div>

          <button
            type="button"
            className="tally-primary"
            onClick={savedId ? saveChanges : saveNew}
            disabled={count === 0}
          >
            <i className="fa-solid fa-floppy-disk" />
            {savedId ? "Save changes" : "Save to ledger"}
          </button>
        </div>
      </div>
      </motion.div>
      )}
      </AnimatePresence>
    </Modal>
  );
}
