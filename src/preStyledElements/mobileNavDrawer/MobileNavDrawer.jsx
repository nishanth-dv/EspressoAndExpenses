import { memo } from "react";
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
            <NavigationLink to="/Expense" onClick={onClose}>
              Expenses
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

export default memo(MobileNavDrawer);
