// ── InvestmentTypeDesigner ─────────────────────────────
//
// Modal that lets the user create or edit an investment type schema.
//
// Phase 3 scope:
//   • Header: name + math-profile selector (icon, colour and description
//     are hidden from the user; defaults are assigned for new types).
//   • Multi-row layout: fields live in rows of up to 3, exactly as they'll
//     render in the Add Investment form. Each row has its own +Add field
//     control; +Add row appends a new empty row.
//   • Drag-to-reorder: grab a field by its icon and drop it anywhere —
//     within the same row, across rows, or past the last row to spawn a
//     new row. Chevron buttons stay as a keyboard / no-pointer fallback.
//   • Anchors (locked) stay protected — they show with a lock pill and
//     can't be renamed or deleted, but they can be repositioned.
//   • Live preview pane on the right (desktop) or below (mobile) renders
//     the actual DynamicInvestmentForm with the current draft schema so
//     the user sees exactly what the Add Investment form will look like.
//
// Built-in types open in extras-only mode — the metadata and profile are
// read-only, anchors are locked.

import { memo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import DynamicInvestmentForm from "../Forms/DynamicInvestmentForm";
import {
  persistAddInvestmentType,
  persistUpdateInvestmentType,
} from "../redux/slices/transactionSlice";
import {
  MATH_PROFILES,
  FIELD_TYPES,
  getAnchorsForProfile,
} from "../utils/investmentTypeSchemas";

// ── Field-type metadata for the palette ─────────────────

const FIELD_TYPE_META = {
  text:                  { label: "Text",                icon: "fa-font" },
  textarea:              { label: "Long text",           icon: "fa-align-left" },
  number:                { label: "Number",              icon: "fa-hashtag" },
  currency:              { label: "Amount",              icon: "fa-indian-rupee-sign" },
  percentage:            { label: "Percentage",          icon: "fa-percent" },
  date:                  { label: "Date",                icon: "fa-calendar-day" },
  month:                 { label: "Month",               icon: "fa-calendar" },
  "day-of-month":        { label: "Day of month",        icon: "fa-calendar-week" },
  dropdown:              { label: "Dropdown",            icon: "fa-list" },
  "multi-select":        { label: "Multi-select chips",  icon: "fa-tags" },
  checkbox:              { label: "Checkbox",            icon: "fa-square-check" },
  ticker:                { label: "Ticker",              icon: "fa-magnifying-glass" },
  "month-grid":          { label: "Month grid",          icon: "fa-table-cells" },
  "deduct-from-balance": { label: "Deduct from balance", icon: "fa-arrow-down" },
  "auto-deduct":         { label: "Auto-deduct schedule", icon: "fa-rotate" },
};

const MAX_FIELDS_PER_ROW = 3;

// ── Helpers ─────────────────────────────────────────────

function makeEmptyType() {
  const palette = ["#5b8dee", "#7abf8e", "#d4a35a", "#9b8ea6", "#d4735a", "#8a9fd4"];
  const color = palette[Math.floor(Math.random() * palette.length)];
  return {
    key: `custom-${crypto.randomUUID().slice(0, 8)}`,
    label: "",
    color,
    icon: "fa-cube",
    mathProfile: "manual",
    rows: [{ id: `r-${crypto.randomUUID().slice(0, 4)}`, fields: getAnchorsForProfile("manual") }],
  };
}

function freshRowId() {
  return `r-${crypto.randomUUID().slice(0, 6)}`;
}

function newFieldOfType(type) {
  const meta = FIELD_TYPE_META[type] ?? { label: "Field" };
  const id = crypto.randomUUID();
  return {
    id,
    key: `f_${id.slice(0, 8)}`,
    type,
    label: meta.label,
    locked: false,
    required: false,
  };
}

// Decide whether a drag's current (fromRow/fromIdx → toRow/toSlot) target
// is a no-op or blocked. Used both to skip commit and to hide the insertion
// bar visually so the user gets clean feedback on invalid drops.
function isNoOpOrBlocked(rows, fromRow, fromIdx, toRow, toSlot) {
  if (toRow === fromRow && (toSlot === fromIdx || toSlot === fromIdx + 1)) {
    return true; // dropping where it already is
  }
  if (toRow < rows.length) {
    const target = rows[toRow];
    if (fromRow !== toRow && target.fields.length >= MAX_FIELDS_PER_ROW) {
      return true; // capacity exhausted in another row
    }
  }
  return false;
}

// ── Main designer modal ─────────────────────────────────

const InvestmentTypeDesigner = ({ existing, onClose, onCreated }) => {
  const dispatch = useDispatch();
  const isNew = !existing;
  const isBuiltIn = !!existing?.builtIn;

  const [draft, setDraft] = useState(() => {
    if (existing) return JSON.parse(JSON.stringify(existing));
    return makeEmptyType();
  });

  const [editingFieldRef, setEditingFieldRef] = useState(null); // { rowIdx, fieldIdx }
  const [pickerTarget, setPickerTarget] = useState(null);       // rowIdx to add into
  const [previewVisibleMobile, setPreviewVisibleMobile] = useState(false);

  // ── Drag-to-reorder state ─────────────────────────────
  //
  // Captured on pointer-down on a field icon. We snapshot every row's
  // bounding rect and every chip's mid-X so subsequent pointer-moves can
  // pick a target (toRow, toSlot) without re-measuring. The drop happens
  // in onDragEnd → commitMove which mutates draft.rows.
  const editorPaneRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const rows = draft.rows ?? [];
  const profile = MATH_PROFILES[draft.mathProfile];

  function updateDraft(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function updateRows(updater) {
    setDraft((d) => ({ ...d, rows: updater(d.rows ?? []) }));
  }

  function switchProfile(newProfile) {
    if (isBuiltIn || newProfile === draft.mathProfile) return;
    const newAnchors = getAnchorsForProfile(newProfile);
    const extrasByRow = rows.map((r) => r.fields.filter((f) => !f.locked));
    const nextRows = [
      { id: freshRowId(), fields: newAnchors },
      ...extrasByRow
        .map((fields, idx) => ({ id: rows[idx]?.id ?? freshRowId(), fields }))
        .filter((r) => r.fields.length > 0),
    ];
    setDraft((d) => ({ ...d, mathProfile: newProfile, rows: nextRows }));
  }

  // ── Field / row operations ────────────────────────────

  function addFieldToRow(rowIdx, type) {
    updateRows((rs) =>
      rs.map((r, i) =>
        i === rowIdx && r.fields.length < MAX_FIELDS_PER_ROW
          ? { ...r, fields: [...r.fields, newFieldOfType(type)] }
          : r,
      ),
    );
    setPickerTarget(null);
  }

  function addRow() {
    updateRows((rs) => [...rs, { id: freshRowId(), fields: [] }]);
  }

  function deleteField(rowIdx, fieldIdx) {
    updateRows((rs) =>
      rs
        .map((r, i) =>
          i === rowIdx ? { ...r, fields: r.fields.filter((_, j) => j !== fieldIdx) } : r,
        )
        .filter((r, i) => i === 0 || r.fields.length > 0),
    );
  }

  function updateField(rowIdx, fieldIdx, patch) {
    updateRows((rs) =>
      rs.map((r, i) =>
        i === rowIdx
          ? {
              ...r,
              fields: r.fields.map((f, j) =>
                j === fieldIdx ? { ...f, ...patch } : f,
              ),
            }
          : r,
      ),
    );
  }

  // Keyboard / chevron fallback. Moves a field by one slot in the given
  // direction. Used by the chip's chevron buttons for users without
  // pointer drag (keyboard, screen reader, or just preference).
  function moveField(rowIdx, fieldIdx, direction) {
    updateRows((rs) => {
      const clone = rs.map((r) => ({ ...r, fields: [...r.fields] }));
      const field = clone[rowIdx].fields[fieldIdx];
      if (!field) return rs;
      if (direction === "left" && fieldIdx > 0) {
        [clone[rowIdx].fields[fieldIdx - 1], clone[rowIdx].fields[fieldIdx]] =
          [clone[rowIdx].fields[fieldIdx], clone[rowIdx].fields[fieldIdx - 1]];
      } else if (
        direction === "right" &&
        fieldIdx < clone[rowIdx].fields.length - 1
      ) {
        [clone[rowIdx].fields[fieldIdx], clone[rowIdx].fields[fieldIdx + 1]] =
          [clone[rowIdx].fields[fieldIdx + 1], clone[rowIdx].fields[fieldIdx]];
      } else if (direction === "up" && rowIdx > 0) {
        if (clone[rowIdx - 1].fields.length >= MAX_FIELDS_PER_ROW) return rs;
        clone[rowIdx].fields.splice(fieldIdx, 1);
        clone[rowIdx - 1].fields.push(field);
      } else if (direction === "down") {
        if (rowIdx === clone.length - 1) {
          clone[rowIdx].fields.splice(fieldIdx, 1);
          clone.push({ id: freshRowId(), fields: [field] });
        } else {
          if (clone[rowIdx + 1].fields.length >= MAX_FIELDS_PER_ROW) return rs;
          clone[rowIdx].fields.splice(fieldIdx, 1);
          clone[rowIdx + 1].fields.unshift(field);
        }
      }
      return clone.filter((r, i) => i === 0 || r.fields.length > 0);
    });
  }

  // ── Drag handlers ─────────────────────────────────────

  function handleDragStart(e, rowIdx, fieldIdx) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const pane = editorPaneRef.current;
    if (!pane) return;

    // Snapshot every row + every chip's geometry. We use querySelector
    // rather than refs because the chip count varies per row and a refs
    // map would be more bookkeeping than it's worth.
    const rowEls = pane.querySelectorAll("[data-row-id]");
    const rowRects = [];
    rowEls.forEach((rowEl) => {
      const rect = rowEl.getBoundingClientRect();
      const fieldRects = [];
      rowEl.querySelectorAll("[data-field-id]").forEach((fEl) => {
        const fr = fEl.getBoundingClientRect();
        fieldRects.push({ midX: (fr.left + fr.right) / 2 });
      });
      rowRects.push({ top: rect.top, bottom: rect.bottom, fieldRects });
    });

    setDrag({
      fromRowIdx: rowIdx,
      fromFieldIdx: fieldIdx,
      toRowIdx: rowIdx,
      toSlotIdx: fieldIdx,
      pointerId: e.pointerId,
      pointerX: e.clientX,
      pointerY: e.clientY,
      rowRects,
    });
  }

  function handleDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;

    // Find target row by Y. If pointer is below the last row's bottom
    // edge, treat as "new row at end" (rowRects.length).
    let targetRow = -1;
    for (let i = 0; i < drag.rowRects.length; i++) {
      const r = drag.rowRects[i];
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        targetRow = i;
        break;
      }
    }
    if (targetRow === -1) {
      const last = drag.rowRects[drag.rowRects.length - 1];
      if (e.clientY > last.bottom) targetRow = drag.rowRects.length;
      else if (e.clientY < drag.rowRects[0].top) targetRow = 0;
      else {
        // Between rows — snap to whichever centerline is closer.
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < drag.rowRects.length; i++) {
          const r = drag.rowRects[i];
          const mid = (r.top + r.bottom) / 2;
          const dist = Math.abs(e.clientY - mid);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
        targetRow = best;
      }
    }

    // Find target slot within the row by X. Default to "end of row";
    // if the pointer is left of any chip's mid-X, snap there instead.
    let targetSlot = 0;
    if (targetRow < drag.rowRects.length) {
      const row = drag.rowRects[targetRow];
      targetSlot = row.fieldRects.length;
      for (let j = 0; j < row.fieldRects.length; j++) {
        if (e.clientX < row.fieldRects[j].midX) {
          targetSlot = j;
          break;
        }
      }
    }

    if (
      targetRow !== drag.toRowIdx ||
      targetSlot !== drag.toSlotIdx ||
      e.clientX !== drag.pointerX ||
      e.clientY !== drag.pointerY
    ) {
      setDrag((d) => ({
        ...d,
        toRowIdx: targetRow,
        toSlotIdx: targetSlot,
        pointerX: e.clientX,
        pointerY: e.clientY,
      }));
    }
  }

  function handleDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { fromRowIdx, fromFieldIdx, toRowIdx, toSlotIdx } = drag;
    setDrag(null);
    commitMove(fromRowIdx, fromFieldIdx, toRowIdx, toSlotIdx);
  }

  function commitMove(fromRow, fromIdx, toRow, toSlot) {
    updateRows((rs) => {
      if (isNoOpOrBlocked(rs, fromRow, fromIdx, toRow, toSlot)) return rs;
      const clone = rs.map((r) => ({ ...r, fields: [...r.fields] }));
      const [field] = clone[fromRow].fields.splice(fromIdx, 1);
      if (toRow >= clone.length) {
        clone.push({ id: freshRowId(), fields: [field] });
      } else {
        // If moving within the same row past the original index, the
        // splice above shifted everything left by 1 — adjust the insert
        // slot to land at the user's intended position.
        let adjusted = toSlot;
        if (fromRow === toRow && toSlot > fromIdx) adjusted--;
        clone[toRow].fields.splice(adjusted, 0, field);
      }
      return clone.filter((r, i) => i === 0 || r.fields.length > 0);
    });
  }

  function handleSave() {
    if (!draft.label?.trim()) return;
    const cleanedRows = (draft.rows ?? []).filter(
      (r, i) => i === 0 || r.fields.length > 0,
    );
    const schema = {
      ...draft,
      label: draft.label.trim(),
      rows: cleanedRows,
    };
    if (isNew) {
      dispatch(persistAddInvestmentType(schema));
      // Let the caller react to a fresh type — e.g. the InvestmentForm
      // type-picker auto-selects the new type so the user lands straight
      // in its Add Investment flow without a second tap.
      onCreated?.(schema);
    } else {
      dispatch(persistUpdateInvestmentType(schema));
    }
    onClose();
  }

  const canSave = !!draft.label?.trim();
  const editingField =
    editingFieldRef &&
    rows[editingFieldRef.rowIdx]?.fields[editingFieldRef.fieldIdx];

  // Pre-compute whether the current drag target is a valid drop spot. The
  // RowEditor uses this to decide whether to show the insertion bar.
  const dragTargetValid =
    drag &&
    !isNoOpOrBlocked(
      rows,
      drag.fromRowIdx,
      drag.fromFieldIdx,
      drag.toRowIdx,
      drag.toSlotIdx,
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isNew
          ? "Create custom investment type"
          : `Edit ${existing.label}`
      }
    >
      <div className="itd-designer">
        {/* ── Header ── */}
        <div className="itd-section">
          <div className="field">
            <input
              type="text"
              value={draft.label ?? ""}
              onChange={(e) => updateDraft({ label: e.target.value })}
              required
              placeholder=" "
              readOnly={isBuiltIn}
              autoFocus={!isBuiltIn}
            />
            <label>Name</label>
          </div>

          <div className="itd-profile-section">
            <p className="itd-section-label">Math profile</p>
            <div className="itd-profile-pills">
              {Object.values(MATH_PROFILES).map((p) => {
                const isOn = draft.mathProfile === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`itd-profile-pill${isOn ? " itd-profile-pill--on" : ""}`}
                    onClick={() => switchProfile(p.key)}
                    disabled={isBuiltIn}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            {isBuiltIn && (
              <p className="itd-locked-hint">
                <i className="fa-solid fa-lock" /> Built-in type. Name and
                profile are locked; you can still add extra fields below.
              </p>
            )}
            {!isBuiltIn && profile && !profile.affectsPortfolio && (
              <p className="itd-locked-hint itd-locked-hint--info">
                <i className="fa-solid fa-circle-info" /> Cash flow types are
                excluded from portfolio returns. They show up in holdings
                but don't contribute to CAGR or allocation math.
              </p>
            )}
          </div>
        </div>

        {/* ── Mobile preview toggle ── */}
        <div className="itd-preview-toggle">
          <button
            type="button"
            className={`itd-preview-tab${!previewVisibleMobile ? " itd-preview-tab--on" : ""}`}
            onClick={() => setPreviewVisibleMobile(false)}
          >
            Edit
          </button>
          <button
            type="button"
            className={`itd-preview-tab${previewVisibleMobile ? " itd-preview-tab--on" : ""}`}
            onClick={() => setPreviewVisibleMobile(true)}
          >
            Preview
          </button>
        </div>

        {/* ── Split: editor (left) + preview (right) ── */}
        <div className="itd-split">
          {/* Editor pane — pointer-move and pointer-up are bound here so
              they catch events bubbling up from the captured drag handle.
              setPointerCapture on the handle still lets events bubble. */}
          <div
            ref={editorPaneRef}
            className={`itd-pane itd-pane--editor${previewVisibleMobile ? " itd-pane--hidden-mobile" : ""}${drag ? " itd-pane--dragging" : ""}`}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <p className="itd-section-label">Fields</p>

            {rows.map((row, rIdx) => (
              <RowEditor
                key={row.id}
                row={row}
                rowIndex={rIdx}
                isFirstRow={rIdx === 0}
                drag={drag}
                dragTargetValid={dragTargetValid}
                onOpenPicker={() => setPickerTarget(rIdx)}
                onMoveField={(fIdx, dir) => moveField(rIdx, fIdx, dir)}
                onEditField={(fIdx) =>
                  setEditingFieldRef({ rowIdx: rIdx, fieldIdx: fIdx })
                }
                onDeleteField={(fIdx) => deleteField(rIdx, fIdx)}
                onDragStart={(e, fIdx) => handleDragStart(e, rIdx, fIdx)}
              />
            ))}

            {/* Drop zone for "new row at end" — shown only during drag */}
            {drag && (
              <div
                className={`itd-new-row-zone${
                  drag.toRowIdx === rows.length && dragTargetValid
                    ? " itd-new-row-zone--active"
                    : ""
                }`}
              >
                <i className="fa-solid fa-plus" /> Drop here to start a new row
              </div>
            )}

            <button
              type="button"
              className="itd-add-row-btn"
              onClick={addRow}
            >
              <i className="fa-solid fa-plus" /> Add row
            </button>
          </div>

          {/* Preview pane */}
          <div
            className={`itd-pane itd-pane--preview${previewVisibleMobile ? "" : " itd-pane--hidden-mobile"}`}
          >
            <p className="itd-section-label">
              <i className="fa-solid fa-eye" /> Live preview
            </p>
            {/* `inert` removes the entire preview subtree from focus,
                pointer, and keyboard interaction — turning the form into
                a static visual mock. Buttons can't be clicked, inputs
                can't be edited, dropdowns can't open. The .itd-preview-frame
                class also adds pointer-events:none + a faint overlay
                cursor cue so the read-only intent is obvious. */}
            <div className="itd-preview-frame" inert={true}>
              <DynamicInvestmentForm
                key={JSON.stringify(rows)}
                schema={draft}
                onSubmit={() => {}}
                onCancel={() => {}}
              />
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="generic-button"
            disabled={!canSave}
            onClick={handleSave}
          >
            <i className="fa-solid fa-floppy-disk" />{" "}
            {isNew ? "Create type" : "Save changes"}
          </button>
        </div>
      </div>

      {/* ── Field-type picker ── */}
      {pickerTarget !== null && (
        <Modal
          open
          onClose={() => setPickerTarget(null)}
          title="Add a field"
        >
          <FieldTypePicker
            onPick={(t) => addFieldToRow(pickerTarget, t)}
            onClose={() => setPickerTarget(null)}
          />
        </Modal>
      )}

      {/* ── Per-field editor ── */}
      {editingField && (
        <Modal
          open
          onClose={() => setEditingFieldRef(null)}
          title={`Edit field — ${editingField.label || editingField.type}`}
        >
          <FieldConfig
            field={editingField}
            onChange={(patch) =>
              updateField(editingFieldRef.rowIdx, editingFieldRef.fieldIdx, patch)
            }
            onClose={() => setEditingFieldRef(null)}
          />
        </Modal>
      )}
    </Modal>
  );
};

InvestmentTypeDesigner.propTypes = {
  existing: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
};

export default memo(InvestmentTypeDesigner);

// ── Row editor ─────────────────────────────────────────

function RowEditor({
  row,
  rowIndex,
  isFirstRow,
  drag,
  dragTargetValid,
  onOpenPicker,
  onMoveField,
  onEditField,
  onDeleteField,
  onDragStart,
}) {
  const canAddMore = row.fields.length < MAX_FIELDS_PER_ROW;
  const showBarAt = (slotIdx) =>
    !!drag && dragTargetValid && drag.toRowIdx === rowIndex && drag.toSlotIdx === slotIdx;

  return (
    <div className="itd-row-editor" data-row-id={row.id}>
      <div className="itd-row-header">
        <span className="itd-row-label">Row {rowIndex + 1}</span>
        <span className="itd-row-meta">
          {row.fields.length} / {MAX_FIELDS_PER_ROW} fields
        </span>
      </div>
      <div className="itd-row-fields">
        {row.fields.map((f, fIdx) => {
          const isDragging =
            !!drag && drag.fromRowIdx === rowIndex && drag.fromFieldIdx === fIdx;
          return (
            <Slot key={f.id}>
              {showBarAt(fIdx) && <InsertBar />}
              <FieldChip
                field={f}
                fieldIndex={fIdx}
                rowFieldCount={row.fields.length}
                isFirstRow={isFirstRow}
                isDragging={isDragging}
                onMove={(dir) => onMoveField(fIdx, dir)}
                onEdit={() => onEditField(fIdx)}
                onDelete={() => onDeleteField(fIdx)}
                onDragStart={(e) => onDragStart(e, fIdx)}
              />
            </Slot>
          );
        })}
        {showBarAt(row.fields.length) && <InsertBar />}
        {row.fields.length === 0 && !showBarAt(0) && (
          <p className="itd-row-empty">Empty row. Add a field below.</p>
        )}
      </div>
      <button
        type="button"
        className="itd-add-field-btn"
        onClick={onOpenPicker}
        disabled={!canAddMore}
        title={
          canAddMore
            ? "Add a field to this row"
            : "Row is full. Add another row."
        }
      >
        <i className="fa-solid fa-plus" /> Add field to this row
      </button>
    </div>
  );
}

RowEditor.propTypes = {
  row: PropTypes.object.isRequired,
  rowIndex: PropTypes.number.isRequired,
  isFirstRow: PropTypes.bool.isRequired,
  drag: PropTypes.object,
  dragTargetValid: PropTypes.bool,
  onOpenPicker: PropTypes.func.isRequired,
  onMoveField: PropTypes.func.isRequired,
  onEditField: PropTypes.func.isRequired,
  onDeleteField: PropTypes.func.isRequired,
  onDragStart: PropTypes.func.isRequired,
};

// Thin wrapper so React keys + sibling order play nicely with the
// optional insertion-bar element preceding each chip.
function Slot({ children }) {
  return <>{children}</>;
}

Slot.propTypes = { children: PropTypes.node };

// Vertical insertion bar shown at drop target. align-self: stretch in CSS
// makes it match the chip height in the flex row.
function InsertBar() {
  return <span className="itd-insert-bar" aria-hidden="true" />;
}

// ── Field chip ─────────────────────────────────────────

function FieldChip({
  field,
  fieldIndex,
  rowFieldCount,
  isFirstRow,
  isDragging,
  onMove,
  onEdit,
  onDelete,
  onDragStart,
}) {
  const meta = FIELD_TYPE_META[field.type] ?? { label: field.type, icon: "fa-circle" };
  const locked = !!field.locked;
  return (
    <div
      className={`itd-field-chip${locked ? " itd-field-chip--locked" : ""}${isDragging ? " itd-field-chip--dragging" : ""}`}
      data-field-id={field.id}
    >
      <div className="itd-field-chip-head">
        {/* The icon doubles as the drag handle. cursor:grab + pointer-down
            kicks off the move. Keeps the UI tidy — one fewer button per
            chip while still being discoverable. */}
        <button
          type="button"
          className="itd-field-icon itd-field-drag-handle"
          onPointerDown={onDragStart}
          aria-label={`Drag ${field.label} to reorder`}
          title="Drag to reorder"
        >
          <i className={`fa-solid ${meta.icon}`} />
        </button>
        <div className="itd-field-chip-meta">
          <span className="itd-field-label">
            {field.label}
            {field.required && (
              <span className="itd-field-req" title="Required">*</span>
            )}
          </span>
          <span className="itd-field-type">{meta.label}</span>
        </div>
        {locked && (
          <span className="itd-field-locked-pill">
            <i className="fa-solid fa-lock" />
          </span>
        )}
      </div>

      <div className="itd-field-actions">
        <button
          type="button"
          className="itd-icon-btn"
          onClick={() => onMove("left")}
          disabled={fieldIndex === 0}
          aria-label="Move left"
          title="Move left within row"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <button
          type="button"
          className="itd-icon-btn"
          onClick={() => onMove("right")}
          disabled={fieldIndex === rowFieldCount - 1}
          aria-label="Move right"
          title="Move right within row"
        >
          <i className="fa-solid fa-chevron-right" />
        </button>
        <button
          type="button"
          className="itd-icon-btn"
          onClick={() => onMove("up")}
          disabled={isFirstRow}
          aria-label="Move to row above"
          title="Move to row above"
        >
          <i className="fa-solid fa-chevron-up" />
        </button>
        <button
          type="button"
          className="itd-icon-btn"
          onClick={() => onMove("down")}
          aria-label="Move to row below"
          title="Move to row below (creates a new row if at the bottom)"
        >
          <i className="fa-solid fa-chevron-down" />
        </button>
        {!locked && (
          <>
            <button
              type="button"
              className="itd-icon-btn"
              onClick={onEdit}
              aria-label="Edit"
              title="Edit field"
            >
              <i className="fa-solid fa-pen" />
            </button>
            <button
              type="button"
              className="itd-icon-btn itd-icon-btn--danger"
              onClick={onDelete}
              aria-label="Remove"
              title="Remove field"
            >
              <i className="fa-solid fa-trash-can" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

FieldChip.propTypes = {
  field: PropTypes.object.isRequired,
  fieldIndex: PropTypes.number.isRequired,
  rowFieldCount: PropTypes.number.isRequired,
  isFirstRow: PropTypes.bool.isRequired,
  isDragging: PropTypes.bool,
  onMove: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onDragStart: PropTypes.func.isRequired,
};

// ── Field-type picker (sub-modal) ───────────────────────

function FieldTypePicker({ onPick, onClose }) {
  return (
    <div className="itd-picker">
      <p className="pref-section-hint">
        Pick the kind of field to add. You can rename it after.
      </p>
      <div className="itd-picker-grid">
        {FIELD_TYPES.map((t) => {
          const meta = FIELD_TYPE_META[t];
          return (
            <button
              key={t}
              type="button"
              className="itd-picker-tile"
              onClick={() => onPick(t)}
            >
              <i className={`fa-solid ${meta?.icon ?? "fa-circle"}`} />
              <span>{meta?.label ?? t}</span>
            </button>
          );
        })}
      </div>
      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

FieldTypePicker.propTypes = {
  onPick: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── Per-field configuration (sub-modal) ─────────────────

function FieldConfig({ field, onChange, onClose }) {
  const [draftOption, setDraftOption] = useState("");
  const hasOptions = field.type === "dropdown" || field.type === "multi-select";
  const options = Array.isArray(field.options) ? field.options : [];

  function addOption() {
    const v = draftOption.trim();
    if (!v) return;
    if (options.some((o) => o.value === v || o.label === v)) {
      setDraftOption("");
      return;
    }
    onChange({ options: [...options, { value: v, label: v }] });
    setDraftOption("");
  }

  function removeOption(value) {
    onChange({ options: options.filter((o) => o.value !== value) });
  }

  return (
    <div className="itd-field-config">
      <div className="field">
        <input
          type="text"
          value={field.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          required
          placeholder=" "
          autoFocus
        />
        <label>Label</label>
      </div>

      <label className="dyn-form-checkbox">
        <input
          type="checkbox"
          checked={!!field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        <span>Required field</span>
      </label>

      {field.type === "text" && (
        <div className="field">
          <input
            type="text"
            value={field.defaultValue ?? ""}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
            placeholder=" "
          />
          <label>Default value (optional)</label>
        </div>
      )}

      {(field.type === "number" ||
        field.type === "currency" ||
        field.type === "percentage") && (
        <div className="field">
          <input
            type="number"
            step="any"
            value={field.defaultValue ?? ""}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
            placeholder=" "
          />
          <label>Default value (optional)</label>
        </div>
      )}

      {/* Ticker field — choose which API to hit when searching / fetching */}
      {field.type === "ticker" && (
        <div className="field">
          <select
            value={field.config?.kind ?? "stock"}
            onChange={(e) =>
              onChange({
                config: { ...(field.config ?? {}), kind: e.target.value },
              })
            }
          >
            <option value="stock">Stock / ETF / REIT (Yahoo Finance)</option>
            <option value="mf">Mutual fund / SIP (MFAPI.in)</option>
            <option value="crypto">Crypto (CoinGecko)</option>
          </select>
          <label>Ticker source</label>
        </div>
      )}

      {/* Month-grid — how many months can the user pick at most */}
      {field.type === "month-grid" && (
        <div className="field">
          <input
            type="number"
            min="1"
            max="12"
            step="1"
            value={field.config?.maxSelections ?? 12}
            onChange={(e) =>
              onChange({
                config: {
                  ...(field.config ?? {}),
                  maxSelections: Math.max(
                    1,
                    Math.min(12, parseInt(e.target.value) || 12),
                  ),
                },
              })
            }
            placeholder=" "
          />
          <label>Max months selectable (1 to 12)</label>
        </div>
      )}

      {hasOptions && (
        <div className="itd-options">
          <p className="itd-section-label">Options</p>
          <ul className="itd-options-list">
            {options.map((o) => (
              <li key={o.value} className="itd-option-row">
                <span>{o.label}</span>
                <button
                  type="button"
                  className="pref-cat-btn pref-cat-btn--danger"
                  onClick={() => removeOption(o.value)}
                  aria-label={`Remove ${o.label}`}
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </li>
            ))}
            {options.length === 0 && (
              <li className="pref-cat-empty">No options yet.</li>
            )}
          </ul>
          <form
            className="pref-cat-add"
            onSubmit={(e) => {
              e.preventDefault();
              addOption();
            }}
          >
            <input
              type="text"
              placeholder="New option label"
              value={draftOption}
              onChange={(e) => setDraftOption(e.target.value)}
            />
            <button
              type="submit"
              className="pref-cat-add-btn"
              disabled={!draftOption.trim()}
            >
              <i className="fa-solid fa-plus" /> Add
            </button>
          </form>
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="generic-button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

FieldConfig.propTypes = {
  field: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
