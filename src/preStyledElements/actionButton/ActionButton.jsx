import { memo } from "react";
import PropTypes from "prop-types";
import "./ActionButton.css";

const Button = (props) => (
  <button {...props}>
    <span className="button-content">{props.children}</span>
  </button>
);

Button.propTypes = {
  children: PropTypes.node.isRequired,
  onClick: PropTypes.func,
  className: PropTypes.string,
};

export default memo(Button);
