import { memo, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

// Slides a banner down from under the navbar when offline. On reconnect,
// briefly shows a "Back online" confirmation before sliding away.
const OfflineBanner = () => {
  const online = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(!online);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      // Sync banner visibility from browser online/offline (external source).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowReconnected(false);
      return;
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setShowReconnected(true);
      const t = setTimeout(() => setShowReconnected(false), 2200);
      return () => clearTimeout(t);
    }
  }, [online]);

  const visible = !online || showReconnected;

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key={online ? "online" : "offline"}
          className={`offline-banner${online ? " offline-banner--online" : ""}`}
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          role="status"
          aria-live="polite"
        >
          <span className="offline-banner-dot" />
          <span className="offline-banner-text">
            {online
              ? "Back online"
              : "You're offline — changes will retry when you reconnect"}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default memo(OfflineBanner);
