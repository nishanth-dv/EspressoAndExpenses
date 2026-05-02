import { memo } from "react";
import PropTypes from "prop-types";
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

HamburgerButton.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
};

export default memo(HamburgerButton);
