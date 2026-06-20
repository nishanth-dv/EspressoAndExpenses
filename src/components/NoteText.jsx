import { memo } from "react";
import PropTypes from "prop-types";
import { parseNoteLines } from "../utils/noteFormat";

// Read-only display of a description / notes value. Multi-line notes render as
// a bullet list; a single line stays as plain text (unchanged from before).
export const NoteContent = memo(function NoteContent({ text }) {
  const lines = parseNoteLines(text);
  if (lines.length <= 1) return text ?? null;
  return (
    <ul className="note-list">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
});

NoteContent.propTypes = { text: PropTypes.string };

// Edit affordance shown beneath a description textarea: a one-line hint on how
// multi-line notes render as bullets.
export const NoteBulletHint = memo(function NoteBulletHint() {
  return (
    <p className="note-field-hint">
      <i className="fa-solid fa-list-ul" /> Start each point on a new line to
      show it as a bullet.
    </p>
  );
});
