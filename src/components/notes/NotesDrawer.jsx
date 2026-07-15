import { useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useLocation, useSearchParams } from "react-router-dom";
import Modal from "../../preStyledElements/modal/Modal";
import { useNotes } from "../../context/NotesContext";
import { APP_PAGES } from "../../utils/pages";
import { persistAddNote } from "../../redux/slices/transactionSlice";
import NoteCard from "./NoteCard";
import NoteComposer from "./NoteComposer";
import "../../styles/notes.css";

function pageKeyForPath(pathname) {
  const p = APP_PAGES.find((pg) =>
    pathname.toLowerCase().startsWith(pg.route.toLowerCase()),
  );
  return p?.key ?? null;
}

function matchesEntity(note, entityRef) {
  return (
    note.scope === "entity" &&
    note.entityRef?.type === entityRef.type &&
    note.entityRef?.id === entityRef.id
  );
}

export default function NotesDrawer() {
  const { open, context, openNotes, closeNotes } = useNotes();
  const dispatch = useDispatch();
  const notes = useSelector((s) => s.transactions.transactionData?.notes ?? []);
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPageKey = useMemo(() => pageKeyForPath(pathname), [pathname]);

  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [entityRef, setEntityRef] = useState(null);
  const [editingCount, setEditingCount] = useState(0);

  const focusId = context?.focusId ?? null;
  // Hide the search/filter row while a note is being written or edited.
  const formActive = composing || editingCount > 0;

  // ?note=<id> deep-link (fired by a reminder notification) → open the drawer
  // focused on that note, then strip the param so a refresh doesn't re-trigger.
  useEffect(() => {
    const id = searchParams.get("note");
    if (!id) return;
    openNotes({ focusId: id });
    const next = new URLSearchParams(searchParams);
    next.delete("note");
    setSearchParams(next, { replace: true });
  }, [searchParams, openNotes, setSearchParams]);

  // Sync transient view state to the open/context lifecycle.
  useEffect(() => {
    if (!open) {
      setComposing(false);
      setQuery("");
      setEditingCount(0);
      return;
    }
    setEntityRef(context?.entityRef ?? null);
    setFilter("all");
    // Opened from the Calendar's "Add reminder" → jump straight into a new
    // note pre-seeded with that day's reminder time.
    if (context?.seedNote) setComposing(true);
  }, [open, context]);

  const inEntityMode = !!entityRef;

  const visibleNotes = useMemo(() => {
    let list = notes.filter((n) => !n.archivedAt);
    if (inEntityMode) {
      list = list.filter((n) => matchesEntity(n, entityRef));
    } else if (filter === "pinned") {
      list = list.filter((n) => n.pinned);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((n) =>
        `${n.title ?? ""} ${n.body ?? ""}`.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (
        new Date(b.updatedAt || b.createdAt) -
        new Date(a.updatedAt || a.createdAt)
      );
    });
  }, [notes, filter, query, inEntityMode, entityRef]);

  return (
    <Modal open={open} onClose={closeNotes} title="Notes">
      <div className="note-modal">
        {inEntityMode ? (
          <div className="note-entity-bar">
            <span className="note-entity-chip">
              <i className="fa-solid fa-paperclip" /> Notes on this item
            </span>
            <button
              type="button"
              className="note-entity-all"
              onClick={() => {
                setEntityRef(null);
                setComposing(false);
                setEditingCount(0);
              }}
            >
              View all notes
            </button>
          </div>
        ) : (
          !formActive && (
            <div className="note-modal-tools">
              <div className="note-filters">
                <button
                  type="button"
                  className={`note-filter${filter === "all" ? " note-filter--active" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`note-filter${filter === "pinned" ? " note-filter--active" : ""}`}
                  onClick={() => setFilter("pinned")}
                >
                  Pinned
                </button>
              </div>
              <div className="note-search">
                <i className="fa-solid fa-magnifying-glass" />
                <input
                  placeholder="Search notes…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          )
        )}

        <div className="note-modal-body">
          {composing ? (
            <NoteComposer
              draft={context?.seedNote}
              defaultEntityRef={inEntityMode ? entityRef : undefined}
              defaultPageKey={currentPageKey}
              onCancel={() => setComposing(false)}
              onSave={(note) => {
                dispatch(persistAddNote(note));
                setComposing(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="note-new-btn"
              onClick={() => setComposing(true)}
            >
              <i className="fa-solid fa-plus" /> New note
              {inEntityMode ? " for this item" : ""}
            </button>
          )}

          {visibleNotes.length === 0 && !composing ? (
            <div className="note-empty">
              <i className="fa-solid fa-note-sticky" />
              <p>
                No notes{" "}
                {inEntityMode
                  ? "on this item"
                  : filter === "pinned"
                    ? "pinned"
                    : "yet"}
                .
              </p>
              <p className="note-empty-sub">
                Jot reminders, ideas, or a checklist.
              </p>
            </div>
          ) : (
            <div className="note-list">
              {visibleNotes.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  focused={n.id === focusId}
                  onEditingChange={(active) =>
                    setEditingCount((c) => Math.max(0, c + (active ? 1 : -1)))
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
