import { memo } from "react";
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

export default memo(NavigationLink);
