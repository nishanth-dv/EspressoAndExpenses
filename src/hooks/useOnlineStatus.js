import { useEffect, useState } from "react";

// Subscribes to the browser's online/offline events and returns the current
// status. `navigator.onLine` is the initial value; the `online`/`offline`
// events fire whenever connectivity changes. iOS Safari reliably fires these
// events when toggling airplane mode or losing Wi-Fi.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
