import PropTypes from "prop-types";

const WIDTHS = [72, 46, 60, 38, 54, 42];

export default function Skeleton({ className = "", count = 1, lines = 3, style }) {
  return Array.from({ length: count }).map((_, i) => (
    <div
      key={i}
      className={`skeleton ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      {Array.from({ length: lines }).map((_, j) => (
        <span
          key={j}
          className="skeleton-bar"
          style={{ width: `${WIDTHS[j % WIDTHS.length]}%` }}
        />
      ))}
    </div>
  ));
}

Skeleton.propTypes = {
  className: PropTypes.string,
  count: PropTypes.number,
  lines: PropTypes.number,
  style: PropTypes.object,
};
