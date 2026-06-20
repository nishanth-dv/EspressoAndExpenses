import { memo, useState } from "react";
import { useSelector } from "react-redux";
import useNotifications from "../hooks/useNotifications";
import NotificationModal from "./NotificationModal";

// Nav-bar entry point for notifications. Hidden entirely when the feature is
// switched off in Preferences → General. The badge count and the modal both
// read the same derived list via useNotifications.
const NotificationBell = () => {
  const enabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.notificationsEnabled,
  );
  const { items, count } = useNotifications();
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className={`notif-bell${count > 0 ? " notif-bell--active" : ""}`}
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Notifications, ${count} pending` : "Notifications"}
      >
        <i className="fa-solid fa-bell" />
        {count > 0 && (
          <span className="notif-badge">{count > 9 ? "9+" : count}</span>
        )}
      </button>
      <NotificationModal
        open={open}
        onClose={() => setOpen(false)}
        items={items}
      />
    </>
  );
};

export default memo(NotificationBell);
