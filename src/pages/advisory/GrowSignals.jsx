import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccessToken } from "../../utils/googleDrive";
import { CATEGORY_META } from "../../utils/grow/signals/contract";
import { ConfidenceBadge, ConfidenceReveal } from "./ConfidenceControl";

const API = import.meta.env.VITE_API_URL ?? "";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

export default function GrowSignals() {
  const navigate = useNavigate();
  const [scan, setScan] = useState(null);
  const [signals, setSignals] = useState([]);
  const [trackRows, setTrackRows] = useState([]);
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
        const tr = await fetch(`${API}/grow/track`, { headers: { Authorization: `Bearer ${token}` } });
        if (tr.ok && alive) {
          const td = await tr.json();
          setTrackRows(Array.isArray(td.track) ? td.track : []);
        }
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

  const stale = scan?.scan_date && scan.scan_date < new Date().toISOString().slice(0, 10);

  const track = useMemo(() => {
    const num = (v) => (v == null ? 0 : Number(v));
    const overall = trackRows.find((r) => r.scope === "overall");
    const byBand = {};
    for (const r of trackRows) if (r.scope === "band") byBand[r.key] = r;
    return {
      resolved: overall ? num(overall.resolved) : 0,
      hitRate: overall ? num(overall.hit_rate) : 0,
      avgReturn: overall ? num(overall.avg_return) : 0,
      byBand,
      num,
    };
  }, [trackRows]);

  function openChart(s) {
    navigate(
      `/Advisory/grow/charts?symbol=${encodeURIComponent(s.symbol)}&name=${encodeURIComponent(s.symbol_name)}&t=${s.bar_time}&ty=${s.type}`,
    );
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
        {stale && <span className="grow-sig-stale">stale</span>}
      </div>

      {track.resolved > 0 ? (
        <div className="grow-score">
          <div className="grow-score-head">
            <i className="fa-solid fa-clipboard-check" /> Track record
            <span className="grow-score-sub">out-of-sample · graded on prices after each scan</span>
          </div>
          <div className="grow-score-hero">
            <div className="grow-score-stat">
              <span className="grow-score-val">{Math.round(track.hitRate * 100)}%</span>
              <span className="grow-score-lbl">hit rate</span>
            </div>
            <div className="grow-score-stat">
              <span className={`grow-score-val ${track.avgReturn >= 0 ? "is-up" : "is-down"}`}>
                {track.avgReturn >= 0 ? "+" : ""}
                {(track.avgReturn * 100).toFixed(1)}%
              </span>
              <span className="grow-score-lbl">avg return</span>
            </div>
            <div className="grow-score-stat">
              <span className="grow-score-val">{track.resolved}</span>
              <span className="grow-score-lbl">graded</span>
            </div>
          </div>
          <div className="grow-score-sec">Does confidence predict wins? (live)</div>
          <div className="grow-cal">
            {["high", "moderate", "low"].map((b) => {
              const row = track.byBand[b];
              if (!row || track.num(row.resolved) === 0) return null;
              const hr = track.num(row.hit_rate);
              return (
                <div key={b} className="grow-cal-row">
                  <span className={`grow-cal-band grow-cal-band--${b}`}>{b}</span>
                  <div className="grow-cal-track">
                    <div className="grow-cal-fill" style={{ width: `${Math.round(hr * 100)}%` }} />
                  </div>
                  <span className="grow-cal-pct">
                    {Math.round(hr * 100)}%<span className="grow-cal-n"> ({track.num(row.resolved)})</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        !loading &&
        scan && (
          <div className="grow-sig-note">
            <i className="fa-solid fa-hourglass-half" /> Building the out-of-sample track record — the first forward
            outcomes appear once the current signals age (~2 weeks). Check back.
          </div>
        )
      )}

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
          className="grow-sigflt-switch"
          onClick={() => setActionableOnly((v) => !v)}
          aria-pressed={actionableOnly}
        >
          Actionable only
          <span className={`pref-switch${actionableOnly ? " pref-switch--on" : ""}`}>
            <span className="pref-switch-thumb" />
          </span>
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
                      <span className={`grow-cat grow-cat--${s.category}`}>
                        <i className={`fa-solid ${CATEGORY_META[s.category]?.icon ?? ""}`} />{" "}
                        {CATEGORY_META[s.category]?.label ?? s.category}
                      </span>
                      <strong>{s.symbol_name}</strong> · {s.name}
                    </span>
                    <span className="grow-sig-meta">
                      {s.title} · ₹{Number(s.price).toFixed(2)}
                    </span>
                  </span>
                </button>
                <ConfidenceBadge
                  score={s.confidence ?? 0}
                  open={openId === s.id}
                  onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                />
              </div>
              {s.breakdown && <ConfidenceReveal open={openId === s.id} card={{ confidenceBreakdown: s.breakdown }} />}
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && scan && (
        <p className="grow-sig-note">
          Rule-based pattern detections back-tested on this symbol’s history — not investment advice or a prediction of
          the market. Do your own research.
        </p>
      )}
    </div>
  );
}
