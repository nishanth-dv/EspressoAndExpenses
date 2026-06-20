import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const TICKS = 12;
const CYCLE_MS = 1200;

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
      <svg
        className="tick-ring"
        viewBox="0 0 44 44"
        width="46"
        height="46"
        aria-hidden="true"
      >
        {Array.from({ length: TICKS }).map((_, i) => (
          <rect
            key={i}
            className="tick"
            x="20.9"
            y="3.5"
            width="2.2"
            height="7"
            rx="1.1"
            transform={`rotate(${i * (360 / TICKS)} 22 22)`}
            // Negative stagger phases each tick so the bright point glides
            // smoothly around the ring with a trailing fade. Reversing the
            // index ((TICKS - i)) makes the comet travel clockwise.
            style={{
              animationDelay: `${
                -(((TICKS - i) % TICKS) * (CYCLE_MS / TICKS)) / 1000
              }s`,
            }}
          />
        ))}
      </svg>
      <p className="spnr-label">
        <span className="spnr-word">{label}</span>
        {/* Dots live in fixed slots and only fade/scale, so the word never
            shifts as they animate. */}
        <span className="spnr-dots" aria-hidden="true">
          <span className="spnr-dot" />
          <span className="spnr-dot" />
          <span className="spnr-dot" />
        </span>
      </p>
    </div>
  );
};

Spinner.propTypes = { label: PropTypes.string };
export default Spinner;
