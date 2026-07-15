import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { computeCoverage } from "../../utils/advisory/coverage";
import { useDeepLinkNav } from "../../hooks/useDeepLinkNav";

const EASE = [0.25, 0.46, 0.45, 0.94];

// "Profile 60% complete — 2 more unlock sharper advice." Expands to a checklist
// where each unfilled item says what it switches on and jumps you to fix it.
export default function CoverageMeter({ data, profile, onOpenProfile }) {
  const deepNav = useDeepLinkNav();
  const cov = useMemo(() => computeCoverage(data, profile), [data, profile]);
  const [open, setOpen] = useState(false);

  if (cov.pct >= 100) return null;

  const go = (item) => {
    if (item.where === "cards") deepNav("/Solvency");
    else onOpenProfile?.();
  };

  return (
    <div className="adv-coverage">
      <button
        type="button"
        className="adv-coverage-head"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="adv-coverage-top">
          <span className="adv-coverage-title">
            <i className="fa-solid fa-circle-nodes" /> Profile {cov.pct}% complete
          </span>
          <span className="adv-coverage-sub">
            {cov.missing.length} more unlock{cov.missing.length === 1 ? "s" : ""}{" "}
            sharper advice
            <i
              className={`fa-solid fa-chevron-${open ? "up" : "down"} adv-coverage-chev`}
            />
          </span>
        </div>
        <div className="adv-coverage-track">
          <motion.div
            className="adv-coverage-bar"
            initial={{ width: 0 }}
            animate={{ width: `${cov.pct}%` }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="adv-coverage-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            style={{ overflow: "hidden" }}
          >
            {cov.items.map((it) => (
              <li
                key={it.key}
                className={`adv-coverage-item${it.done ? " adv-coverage-item--done" : ""}`}
              >
                <i
                  className={`fa-solid ${it.done ? "fa-circle-check" : "fa-circle-plus"} adv-coverage-item-ico`}
                />
                <span className="adv-coverage-item-body">
                  <span className="adv-coverage-item-label">{it.label}</span>
                  <span className="adv-coverage-item-unlocks">
                    Unlocks {it.unlocks}
                  </span>
                </span>
                {!it.done && (
                  <button
                    type="button"
                    className="adv-coverage-item-go"
                    onClick={() => go(it)}
                  >
                    Add <i className="fa-solid fa-arrow-right" />
                  </button>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
