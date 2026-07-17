import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTally } from "../context/TallyContext";
import { useToolkitTools } from "../hooks/useToolkitTools";

const POP = { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] };

const MENU_VARIANTS = {
  hidden: { opacity: 0, y: 10, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.14,
      ease: [0.25, 0.46, 0.45, 0.94],
      staggerChildren: 0.028,
      staggerDirection: -1,
      delayChildren: 0.02,
    },
  },
  exit: { opacity: 0, y: 10, scale: 0.96, transition: { duration: 0.14 } },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export default function ActionLauncher({ addActions = [], driveReady = true }) {
  const { recording, reviewOpen } = useTally();
  const { pathname } = useLocation();
  const tools = useToolkitTools();
  const [open, setOpen] = useState(false);
  const fabRef = useRef(null);
  const menuRef = useRef(null);

  const routeOk = !/^\/(Preferences|Admin)/i.test(pathname);
  const hasContent = addActions.length > 0 || tools.length > 0;
  const visible = routeOk && hasContent && !recording && !reviewOpen;
  const hasAdd = addActions.length > 0;

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (
        fabRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target)
      )
        return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const runItem = (fn) => {
    setOpen(false);
    fn?.();
  };

  return (
    <>
      <AnimatePresence>
        {visible && open && (
          <motion.div
            ref={menuRef}
            className="toolkit-menu action-launcher-menu"
            variants={MENU_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="menu"
          >
            {addActions.map((a) => {
              const locked = a.needsDrive && !driveReady;
              return (
                <motion.button
                  key={a.key}
                  type="button"
                  variants={ITEM_VARIANTS}
                  className={`toolkit-menu-item al-item${a.primary ? " al-item--primary" : ""}`}
                  role="menuitem"
                  disabled={locked}
                  title={
                    a.primary
                      ? "Suggested — your most likely action right now, based on recent entries"
                      : undefined
                  }
                  onClick={() => runItem(a.onClick)}
                >
                  <span
                    className="toolkit-menu-icon al-item-icon"
                    style={a.tone ? { color: a.tone } : undefined}
                  >
                    <i className={`fa-solid ${a.icon}`} />
                  </span>
                  <span className="toolkit-menu-text">
                    <span className="toolkit-menu-title al-item-title">
                      {a.label}
                      {a.primary && (
                        <span className="al-primary-badge">
                          <i className="fa-solid fa-star" /> Suggested
                        </span>
                      )}
                    </span>
                    <span className="toolkit-menu-sub">{a.sub}</span>
                  </span>
                </motion.button>
              );
            })}

            {hasAdd && tools.length > 0 && (
              <motion.div variants={ITEM_VARIANTS} className="al-divider" />
            )}

            {tools.map((t) => (
              <motion.button
                key={t.key}
                type="button"
                variants={ITEM_VARIANTS}
                className="toolkit-menu-item al-item"
                role="menuitem"
                onClick={() => runItem(t.run)}
              >
                <span className="toolkit-menu-icon">
                  <i className={`fa-solid ${t.icon}`} />
                </span>
                <span className="toolkit-menu-text">
                  <span className="toolkit-menu-title">{t.label}</span>
                  <span className="toolkit-menu-sub">{t.sub}</span>
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.button
            ref={fabRef}
            type="button"
            className={`tally-fab action-launcher-fab${open ? " action-launcher-fab--open" : ""}`}
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            title="Actions"
            aria-label="Actions"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.96, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            whileHover={{ scale: 1.05, y: -2, opacity: 1 }}
            whileTap={{ scale: 0.93 }}
            transition={POP}
          >
            <i
              className={`fa-solid ${open ? "fa-xmark" : "fa-bolt"}`}
            />{" "}
            {open ? "Close" : "Actions"}
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
