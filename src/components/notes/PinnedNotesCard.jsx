import { useSelector } from "react-redux";
import { useNotes } from "../../context/NotesContext";
import { getPage } from "../../utils/pages";
import "../../styles/notes.css";

// Dashboard widget: a compact strip of the user's pinned notes. Tapping one
// opens the Notes drawer focused on it. Renders nothing when Notes is off or
// there's nothing pinned, so it never clutters an empty dashboard.
export default function PinnedNotesCard() {
  const { openNotes } = useNotes();
  const notesEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.notesEnabled ?? true,
  );
  const notes = useSelector((s) => s.transactions.transactionData?.notes ?? []);

  if (!notesEnabled) return null;
  const pinned = notes
    .filter((n) => n.pinned && !n.archivedAt)
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt) -
        new Date(a.updatedAt || a.createdAt),
    )
    .slice(0, 5);
  if (pinned.length === 0) return null;

  const preview = (n) => {
    if (n.title) return n.title;
    const firstLine = (n.body || "")
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/^-\s+(\[[ xX]\]\s*)?/, "")
      .replace(/\*\*|~~/g, "");
    if (firstLine) return firstLine;
    const firstItem = Array.isArray(n.checklist)
      ? n.checklist.find((it) => it.text?.trim())?.text
      : null;
    return firstItem || "Untitled note";
  };

  return (
    <div className="dash-section">
      <p className="dash-section-title">
        <i className="fa-solid fa-thumbtack" style={{ marginRight: 6 }} />
        Pinned notes
      </p>
      <div className="pinned-notes">
        {pinned.map((n) => {
          const scopeLabel =
            n.scope === "entity"
              ? "Attached"
              : n.scope === "page"
                ? (getPage(n.pageKey)?.label ?? "Page")
                : "Global";
          return (
            <button
              key={n.id}
              type="button"
              className="pinned-note"
              style={n.color ? { "--note-color": n.color } : undefined}
              onClick={() => openNotes({ focusId: n.id })}
            >
              <span className="pinned-note-text">{preview(n)}</span>
              <span className="pinned-note-scope">
                {n.remindAt && <i className="fa-solid fa-bell" />} {scopeLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
