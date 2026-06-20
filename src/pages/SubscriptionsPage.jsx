import { memo, useState, useMemo, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
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
  getCycleInfo,
  detectAnomaly,
  trialStatus,
  detectCandidates,
  isBilling,
  isCurrentCyclePosted,
} from "../utils/subscriptionUtils";
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

// ── Summary band ─────────────────────────────────────────
function SummaryBand({ subscriptions }) {
  const totals = useMemo(
    () => subscriptionTotals(subscriptions),
    [subscriptions],
  );
  return (
    <div className="sub-summary">
      <div className="sub-summary-cell">
        <span className="sub-summary-value">{INR.format(totals.monthly)}</span>
        <span className="sub-summary-label">per month</span>
      </div>
      <div className="sub-summary-cell sub-summary-cell--hero">
        <span className="sub-summary-value">{INR.format(totals.yearly)}</span>
        <span className="sub-summary-label">committed / year</span>
      </div>
      <div className="sub-summary-cell">
        <span className="sub-summary-value">{totals.count}</span>
        <span className="sub-summary-label">active</span>
      </div>
    </div>
  );
}

// ── Renewal countdown rail (next 30 days) ────────────────
function RenewalRail({ subscriptions, userTypes, onTap }) {
  const upcoming = useMemo(() => {
    const now = new Date();
    return subscriptions
      .filter(isBilling)
      .map((s) => ({ sub: s, next: nextRenewal(s, now) }))
      .filter((x) => x.next)
      .map((x) => ({ ...x, days: daysUntil(x.next, now) }))
      .filter((x) => x.days >= 0 && x.days <= 30)
      .sort((a, b) => a.days - b.days);
  }, [subscriptions]);

  if (upcoming.length === 0) return null;

  return (
    <div className="sub-rail">
      <div className="sub-rail-head">Renewing in the next 30 days</div>
      <div className="sub-rail-track">
        {upcoming.map(({ sub, days }) => {
          const v = subscriptionVisual(sub, userTypes);
          return (
            <button
              key={sub.id}
              type="button"
              className="sub-rail-pill"
              style={{ "--accent": v.color }}
              onClick={() => onTap(sub.id)}
            >
              <i className={`${v.iconStyle} ${v.icon}`} />
              <span className="sub-rail-name">{sub.name}</span>
              <span className="sub-rail-when">{countdownLabel(days)}</span>
              <span className="sub-rail-amt">{INR.format(sub.amount)}</span>
            </button>
          );
        })}
      </div>
    </div>
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

// ── Auto-detect banner ───────────────────────────────────
function DetectBanner({ candidates, onTrack, onDismiss }) {
  if (candidates.length === 0) return null;
  return (
    <motion.div
      className="sub-detect"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="sub-detect-head">
        <i className="fa-solid fa-wand-magic-sparkles" />
        <span>
          We spotted {candidates.length} recurring charge
          {candidates.length === 1 ? "" : "s"} that look like subscriptions
        </span>
        <button className="sub-detect-dismiss" onClick={onDismiss}>
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
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
            <button className="sub-detect-track" onClick={() => onTrack(c)}>
              <i className="fa-solid fa-plus" /> Track
            </button>
          </div>
        ))}
      </div>
    </motion.div>
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
        <SummaryBand subscriptions={subscriptions} />
      )}

      <MigrateBanner
        commitments={commitments}
        onMigrate={(ids) =>
          dispatch(persistMigrateSubscriptionCommitments(ids))
        }
      />

      <DetectBanner
        candidates={candidates}
        onTrack={trackCandidate}
        onDismiss={() => setDismissedDetect(true)}
      />

      {subscriptions.length > 0 && (
        <RenewalRail
          subscriptions={subscriptions}
          userTypes={subscriptionTypes}
          onTap={(id) => {
            const el = document.getElementById(`sub-${id}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
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
      ) : (
        <div className="sub-list">
          {sorted.map((sub) => (
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
        </div>
      )}

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
