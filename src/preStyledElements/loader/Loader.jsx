import PropTypes from "prop-types";
import EspressoLoader from "./LoaderTheme";
import "./loader.css";

const Loader = ({ fullscreen = false, size = 96, label = "Brewing" }) => {
  const content = <EspressoLoader size={size} label={label} />;

  if (!fullscreen) return content;

  return <div className="loader-overlay">{content}</div>;
};

Loader.propTypes = {
  fullscreen: PropTypes.bool,
  size: PropTypes.number,
  label: PropTypes.string,
};

export default Loader;
