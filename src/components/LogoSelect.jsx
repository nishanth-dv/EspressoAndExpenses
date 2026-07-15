import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import BankLogo from "./BankLogo";

const LogoSelect = ({
  name,
  value,
  onChange,
  options,
  label,
  placeholder,
  required = false,
  disabled = false,
  invalid = false,
  className = "",
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => String(o.value) === String(value));
  const extra = className ? ` ${className}` : "";

  const pick = (v) => {
    onChange({ target: { name, value: v } });
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className={`logo-select${invalid ? " logo-select--invalid" : ""}${
        disabled ? " logo-select--disabled" : ""
      }${extra}`}
    >
      {label && <span className="logo-select-label">{label}</span>}
      <button
        type="button"
        className="logo-select-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        {selected ? (
          <span className="logo-select-value">
            {selected.bank && (
              <BankLogo bank={selected.bank} color={selected.color} size={18} />
            )}
            <span className="logo-select-text">{selected.label}</span>
          </span>
        ) : (
          <span className="logo-select-placeholder">{placeholder || ""}</span>
        )}
        <i className="fa-solid fa-chevron-down logo-select-chevron" />
      </button>

      {open && (
        <ul className="logo-select-menu" role="listbox">
          {options.map((o) => {
            const active = String(value) === String(o.value);
            return (
              <li key={String(o.value)} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`logo-select-option${
                    active ? " logo-select-option--active" : ""
                  }`}
                  onClick={() => pick(o.value)}
                >
                  {o.bank && (
                    <BankLogo bank={o.bank} color={o.color} size={18} />
                  )}
                  <span className="logo-select-text">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

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

LogoSelect.propTypes = {
  name: PropTypes.string,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func.isRequired,
  options: PropTypes.array.isRequired,
  label: PropTypes.string,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  invalid: PropTypes.bool,
  className: PropTypes.string,
};

export default LogoSelect;
