import { memo } from "react";
import PropTypes from "prop-types";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";

const NavigationLink = ({ to, children, pill = false, ...rest }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      isActive ? "nav-item nav-item-active" : "nav-item"
    }
    {...rest}
  >
    {({ isActive }) => (
      <>
        {pill && isActive && (
          <motion.span
            layoutId="nav-pill"
            className="nav-pill"
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          />
        )}
        <span className="nav-item-label">{children}</span>
      </>
    )}
  </NavLink>
);

NavigationLink.propTypes = {
  to: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  pill: PropTypes.bool,
};

export default memo(NavigationLink);
