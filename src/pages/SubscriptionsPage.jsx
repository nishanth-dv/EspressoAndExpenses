import { memo, useState, useMemo, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import Modal from "../preStyledElements/modal/Modal";
import SubscriptionForm from "../Forms/SubscriptionForm";
import {
  persistAddSubscription,
  persistUpdateSubscription,
  persistDeleteSubscription,
  persistLogSubscriptionCharge,
  persistMigrateSubscriptionCommitments,
} from "../redux/slices/solvencySlice";
import {
  subscriptionTotals,
  subscriptionVisual,
  nextRenewal,
  previousRenewal,
  daysUntil,
  annualCost,
  monthlyEquivalent,
  isRecurring,
  chargesFor,
  getCycleInfo,
  detectAnomaly,
  trialStatus,
  detectCandidates,
  isBilling,
  isCurrentCyclePosted,
} from "../utils/subscriptionUtils";
import { subscriptionInsights } from "../utils/subscriptionInsights";
import { resolveMonthlyIncome } from "../utils/incomeUtils";
import useCountUp from "../hooks/useCountUp";
import Reveal from "../components/Reveal";
import "../styles/subscriptions.css";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function countdownLabel(days) {
  if (days == null) return "—";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d`;
}

// ── Living cost hero ─────────────────────────────────────
function SubHero({ subscriptions, transactions, userTypes }) {
  const totals = useMemo(
    () => subscriptionTotals(subscriptions),
    [subscriptions],
  );
  const [period, setPeriod] = useState("year");
  const target = period === "year" ? totals.yearly : totals.monthly;
  const animated = useCountUp(target);
  const income = useMemo(
    () => resolveMonthlyIncome(transactions ?? []).monthly || 0,
    [transactions],
  );
  const pctOfIncome = income > 0 ? (totals.monthly / income) * 100 : null;

  // Per-subscription spend segments (monthly-equivalent), brand-coloured — a
  // literal "where the money goes" bar.
  const segments = useMemo(
    () =>
      subscriptions
        .filter((s) => isBilling(s) && isRecurring(s))
        .map((s) => ({
          id: s.id,
          name: s.name,
          value: monthlyEquivalent(s),
          color: subscriptionVisual(s, userTypes).color,
        }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value),
    [subscriptions, userTypes],
  );
  const segTotal = segments.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className="sub-hero">
      <div className="sub-hero-top">
        <span className="sub-hero-eyebrow">Committed spend</span>
        <div className="sub-hero-toggle">
          {[
            ["month", "Monthly"],
            ["year", "Yearly"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`sub-hero-tog${period === k ? " sub-hero-tog--active" : ""}`}
              onClick={() => setPeriod(k)}
            >
              {period === k && (
                <motion.span
                  layoutId="subHeroTogPill"
                  className="sub-hero-tog-pill"
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                />
              )}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="sub-hero-value">{INR.format(Math.round(animated))}</div>
      <div className="sub-hero-meta">
        <span className="sub-hero-alt">
          {period === "year"
            ? `${INR.format(totals.monthly)}/mo`
            : `${INR.format(totals.yearly)}/yr`}
        </span>
        {pctOfIncome != null && (
          <span className="sub-hero-chip">
            <i className="fa-solid fa-wallet" />{" "}
            {pctOfIncome.toFixed(pctOfIncome < 10 ? 1 : 0)}% of income
          </span>
        )}
        <span className="sub-hero-count">{totals.count} active</span>
      </div>
      {segments.length > 0 && (
        <div className="sub-hero-bar">
          {segments.map((seg) => (
            <span
              key={seg.id}
              className="sub-hero-seg"
              title={`${seg.name} · ${INR.format(seg.value)}/mo`}
              style={{
                width: `${(seg.value / segTotal) * 100}%`,
                background: seg.color,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Smart insight cards ──────────────────────────────────
function SubInsights({ subscriptions, transactions }) {
  const insights = useMemo(
    () => subscriptionInsights(subscriptions, transactions),
    [subscriptions, transactions],
  );
  if (insights.length === 0) return null;
  return (
    <div className="sub-insights">
      {insights.slice(0, 6).map((ins) => (
        <div key={ins.id} className={`sub-insight sub-insight--${ins.kind}`}>
          <span className="sub-insight-icon">
            <i className={`fa-solid ${ins.icon}`} />
          </span>
          <div className="sub-insight-text">
            <span className="sub-insight-title">{ins.title}</span>
            <span className="sub-insight-detail">{ins.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Renewal timeline (next 31 days, pile-up aware) ───────
const TL_RANGE = 31;

// Cluster renewals that bunch within a 4-day window (a "busy few days").
function computePileups(items) {
  const clusters = [];
  let cur = null;
  for (const it of items) {
    if (cur && it.days - cur.startDays <= 4) {
      cur.items.push(it);
    } else {
      if (cur && cur.items.length >= 2) clusters.push(cur);
      cur = { startDays: it.days, items: [it] };
    }
  }
  if (cur && cur.items.length >= 2) clusters.push(cur);
  return clusters.map((c) => ({
    count: c.items.length,
    total: c.items.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0),
    from: c.items[0].date,
    to: c.items[c.items.length - 1].date,
  }));
}

function RenewalTimeline({ subscriptions, userTypes, onTap }) {
  const items = useMemo(() => {
    const now = new Date();
    return subscriptions
      .filter(isBilling)
      .map((s) => {
        const next = nextRenewal(s, now);
        const v = subscriptionVisual(s, userTypes);
        return {
          id: s.id,
          name: s.name,
          amount: s.amount,
          date: next,
          days: daysUntil(next, now),
          color: v.color,
          icon: v.icon,
          iconStyle: v.iconStyle,
        };
      })
      .filter((x) => x.date && x.days >= 0 && x.days <= TL_RANGE)
      .sort((a, b) => a.days - b.days);
  }, [subscriptions, userTypes]);

  // Assign vertical lanes so dots close in time don't overlap.
  const laned = useMemo(() => {
    const laneEnds = [];
    return items.map((it) => {
      const x = (it.days / TL_RANGE) * 100;
      let lane = laneEnds.findIndex((end) => x - end > 9);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = x;
      return { ...it, x, lane };
    });
  }, [items]);
  const laneCount = laned.length
    ? Math.max(...laned.map((d) => d.lane + 1))
    : 1;

  const pileups = useMemo(() => computePileups(items), [items]);
  const total = items.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);

  if (items.length === 0) return null;

  return (
    <div className="sub-tl">
      <div className="sub-tl-head">
        <span className="sub-tl-title">Renewing in the next {TL_RANGE} days</span>
        <span className="sub-tl-total">{INR.format(total)}</span>
      </div>
      <div className="sub-tl-track" style={{ height: laneCount * 30 + 20 }}>
        {[0, 7, 14, 21, 28].map((d) => (
          <div
            key={d}
            className="sub-tl-grid"
            style={{ left: `${(d / TL_RANGE) * 100}%` }}
          >
            <span className="sub-tl-grid-label">
              {d === 0 ? "Now" : `${d / 7}w`}
            </span>
          </div>
        ))}
        {laned.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`sub-tl-dot${d.days <= 3 ? " sub-tl-dot--soon" : ""}`}
            style={{ left: `${d.x}%`, top: d.lane * 30 + 2, "--accent": d.color }}
            title={`${d.name} · ${INR.format(d.amount)} · ${fmtDate(d.date)}`}
            onClick={() => onTap(d.id)}
          >
            <i className={`${d.iconStyle} ${d.icon}`} />
          </button>
        ))}
      </div>
      {pileups.length > 0 && (
        <div className="sub-tl-pileups">
          {pileups.map((p, i) => (
            <span key={i} className="sub-tl-pileup">
              <i className="fa-solid fa-layer-group" />
              {INR.format(p.total)} · {p.count} charges · {fmtDate(p.from)}
              {p.from.getTime() !== p.to.getTime() ? `–${fmtDate(p.to)}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Tiny inline charge-history sparkline (chronological amounts).
function Sparkline({ points, up }) {
  const w = 74;
  const h = 24;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const d = coords
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const stroke = up ? "var(--amount-expense)" : "var(--amount-income)";
  const [lx, ly] = coords[coords.length - 1];
  return (
    <svg
      className="sub-spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r="2.2" fill={stroke} />
    </svg>
  );
}

// ── A single subscription card ───────────────────────────
function SubscriptionCard({
  sub,
  transactions,
  userTypes,
  highlighted,
  onEdit,
  onDelete,
  onLogCharge,
  autoPost,
}) {
  const v = subscriptionVisual(sub, userTypes);
  const now = new Date();
  const next = nextRenewal(sub, now);
  const days = daysUntil(next, now);
  const anomalies = useMemo(
    () => detectAnomaly(sub, transactions),
    [sub, transactions],
  );
  const trial = trialStatus(sub, now);
  const oneTime = sub.recurring === false;
  const cycleLabel = oneTime ? "One-time" : getCycleInfo(sub.cycle).label;
  const billing = isBilling(sub);
  const posted = useMemo(
    () => isCurrentCyclePosted(sub, transactions),
    [sub, transactions],
  );
  const chargeAmts = useMemo(
    () =>
      chargesFor(sub.id, transactions)
        .slice(0, 8)
        .map((c) => parseFloat(c.amount) || 0)
        .reverse(),
    [sub.id, transactions],
  );
  const perDay = oneTime ? null : annualCost(sub) / 365;
  const crept =
    chargeAmts.length >= 2 &&
    chargeAmts[chargeAmts.length - 1] > chargeAmts[0] + 0.5;

  return (
    <div
      className={`sub-card${highlighted ? " sub-card--highlight" : ""}${
        billing ? "" : " sub-card--muted"
      }`}
      style={{ "--accent": v.color }}
      id={`sub-${sub.id}`}
    >
      <div className="sub-card-main">
        <div className="sub-card-icon">
          <i className={`${v.iconStyle} ${v.icon}`} />
        </div>
        <div className="sub-card-body">
          <div className="sub-card-title-row">
            <span className="sub-card-name">{sub.name}</span>
            {sub.status !== "active" && (
              <span className={`sub-status sub-status--${sub.status}`}>
                {sub.status}
              </span>
            )}
          </div>
          <div className="sub-card-sub">
            {INR.format(sub.amount)} · {cycleLabel}
            {!oneTime && (
              <span className="sub-card-annual">
                {" "}
                = {INR.format(annualCost(sub))}/yr
              </span>
            )}
          </div>
        </div>
        <div className="sub-card-when">
          {billing && next ? (
            <>
              <span
                className={`sub-card-days${days <= 3 ? " sub-card-days--soon" : ""}`}
              >
                {countdownLabel(days)}
              </span>
              <span className="sub-card-date">{fmtDate(next)}</span>
            </>
          ) : (
            <span className="sub-card-date">{sub.status}</span>
          )}
        </div>
      </div>

      {!oneTime && (
        <div className="sub-card-trend">
          {chargeAmts.length >= 2 && (
            <div className="sub-card-spark-wrap" title="Charge history">
              <Sparkline points={chargeAmts} up={crept} />
              <span
                className={`sub-card-spark-cap${crept ? " sub-card-spark-cap--up" : ""}`}
              >
                {crept
                  ? `up ${INR.format(chargeAmts[chargeAmts.length - 1] - chargeAmts[0])}`
                  : "steady"}
              </span>
            </div>
          )}
          {perDay != null && (
            <span className="sub-card-perday">≈ {INR.format(perDay)}/day</span>
          )}
        </div>
      )}

      {(anomalies.length > 0 || trial) && (
        <div className="sub-card-flags">
          {trial && (
            <span className={`sub-flag sub-flag--trial${trial.soon ? " sub-flag--soon" : ""}`}>
              <i className="fa-solid fa-hourglass-half" />
              {trial.days < 0
                ? "Trial ended"
                : `Trial ends ${countdownLabel(trial.days)} · then ${INR.format(trial.firstCharge)}`}
            </span>
          )}
          {anomalies.map((a, i) => (
            <span
              key={i}
              className={`sub-flag sub-flag--${a.kind}`}
            >
              <i
                className={`fa-solid ${a.kind === "hike" ? "fa-arrow-trend-up" : "fa-ghost"}`}
              />
              {a.message}
            </span>
          ))}
        </div>
      )}

      <div className="sub-card-actions">
        {billing && !autoPost && (
          <button
            type="button"
            className="sub-action"
            disabled={posted}
            onClick={() => onLogCharge(sub)}
          >
            <i className="fa-solid fa-receipt" />
            {posted ? "Logged" : "Log charge"}
          </button>
        )}
        <button type="button" className="sub-action" onClick={() => onEdit(sub)}>
          <i className="fa-solid fa-pen" /> Edit
        </button>
        <button
          type="button"
          className="sub-action sub-action--danger"
          onClick={() => onDelete(sub)}
        >
          <i className="fa-solid fa-trash" /> Delete
        </button>
        <span className="sub-card-save">
          Cancel → save {INR.format(annualCost(sub))}/yr
        </span>
      </div>
    </div>
  );
}

// ── Auto-detect (collapsible, below the list) ────────────
// Collapsed by default so tracked subscriptions get the spotlight; the header
// summarises the count and expands to reveal the candidates.
function DetectBanner({ candidates, onTrack, onDismiss }) {
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) return null;
  return (
    <div className="sub-detect">
      <button
        type="button"
        className="sub-detect-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <i className="fa-solid fa-wand-magic-sparkles" />
        <span>
          We spotted {candidates.length} recurring charge
          {candidates.length === 1 ? "" : "s"} that look like subscriptions
        </span>
        <i
          className={`fa-solid fa-chevron-${open ? "up" : "down"} sub-detect-chev`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="sub-detect-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="sub-detect-list">
              {candidates.map((c) => (
                <div key={c.name} className="sub-detect-item">
                  <div className="sub-detect-info">
                    <strong>{c.name}</strong>
                    <span>
                      {INR.format(c.amount)} · {getCycleInfo(c.cycle).label} ·{" "}
                      {c.months} months
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sub-detect-track"
                    onClick={() => onTrack(c)}
                  >
                    <i className="fa-solid fa-plus" /> Track
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="sub-detect-dismiss"
              onClick={onDismiss}
            >
              Dismiss suggestions
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Migrate banner (legacy subscription commitments) ─────
function MigrateBanner({ commitments, onMigrate }) {
  const legacy = useMemo(
    () => commitments.filter((c) => c.type === "subscription"),
    [commitments],
  );
  if (legacy.length === 0) return null;
  return (
    <div className="sub-migrate">
      <i className="fa-solid fa-right-left" />
      <span>
        You have {legacy.length} subscription
        {legacy.length === 1 ? "" : "s"} in your Solvency commitments. Move{" "}
        {legacy.length === 1 ? "it" : "them"} here?
      </span>
      <button
        className="sub-migrate-btn"
        onClick={() => onMigrate(legacy.map((c) => c.id))}
      >
        Migrate
      </button>
    </div>
  );
}

// ── Category spend ring ──────────────────────────────────
function CategoryRing({ subscriptions, userTypes, selected, onSelect }) {
  const data = useMemo(() => {
    const map = new Map();
    subscriptions
      .filter((s) => isBilling(s) && isRecurring(s))
      .forEach((s) => {
        const cat = (s.category || "").trim() || "Other";
        const v = monthlyEquivalent(s);
        if (v <= 0) return;
        const cur = map.get(cat) || { value: 0, top: 0, color: "#8b8b9a" };
        cur.value += v;
        if (v >= cur.top) {
          cur.top = v;
          cur.color = subscriptionVisual(s, userTypes).color;
        }
        map.set(cat, cur);
      });
    return [...map.entries()]
      .map(([name, x]) => ({ name, value: x.value, color: x.color }))
      .sort((a, b) => b.value - a.value);
  }, [subscriptions, userTypes]);

  const total = data.reduce((s, x) => s + x.value, 0);
  if (data.length < 2) return null;

  const active = selected ? data.find((d) => d.name === selected) : null;

  return (
    <div className="sub-ring">
      <div className="sub-ring-chart-wrap">
        <ResponsiveContainer width="100%" height={188}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={86}
              paddingAngle={2}
              stroke="none"
              onClick={(_, i) =>
                onSelect(data[i].name === selected ? null : data[i].name)
              }
            >
              {data.map((d) => (
                <Cell
                  key={d.name}
                  fill={d.color}
                  opacity={selected && selected !== d.name ? 0.32 : 1}
                  cursor="pointer"
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="sub-ring-center">
          <span className="sub-ring-center-val">
            {INR.format(active ? active.value : total)}
          </span>
          <span className="sub-ring-center-lbl">
            {active ? active.name : "per month"}
          </span>
        </div>
      </div>
      <div className="sub-ring-legend">
        {data.map((d) => (
          <button
            key={d.name}
            type="button"
            className={`sub-ring-leg${selected === d.name ? " sub-ring-leg--active" : ""}`}
            onClick={() => onSelect(d.name === selected ? null : d.name)}
          >
            <span className="sub-ring-leg-dot" style={{ background: d.color }} />
            <span className="sub-ring-leg-name">{d.name}</span>
            <span className="sub-ring-leg-pct">
              {Math.round((d.value / total) * 100)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Status pill tabs ─────────────────────────────────────
const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trial", label: "Trials" },
  { key: "paused", label: "Paused" },
  { key: "cancelled", label: "Cancelled" },
];

function StatusTabs({ subscriptions, value, onChange }) {
  const counts = useMemo(() => {
    const c = { all: subscriptions.length };
    subscriptions.forEach((s) => {
      c[s.status] = (c[s.status] || 0) + 1;
    });
    return c;
  }, [subscriptions]);
  const tabs = STATUS_TABS.filter(
    (t) => t.key === "all" || (counts[t.key] || 0) > 0,
  );
  if (tabs.length <= 2) return null;
  return (
    <div className="sub-status-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`sub-status-tab${value === t.key ? " sub-status-tab--active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {value === t.key && (
            <motion.span
              layoutId="subStatusPill"
              className="sub-status-pill"
              transition={{ type: "spring", stiffness: 480, damping: 38 }}
            />
          )}
          {t.label} <span className="sub-status-count">{counts[t.key] || 0}</span>
        </button>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────
function SubscriptionsPage() {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();

  const subscriptions = useSelector(
    (state) => state.transactions.transactionData?.subscriptions ?? [],
  );
  const transactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const commitments = useSelector(
    (state) => state.transactions.transactionData?.commitments ?? [],
  );
  const subscriptionTypes = useSelector(
    (state) => state.transactions.transactionData?.subscriptionTypes ?? [],
  );
  const autoPost = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.subscriptionAutoPost ??
      false,
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [dismissedDetect, setDismissedDetect] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState(null);

  const highlight = searchParams.get("highlight");

  // Scroll a deep-linked subscription into view.
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`sub-${highlight}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => {
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.delete("highlight");
        return next;
      });
    }, 2200);
    return () => clearTimeout(t);
  }, [highlight, setSearchParams]);

  const candidates = useMemo(
    () =>
      dismissedDetect ? [] : detectCandidates(transactions, subscriptions),
    [transactions, subscriptions, dismissedDetect],
  );

  // Auto-post sweep: when the preference is on, post any active subscription's
  // current-cycle charge that hasn't landed yet. Guarded so we never fabricate
  // a charge for a cycle that predates the subscription's anchor date, and the
  // thunk's own idempotency check stops double-posting.
  useEffect(() => {
    if (!autoPost) return;
    const now = new Date();
    subscriptions.forEach((s) => {
      if (!isBilling(s)) return;
      const prev = previousRenewal(s, now);
      if (!prev || prev > now) return;
      if (s.anchorDate && prev < new Date(s.anchorDate)) return;
      if (isCurrentCyclePosted(s, transactions, now)) return;
      dispatch(persistLogSubscriptionCharge(s, prev));
    });
    // Intentionally keyed on subscriptions + autoPost: re-running after a post
    // is a no-op thanks to the idempotency guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions, autoPost]);

  const sorted = useMemo(() => {
    const now = new Date();
    return [...subscriptions].sort((a, b) => {
      // Billing ones first, ordered by soonest renewal; then the rest.
      const ab = isBilling(a) ? 0 : 1;
      const bb = isBilling(b) ? 0 : 1;
      if (ab !== bb) return ab - bb;
      const an = daysUntil(nextRenewal(a, now), now) ?? 9999;
      const bn = daysUntil(nextRenewal(b, now), now) ?? 9999;
      return an - bn;
    });
  }, [subscriptions]);

  const filtered = useMemo(
    () =>
      sorted.filter(
        (s) =>
          (statusFilter === "all" || s.status === statusFilter) &&
          (!categoryFilter || ((s.category || "").trim() || "Other") === categoryFilter),
      ),
    [sorted, statusFilter, categoryFilter],
  );

  function openEdit(sub) {
    setEditing(sub);
    setModalOpen(true);
  }
  function handleSubmit(sub) {
    if (editing) dispatch(persistUpdateSubscription(sub));
    else dispatch(persistAddSubscription(sub));
    setModalOpen(false);
    setEditing(null);
  }
  function trackCandidate(c) {
    dispatch(
      persistAddSubscription({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        name: c.name,
        brandKey: c.brandKey,
        amount: c.amount,
        cycle: c.cycle,
        anchorDate: c.anchorDate,
        category: c.category,
        paymentMethod: "bank",
        status: "active",
        autoPost: false,
        notes: "",
      }),
    );
  }

  return (
    <div className="sub-page">
      <div className="sub-page-head">
        <div>
          <h1 className="sub-page-title">Subscriptions</h1>
          <p className="sub-page-tagline">
            Every little renewal, and what it really costs you a year.
          </p>
        </div>
      </div>

      {subscriptions.length > 0 && (
        <SubHero
          subscriptions={subscriptions}
          transactions={transactions}
          userTypes={subscriptionTypes}
        />
      )}

      {subscriptions.length > 0 && (
        <Reveal>
          <SubInsights
            subscriptions={subscriptions}
            transactions={transactions}
          />
        </Reveal>
      )}

      <MigrateBanner
        commitments={commitments}
        onMigrate={(ids) =>
          dispatch(persistMigrateSubscriptionCommitments(ids))
        }
      />

      {subscriptions.length > 0 && (
        <Reveal>
          <RenewalTimeline
            subscriptions={subscriptions}
            userTypes={subscriptionTypes}
            onTap={(id) => {
              const el = document.getElementById(`sub-${id}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        </Reveal>
      )}

      {subscriptions.length > 0 && (
        <Reveal>
          <CategoryRing
            subscriptions={subscriptions}
            userTypes={subscriptionTypes}
            selected={categoryFilter}
            onSelect={setCategoryFilter}
          />
        </Reveal>
      )}

      {subscriptions.length > 0 && (
        <div className="sub-list-controls">
          <StatusTabs
            subscriptions={subscriptions}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          {categoryFilter && (
            <button
              type="button"
              className="sub-filter-chip"
              onClick={() => setCategoryFilter(null)}
            >
              {categoryFilter} <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
      )}

      {subscriptions.length === 0 ? (
        <div className="sub-empty">
          <i className="fa-solid fa-rotate" />
          <p>No subscriptions tracked yet.</p>
          <span>
            Tap <strong>Add Subscription</strong> below to add Netflix, Spotify,
            your gym — or let us detect them from your spending above.
          </span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="sub-empty sub-empty--filtered">
          <i className="fa-solid fa-filter" />
          <p>Nothing in this view.</p>
          <span>Try a different status or clear the category filter.</span>
        </div>
      ) : (
        <Reveal className="sub-list">
          {filtered.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              transactions={transactions}
              userTypes={subscriptionTypes}
              highlighted={highlight === sub.id}
              autoPost={autoPost}
              onEdit={openEdit}
              onDelete={setConfirmDelete}
              onLogCharge={(s) => dispatch(persistLogSubscriptionCharge(s))}
            />
          ))}
        </Reveal>
      )}

      <DetectBanner
        candidates={candidates}
        onTrack={trackCandidate}
        onDismiss={() => setDismissedDetect(true)}
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Edit Subscription" : "Add Subscription"}
      >
        <SubscriptionForm
          existing={editing}
          onSubmit={handleSubmit}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Remove subscription?"
      >
        <AnimatePresence>
          {confirmDelete && (
            <div className="delete-confirm-body">
              <p className="delete-confirm-name">{confirmDelete.name}</p>
              <p className="delete-confirm-hint">
                Stop tracking this subscription? Past charges already in your
                ledger stay put.
              </p>
              <div className="form-actions">
                <button
                  className="cancel-button"
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  onClick={() => {
                    dispatch(persistDeleteSubscription(confirmDelete.id));
                    setConfirmDelete(null);
                  }}
                >
                  <i className="fa-solid fa-trash-can" /> Remove
                </button>
              </div>
            </div>
          )}
        </AnimatePresence>
      </Modal>
    </div>
  );
}

export default memo(SubscriptionsPage);
