import { memo, useState } from "react";
import PropTypes from "prop-types";
import "../styles/daypicker.css";

function ordinal(n) {
  const v = n % 100;
  const suffix = ["th", "st", "nd", "rd"][v % 10] ?? "th";
  return v >= 11 && v <= 13 ? `${n}th` : `${n}${suffix}`;
}

const DayPicker = ({ value, onChange, label, required }) => {
  const [open, setOpen] = useState(false);

  function handleSelect(day) {
    onChange(String(day));
    setOpen(false);
  }

  return (
    <div className="field sol-day-picker">
      <button
        type="button"
        className={`sol-day-trigger${open ? " sol-day-trigger--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sol-day-trigger-val">
          {value ? ordinal(parseInt(value)) : " "}
        </span>
      </button>
      <label>
        {label}
        {required && !value && <span className="sol-day-required"> *</span>}
      </label>
      {open && (
        <div className="sol-day-grid">
          {Array.from({ length: 31 }, (_, i) => {
            const day = i + 1;
            const active = value !== "" && parseInt(value) === day;
            return (
              <button
                key={day}
                type="button"
                className={`sol-day-btn${active ? " sol-day-btn--active" : ""}`}
                onClick={() => handleSelect(day)}
                aria-pressed={active}
              >
                {day}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

DayPicker.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
  required: PropTypes.bool,
};

export default memo(DayPicker);
