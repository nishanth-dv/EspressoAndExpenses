import { memo } from "react";
import PropTypes from "prop-types";
import NavigationLink from "../../components/NavItem";
import LogoutButton from "../../components/Logout";
import "./MobileNavDrawer.css";

const MobileNavDrawer = ({ open, setIsOpen }) => {
  const onClose = () => {
    setIsOpen((prevState) => !prevState);
  };
  return (
    <>
      <div
        className={`drawer-backdrop ${open ? "show" : ""} flex nav-mobile`}
        onClick={onClose}
      />
      <aside className={`drawer ${open ? "open" : ""}`}>
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
          </div>
          <LogoutButton />
        </nav>
      </aside>
    </>
  );
};

MobileNavDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
};

export default memo(MobileNavDrawer);
