import { memo, useState } from "react";
import { useSelector } from "react-redux";
import LogoutButton from "../components/Logout";
import NavigationLink from "../components/NavItem";
import HamBurgerButton from "../preStyledElements/hamburger/HamBurger";
import MobileNavDrawer from "../preStyledElements/mobileNavDrawer/mobileNavDrawer";
import { useTheme } from "../hooks/useTheme";

const Navbar = () => {
  const userInfo = useSelector((state) => state.auth.user);
  const [isOpen, setIsOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();

  return (
    <nav className="flex navbar">
      <img
        className="display-picture"
        src={userInfo?.picture}
        alt={userInfo?.name}
        referrerPolicy="no-referrer"
      />
      <div className="nav-controls">
        <div
          className="theme-toggle-bar"
          onClick={toggleTheme}
          role="switch"
          aria-checked={theme === "light"}
          aria-label="Toggle theme"
        >
          <div className={`toggle-thumb${theme === "dark" ? " toggle-thumb--right" : ""}`} />
          <span className={`toggle-icon${theme === "light" ? " toggle-icon--active" : ""}`}>
            <i className="fa-solid fa-sun" />
          </span>
          <span className={`toggle-icon${theme === "dark" ? " toggle-icon--active" : ""}`}>
            <i className="fa-solid fa-moon" />
          </span>
        </div>
        <div className="flex nav-desktop">
          <NavigationLink to="/Dashboard">Dashboard</NavigationLink>
          <NavigationLink to="/Transactions">Transactions</NavigationLink>
          <NavigationLink to="/Invest">Investments</NavigationLink>
          <LogoutButton />
        </div>
        <HamBurgerButton isOpen={isOpen} setIsOpen={setIsOpen} />
      </div>
      <MobileNavDrawer open={isOpen} setIsOpen={setIsOpen} />
    </nav>
  );
};

export default memo(Navbar);
