import { memo, useState } from "react";
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
  // The note explains what "untagged" means — only show it once the user
  // actively picks Untagged, not for the passive default empty state.
  const [pickedUntagged, setPickedUntagged] = useState(false);
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
              onClick={() => {
                setPickedUntagged(false);
                onChange(a.id);
              }}
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
            onClick={() => {
              setPickedUntagged(true);
              onChange("");
            }}
            title="Don't tag this transaction to a bank"
          >
            Untagged
          </button>
        )}
      </div>
      {allowUntagged && (
        <p
          className={`bank-chip-untagged-note${
            !value && pickedUntagged ? " bank-chip-untagged-note--show" : ""
          }`}
        >
          <i className="fa-solid fa-circle-info" />
          Untagged transactions are saved to your history but won&apos;t change
          your total or any bank balance.
        </p>
      )}
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
