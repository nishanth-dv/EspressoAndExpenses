import { memo } from "react";
import PropTypes from "prop-types";
import { NavLink } from "react-router-dom";

const NavigationLink = (props) => (
  <NavLink
    className={({ isActive }) => {
      return isActive ? "nav-item nav-item-active" : "nav-item";
    }}
    {...props}
  >
    {props.children}
  </NavLink>
);

NavigationLink.propTypes = {
  to: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

export default memo(NavigationLink);
