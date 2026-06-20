// Description / notes fields hold a single raw string. When it spans multiple
// lines we render it as a bullet list; a single line stays plain text. Bullet
// glyphs are never stored — they're presentational only — so editing a note
// round-trips losslessly through a plain textarea.

const BULLET_PREFIX = /^\s*[-*•·]\s+/;

// Split a note into cleaned, displayable lines: trimmed, blank lines dropped,
// and any leading bullet glyph the user typed themselves removed so we don't
// double-bullet.
export function parseNoteLines(text = "") {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(BULLET_PREFIX, "").trim())
    .filter(Boolean);
}

// True when the note should render as a bullet list (more than one line).
export function isMultilineNote(text = "") {
  return parseNoteLines(text).length > 1;
}
