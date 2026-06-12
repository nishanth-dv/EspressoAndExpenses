import PropTypes from "prop-types";
import Spinner from "./LoaderTheme";
import "./loader.css";

const Loader = ({ fullscreen = false, label = "Brewing" }) => {
  const content = <Spinner label={label} />;

  if (!fullscreen) return content;

  return <div className="loader-overlay">{content}</div>;
};

Loader.propTypes = {
  fullscreen: PropTypes.bool,
  label: PropTypes.string,
};

export default Loader;
