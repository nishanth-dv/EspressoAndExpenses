// ── InvestmentTypesPanel ────────────────────────────────
//
// Rendered inside the Preferences page. Shows every available investment
// type (built-ins + curated Discover catalog + user-added) as a flat list,
// each with a toggle controlling whether it appears in the Add Investment
// type picker. The user's enabled set is persisted as
// `preferences.enabledInvestmentTypes`.
//
// The visible order is also user-driven via drag-to-reorder, persisted as
// `preferences.investmentTypeOrder`. Whatever order the rows take here is
// the same order the type-picker uses in the Add Investment form.
//
// Tapping a toggle on a Discover entry that isn't yet in the user's
// `transactionData.investmentTypes` also brings the entry over into that
// catalog so the schema is available for the form. Toggling off a built-in
// just removes its key from the enabled set — the schema stays in code.
//
// The field designer (build-your-own / edit existing) lands in Phase 3.

import { memo, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  persistAddInvestmentType,
  persistSetPreference,
} from "../redux/slices/transactionSlice";
import {
  BUILTIN_INVESTMENT_TYPES,
  MATH_PROFILES,
} from "../utils/investmentTypeSchemas";
import { DISCOVER_INVESTMENT_TYPES } from "../data/investmentTypesDiscover";
import InvestmentTypeDesigner from "./InvestmentTypeDesigner";

// Build the universe of types the user can choose from:
//   • Built-ins (from code)
//   • Discover catalog (from code)
//   • User-added entries (overrides + custom types, from Drive)
// User entries replace any built-in / discover entry with the same key so
// schema edits win. We keep the canonical description from the source
// catalog as a fallback though, since legacy user-saved Discover clones
// were persisted without their description and we still want it shown.
function buildAvailableTypes(userTypes) {
  const byKey = new Map();
  const fallbackDesc = new Map();
  for (const t of BUILTIN_INVESTMENT_TYPES) {
    byKey.set(t.key, { ...t, _source: "builtin" });
    if (t.description) fallbackDesc.set(t.key, t.description);
  }
  for (const t of DISCOVER_INVESTMENT_TYPES) {
    byKey.set(t.key, { ...t, _source: "discover" });
    if (t.description) fallbackDesc.set(t.key, t.description);
  }
  for (const t of userTypes) {
    const description = t.description ?? fallbackDesc.get(t.key);
    byKey.set(t.key, { ...t, description, _source: "user" });
  }
  return [...byKey.values()];
}

// Apply a key-order to the available array. Keys present in `order` win
// (first), in the order they appear; remaining types (e.g., brand-new
// Discover entries shipped in a later app version) tack onto the end.
function applyOrder(types, order) {
  if (!Array.isArray(order) || order.length === 0) return types;
  const byKey = new Map(types.map((t) => [t.key, t]));
  const seen = new Set();
  const ordered = [];
  for (const key of order) {
    if (byKey.has(key) && !seen.has(key)) {
      ordered.push(byKey.get(key));
      seen.add(key);
    }
  }
  for (const t of types) {
    if (!seen.has(t.key)) ordered.push(t);
  }
  return ordered;
}

const InvestmentTypesPanel = () => {
  const dispatch = useDispatch();
  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.investmentTypes ?? [],
  );
  const enabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.enabledInvestmentTypes ?? [],
  );
  const order = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences
        ?.investmentTypeOrder ?? [],
  );

  const available = useMemo(
    () => applyOrder(buildAvailableTypes(userTypes), order),
    [userTypes, order],
  );
  const enabledSet = useMemo(() => new Set(enabled), [enabled]);

  function setEnabled(nextKeys) {
    dispatch(persistSetPreference("enabledInvestmentTypes", nextKeys));
  }
  function setOrder(nextOrder) {
    dispatch(persistSetPreference("investmentTypeOrder", nextOrder));
  }

  function toggle(typeEntry) {
    const isOn = enabledSet.has(typeEntry.key);
    if (isOn) {
      setEnabled(enabled.filter((k) => k !== typeEntry.key));
      return;
    }
    // Enabling a Discover entry that hasn't been brought into the user
    // catalog yet — clone the schema into transactionData.investmentTypes
    // so the dynamic form has access to it.
    if (typeEntry._source === "discover") {
      const alreadyImported = userTypes.some((u) => u.key === typeEntry.key);
      if (!alreadyImported) {
        // Carry description + tags through to the saved schema so the
        // Preferences row keeps showing them even after the user-saved
        // copy wins precedence over the catalog entry. Drop the
        // _source marker; that's a runtime-only tag.
        const { _source, ...schema } = typeEntry;
        void _source;
        dispatch(persistAddInvestmentType(schema));
      }
    }
    setEnabled([...enabled, typeEntry.key]);
  }

  // ── Drag-to-reorder ──────────────────────────────────
  // Same model as the Categories / Payment modes / Banks lists in
  // PreferencesPage. Pointer-driven, transforms-only during the drag so
  // there's no layout thrash; the persisted order updates on drag end.

  const listRef = useRef(null);
  const [drag, setDrag] = useState(null);
  // Designer modal state. `editingType` holds the schema being edited (or
  // null when the modal is closed). For brand-new custom types, we open
  // the modal with `existing={null}` so the designer seeds an empty schema.
  const [editingType, setEditingType] = useState(null);
  const [creating, setCreating] = useState(false);

  function handleDragStart(e, idx) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const rows = listRef.current?.querySelectorAll("[data-cat-row]");
    const originalRects = [];
    if (rows) {
      rows.forEach((row) => {
        const r = row.getBoundingClientRect();
        originalRects.push({ top: r.top, bottom: r.bottom, height: r.height });
      });
    }
    const rowHeight =
      originalRects.length > 1
        ? originalRects[1].top - originalRects[0].top
        : (originalRects[0]?.height ?? 0) + 6;

    setDrag({
      fromIndex: idx,
      toIndex: idx,
      startY: e.clientY,
      pointerY: e.clientY,
      pointerId: e.pointerId,
      originalRects,
      rowHeight,
    });
  }

  function handleDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    let newIdx = drag.originalRects.length - 1;
    for (let i = 0; i < drag.originalRects.length; i++) {
      const r = drag.originalRects[i];
      const mid = (r.top + r.bottom) / 2;
      if (e.clientY < mid) {
        newIdx = i;
        break;
      }
    }
    if (newIdx !== drag.toIndex || e.clientY !== drag.pointerY) {
      setDrag((d) => ({ ...d, toIndex: newIdx, pointerY: e.clientY }));
    }
  }

  function handleDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { fromIndex, toIndex } = drag;
    if (fromIndex !== toIndex) {
      const keys = available.map((t) => t.key);
      const [moved] = keys.splice(fromIndex, 1);
      keys.splice(toIndex, 0, moved);
      setOrder(keys);
    }
    setDrag(null);
  }

  function getYOffset(index) {
    if (!drag) return 0;
    if (index === drag.fromIndex) return drag.pointerY - drag.startY;
    if (drag.fromIndex < drag.toIndex) {
      if (index > drag.fromIndex && index <= drag.toIndex)
        return -drag.rowHeight;
    } else if (drag.fromIndex > drag.toIndex) {
      if (index >= drag.toIndex && index < drag.fromIndex)
        return drag.rowHeight;
    }
    return 0;
  }

  const enabledCount = available.filter((t) => enabledSet.has(t.key)).length;

  return (
    <>
      <p className="pref-section-hint">
        Pick which investment types appear in the Add Investment screen. Tap
        the toggle to enable or disable. Drag the grip handle to reorder —
        the order here is the same order shown in the picker.
      </p>

      <p className="pref-inv-types-summary">
        <strong>{enabledCount}</strong> of {available.length} types enabled
      </p>

      <ul
        ref={listRef}
        className="pref-inv-types-flat"
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        {available.map((t, i) => {
          const isOn = enabledSet.has(t.key);
          const profile =
            MATH_PROFILES[t.mathProfile]?.label ?? t.mathProfile;
          const sourceLabel =
            t._source === "discover"
              ? "Discover"
              : t._source === "user"
                ? "Custom"
                : null;
          const isDragging = drag != null && i === drag.fromIndex;
          const yOff = getYOffset(i);
          return (
            <li
              key={t.key}
              data-cat-row
              data-key={t.key}
              className={`pref-inv-type-flat${isOn ? " pref-inv-type-flat--on" : ""}${isDragging ? " pref-inv-type-flat--dragging" : ""}`}
              style={yOff ? { transform: `translateY(${yOff}px)` } : undefined}
            >
              <button
                type="button"
                className="pref-cat-handle pref-inv-type-handle"
                onPointerDown={(e) => handleDragStart(e, i)}
                aria-label={`Drag ${t.label} to reorder`}
              >
                <span className="pref-cat-handle-stack" aria-hidden="true">
                  <i className="fa-solid fa-chevron-up" />
                  <i className="fa-solid fa-chevron-down" />
                </span>
              </button>
              <span
                className="pref-inv-type-icon"
                style={{
                  background: (t.color || "#888") + "22",
                  color: t.color || "#888",
                }}
              >
                <i className={`fa-solid ${t.icon ?? "fa-circle"}`} />
              </span>
              <div className="pref-inv-type-meta">
                <div className="pref-inv-type-head">
                  <span className="pref-inv-type-name">
                    {t.label}
                    {sourceLabel && (
                      <span className="pref-inv-type-source">{sourceLabel}</span>
                    )}
                  </span>
                  <div className="pref-inv-type-actions">
                    <button
                      type="button"
                      className="pref-cat-btn pref-inv-type-edit"
                      onClick={() => setEditingType(t)}
                      aria-label={`Edit ${t.label}`}
                      title={
                        t._source === "builtin"
                          ? "Add extra fields (anchors stay locked)"
                          : "Edit schema"
                      }
                    >
                      <i className="fa-solid fa-pen" />
                    </button>
                    <button
                      type="button"
                      className={`pref-switch${isOn ? " pref-switch--on" : ""}`}
                      role="switch"
                      aria-checked={isOn}
                      aria-label={`${isOn ? "Disable" : "Enable"} ${t.label}`}
                      onClick={() => toggle(t)}
                    >
                      <span className="pref-switch-thumb" />
                    </button>
                  </div>
                </div>
                <span className="pref-inv-type-sub">{profile}</span>
                {t.description && (
                  <span className="pref-inv-type-desc">{t.description}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="generic-button pref-inv-create-btn"
        onClick={() => setCreating(true)}
      >
        <i className="fa-solid fa-wand-magic-sparkles" /> Create custom type
      </button>

      {editingType && (
        <InvestmentTypeDesigner
          existing={editingType}
          onClose={() => setEditingType(null)}
        />
      )}
      {creating && (
        <InvestmentTypeDesigner onClose={() => setCreating(false)} />
      )}
    </>
  );
};

export default memo(InvestmentTypesPanel);
