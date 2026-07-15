import PropTypes from "prop-types";
import { LOG_MODES, recommendedLogMode } from "../utils/loggingMode";

export default function LoggingModeSelector({
  typeKey,
  value,
  onChange,
  scheduleSlot,
  suggested,
  context,
}) {
  const reco = recommendedLogMode(typeKey);
  const suggestedMode = suggested || reco.mode;
  const contextText = context || reco.context;
  const mode = value || suggestedMode;
  return (
    <div className="log-mode">
      <span className="log-mode-title">
        <i className="fa-solid fa-clock-rotate-left" /> How should this be logged?
      </span>
      <div className="log-mode-opts">
        {LOG_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`log-mode-opt${mode === m.key ? " log-mode-opt--on" : ""}`}
            onClick={() => onChange(m.key)}
          >
            {suggestedMode === m.key && (
              <span className="log-mode-badge">Suggested</span>
            )}
            <i className={`fa-solid ${m.icon} log-mode-opt-ico`} />
            <span className="log-mode-opt-label">{m.label}</span>
            <span className="log-mode-opt-blurb">{m.blurb}</span>
          </button>
        ))}
      </div>
      <p className="log-mode-context">
        <i className="fa-solid fa-lightbulb" /> {contextText}
      </p>
      {(mode === "auto" || mode === "manual") && scheduleSlot}
    </div>
  );
}

LoggingModeSelector.propTypes = {
  typeKey: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  scheduleSlot: PropTypes.node,
  suggested: PropTypes.string,
  context: PropTypes.string,
};
