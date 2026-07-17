import { memo, useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { motion, AnimatePresence } from "framer-motion";
import useCountUp from "../hooks/useCountUp";
import { useSelector, useDispatch } from "react-redux";
import {
  computeAccountBalance,
  computeAggregateBalance,
  getReconciliationDelta,
  balanceAsOf,
} from "../utils/accountUtils";
import BankLogo from "./BankLogo";
import {
  persistRecomputeBalance,
  persistVerifyAccountBalance,
} from "../redux/slices/transactionSlice";
import { setFilter } from "../redux/slices/filterSlice";
import Modal from "../preStyledElements/modal/Modal";
import DateField from "./DateField";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

// Slide animation: positive direction = slide left to enter from right.
// Slightly longer + softer easing so swipes between banks feel deliberate
// rather than snappy; pairs with the background-tint transition.
const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction > 0 ? -60 : 60,
    opacity: 0,
  }),
};
const SLIDE_TRANSITION = { duration: 0.35, ease: [0.32, 0.72, 0.24, 1] };

const SWIPE_THRESHOLD = 60; // px drag to trigger slide change
const SWIPE_VELOCITY = 300; // px/s flick velocity threshold

const BalanceCarousel = ({ variant = "compact", syncTransactionFilter = false }) => {
  const dispatch = useDispatch();
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const allTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const insightsBalance = useSelector(
    (state) => state.transactions.transactionData?.insights?.balance ?? 0,
  );

  const slides = useMemo(() => {
    const out = [
      {
        kind: "all",
        title: "Total Balance",
        balance:
          multiBankEnabled && accounts.length > 0
            ? computeAggregateBalance(accounts, allTransactions)
            : insightsBalance,
      },
    ];
    if (multiBankEnabled) {
      for (const a of accounts) {
        out.push({
          kind: "account",
          account: a,
          title: a.bank,
          balance: computeAccountBalance(a, allTransactions),
          reconciliation: getReconciliationDelta(a, allTransactions),
        });
      }
    }
    return out;
  }, [accounts, allTransactions, multiBankEnabled, insightsBalance]);

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [busyRecompute, setBusyRecompute] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [showHint, setShowHint] = useState(false);

  const safeIndex = Math.min(index, slides.length - 1);
  const slide = slides[safeIndex];

  useEffect(() => {
    if (slides.length <= 1) return undefined;
    if (localStorage.getItem("bc-swipe-hint")) return undefined;
    setShowHint(true);
    const t = setTimeout(() => {
      localStorage.setItem("bc-swipe-hint", "1");
      setShowHint(false);
    }, 3200);
    return () => clearTimeout(t);
  }, [slides.length]);

  // Infinite cycle: wraps last → 0 going forward, 0 → last going back.
  // `dir` is the user's intent (1 = next, -1 = prev) so the slide animation
  // still flies in the correct direction even when the index wraps.
  const goTo = useCallback(
    (nextRaw, dir) => {
      if (slides.length === 0) return;
      const wrapped =
        ((nextRaw % slides.length) + slides.length) % slides.length;
      setDirection(dir);
      setIndex(wrapped);
      // Auto-sync the transaction filter so the ledger below reflects the
      // bank the user just swiped to. "All" slide clears the filter so the
      // user sees every transaction. User can still manually clear the chip
      // independently — we only dispatch on swipe, not on filter changes,
      // so removing the chip doesn't snap the carousel back.
      if (syncTransactionFilter) {
        const target = slides[wrapped];
        if (target?.kind === "all") {
          dispatch(setFilter({ scope: "transactions", accountId: "" }));
        } else if (target?.kind === "account") {
          dispatch(
            setFilter({
              scope: "transactions",
              accountId: target.account.id,
            }),
          );
        }
      }
    },
    [slides, syncTransactionFilter, dispatch],
  );
  const goNext = useCallback(
    () => goTo(safeIndex + 1, 1),
    [goTo, safeIndex],
  );
  const goPrev = useCallback(
    () => goTo(safeIndex - 1, -1),
    [goTo, safeIndex],
  );

  const handleRecompute = useCallback(async () => {
    if (busyRecompute) return;
    setBusyRecompute(true);
    try {
      await dispatch(persistRecomputeBalance());
    } finally {
      setBusyRecompute(false);
    }
  }, [busyRecompute, dispatch]);

  function handleDragEnd(_e, info) {
    const { offset, velocity } = info;
    const flick = Math.abs(velocity.x) > SWIPE_VELOCITY;
    const dragged =
      Math.abs(offset.x) > SWIPE_THRESHOLD ||
      (flick && Math.abs(offset.x) > 20);
    if (!dragged) return;
    if (offset.x < 0) goNext();
    else goPrev();
  }

  const showCarouselControls = slides.length > 1;

  // Bank-coloured tint when a per-bank slide is active. Mixed against the
  // base bar background so the colour reads as a soft accent, not a saturated
  // panel. Falls back to plain bar-bg for the All slide. Applied via a CSS
  // variable so the transition can be animated in CSS.
  const bankColor =
    slide?.kind === "account" && slide.account?.color
      ? slide.account.color
      : null;
  const tintBg = bankColor
    ? `color-mix(in srgb, ${bankColor} 16%, var(--bar-bg))`
    : "var(--bar-bg)";
  const tintGlow = bankColor
    ? `color-mix(in srgb, ${bankColor} 45%, transparent)`
    : "color-mix(in srgb, #d4a35a 26%, transparent)";

  return (
    <div
      className={`balance-carousel balance-carousel--${variant}${
        showCarouselControls ? "" : " balance-carousel--single"
      }`}
      style={{ "--bank-tint-bg": tintBg, "--bank-tint-glow": tintGlow }}
    >
      {showCarouselControls && (
        <button
          type="button"
          className="balance-carousel-arrow balance-carousel-arrow--left"
          onClick={goPrev}
          aria-label="Previous account"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
      )}
      <motion.div
        className="balance-carousel-drag"
        drag={showCarouselControls ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
      >
        <AnimatePresence custom={direction} initial={false} mode="wait">
          <motion.div
            key={safeIndex}
            className="balance-carousel-slide"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={SLIDE_TRANSITION}
          >
            <BalanceSlide slide={slide} variant={variant} />
          </motion.div>
        </AnimatePresence>
      </motion.div>
      {showCarouselControls && (
        <button
          type="button"
          className={`balance-carousel-arrow balance-carousel-arrow--right${
            showHint ? " balance-carousel-arrow--hint" : ""
          }`}
          onClick={goNext}
          aria-label="Next account"
        >
          <i className="fa-solid fa-chevron-right" />
        </button>
      )}

      <BalanceMetaRow
        slide={slide}
        onRecompute={handleRecompute}
        recomputeBusy={busyRecompute}
        onVerify={(account) => setVerifyTarget(account)}
      />

      {verifyTarget && (
        <Modal
          open={!!verifyTarget}
          onClose={() => setVerifyTarget(null)}
          title={`Verify ${verifyTarget.bank} balance`}
        >
          <VerifyBalanceForm
            account={verifyTarget}
            transactions={allTransactions}
            onClose={() => setVerifyTarget(null)}
            onConfirm={async ({ balance, asOf }) => {
              await dispatch(
                persistVerifyAccountBalance({
                  id: verifyTarget.id,
                  balance,
                  asOf,
                }),
              );
              setVerifyTarget(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
};

BalanceCarousel.propTypes = {
  // "compact" = single-line label-on-top layout used in Transactions page.
  // "hero" = larger, used on the Dashboard.
  variant: PropTypes.oneOf(["compact", "hero"]),
  // When true, the transaction filter's accountId is dispatched on every
  // slide change so the list below reflects the active bank. The compact
  // variant on the Transactions page sets this; the Dashboard hero does not.
  syncTransactionFilter: PropTypes.bool,
};

// ── Slide body ────────────────────────────────────────

function BalanceSlide({ slide, variant }) {
  const animated = useCountUp(slide.balance, 600);
  const shown =
    Math.abs(animated - slide.balance) < 0.5 ? slide.balance : Math.round(animated);
  return (
    <div className={`balance-slide balance-slide--${variant}`}>
      <p className="balance-slide-label">
        {slide.kind === "account" && (
          <BankLogo
            bank={slide.account.bank}
            color={slide.account.color}
            size={20}
          />
        )}
        {slide.title}
      </p>
      <p className="balance balance-carousel-value">
        {INR.format(shown)}
      </p>
    </div>
  );
}

BalanceSlide.propTypes = {
  slide: PropTypes.object.isRequired,
  variant: PropTypes.string.isRequired,
};

// ── Static meta row (lives outside the swipe area) ────
// Updates in place as the slide changes. Always rendered so the carousel
// card's overall height stays constant regardless of which slide is active.

function BalanceMetaRow({ slide, onRecompute, recomputeBusy, onVerify }) {
  if (slide.kind === "all") {
    return (
      <div className="balance-meta-row">
        {onRecompute && (
          <button
            type="button"
            className="balance-recompute-btn balance-recompute-btn--standalone"
            onClick={onRecompute}
            disabled={recomputeBusy}
            title="Recompute balance from all transactions"
            aria-label="Recompute balance from all transactions"
          >
            <i
              className={`fa-solid ${recomputeBusy ? "fa-spinner fa-spin" : "fa-rotate"}`}
            />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="balance-meta-row">
      <ReconciliationChip
        recon={slide.reconciliation}
        onVerify={() => onVerify(slide.account)}
      />
    </div>
  );
}

BalanceMetaRow.propTypes = {
  slide: PropTypes.object.isRequired,
  onRecompute: PropTypes.func,
  recomputeBusy: PropTypes.bool,
  onVerify: PropTypes.func.isRequired,
};

// ── Reconciliation chip ───────────────────────────────

function ReconciliationChip({ recon, onVerify }) {
  if (!recon) {
    return (
      <button
        type="button"
        className="balance-recon-chip balance-recon-chip--idle"
        onClick={onVerify}
      >
        <i className="fa-solid fa-circle-check" /> Verify balance
      </button>
    );
  }
  const drift = Math.abs(recon.delta);
  const driftMatters = drift > 100;
  const date = new Date(recon.verifiedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  return (
    <button
      type="button"
      className={`balance-recon-chip ${driftMatters ? "balance-recon-chip--drift" : "balance-recon-chip--ok"}`}
      onClick={onVerify}
      title={`Verified ₹${recon.verifiedBalance.toLocaleString("en-IN")} on ${date}. Computed ₹${recon.computed.toLocaleString("en-IN")}.`}
    >
      {driftMatters ? (
        <>
          <i className="fa-solid fa-triangle-exclamation" />
          {recon.delta > 0 ? "+" : "−"}
          {INR.format(drift)} drift
        </>
      ) : (
        <>
          <i className="fa-solid fa-circle-check" /> Verified {date}
        </>
      )}
    </button>
  );
}

ReconciliationChip.propTypes = {
  recon: PropTypes.object,
  onVerify: PropTypes.func.isRequired,
};

// ── Verify modal body ─────────────────────────────────

function VerifyBalanceForm({ account, transactions, onConfirm, onClose }) {
  const [asOf, setAsOf] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const computed = useMemo(
    () => balanceAsOf(account, transactions, asOf),
    [account, transactions, asOf],
  );
  const [balanceDraft, setBalanceDraft] = useState(
    String(account.verifiedBalance ?? computed.toFixed(2)),
  );
  const parsed = parseFloat(balanceDraft);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const drift = valid ? computed - parsed : 0;

  return (
    <div className="balance-verify-form">
      <div className="balance-verify-bank">
        <BankLogo bank={account.bank} color={account.color} size={22} />
        <span>{account.bank}</span>
      </div>
      <p className="balance-verify-hint">
        Enter the balance shown in your <strong>{account.bank}</strong>{" "}
        statement / app. We&apos;ll compare it with what your transactions
        sum to and flag any drift above ₹100.
      </p>

      <div className="field">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={balanceDraft}
          onChange={(e) => setBalanceDraft(e.target.value)}
          autoFocus
        />
        <label>Actual balance (₹)</label>
      </div>

      <DateField
        value={asOf}
        onChange={(e) => setAsOf(e.target.value)}
        label="As of"
      />

      {valid && (
        <p
          className={`balance-verify-preview ${Math.abs(drift) > 100 ? "balance-verify-preview--drift" : "balance-verify-preview--ok"}`}
        >
          {Math.abs(drift) <= 0.5 ? (
            <>
              <i className="fa-solid fa-circle-check" /> Matches exactly.
            </>
          ) : (
            <>
              <i className="fa-solid fa-scale-unbalanced" />
              {" "}
              We computed <strong>{INR.format(computed)}</strong> — drift of{" "}
              <strong>
                {drift > 0 ? "+" : "−"}
                {INR.format(Math.abs(drift))}
              </strong>
              {drift > 0
                ? " (you have phantom or duplicate entries)"
                : " (you're missing transactions)"}
            </>
          )}
        </p>
      )}

      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="generic-button"
          disabled={!valid}
          onClick={() =>
            onConfirm({
              balance: parsed,
              asOf: new Date(asOf).toISOString(),
            })
          }
        >
          <i className="fa-solid fa-circle-check" /> Save verification
        </button>
      </div>
    </div>
  );
}

VerifyBalanceForm.propTypes = {
  account: PropTypes.object.isRequired,
  transactions: PropTypes.array.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default memo(BalanceCarousel);
