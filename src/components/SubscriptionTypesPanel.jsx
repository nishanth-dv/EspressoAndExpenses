// ── SubscriptionTypesPanel ──────────────────────────────
//
// Rendered inside the Preferences page. Lists the available subscription
// "types" (the built-in brands plus any the user defines) as pickable presets
// for the Add Subscription form. Rows can be dragged to reorder — the order
// here is the same order the form's chip strip uses. Custom types can be
// removed; creating one opens a modal. Mirrors the Investment-types panel.

import { memo, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import {
  persistAddSubscriptionType,
  persistDeleteSubscriptionType,
} from "../redux/slices/solvencySlice";
import { persistSetPreference } from "../redux/slices/transactionSlice";
import {
  KNOWN_BRANDS,
  SUBSCRIPTION_ICON_CHOICES,
  applyTypeOrder,
} from "../utils/subscriptionUtils";
import { CARD_COLORS } from "../utils/constants";
import "../styles/subscriptions.css";

const SubscriptionTypesPanel = () => {
  const dispatch = useDispatch();
  const userTypes = useSelector(
    (state) => state.transactions.transactionData?.subscriptionTypes ?? [],
  );
  const order = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.subscriptionTypeOrder ??
      [],
  );

  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState(SUBSCRIPTION_ICON_CHOICES[0]);
  const [color, setColor] = useState(CARD_COLORS[0]);

  // Built-ins first, then custom — then the user's saved order applied on top.
  const rows = useMemo(() => {
    const builtins = KNOWN_BRANDS.map((b) => ({ ...b, _source: "builtin" }));
    const users = userTypes.map((t) => ({
      ...t,
      iconStyle: t.iconStyle || "fa-solid",
      _source: "user",
    }));
    return applyTypeOrder([...builtins, ...users], order);
  }, [userTypes, order]);

  function setOrder(keys) {
    dispatch(persistSetPreference("subscriptionTypeOrder", keys));
  }

  // ── Drag-to-reorder (pointer-driven, transforms-only) ──
  // Same model as the Investment-types / Categories lists.
  const listRef = useRef(null);
  const [drag, setDrag] = useState(null);

  function handleDragStart(e, idx) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const els = listRef.current?.querySelectorAll("[data-sub-row]");
    const originalRects = [];
    if (els) {
      els.forEach((row) => {
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
      const keys = rows.map((t) => t.key);
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

  function closeCreate() {
    setCreating(false);
    setLabel("");
    setIcon(SUBSCRIPTION_ICON_CHOICES[0]);
    setColor(CARD_COLORS[0]);
  }

  function handleAdd(e) {
    e.preventDefault();
    const name = label.trim();
    if (!name) return;
    dispatch(
      persistAddSubscriptionType({
        key: `sub-${crypto.randomUUID()}`,
        label: name,
        icon,
        iconStyle: "fa-solid",
        color,
      }),
    );
    closeCreate();
  }

  return (
    <>
      <p className="pref-section-hint">
        Presets that appear as quick-pick chips in the Add Subscription form.
        Drag the grip handle to reorder — the order here is the order shown in
        the form. Built-in brands are listed for reference.
      </p>

      <ul
        ref={listRef}
        className="pref-inv-types-flat"
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        {rows.map((t, i) => {
          const isDragging = drag != null && i === drag.fromIndex;
          const yOff = getYOffset(i);
          return (
            <li
              key={t.key}
              data-sub-row
              className={`pref-inv-type-flat sub-type-flat${isDragging ? " pref-inv-type-flat--dragging" : ""}`}
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
                <i className={`${t.iconStyle} ${t.icon}`} />
              </span>
              <span className="pref-inv-type-name">
                {t.label}
                <span className="pref-inv-type-source">
                  {t._source === "user" ? "Custom" : "Built-in"}
                </span>
              </span>
              <div className="pref-inv-type-actions">
                {t._source === "user" && (
                  <button
                    type="button"
                    className="pref-cat-btn pref-cat-btn--danger"
                    onClick={() =>
                      dispatch(persistDeleteSubscriptionType(t.key))
                    }
                    aria-label={`Delete ${t.label}`}
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
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
        <i className="fa-solid fa-plus" /> Create custom type
      </button>

      <Modal
        open={creating}
        onClose={closeCreate}
        title="New subscription type"
      >
        <form className="expense-form" onSubmit={handleAdd}>
          <div className="field">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoCorrect="off"
              spellCheck={false}
              required
              placeholder=" "
            />
            <label>Name (e.g. Adobe, my newspaper)</label>
          </div>

          <div className="sub-type-picker-label">Icon</div>
          <div className="sub-type-icon-grid">
            {SUBSCRIPTION_ICON_CHOICES.map((ic) => (
              <button
                key={ic}
                type="button"
                className={`sub-type-icon-opt${icon === ic ? " sub-type-icon-opt--active" : ""}`}
                style={{ "--accent": color }}
                onClick={() => setIcon(ic)}
                aria-label={ic}
              >
                <i className={`fa-solid ${ic}`} />
              </button>
            ))}
          </div>

          <div className="sub-type-picker-label">Colour</div>
          <div className="sub-type-color-grid">
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`sub-type-color-opt${color === c ? " sub-type-color-opt--active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>

          <div className="sub-type-preview">
            <span
              className="pref-inv-type-icon"
              style={{ background: color + "22", color }}
            >
              <i className={`fa-solid ${icon}`} />
            </span>
            <span className="sub-type-preview-name">
              {label.trim() || "Preview"}
            </span>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={closeCreate}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="generic-button"
              disabled={!label.trim()}
            >
              Add type
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};

export default memo(SubscriptionTypesPanel);
