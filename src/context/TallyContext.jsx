import { createContext, useCallback, useContext, useMemo, useState } from "react";
import PropTypes from "prop-types";

const TallyContext = createContext(null);

export const useTally = () => useContext(TallyContext);

let seq = 0;
const nextId = () => `ty_${Date.now()}_${seq++}`;

export function TallyProvider({ children }) {
  const [recording, setRecording] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [smartSigns, setSmartSigns] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [calcView, setCalcView] = useState(false);

  const openCalc = useCallback(() => {
    setRecording(false);
    setReviewOpen(true);
    setCalcView(true);
  }, []);
  const closeCalc = useCallback(() => setCalcView(false), []);

  const start = useCallback(() => {
    setEntries([]);
    setSavedId(null);
    setReviewOpen(false);
    setCalcView(false);
    setRecording(true);
  }, []);

  const stop = useCallback(() => {
    setRecording(false);
    setCalcView(false);
    setReviewOpen(true);
  }, []);

  const resume = useCallback(() => {
    setReviewOpen(false);
    setCalcView(false);
    setRecording(true);
  }, []);

  const closeReview = useCallback(() => {
    setReviewOpen(false);
    setCalcView(false);
    setEntries([]);
    setSavedId(null);
  }, []);

  const cancel = useCallback(() => {
    setRecording(false);
    setReviewOpen(false);
    setCalcView(false);
    setEntries([]);
    setSavedId(null);
  }, []);

  const openSaved = useCallback((tally) => {
    setEntries(tally.entries || []);
    setSavedId(tally.id);
    setRecording(false);
    setCalcView(false);
    setReviewOpen(true);
  }, []);

  const toggleSmart = useCallback(() => {
    setSmartSigns((on) => {
      const next = !on;
      setEntries((e) =>
        e.map((x) => ({ ...x, sign: next ? x.hint || 1 : 1 })),
      );
      return next;
    });
  }, []);

  const addEntry = useCallback(
    (value, label, hint = 1, sourceKey) => {
      setEntries((e) => {
        if (sourceKey && e.some((x) => x.sourceKey === sourceKey)) return e;
        return [
          ...e,
          {
            id: nextId(),
            value,
            hint,
            sign: smartSigns ? hint : 1,
            label: label || "",
            sourceKey,
          },
        ];
      });
    },
    [smartSigns],
  );

  const removeEntry = useCallback(
    (id) => setEntries((e) => e.filter((x) => x.id !== id)),
    [],
  );

  const toggleSign = useCallback(
    (id) =>
      setEntries((e) =>
        e.map((x) => (x.id === id ? { ...x, sign: -x.sign } : x)),
      ),
    [],
  );

  const undoLast = useCallback(() => setEntries((e) => e.slice(0, -1)), []);
  const clearEntries = useCallback(() => setEntries([]), []);

  const total = useMemo(
    () => entries.reduce((s, x) => s + x.sign * x.value, 0),
    [entries],
  );

  const value = useMemo(
    () => ({
      recording,
      reviewOpen,
      entries,
      total,
      smartSigns,
      savedId,
      calcView,
      start,
      stop,
      resume,
      closeReview,
      cancel,
      openSaved,
      toggleSmart,
      openCalc,
      closeCalc,
      addEntry,
      removeEntry,
      toggleSign,
      undoLast,
      clearEntries,
    }),
    [
      recording,
      reviewOpen,
      entries,
      total,
      smartSigns,
      savedId,
      calcView,
      start,
      stop,
      resume,
      closeReview,
      cancel,
      openSaved,
      toggleSmart,
      openCalc,
      closeCalc,
      addEntry,
      removeEntry,
      toggleSign,
      undoLast,
      clearEntries,
    ],
  );

  return <TallyContext.Provider value={value}>{children}</TallyContext.Provider>;
}

TallyProvider.propTypes = {
  children: PropTypes.node,
};
