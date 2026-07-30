import PropTypes from "prop-types";
import { motion } from "framer-motion";
import ShortcutMenuItems from "./ShortcutMenuItems";

export function ShortcutsTrigger({ count, variants, onOpen }) {
  if (count === 0) return null;
  return (
    <motion.button
      type="button"
      variants={variants}
      className="toolkit-menu-item al-item al-shortcut-trigger"
      role="menuitem"
      onClick={onOpen}
    >
      <span className="toolkit-menu-icon al-shortcut-icon">
        <i className="fa-solid fa-bolt" />
      </span>
      <span className="toolkit-menu-text">
        <span className="toolkit-menu-title">Shortcuts</span>
        <span className="toolkit-menu-sub">
          {count} saved · jump straight there
        </span>
      </span>
      <i className="fa-solid fa-chevron-right al-shortcut-jump" />
    </motion.button>
  );
}

ShortcutsTrigger.propTypes = {
  count: PropTypes.number.isRequired,
  variants: PropTypes.object,
  onOpen: PropTypes.func.isRequired,
};

export default function ShortcutsPanel({ shortcuts, variants, onBack, onRun }) {
  return (
    <>
      <div className="al-panel-head">
        <button
          type="button"
          className="al-back-btn"
          onClick={onBack}
          aria-label="Back to actions"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <span className="al-panel-title">Shortcuts</span>
      </div>
      <ShortcutMenuItems
        shortcuts={shortcuts}
        variants={variants}
        onRun={onRun}
      />
    </>
  );
}

ShortcutsPanel.propTypes = {
  shortcuts: PropTypes.array.isRequired,
  variants: PropTypes.object,
  onBack: PropTypes.func.isRequired,
  onRun: PropTypes.func.isRequired,
};
