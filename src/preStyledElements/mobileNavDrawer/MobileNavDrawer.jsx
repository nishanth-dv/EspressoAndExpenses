import { memo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import PropTypes from "prop-types";
import NavigationLink from "../../components/NavItem";
import "./MobileNavDrawer.css";

const MobileNavDrawer = ({ open, setIsOpen }) => {
  const onClose = () => setIsOpen(false);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.aside
            className="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            <nav className="drawer-menu">
              <div className="flex column">
                <NavigationLink to="/Dashboard" onClick={onClose}>
                  Dashboard
                </NavigationLink>
                <NavigationLink to="/Transactions" onClick={onClose}>
                  Transactions
                </NavigationLink>
                <NavigationLink to="/Invest" onClick={onClose}>
                  Investments
                </NavigationLink>
                <NavigationLink to="/Solvency" onClick={onClose}>
                  Solvency Audit
                </NavigationLink>
              </div>
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
};

MobileNavDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
};

export default memo(MobileNavDrawer);
