import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const EspressoLoader = ({ size = 96, label = "Brewing" }) => {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPaused(document.hidden);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return (
    <div
      className={`espresso-loader ${paused ? "paused" : ""}`}
      style={{ width: size, height: size * 1.2 }}
      role="status"
      aria-live="polite"
    >
      <div className="steam steam-1" />
      <div className="steam steam-2" />
      <div className="steam steam-3" />

      <div className="cup-wrapper">
        <div className="cup">
          <div className="coffee">
            <div className="crema" />
          </div>
        </div>
        <div className="handle" />
      </div>

      <p className="espresso-label">
        {label}
        <span className="dots" />
      </p>
    </div>
  );
};

EspressoLoader.propTypes = {
  size: PropTypes.number,
  label: PropTypes.string,
};

export default EspressoLoader;
