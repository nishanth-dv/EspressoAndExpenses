import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";
import { persistSetPreference } from "../../redux/slices/transactionSlice";
import { mergeProfile } from "../../utils/advisory/profile";
import { runReview, VERDICTS } from "../../utils/advisory/reviewEngine";
import { fetchMarket } from "../../utils/advisory/market";
import {
  statusOf,
  isSuppressed,
  setCardState,
  snoozeUntil,
} from "../../utils/advisory/state";
import CardMenu from "./CardMenu";
import CardMenuLegend from "./CardMenuLegend";
import VerdictLegend from "./VerdictLegend";
import { ConfidenceBadge, ConfidenceReveal } from "./ConfidenceControl";
import { verdictGuide } from "../../utils/advisory/guide";
import { useDeepLinkNav } from "../../hooks/useDeepLinkNav";

const EASE = [0.25, 0.46, 0.45, 0.94];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const INR_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const CLASS_COLORS = {
  equity: "#1a9f63",
  debt: "#9aa3b2",
  gold: "#d9a521",
  alt: "#6c5ce7",
};

export default function ReviewLens() {
  const dispatch = useDispatch();
  const deepNav = useDeepLinkNav();
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const stored = data.preferences?.advisoryProfile;
  const advState = data.preferences?.advisoryState;
  const profile = useMemo(() => mergeProfile(data, stored), [data, stored]);

  const [market, setMarket] = useState({});
  useEffect(() => {
    let alive = true;
    fetchMarket()
      .then((m) => alive && setMarket(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const { holdings, xray } = useMemo(
    () => runReview(data, profile, market),
    [data, profile, market],
  );

  const [filter, setFilter] = useState("all"); // all | attention
  const [showHidden, setShowHidden] = useState(false);
  const [order, setOrder] = useState("priority"); // priority | type
  const [open, setOpen] = useState({});
  const [openVerdict, setOpenVerdict] = useState({});

  const saveState = (id, entry) =>
    dispatch(persistSetPreference("advisoryState", setCardState(advState, id, entry)));

  const hiddenCount = holdings.filter((h) => isSuppressed(advState, h.id)).length;

  const shown = holdings.filter((h) => {
    if (isSuppressed(advState, h.id)) return showHidden;
    if (filter === "attention") return h.verdict !== "keep";
    return true;
  });

  // Grouped-by-type view: one section per investment type, ordered by type,
  // holdings biggest-first within each. Priority view keeps the engine's
  // severity ordering.
  const typeGroups = useMemo(() => {
    if (order !== "type") return null;
    const map = new Map();
    for (const h of shown) {
      if (!map.has(h.typeLabel))
        map.set(h.typeLabel, { typeLabel: h.typeLabel, icon: h.icon, color: h.color, items: [] });
      map.get(h.typeLabel).items.push(h);
    }
    const groups = [...map.values()];
    groups.sort((a, b) => a.typeLabel.localeCompare(b.typeLabel));
    for (const g of groups) g.items.sort((a, b) => b.value - a.value);
    return groups;
  }, [order, shown]);

  if (holdings.length === 0) {
    return (
      <motion.div
        className="adv-understand-empty"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
      >
        <i className="fa-solid fa-magnifying-glass-chart adv-understand-icon" />
        <h3>Nothing to review yet</h3>
        <p>Add a few investments and this page will grade each one and your
        portfolio as a whole.</p>
      </motion.div>
    );
  }

  const outperforming =
    xray.blendedReturn != null &&
    xray.blendedBench != null &&
    xray.blendedReturn >= xray.blendedBench;

  const renderCard = (h) => {
    const status = statusOf(advState, h.id);
    const v = VERDICTS[h.verdict];
    return (
      <motion.div
        key={h.id}
        layout
        className={`adv-card adv-review-card${status ? " adv-card--muted" : ""}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <div className="adv-card-head">
          <span className="adv-card-title">
            <i
              className={`fa-solid ${h.icon}`}
              style={{ color: h.color, marginRight: 6 }}
            />
            {h.name}
          </span>
          {verdictGuide(h.verdict) ? (
            <button
              type="button"
              className={`adv-verdict adv-verdict--${h.verdict} adv-verdict--btn`}
              onClick={() =>
                setOpenVerdict((o) => ({ ...o, [h.id]: !o[h.id] }))
              }
            >
              <i className={`fa-solid ${v.icon}`} /> {v.label}
              <i
                className={`fa-solid fa-chevron-down adv-verdict-chev${openVerdict[h.id] ? " adv-verdict-chev--open" : ""}`}
              />
            </button>
          ) : (
            <span className={`adv-verdict adv-verdict--${h.verdict}`}>
              <i className={`fa-solid ${v.icon}`} /> {v.label}
            </span>
          )}
          <ConfidenceBadge
            score={h.confidence}
            open={!!open[h.id]}
            onToggle={() => setOpen((o) => ({ ...o, [h.id]: !o[h.id] }))}
          />
        </div>

        <div className="adv-review-stats">
          <span>{INR.format(h.value)}</span>
          {h.returnPct == null ? (
            <span className="adv-review-pct">no price</span>
          ) : (
            <span
              style={{
                color:
                  h.returnPct >= 0
                    ? "var(--amount-income)"
                    : "var(--amount-expense)",
              }}
            >
              {h.returnPct >= 0 ? "+" : ""}
              {h.returnPct.toFixed(1)}%
            </span>
          )}
          <span className="adv-review-pct">
            {(h.pct * 100).toFixed(0)}% of book
          </span>
        </div>

        <ul className="adv-review-reasons">
          {h.reasons.map((r, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i}>{r}</li>
          ))}
        </ul>

        <div className="adv-card-foot">
          <button
            type="button"
            className="adv-card-go"
            onClick={() => deepNav(h.href)}
          >
            <i className="fa-solid fa-arrow-up-right-from-square" /> Open
          </button>
          <CardMenu
            status={status}
            onDone={() => saveState(h.id, { status: "done" })}
            onSnooze={() =>
              saveState(h.id, { status: "snoozed", until: snoozeUntil() })
            }
            onDismiss={() => saveState(h.id, { status: "dismissed" })}
            onRestore={() => saveState(h.id, null)}
          />
        </div>

        <ConfidenceReveal open={!!open[h.id]} card={h} />

        <AnimatePresence initial={false}>
          {openVerdict[h.id] && verdictGuide(h.verdict) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
              style={{ overflow: "hidden" }}
            >
              <div className="adv-guide">
                <p className="adv-guide-title">
                  {verdictGuide(h.verdict).title}
                </p>
                <ol className="adv-guide-steps">
                  {verdictGuide(h.verdict).steps.map((s, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="adv-card-go"
                  onClick={() => deepNav(h.href)}
                >
                  <i className="fa-solid fa-arrow-up-right-from-square" /> Open in
                  Investments
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className="adv-und">
      {/* ── Portfolio X-ray ── */}
      <motion.section
        className="adv-und-section"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        <div className="adv-und-head">
          <h3>Portfolio X-ray</h3>
          <span className="adv-und-sub">
            {xray.count} holding{xray.count === 1 ? "" : "s"} ·{" "}
            {INR_COMPACT.format(xray.total)}
          </span>
        </div>

        <div className="adv-xray-alloc">
          {xray.byClass.map((c) => (
            <div
              key={c.cls}
              className="adv-xray-seg"
              style={{
                width: `${Math.max(4, c.pct * 100)}%`,
                background: CLASS_COLORS[c.cls],
              }}
              title={`${c.label} ${(c.pct * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="adv-xray-legend">
          {xray.byClass.map((c) => (
            <span key={c.cls} className="adv-xray-leg">
              <span
                className="adv-xray-dot"
                style={{ background: CLASS_COLORS[c.cls] }}
              />
              {c.label} {(c.pct * 100).toFixed(0)}%
            </span>
          ))}
        </div>

        {xray.blendedReturn != null && (
          <p className="adv-und-hint">
            <i className="fa-solid fa-gauge-high" /> Blended return{" "}
            <strong
              style={{
                color: outperforming ? "var(--amount-income)" : "var(--amount-expense)",
              }}
            >
              {(xray.blendedReturn * 100).toFixed(1)}%/yr
            </strong>{" "}
            vs ∼{(xray.blendedBench * 100).toFixed(0)}% expected.
          </p>
        )}
        {xray.niftyReturn != null && (
          <p className="adv-und-hint">
            <i className="fa-solid fa-chart-line" /> The Nifty's own 3-yr return
            is ∼{(xray.niftyReturn * 100).toFixed(0)}%/yr — your equity benchmark.
          </p>
        )}
        {(xray.sprawl || xray.missing.length > 0) && (
          <div className="adv-xray-flags">
            {xray.sprawl && (
              <span className="adv-xray-flag">
                <i className="fa-solid fa-layer-group" /> {xray.equityFundCount}{" "}
                equity funds — fund sprawl, consider consolidating
              </span>
            )}
            {xray.missing.length > 0 && (
              <span className="adv-xray-flag">
                <i className="fa-solid fa-circle-half-stroke" /> No exposure to{" "}
                {xray.missing.join(", ")} (in your target)
              </span>
            )}
          </div>
        )}
      </motion.section>

      <VerdictLegend />

      {/* ── Filters ── */}
      <div className="adv-filters">
        <button
          type="button"
          className={`adv-filter${filter === "all" ? " adv-filter--active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All ({xray.count})
        </button>
        <button
          type="button"
          className={`adv-filter${filter === "attention" ? " adv-filter--active" : ""}`}
          onClick={() => setFilter("attention")}
        >
          Needs attention ({xray.needAttention})
        </button>
        {hiddenCount > 0 && (
          <button
            type="button"
            className={`adv-filter${showHidden ? " adv-filter--active" : ""}`}
            onClick={() => setShowHidden((v) => !v)}
          >
            Hidden ({hiddenCount})
          </button>
        )}
      </div>

      <div className="adv-review-order">
        <button
          type="button"
          className={`adv-filter${order === "priority" ? " adv-filter--active" : ""}`}
          onClick={() => setOrder("priority")}
        >
          By priority
        </button>
        <button
          type="button"
          className={`adv-filter${order === "type" ? " adv-filter--active" : ""}`}
          onClick={() => setOrder("type")}
        >
          By type
        </button>
      </div>

      <CardMenuLegend />

      {shown.length === 0 ? (
        <p className="adv-empty">
          {filter === "attention"
            ? "Every holding looks fine — nothing needs a change right now."
            : "Nothing to show."}
        </p>
      ) : order === "type" && typeGroups ? (
        <div className="adv-feed">
          {typeGroups.map((g) => (
            <div key={g.typeLabel} className="adv-review-group">
              <div className="adv-review-group-head">
                <i className={`fa-solid ${g.icon}`} style={{ color: g.color }} />
                {g.typeLabel}
                <span className="adv-review-group-count">{g.items.length}</span>
              </div>
              {g.items.map(renderCard)}
            </div>
          ))}
        </div>
      ) : (
        <div className="adv-feed">
          <AnimatePresence initial={false}>{shown.map(renderCard)}</AnimatePresence>
        </div>
      )}
    </div>
  );
}
