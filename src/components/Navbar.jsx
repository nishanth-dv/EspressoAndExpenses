import { memo, useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import NavigationLink from "../components/NavItem";
import UserMenu from "../components/UserMenu";
import NotificationBell from "../components/NotificationBell";
import HamBurgerButton from "../preStyledElements/hamburger/HamBurger";
import MobileNavDrawer from "../preStyledElements/mobileNavDrawer/mobileNavDrawer";
import { getEnabledPages } from "../utils/pages";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navRef = useRef(null);
  const preferences = useSelector(
    (state) => state.transactions.transactionData?.preferences,
  );
  const pages = getEnabledPages(preferences);

  // Same Visual Viewport pattern as the footer — keeps the navbar pinned to
  // the top of the *visible* area when the mobile URL bar collapses/expands.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (!navRef.current) return;
      navRef.current.style.top = `${Math.max(0, vv.offsetTop)}px`;
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Publish the rendered navbar height as --nav-h so .outlet can pad below it
  // without hard-coding a magic number.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        "--nav-h",
        `${el.offsetHeight}px`,
      );
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <nav ref={navRef} className="navbar">
      <div className="navbar-inner page-container">
        <UserMenu />
        <div className="nav-controls">
          <div className="flex nav-desktop">
            {pages.map((p) => (
              <NavigationLink key={p.key} to={p.route}>
                {p.label}
              </NavigationLink>
            ))}
          </div>
          <NotificationBell />
          <HamBurgerButton isOpen={isOpen} setIsOpen={setIsOpen} />
        </div>
      </div>
      <MobileNavDrawer open={isOpen} setIsOpen={setIsOpen} pages={pages} />
    </nav>
  );
};

export default memo(Navbar);
