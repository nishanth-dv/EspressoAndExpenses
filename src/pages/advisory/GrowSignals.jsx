import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccessToken } from "../../utils/googleDrive";
import { ConfidenceBadge, ConfidenceReveal } from "./ConfidenceControl";

const API = import.meta.env.VITE_API_URL ?? "";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

export default function GrowSignals() {
  const navigate = useNavigate();
  const [scan, setScan] = useState(null);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dir, setDir] = useState("all");
  const [actionableOnly, setActionableOnly] = useState(true);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!API) throw new Error("Signals service not configured");
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        const res = await fetch(`${API}/grow/signals?limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (!alive) return;
        setScan(data.scan);
        setSignals(Array.isArray(data.signals) ? data.signals : []);
      } catch (e) {
        if (alive) setError(e.message || "Could not load signals");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(
    () => signals.filter((s) => (dir === "all" || s.direction === dir) && (!actionableOnly || s.band !== "low")),
    [signals, dir, actionableOnly],
  );

  function openChart(s) {
    navigate(`/Advisory/grow/charts?symbol=${encodeURIComponent(s.symbol)}&name=${encodeURIComponent(s.symbol_name)}`);
  }

  return (
    <div className="grow-sig">
      <div className="grow-sig-head">
        <i className="fa-solid fa-magnifying-glass-chart" /> Market signals
        {scan && (
          <span className="grow-sig-count">
            {scan.universe_size} names · {fmtDate(scan.scan_date)}
          </span>
        )}
      </div>

      <div className="grow-sigflt">
        {["all", "bullish", "bearish"].map((d) => (
          <button
            key={d}
            type="button"
            className={`grow-sigflt-chip${dir === d ? " is-active" : ""}`}
            onClick={() => setDir(d)}
          >
            {d === "all" ? "All" : d === "bullish" ? "Bullish" : "Bearish"}
          </button>
        ))}
        <button
          type="button"
          className={`grow-sigflt-chip${actionableOnly ? " is-active" : ""}`}
          onClick={() => setActionableOnly((v) => !v)}
        >
          Actionable only
        </button>
      </div>

      {loading && (
        <div className="grow-sig-empty">
          <i className="fa-solid fa-spinner fa-spin" /> Loading…
        </div>
      )}
      {!loading && error && (
        <div className="grow-sig-empty grow-sig-empty--err">
          <i className="fa-solid fa-triangle-exclamation" /> {error}
        </div>
      )}
      {!loading && !error && shown.length === 0 && (
        <div className="grow-sig-empty">
          <i className="fa-solid fa-inbox" />{" "}
          {scan ? "No fresh setups match the filter today." : "No scan yet — the nightly batch hasn’t run."}
        </div>
      )}

      {!loading && !error && shown.length > 0 && (
        <ul className="grow-sig-list">
          {shown.map((s) => (
            <li key={s.id} className={`grow-sig-card grow-sig-card--${s.direction}`}>
              <div className="grow-sig-row">
                <button type="button" className="grow-sig-main" onClick={() => openChart(s)}>
                  <span className={`grow-sig-dir grow-sig-dir--${s.direction}`}>
                    <i className={`fa-solid fa-arrow-trend-${s.direction === "bullish" ? "up" : "down"}`} />
                  </span>
                  <span className="grow-sig-text">
                    <span className="grow-sig-title">
                      <strong>{s.symbol_name}</strong> · {s.name}
                    </span>
                    <span className="grow-sig-meta">
                      {s.title} · ₹{Number(s.price).toFixed(2)}
                    </span>
                  </span>
                </button>
                <ConfidenceBadge
                  score={s.confidence}
                  open={openId === s.id}
                  onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                />
              </div>
              <ConfidenceReveal open={openId === s.id} card={{ confidenceBreakdown: s.breakdown }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
