import { useEffect, useState } from "react";
import { getAccessToken } from "../utils/googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

export default function useGrowScan(enabled) {
  const [signals, setSignals] = useState(null);

  useEffect(() => {
    if (!enabled || !API) return undefined;
    let alive = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || !alive) return;
        const res = await fetch(`${API}/grow/signals?interval=1d&limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || !alive) return;
        const data = await res.json();
        if (alive) setSignals(Array.isArray(data.signals) ? data.signals : []);
      } catch {
        /* best effort — a failed scan fetch just means no watchlist alert */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return signals;
}
