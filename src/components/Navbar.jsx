import { memo, useState } from "react";
import { useSelector } from "react-redux";
import LogoutButton from "../components/Logout";
import NavigationLink from "../components/NavItem";
import HamBurgerButton from "../preStyledElements/hamburger/HamBurger";
import MobileNavDrawer from "../preStyledElements/mobileNavDrawer/mobileNavDrawer";

const Navbar = () => {
  const userInfo = useSelector((state) => state.auth.user);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="flex navbar">
      <img className="display-picture" src={userInfo?.picture} />
      <div className="flex nav-desktop">
        <NavigationLink to="/Expense">Expenses</NavigationLink>
        <NavigationLink to="/Invest">Investments</NavigationLink>
        <LogoutButton />
      </div>
      <HamBurgerButton isOpen={isOpen} setIsOpen={setIsOpen} />
      <MobileNavDrawer open={isOpen} setIsOpen={setIsOpen} />
    </nav>
  );
};

export default memo(Navbar);
