import { memo } from "react";
import PropTypes from "prop-types";

// A labelled native date / datetime input that keeps the app's floating label
// and adds a "Now" quick-set chip in the top-right corner (on the border, like
// the label) so it never competes with the input for width — same look whether
// the field is full-width or sharing a row. onChange matches a native input: it
// receives a { target: { name, value } } event so form handlers work unchanged.
function nowValue(withTime) {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000,
  ).toISOString();
  return withTime ? local.slice(0, 16) : local.slice(0, 10);
}

const DateField = ({
  name,
  value,
  onChange,
  label,
  withTime = false,
  required = false,
  disabled = false,
  invalid = false,
  min,
  max,
  nowLabel = "Now",
}) => {
  const setNow = () =>
    onChange({ target: { name, value: nowValue(withTime) } });

  return (
    <div className={`field date-field${invalid ? " field--invalid" : ""}`}>
      <input
        type={withTime ? "datetime-local" : "date"}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        min={min}
        max={max}
      />
      <div className="date-field-float">
        <span className="date-field-float-label">{label}</span>
        <button
          type="button"
          className="date-field-now"
          onClick={setNow}
          disabled={disabled}
        >
          <i className="fa-regular fa-clock" />
          {nowLabel}
        </button>
      </div>
    </div>
  );
};

DateField.propTypes = {
  name: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  withTime: PropTypes.bool,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  invalid: PropTypes.bool,
  min: PropTypes.string,
  max: PropTypes.string,
  nowLabel: PropTypes.string,
};

export default memo(DateField);
