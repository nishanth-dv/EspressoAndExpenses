import { memo } from "react";
import "./Hamburger.css";

const HamburgerButton = ({ isOpen, setIsOpen }) => {
  return (
    <button
      className="hamburger"
      aria-label="Toggle menu"
      aria-expanded={isOpen}
      onClick={() => {
        setIsOpen((prevState) => !prevState);
      }}
    >
      <span />
      <span />
      <span />
    </button>
  );
};

export default memo(HamburgerButton);
