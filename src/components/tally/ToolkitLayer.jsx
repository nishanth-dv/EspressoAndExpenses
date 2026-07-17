import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { useTally } from "../../context/TallyContext";
import { useToolkitTools } from "../../hooks/useToolkitTools";
import NotesDrawer from "../notes/NotesDrawer";
import CalendarModal from "../calendar/CalendarModal";
import "../../styles/notes.css";

const POP = { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] };

// The Toolbox launcher — the idle entry point that replaced the standalone
// "Tally" FAB. Tapping it reveals the enabled tools (Tally · Notes · Calendar).
// With only one tool enabled it launches that directly (no menu). While Tally
// is recording/reviewing, this hides so its own total-FAB / HUD takes the slot.
// When the "floating" action style is active, the unified ActionLauncher owns
// the FAB (tools + add actions), so this only mounts the tool surfaces.
export default function ToolkitLayer() {
  const { recording, reviewOpen } = useTally();
  const { pathname } = useLocation();
  const tools = useToolkitTools();
  const actionStyle = useSelector(
    (s) => s.transactions.transactionData?.preferences?.actionStyle ?? "docked",
  );
  const floating = actionStyle === "floating";
  const [menuOpen, setMenuOpen] = useState(false);
  const fabRef = useRef(null);
  const menuRef = useRef(null);

  const routeOk = !/^\/(Preferences|Admin)/i.test(pathname);
  const visible =
    !floating && routeOk && tools.length > 0 && !recording && !reviewOpen;
  const multi = tools.length > 1;

  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (fabRef.current?.contains(e.target) || menuRef.current?.contains(e.target))
        return;
      setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onFab = () => {
    if (multi) {
      setMenuOpen((o) => !o);
      return;
    }
    tools[0]?.run();
  };

  return (
    <>
      <AnimatePresence>
        {visible && menuOpen && multi && (
          <motion.div
            ref={menuRef}
            className="toolkit-menu"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={POP}
            role="menu"
          >
            {tools.map((t) => (
              <button
                key={t.key}
                type="button"
                className="toolkit-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  t.run();
                }}
              >
                <span className="toolkit-menu-icon">
                  <i className={`fa-solid ${t.icon}`} />
                </span>
                <span className="toolkit-menu-text">
                  <span className="toolkit-menu-title">{t.label}</span>
                  <span className="toolkit-menu-sub">{t.sub}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.button
            ref={fabRef}
            type="button"
            className={`tally-fab toolkit-fab${menuOpen ? " toolkit-fab--open" : ""}`}
            onClick={onFab}
            aria-haspopup={multi ? "menu" : undefined}
            aria-expanded={multi ? menuOpen : undefined}
            title="Toolbox"
            aria-label="Toolbox"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.94, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            whileHover={{ scale: 1.05, y: -2, opacity: 1 }}
            whileTap={{ scale: 0.93 }}
            transition={POP}
          >
            <i className={`fa-solid ${menuOpen ? "fa-xmark" : "fa-toolbox"}`} />{" "}
            {menuOpen ? "Close" : "Toolbox"}
          </motion.button>
        )}
      </AnimatePresence>

      <NotesDrawer />
      <CalendarModal />
    </>
  );
}
