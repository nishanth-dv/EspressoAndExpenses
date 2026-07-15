import PropTypes from "prop-types";
import { STATUS_LABEL } from "../../utils/advisory/state";

// Done / Snooze / Dismiss controls shared by the Actions and Review lenses.
// When a card is already acted-on, shows its status + an undo.
export default function CardMenu({ status, onDone, onSnooze, onDismiss, onRestore }) {
  if (status) {
    return (
      <button type="button" className="adv-restore" onClick={onRestore}>
        <i className="fa-solid fa-rotate-left" /> {STATUS_LABEL[status]} · undo
      </button>
    );
  }
  return (
    <div className="adv-actbar">
      <button type="button" title="Mark as done" aria-label="Mark as done" onClick={onDone}>
        <i className="fa-solid fa-check" />
      </button>
      <button type="button" title="Snooze 30 days" aria-label="Snooze" onClick={onSnooze}>
        <i className="fa-solid fa-clock" />
      </button>
      <button type="button" title="Not for me" aria-label="Dismiss" onClick={onDismiss}>
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

CardMenu.propTypes = {
  status: PropTypes.string,
  onDone: PropTypes.func.isRequired,
  onSnooze: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
  onRestore: PropTypes.func.isRequired,
};
