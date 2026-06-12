import { memo, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { createPortal } from "react-dom";
import { useSelector, useDispatch } from "react-redux";
import { dismissToast } from "../redux/slices/toastSlice";

const ICONS = {
  success: "fa-circle-check",
  error: "fa-circle-exclamation",
  info: "fa-circle-info",
};

const ToastItem = memo(({ toast }) => {
  const dispatch = useDispatch();
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

  return (
    <div
      className={`toast toast--${toast.type}${hiding ? " toast--hiding" : ""}`}
      role="alert"
    >
      <i className={`fa-solid ${ICONS[toast.type] ?? ICONS.info} toast-icon`} />
      <span className="toast-message">{toast.message}</span>
      <button
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
