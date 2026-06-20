import { memo, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import { persistSetPreference } from "../redux/slices/transactionSlice";
import {
  NOTIFICATION_TYPES,
  isTypeEnabled,
  getNotificationTuning,
} from "../utils/notificationEngine";

// Each group carries its own accent so the two kinds of notification read
// differently at a glance — fixed-date reminders vs. proactive insights.
// Mirrors the colored-icon card layout of the Investment Types panel.
const GROUPS = [
  {
    key: "obligations",
    label: "Reminders",
    hint: "Fixed-date dues and renewals.",
    color: "#5b8dee",
  },
  {
    key: "insights",
    label: "Insights",
    hint: "Proactive nudges — trials ending, silent price hikes, missed charges.",
    color: "#a855f7",
  },
];

// Per-type control. The user can switch any individual reminder — including
// the insight nudges — on or off. Writes a single { typeKey: bool } map to
// preferences.notificationTypes; the engine reads it via isTypeEnabled.
function NotificationsPanel({ types, disabled }) {
  const dispatch = useDispatch();
  const storedTuning = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.notificationTuning ?? {},
  );
  // Effective (sanitised, defaults-filled) values drive the inputs.
  const tuning = getNotificationTuning({ notificationTuning: storedTuning });

  const setType = (key, value) => {
    dispatch(persistSetPreference("notificationTypes", { ...types, [key]: value }));
  };

  const setTuning = (key, value) => {
    dispatch(
      persistSetPreference("notificationTuning", { ...storedTuning, [key]: value }),
    );
  };

  // Milestone multiples is a comma-separated list — keep an editable text
  // buffer so intermediate states ("2,3,") don't fight the parser, and commit
  // the cleaned array on blur.
  const [multiplesText, setMultiplesText] = useState(
    tuning.milestoneMultiples.join(", "),
  );
  const commitMultiples = () => {
    const parsed = [
      ...new Set(
        multiplesText
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 1),
      ),
    ].sort((a, b) => a - b);
    setTuning("milestoneMultiples", parsed);
    setMultiplesText((parsed.length ? parsed : tuning.milestoneMultiples).join(", "));
  };

  const onCount = NOTIFICATION_TYPES.filter((t) =>
    isTypeEnabled({ notificationTypes: types }, t.key),
  ).length;

  const numField = (label, key, value, { min = 0, step = 1 } = {}) => (
    <label className="pref-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) setTuning(key, Math.max(min, n));
        }}
      />
    </label>
  );

  return (
    <div className={`notif-types${disabled ? " notif-types--disabled" : ""}`}>
      <p className="notif-types-summary">
        <strong>{onCount}</strong> of {NOTIFICATION_TYPES.length} notifications on
      </p>

      {GROUPS.map((g) => {
        const groupTypes = NOTIFICATION_TYPES.filter((t) => t.group === g.key);
        if (groupTypes.length === 0) return null;
        return (
          <div className="notif-types-group" key={g.key}>
            <div className="notif-types-group-head">
              <span
                className="notif-types-group-label"
                style={{ color: g.color }}
              >
                {g.label}
              </span>
              <span className="notif-types-group-hint">{g.hint}</span>
            </div>
            <ul className="notif-types-flat">
              {groupTypes.map((t) => {
                const on = isTypeEnabled({ notificationTypes: types }, t.key);
                return (
                  <li
                    className={`notif-type-flat${on ? " notif-type-flat--on" : ""}`}
                    key={t.key}
                    style={{ "--notif-accent": g.color }}
                  >
                    <span
                      className="notif-type-icon"
                      style={{ background: g.color + "22", color: g.color }}
                    >
                      <i className={`fa-solid ${t.icon}`} />
                    </span>
                    <div className="notif-type-meta">
                      <div className="notif-type-head">
                        <span className="notif-type-name">{t.label}</span>
                        <button
                          type="button"
                          className={`pref-switch${on ? " pref-switch--on" : ""}`}
                          role="switch"
                          aria-checked={on}
                          aria-label={`Toggle ${t.label}`}
                          disabled={disabled}
                          onClick={() => setType(t.key, !on)}
                        >
                          <span className="pref-switch-thumb" />
                        </button>
                      </div>
                      <span className="notif-type-desc">{t.hint}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {g.key === "insights" && (
              <div className="notif-tuning">
                <p className="notif-tuning-head">
                  <i className="fa-solid fa-sliders" /> Fine-tune the insights
                </p>
                <p className="notif-tuning-sub">
                  These thresholds decide how sensitive each nudge is. Leave the
                  defaults if unsure.
                </p>
                <div className="pref-grid">
                  {numField("Idle-cash buffer (months)", "idleBufferMonths", tuning.idleBufferMonths, { min: 1 })}
                  {numField("Idle-cash minimum (₹)", "idleMinSurplus", tuning.idleMinSurplus, { min: 0, step: 1000 })}
                  {numField("Pile-up: min payments", "pileupMinCount", tuning.pileupMinCount, { min: 2 })}
                  {numField("Pile-up: within (days)", "pileupWindowDays", tuning.pileupWindowDays, { min: 1 })}
                  {numField("Trial reminder lead (days)", "trialLeadDays", tuning.trialLeadDays, { min: 1 })}
                  <label className="pref-field">
                    <span>Milestone multiples (×)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={multiplesText}
                      disabled={disabled}
                      placeholder="2, 3, 5, 10"
                      onChange={(e) => setMultiplesText(e.target.value)}
                      onBlur={commitMultiples}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

NotificationsPanel.propTypes = {
  types: PropTypes.object.isRequired,
  disabled: PropTypes.bool,
};

export default memo(NotificationsPanel);
