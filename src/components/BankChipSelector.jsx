import { memo } from "react";
import PropTypes from "prop-types";

// Horizontal chip strip — one chip per tracked bank account, plus an
// "Untagged" option. Used in expense / income / investment forms when
// multi-bank tracking is enabled.
const BankChipSelector = ({
  accounts,
  value,
  onChange,
  label = "Bank account",
  allowUntagged = true,
}) => {
  if (!accounts || accounts.length === 0) return null;
  return (
    <div className="bank-chip-field">
      <span className="bank-chip-label">{label}</span>
      <div className="bank-chip-strip">
        {accounts.map((a) => {
          const active = value === a.id;
          return (
            <button
              key={a.id}
              type="button"
              className={`bank-chip${active ? " bank-chip--active" : ""}`}
              style={
                active
                  ? {
                      background: a.color || "var(--surface-active)",
                      borderColor: a.color || "var(--surface-border-open)",
                      color: "#fff",
                    }
                  : undefined
              }
              onClick={() => onChange(a.id)}
            >
              <span
                className="bank-chip-dot"
                style={{ background: a.color || "var(--text-secondary)" }}
              />
              {a.bank}
            </button>
          );
        })}
        {allowUntagged && (
          <button
            type="button"
            className={`bank-chip bank-chip--untagged${value ? "" : " bank-chip--active"}`}
            onClick={() => onChange("")}
            title="Don't tag this transaction to a bank"
          >
            Untagged
          </button>
        )}
      </div>
    </div>
  );
};

BankChipSelector.propTypes = {
  accounts: PropTypes.array.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  allowUntagged: PropTypes.bool,
};

export default memo(BankChipSelector);
