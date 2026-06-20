import { memo, useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import {
  persistDismissNotification,
  persistClearNotifications,
  persistLogAutoDeductPayment,
} from "../redux/slices/transactionSlice";
import { showToast } from "../redux/slices/toastSlice";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// The notifications surface. Tapping a row deep-links to its source section
// (each href carries `?highlight=<id>` which the target page already honours,
// scrolling to and flashing the item). The × dismisses one early; "Clear all"
// dismisses everything visible. Both go through the self-expiring dismissal
// map, so nothing is permanently silenced — it returns next cycle.
function NotificationModal({ open, onClose, items }) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const investments = useSelector(
    (s) => s.transactions.transactionData?.investments ?? [],
  );
  const [loggingId, setLoggingId] = useState(null);

  const handleOpen = (n) => {
    onClose();
    navigate(n.href);
  };

  const handleLog = async (e, n) => {
    e.stopPropagation();
    const inv = investments.find((i) => i.id === n.action.investmentId);
    if (!inv) return;
    setLoggingId(n.id);
    try {
      const ok = await dispatch(
        persistLogAutoDeductPayment(inv, {
          occurredAt: new Date().toISOString(),
          amount: n.action.amount,
        }),
      );
      dispatch(
        showToast({
          message: ok ? "Contribution logged" : "Already logged this period",
          type: ok ? "success" : "info",
        }),
      );
    } finally {
      setLoggingId(null);
    }
  };

  const handleDismiss = (e, n) => {
    e.stopPropagation();
    dispatch(persistDismissNotification({ key: n.id, expiresAt: n.expiresAt }));
  };

  const handleClearAll = () => {
    if (items.length === 0) return;
    dispatch(
      persistClearNotifications(
        items.map((n) => ({ key: n.id, expiresAt: n.expiresAt })),
      ),
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Notifications">
      {items.length === 0 ? (
        <div className="notif-empty">
          <i className="fa-regular fa-bell-slash" />
          <p>You&apos;re all caught up</p>
          <span>Reminders for dues, renewals and SIPs will show up here.</span>
        </div>
      ) : (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>
              {items.length} reminder{items.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="notif-clear-all"
              onClick={handleClearAll}
            >
              Clear all
            </button>
          </div>
          <ul className="notif-list">
            {items.map((n) => (
              <li
                key={n.id}
                className={`notif-item notif-item--${n.severity}`}
                role="button"
                tabIndex={0}
                onClick={() => handleOpen(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpen(n);
                  }
                }}
              >
                <span className="notif-item-icon">
                  <i className={`fa-solid ${n.icon}`} />
                </span>
                <div className="notif-item-body">
                  <p className="notif-item-title">{n.title}</p>
                  <p className="notif-item-sub">
                    {n.subtitle}
                    {n.amount != null && (
                      <span className="notif-item-amt"> · {INR.format(n.amount)}</span>
                    )}
                  </p>
                </div>
                {n.action?.kind === "logAutoDeduct" && (
                  <button
                    type="button"
                    className="notif-item-log"
                    onClick={(e) => handleLog(e, n)}
                    disabled={loggingId === n.id}
                  >
                    {loggingId === n.id ? (
                      <i className="fa-solid fa-spinner fa-spin" />
                    ) : (
                      <>
                        <i className="fa-solid fa-circle-check" /> Log
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className="notif-item-dismiss"
                  aria-label="Dismiss notification"
                  onClick={(e) => handleDismiss(e, n)}
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

NotificationModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  items: PropTypes.array.isRequired,
};

export default memo(NotificationModal);
