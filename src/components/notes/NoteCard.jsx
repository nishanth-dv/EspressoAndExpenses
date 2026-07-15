import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import PropTypes from "prop-types";
import {
  persistUpdateNote,
  persistDeleteNote,
} from "../../redux/slices/transactionSlice";
import { getPage } from "../../utils/pages";
import NoteMarkdown from "./NoteMarkdown";
import NoteComposer from "./NoteComposer";

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NoteCard({ note, focused, onEditingChange }) {
  const dispatch = useDispatch();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef(null);

  const enterEdit = () => {
    setEditing(true);
    onEditingChange?.(true);
  };
  const exitEdit = () => {
    setEditing(false);
    onEditingChange?.(false);
  };

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focused]);

  const togglePin = () =>
    dispatch(
      persistUpdateNote({
        ...note,
        pinned: !note.pinned,
        updatedAt: new Date().toISOString(),
      }),
    );

  // Flip a single "- [ ] / - [x]" source line in place, then persist. (Legacy
  // notes that stored their checklist inline in the body still tick correctly.)
  const toggleTask = (lineIndex) => {
    const lines = (note.body || "").split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    lines[lineIndex] = lines[lineIndex].replace(/\[([ xX])\]/, (_, c) =>
      c.toLowerCase() === "x" ? "[ ]" : "[x]",
    );
    dispatch(
      persistUpdateNote({
        ...note,
        body: lines.join("\n"),
        updatedAt: new Date().toISOString(),
      }),
    );
  };

  // Structured checklist toggle.
  const toggleChecklistItem = (itemId) => {
    const checklist = (note.checklist || []).map((it) =>
      it.id === itemId ? { ...it, done: !it.done } : it,
    );
    dispatch(
      persistUpdateNote({
        ...note,
        checklist,
        updatedAt: new Date().toISOString(),
      }),
    );
  };

  if (editing) {
    return (
      <NoteComposer
        initial={note}
        onCancel={exitEdit}
        onSave={(updated) => {
          dispatch(persistUpdateNote(updated));
          exitEdit();
        }}
      />
    );
  }

  const scopeChip =
    note.scope === "entity"
      ? { icon: "fa-paperclip", label: "Attached" }
      : note.scope === "page"
        ? { icon: "fa-file-lines", label: getPage(note.pageKey)?.label ?? "Page" }
        : { icon: "fa-globe", label: "Global" };

  const edited =
    note.updatedAt &&
    note.createdAt &&
    new Date(note.updatedAt) - new Date(note.createdAt) > 1000;

  const remindDue = note.remindAt && new Date(note.remindAt) <= new Date();

  return (
    <div
      ref={ref}
      className={`note-card${note.pinned ? " note-card--pinned" : ""}${focused ? " note-card--focused" : ""}${note.color ? " note-card--tinted" : ""}`}
      style={note.color ? { "--note-color": note.color } : undefined}
    >
      <div className="note-card-head">
        {note.title && <p className="note-card-title">{note.title}</p>}
        <span className="note-chip">
          <i className={`fa-solid ${scopeChip.icon}`} /> {scopeChip.label}
        </span>
        <div className="note-card-actions">
          <button
            type="button"
            className={`note-icon-btn${note.pinned ? " note-icon-btn--on" : ""}`}
            title={note.pinned ? "Unpin" : "Pin"}
            onClick={togglePin}
          >
            <i className="fa-solid fa-thumbtack" />
          </button>
          <button
            type="button"
            className="note-icon-btn"
            title="Edit"
            onClick={enterEdit}
          >
            <i className="fa-solid fa-pen" />
          </button>
          <button
            type="button"
            className="note-icon-btn note-icon-btn--danger"
            title="Delete"
            onClick={() => setConfirming(true)}
          >
            <i className="fa-solid fa-trash-can" />
          </button>
        </div>
      </div>
      {note.body && <NoteMarkdown body={note.body} onToggleTask={toggleTask} />}
      {Array.isArray(note.checklist) && note.checklist.length > 0 && (
        <ul className="note-check-list">
          {note.checklist.map((it) => (
            <li
              key={it.id}
              className={`note-check-item${it.done ? " note-check-item--done" : ""}`}
            >
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => toggleChecklistItem(it.id)}
              />
              <span>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="note-card-foot">
        {note.remindAt && (
          <span className={`note-remind-chip${remindDue ? " note-remind-chip--due" : ""}`}>
            <i className="fa-solid fa-bell" /> {fmt(note.remindAt)}
          </span>
        )}
        <span className="note-card-meta">
          {edited
            ? `Updated ${fmt(note.updatedAt)}`
            : `Added ${fmt(note.createdAt)}`}
        </span>
      </div>
      {confirming && (
        <div className="note-confirm">
          <span className="note-confirm-text">Delete this note?</span>
          <button
            type="button"
            className="note-btn note-btn--ghost"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="note-btn note-btn--danger"
            onClick={() => dispatch(persistDeleteNote(note.id))}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

NoteCard.propTypes = {
  note: PropTypes.object.isRequired,
  focused: PropTypes.bool,
  onEditingChange: PropTypes.func,
};
