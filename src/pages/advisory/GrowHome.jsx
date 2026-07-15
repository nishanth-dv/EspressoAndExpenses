import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { motion } from "framer-motion";
import {
  ledgerSummary,
  MONEY_BUCKETS,
  BUCKET_ORDER,
} from "../../utils/advisory/ledger";

const EASE = [0.25, 0.46, 0.45, 0.94];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// What the tally will grow to capture, shown in the empty state.
const UPCOMING = [
  { icon: "fa-piggy-bank", label: "Idle-cash yield capture" },
  { icon: "fa-receipt", label: "Fees & tax saved, tracked" },
  { icon: "fa-credit-card", label: "Reward routing, measured" },
  { icon: "fa-chart-line", label: "Opportunities & signals" },
];

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "a month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

// Landing + dashboard for the "Grow your money" domain. The Money Made ledger
// tallies realised gains from acting on advice (see utils/advisory/ledger.js).
// Empty until the first action is captured — then it fills with a breakdown,
// a 12-month trend, and the most recent wins.
export default function GrowHome() {
  const navigate = useNavigate();
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const summary = useMemo(
    () => ledgerSummary(data.preferences?.moneyMade),
    [data.preferences?.moneyMade],
  );
  const { total, count, byBucket, months, recent } = summary;
  const hasData = count > 0;

  const buckets = BUCKET_ORDER.filter((b) => byBucket[b] > 0).map((b) => ({
    key: b,
    ...MONEY_BUCKETS[b],
    amount: byBucket[b],
  }));
  const maxBucket = Math.max(...buckets.map((b) => b.amount), 1);
  const maxMonth = Math.max(...months.map((m) => m.amount), 1);

  return (
    <motion.div
      className="adv-grow"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <div className="adv-grow-hero">
        <span className="adv-grow-hero-label">Money made</span>
        <span className="adv-grow-hero-value">{INR.format(total)}</span>
        <span className="adv-grow-hero-sub">
          {hasData
            ? `Estimated annual value locked in across ${count} action${count > 1 ? "s" : ""}.`
            : "Nothing captured yet — act on a recommendation to start the tally."}
        </span>
      </div>

      {hasData ? (
        <>
          <section className="adv-grow-panel">
            <h3>
              <i className="fa-solid fa-layer-group" /> Where it came from
            </h3>
            <div className="adv-mm-bars">
              {buckets.map((b) => (
                <div
                  className="adv-mm-bar-row"
                  key={b.key}
                  style={{ "--bar-accent": b.accent }}
                >
                  <span className="adv-mm-bar-ico">
                    <i className={`fa-solid ${b.icon}`} />
                  </span>
                  <div className="adv-mm-bar-main">
                    <div className="adv-mm-bar-top">
                      <span className="adv-mm-bar-label">{b.label}</span>
                      <span className="adv-mm-bar-amt">{INR.format(b.amount)}</span>
                    </div>
                    <div className="adv-mm-bar-track">
                      <motion.div
                        className="adv-mm-bar-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${(b.amount / maxBucket) * 100}%` }}
                        transition={{ duration: 0.5, ease: EASE }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="adv-grow-panel">
            <h3>
              <i className="fa-solid fa-chart-column" /> Captured over time
            </h3>
            <div className="adv-mm-trend">
              {months.map((m) => (
                <div className="adv-mm-trend-col" key={m.key}>
                  <div className="adv-mm-trend-bar-wrap">
                    <motion.div
                      className="adv-mm-trend-bar"
                      initial={{ height: 0 }}
                      animate={{
                        height: `${Math.max((m.amount / maxMonth) * 100, m.amount > 0 ? 6 : 0)}%`,
                      }}
                      transition={{ duration: 0.5, ease: EASE }}
                      title={`${m.label}: ${INR.format(m.amount)}`}
                    />
                  </div>
                  <span className="adv-mm-trend-label">{m.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="adv-grow-panel">
            <h3>
              <i className="fa-solid fa-clock-rotate-left" /> Recent wins
            </h3>
            <ul className="adv-mm-list">
              {recent.slice(0, 8).map((e) => {
                const b = MONEY_BUCKETS[e.bucket] || MONEY_BUCKETS.other;
                return (
                  <li
                    key={e.id}
                    className="adv-mm-list-item"
                    style={{ "--bar-accent": b.accent }}
                  >
                    <span className="adv-mm-list-ico">
                      <i className={`fa-solid ${b.icon}`} />
                    </span>
                    <div className="adv-mm-list-main">
                      <span className="adv-mm-list-title">{e.title}</span>
                      <span className="adv-mm-list-meta">
                        {b.label} · {timeAgo(e.capturedAt)}
                      </span>
                    </div>
                    <span className="adv-mm-list-amt">+{INR.format(e.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <button
            type="button"
            className="adv-grow-cta"
            onClick={() => navigate("/Advisory/actions")}
          >
            <i className="fa-solid fa-bolt" /> Find more to capture
          </button>
        </>
      ) : (
        <div className="adv-grow-soon">
          <h3>
            <i className="fa-solid fa-seedling" /> How this grows
          </h3>
          <ul className="adv-grow-list">
            {UPCOMING.map((u) => (
              <li key={u.label}>
                <i className={`fa-solid ${u.icon}`} />
                {u.label}
              </li>
            ))}
          </ul>
          <p className="adv-grow-note">
            Every action you complete in <strong>Know your money</strong> feeds
            this tally.
          </p>
          <button
            type="button"
            className="adv-grow-cta"
            onClick={() => navigate("/Advisory/actions")}
          >
            <i className="fa-solid fa-bolt" /> See your actions
          </button>
        </div>
      )}
    </motion.div>
  );
}
