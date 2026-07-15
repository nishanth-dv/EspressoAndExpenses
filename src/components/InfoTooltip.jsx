import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";

// Small, app-themed info tooltip. A ⓘ button toggles a floating popover —
// click-to-open so it works on touch and desktop alike; closes on an outside
// click or Escape. Content can be any node.
//
// The popover is portaled to <body> and positioned with fixed coordinates
// measured from the button, then clamped to the viewport (with an above/below
// flip). That's what keeps it from bleeding off-screen on narrow phones —
// centering it on the tiny trigger with pure CSS pushed half of it past the
// edge whenever the trigger sat near the screen border.
export default function InfoTooltip({
  text,
  label = "More information",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { left, top, placement, arrowLeft }
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      const pop = popRef.current;
      if (!btn || !pop) return;
      const b = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const margin = 8;
      const gap = 10;
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      const btnCenter = b.left + b.width / 2;

      // Centre on the trigger, then clamp within the viewport.
      let left = btnCenter - pw / 2;
      left = Math.max(margin, Math.min(left, vw - pw - margin));

      // Prefer above the trigger; flip below when there isn't headroom.
      let placement = "top";
      let top = b.top - gap - ph;
      if (top < margin) {
        placement = "bottom";
        top = b.bottom + gap;
      }

      // Keep the arrow pointing at the trigger even after the popover clamps.
      const arrowLeft = Math.max(14, Math.min(btnCenter - left, pw - 14));
      setPos({ left, top, placement, arrowLeft });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (
        wrapRef.current?.contains(e.target) ||
        popRef.current?.contains(e.target)
      )
        return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={`info-tip${className ? ` ${className}` : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-expanded={open}
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <i className="fa-solid fa-circle-info" />
      </button>
      {open &&
        createPortal(
          <span
            ref={popRef}
            className={`info-tip-pop info-tip-pop--${pos?.placement ?? "top"}`}
            role="tooltip"
            style={{
              left: pos ? pos.left : 0,
              top: pos ? pos.top : 0,
              visibility: pos ? "visible" : "hidden",
              "--arrow-left": `${pos?.arrowLeft ?? 0}px`,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

InfoTooltip.propTypes = {
  text: PropTypes.node.isRequired,
  label: PropTypes.string,
  className: PropTypes.string,
};
