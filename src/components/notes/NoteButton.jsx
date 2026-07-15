import { useSelector } from "react-redux";
import PropTypes from "prop-types";
import { useNotes } from "../../context/NotesContext";
import "../../styles/notes.css";

// Reusable "notes on this item" affordance for entity cards (a transaction, an
// investment, …). Shows a note icon with a count badge and opens the drawer in
// entity mode. Renders nothing when Notes is disabled in Preferences.
export default function NoteButton({ entityRef, pageKey, className = "" }) {
  const { openNotes } = useNotes();
  const notesEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.notesEnabled ?? true,
  );
  const count = useSelector(
    (s) =>
      (s.transactions.transactionData?.notes ?? []).filter(
        (n) =>
          !n.archivedAt &&
          n.scope === "entity" &&
          n.entityRef?.type === entityRef.type &&
          n.entityRef?.id === entityRef.id,
      ).length,
  );

  if (!notesEnabled) return null;

  return (
    <button
      type="button"
      className={`note-attach-btn${count ? " note-attach-btn--has" : ""}${className ? ` ${className}` : ""}`}
      title={count ? `${count} note${count > 1 ? "s" : ""}` : "Add a note"}
      aria-label={count ? `${count} notes on this item` : "Add a note"}
      onClick={(e) => {
        e.stopPropagation();
        openNotes({ entityRef, pageKey });
      }}
    >
      <i className="fa-solid fa-note-sticky" />
      {count > 0 && <span className="note-attach-count">{count}</span>}
    </button>
  );
}

NoteButton.propTypes = {
  entityRef: PropTypes.shape({
    type: PropTypes.string.isRequired,
    id: PropTypes.string.isRequired,
  }).isRequired,
  pageKey: PropTypes.string,
  className: PropTypes.string,
};
