import PropTypes from "prop-types";
import { motion } from "framer-motion";

export default function ShortcutMenuItems({ shortcuts, variants, onRun }) {
  return shortcuts.map((s) => (
    <motion.button
      key={s.key}
      type="button"
      variants={variants}
      className="toolkit-menu-item al-item al-item--shortcut"
      role="menuitem"
      onClick={() => onRun(s.run)}
    >
      <span className="toolkit-menu-icon al-shortcut-icon">
        <i className={`fa-solid ${s.icon}`} />
      </span>
      <span className="toolkit-menu-text">
        <span className="toolkit-menu-title">{s.label}</span>
        <span className="toolkit-menu-sub">{s.sub}</span>
      </span>
      <i className="fa-solid fa-arrow-right al-shortcut-jump" />
    </motion.button>
  ));
}

ShortcutMenuItems.propTypes = {
  shortcuts: PropTypes.array.isRequired,
  variants: PropTypes.object,
  onRun: PropTypes.func.isRequired,
};
