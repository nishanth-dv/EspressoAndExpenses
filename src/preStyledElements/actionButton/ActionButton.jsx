import { memo } from "react";
import "./ActionButton.css";

const Button = (props) => (
  <button {...props}>
    <span className="button-content">{props.children}</span>
  </button>
);

export default memo(Button);
