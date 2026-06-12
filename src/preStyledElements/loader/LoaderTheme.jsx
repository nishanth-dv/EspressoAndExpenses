import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const BLADES = 12;
const MIN_OPACITY = 0.15;

const Spinner = ({ label = "Brewing" }) => {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return (
    <div
      className={`app-spinner${paused ? " paused" : ""}`}
      role="status"
      aria-live="polite"
    >
      <svg viewBox="0 0 44 44" width="52" height="52" aria-hidden="true">
        <g className="spnr-blades">
          {Array.from({ length: BLADES }).map((_, i) => {
            const opacity = Math.max(
              MIN_OPACITY,
              1 - i * ((1 - MIN_OPACITY) / (BLADES - 1)),
            );
            return (
              <rect
                key={i}
                x="20.5"
                y="4"
                width="3"
                height="8"
                rx="1.5"
                fill="white"
                opacity={Math.round(opacity * 100) / 100}
                transform={`rotate(${i * 30} 22 22)`}
              />
            );
          })}
        </g>
      </svg>
      <p className="spnr-label">
        {label}
        <span className="ldr-dots" />
      </p>
    </div>
  );
};

Spinner.propTypes = { label: PropTypes.string };
export default Spinner;
