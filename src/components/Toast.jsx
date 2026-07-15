import { memo, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { createPortal } from "react-dom";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { dismissToast } from "../redux/slices/toastSlice";
import { persistRestoreTransaction } from "../redux/slices/transactionSlice";

const ICONS = {
  success: "fa-circle-check",
  error: "fa-circle-exclamation",
  info: "fa-circle-info",
};

const RADIUS = 15;
const CIRC = 2 * Math.PI * RADIUS;

const ToastItem = memo(({ toast }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    const hide = setTimeout(() => setHiding(true), toast.duration);
    return () => clearTimeout(hide);
  }, [toast.duration]);

  useEffect(() => {
    if (!hiding) return;
    const remove = setTimeout(() => dispatch(dismissToast(toast.id)), 220);
    return () => clearTimeout(remove);
  }, [hiding, toast.id, dispatch]);

  const handleAction = () => {
    if (toast.action?.href) navigate(toast.action.href);
    else if (toast.action?.restoreTx)
      dispatch(persistRestoreTransaction(toast.action.restoreTx));
    setHiding(true);
  };

  return (
    <div
      className={`toast toast--${toast.type}${hiding ? " toast--hiding" : ""}`}
      role="alert"
    >
      <span className="toast-timer">
        <svg viewBox="0 0 36 36" className="toast-timer-svg" aria-hidden="true">
          <circle className="toast-timer-track" cx="18" cy="18" r={RADIUS} />
          {!hiding && (
            <circle
              className="toast-timer-ring"
              cx="18"
              cy="18"
              r={RADIUS}
              style={{
                strokeDasharray: CIRC,
                animationDuration: `${toast.duration}ms`,
              }}
            />
          )}
        </svg>
        <i className={`fa-solid ${ICONS[toast.type] ?? ICONS.info} toast-icon`} />
      </span>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={handleAction}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        onClick={() => setHiding(true)}
        aria-label="Dismiss"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
});
ToastItem.displayName = "ToastItem";
ToastItem.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    type: PropTypes.oneOf(["success", "error", "info"]),
    message: PropTypes.string,
    duration: PropTypes.number,
    action: PropTypes.shape({
      label: PropTypes.string,
      href: PropTypes.string,
      restoreTx: PropTypes.object,
    }),
  }).isRequired,
};

const Toast = () => {
  const toasts = useSelector((state) => state.toast.toasts);
  if (!toasts.length) return null;

  return createPortal(
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
};

export default memo(Toast);
