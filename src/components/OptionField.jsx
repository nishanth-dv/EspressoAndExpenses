import { memo } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import BankLogo from "./BankLogo";
import LogoSelect from "./LogoSelect";

// A drop-in replacement for a labelled <select> that honours the user's
// "One-tap fields" preference: when on it renders a tap-to-pick chip strip
// (one tap instead of open-then-pick), otherwise the native dropdown. The
// onChange contract matches a <select> — it receives a synthetic
// { target: { name, value } } event so existing form handlers work unchanged.
function normalise(options) {
  return (options ?? []).map((o) =>
    o != null && typeof o === "object" ? o : { value: o, label: String(o) },
  );
}

const OptionField = ({
  name,
  value,
  onChange,
  options,
  label,
  required = false,
  disabled = false,
  placeholder,
  invalid = false,
  className = "",
}) => {
  const quickSelect = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.quickSelect ?? false,
  );
  const opts = normalise(options);
  const extra = className ? ` ${className}` : "";
  const hasLogos = opts.some((o) => o.bank);

  if (!quickSelect) {
    if (hasLogos) {
      return (
        <LogoSelect
          name={name}
          value={value}
          onChange={onChange}
          options={opts}
          label={label}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          invalid={invalid}
          className={className}
        />
      );
    }
    return (
      <div className={`field${invalid ? " field--invalid" : ""}${extra}`}>
        <select
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
        >
          {placeholder != null && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {opts.map((o) => (
            <option key={String(o.value)} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label>{label}</label>
      </div>
    );
  }

  const emit = (v) => onChange({ target: { name, value: v } });

  return (
    <div className={`opt-field${invalid ? " opt-field--invalid" : ""}${extra}`}>
      {label && <span className="opt-field-label">{label}</span>}
      <div
        className="opt-chip-strip"
        role="radiogroup"
        aria-label={label}
        aria-invalid={invalid || undefined}
      >
        {opts.map((o) => {
          const active = String(value) === String(o.value);
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              className={`opt-chip${active ? " opt-chip--active" : ""}`}
              onClick={() => emit(o.value)}
            >
              {o.bank && <BankLogo bank={o.bank} color={o.color} size={18} />}
              {o.label}
            </button>
          );
        })}
      </div>
      {required && (
        <input
          className="opt-required-mirror"
          tabIndex={-1}
          aria-hidden="true"
          value={value ?? ""}
          onChange={() => {}}
          required
        />
      )}
    </div>
  );
};

OptionField.propTypes = {
  name: PropTypes.string,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func.isRequired,
  options: PropTypes.array.isRequired,
  label: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  placeholder: PropTypes.string,
  invalid: PropTypes.bool,
  className: PropTypes.string,
};

export default memo(OptionField);
