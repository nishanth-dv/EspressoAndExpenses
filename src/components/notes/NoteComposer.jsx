import { useRef, useState } from "react";
import PropTypes from "prop-types";
import InfoTooltip from "../InfoTooltip";

function makeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `note_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Pull any legacy inline checklist lines ("- [ ] item") out of the body and
// into structured items, so old notes edited today become a real checklist.
// If the note already has a structured checklist, the body is left untouched.
function splitBodyChecklist(rawBody, existing) {
  if (Array.isArray(existing) && existing.length) {
    return { body: rawBody ?? "", checklist: existing.map((it) => ({ ...it })) };
  }
  const items = [];
  const kept = [];
  for (const line of (rawBody ?? "").split("\n")) {
    const m = /^\s*-\s+\[([ xX])\]\s?(.*)$/.exec(line);
    if (m) items.push({ id: makeId(), text: m[2], done: m[1].toLowerCase() === "x" });
    else kept.push(line);
  }
  return { body: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), checklist: items };
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Create/edit editor for a note. Notes are generic (global) unless opened from
// a specific item. Layout: reminder at the top, then title, formatting toolbar,
// free-text body, and a real interactive checklist (structured items, not raw
// "[ ]" markdown). Any colour a note already carries is preserved.
export default function NoteComposer({
  initial,
  draft,
  defaultEntityRef,
  defaultPageKey,
  onSave,
  onCancel,
}) {
  const editing = !!initial;
  const entityMode = initial?.scope === "entity" || (!!defaultEntityRef && !editing);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(
    () => splitBodyChecklist(initial?.body, initial?.checklist).body,
  );
  const [remindAt, setRemindAt] = useState(
    toLocalInput(initial?.remindAt ?? draft?.remindAt),
  );
  const [checklist, setChecklist] = useState(
    () => splitBodyChecklist(initial?.body, initial?.checklist).checklist,
  );
  const taRef = useRef(null);

  const surround = (token) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e) || "text";
    const next = body.slice(0, s) + token + sel + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + token.length;
      ta.selectionEnd = s + token.length + sel.length;
    });
  };

  const prefixLine = (prefix) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = body.lastIndexOf("\n", s - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + prefix.length;
      ta.selectionEnd = s + prefix.length;
    });
  };

  const addItem = () =>
    setChecklist((cl) => [...cl, { id: makeId(), text: "", done: false }]);
  const updateItem = (id, patch) =>
    setChecklist((cl) => cl.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) =>
    setChecklist((cl) => cl.filter((it) => it.id !== id));

  const cleanChecklist = checklist
    .filter((it) => it.text.trim())
    .map((it) => ({ id: it.id, text: it.text.trim(), done: !!it.done }));

  const canSave = !!(title.trim() || body.trim() || cleanChecklist.length);

  const handleSave = () => {
    if (!canSave) return;
    const now = new Date().toISOString();
    const remindIso = remindAt ? new Date(remindAt).toISOString() : undefined;
    const common = {
      title: title.trim(),
      body,
      checklist: cleanChecklist.length ? cleanChecklist : undefined,
      color: initial?.color, // preserved, not edited here
      remindAt: remindIso,
      updatedAt: now,
    };
    if (editing) {
      onSave({
        ...initial,
        ...common,
        scope: entityMode ? initial.scope : "global",
        entityRef: entityMode ? initial.entityRef : undefined,
        pageKey: entityMode ? initial.pageKey : undefined,
      });
    } else {
      onSave({
        id: makeId(),
        ...common,
        scope: entityMode ? "entity" : "global",
        entityRef: entityMode ? defaultEntityRef : undefined,
        pageKey: entityMode ? defaultPageKey : undefined,
        pinned: false,
        createdAt: now,
      });
    }
  };

  return (
    <div className="note-composer">
      <label className="note-remind">
        <span className="note-remind-label">
          <i className="fa-solid fa-bell" /> Remind me
        </span>
        <input
          type="datetime-local"
          value={remindAt}
          onChange={(e) => setRemindAt(e.target.value)}
        />
        {remindAt && (
          <button
            type="button"
            className="note-remind-clear"
            onClick={() => setRemindAt("")}
            aria-label="Clear reminder"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </label>

      <input
        className="note-composer-title"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="note-toolbar">
        <button type="button" title="Bold" onClick={() => surround("**")}>
          <i className="fa-solid fa-bold" />
        </button>
        <button type="button" title="Italic" onClick={() => surround("*")}>
          <i className="fa-solid fa-italic" />
        </button>
        <button
          type="button"
          title="Strikethrough"
          onClick={() => surround("~~")}
        >
          <i className="fa-solid fa-strikethrough" />
        </button>
        <button type="button" title="Bullet" onClick={() => prefixLine("- ")}>
          <i className="fa-solid fa-list-ul" />
        </button>
        <InfoTooltip
          className="note-toolbar-help"
          label="Formatting help"
          text={
            <>
              Use the buttons, or type it directly: wrap text with{" "}
              <strong>**double asterisks**</strong> for bold,{" "}
              <strong>*single asterisks*</strong> for italic, and{" "}
              <strong>~~tildes~~</strong> for strikethrough. Start a line with{" "}
              <strong>-</strong> for a bullet. Use the{" "}
              <strong>checklist</strong> below for tick-boxes.
            </>
          }
        />
      </div>
      <textarea
        ref={taRef}
        className="note-composer-body"
        placeholder="Write a note…"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <div className="note-checklist">
        {checklist.map((it) => (
          <div className="note-checklist-item" key={it.id}>
            <input
              type="checkbox"
              checked={it.done}
              onChange={(e) => updateItem(it.id, { done: e.target.checked })}
            />
            <input
              type="text"
              className={`note-checklist-text${it.done ? " note-checklist-text--done" : ""}`}
              value={it.text}
              placeholder="List item"
              autoFocus={it.text === ""}
              onChange={(e) => updateItem(it.id, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
            />
            <button
              type="button"
              className="note-checklist-del"
              onClick={() => removeItem(it.id)}
              aria-label="Remove item"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        ))}
        <button type="button" className="note-checklist-add" onClick={addItem}>
          <i className="fa-solid fa-square-check" /> Add checklist item
        </button>
      </div>

      {entityMode && (
        <p className="note-scope-static">
          <i className="fa-solid fa-paperclip" /> Attached to this item
        </p>
      )}

      <div className="note-composer-actions">
        <button
          type="button"
          className="note-btn note-btn--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="note-btn note-btn--primary"
          disabled={!canSave}
          onClick={handleSave}
        >
          {editing ? "Save" : "Add note"}
        </button>
      </div>
    </div>
  );
}

NoteComposer.propTypes = {
  initial: PropTypes.object,
  draft: PropTypes.object,
  defaultEntityRef: PropTypes.object,
  defaultPageKey: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
