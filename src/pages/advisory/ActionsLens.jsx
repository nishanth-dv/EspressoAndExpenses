import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";
import { persistSetPreference } from "../../redux/slices/transactionSlice";
import { mergeProfile, glidePath } from "../../utils/advisory/profile";
import { runAdvisory } from "../../utils/advisory/engine";
import { fetchMarket } from "../../utils/advisory/market";
import {
  statusOf,
  isSuppressed,
  setCardState,
  snoozeUntil,
} from "../../utils/advisory/state";
import { recordFeedback, actedSummary } from "../../utils/advisory/feedback";
import { addEntry, removeEntry } from "../../utils/advisory/ledger";
import CoverageMeter from "./CoverageMeter";
import CardMenu from "./CardMenu";
import CardMenuLegend from "./CardMenuLegend";
import Modal from "../../preStyledElements/modal/Modal";
import InfoTooltip from "../../components/InfoTooltip";
import OptionField from "../../components/OptionField";
import { ConfidenceBadge, ConfidenceReveal } from "./ConfidenceControl";
import { learnFor } from "../../utils/advisory/learn";
import { guideFor } from "../../utils/advisory/guide";
import { hasRewardInfo } from "../../utils/advisory/cardRewards";
import { useDeepLinkNav } from "../../hooks/useDeepLinkNav";

const PAGE_LABEL = {
  "/Solvency": "Solvency",
  "/Invest": "Investments",
  "/Subscriptions": "Subscriptions",
  "/Dashboard": "Dashboard",
};
function pageLabelFor(href) {
  const base = (href || "").split("?")[0];
  return PAGE_LABEL[base] || "the page";
}

// The step-by-step "how to do this" flow, shown when a card's "Do it" is tapped.
function GuideBox({ card, href, onOpen }) {
  const g = guideFor(card);
  if (!g) return null;
  return (
    <div className="adv-guide">
      <p className="adv-guide-title">{g.title}</p>
      <ol className="adv-guide-steps">
        {g.steps.map((s, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i}>{s}</li>
        ))}
      </ol>
      <button type="button" className="adv-card-go" onClick={onOpen}>
        <i className="fa-solid fa-arrow-up-right-from-square" /> Open{" "}
        {pageLabelFor(href)}
      </button>
    </div>
  );
}

// Where each recommendation sends you to act on it.
function deepLinkFor(card) {
  const holdingPrefixes = ["conc-", "fd-", "mf-direct-", "lic-", "maturity-"];
  for (const p of holdingPrefixes) {
    if (card.id.startsWith(p)) return `/Invest?highlight=${card.id.slice(p.length)}`;
  }
  if (card.id.startsWith("subs-")) return "/Subscriptions";
  if (card.id.startsWith("card-fee-"))
    return `/Solvency?highlight=${card.id.slice("card-fee-".length)}&focus=card`;
  if (
    card.id.startsWith("card-util-") ||
    card.id.startsWith("card-best-") ||
    card.id.startsWith("debt-")
  )
    return "/Solvency";
  if (
    card.id === "emergency-fund" ||
    card.id === "savings-rate" ||
    card.id === "lifestyle-inflation"
  )
    return "/Dashboard";
  if (card.category === "risk") return "/Solvency";
  return "/Invest";
}

const EASE = [0.25, 0.46, 0.45, 0.94];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const FILTERS = [
  { key: "all", label: "All" },
  { key: "opportunity", label: "Opportunities" },
  { key: "tax", label: "Tax" },
  { key: "allocation", label: "Allocation" },
  { key: "cash", label: "Cash" },
  { key: "goal", label: "Goals" },
  { key: "risk", label: "Risk" },
  { key: "calendar", label: "Maturities" },
];

export default function ActionsLens() {
  const dispatch = useDispatch();
  const deepNav = useDeepLinkNav();
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const stored = data.preferences?.advisoryProfile;
  const advState = data.preferences?.advisoryState;
  const advisorySeen = data.preferences?.advisorySeen;
  const advisoryWins = data.preferences?.advisoryWins ?? [];
  const advisoryFeedback = data.preferences?.advisoryFeedback;
  const moneyMade = data.preferences?.moneyMade;
  const profile = useMemo(() => mergeProfile(data, stored), [data, stored]);
  const saveState = (id, entry) =>
    dispatch(
      persistSetPreference("advisoryState", setCardState(advState, id, entry)),
    );
  // Record the action into the per-card state, the cross-session feedback loop
  // (lifetime "acted on" tally + category fatigue), and the Money Made ledger
  // that powers the Grow domain. "done" captures a realised-gain entry; any
  // other transition (undo/dismiss/snooze) drops it so the tally stays honest.
  const act = (card, entry) => {
    const status = entry?.status ?? null;
    saveState(card.id, entry);
    dispatch(
      persistSetPreference(
        "advisoryFeedback",
        recordFeedback(advisoryFeedback, card, status),
      ),
    );
    dispatch(
      persistSetPreference(
        "moneyMade",
        status === "done"
          ? addEntry(moneyMade, card)
          : removeEntry(moneyMade, card.id),
      ),
    );
  };
  const acted = actedSummary(advisoryFeedback);

  const [showProfile, setShowProfile] = useState(false);
  const save = (patch) =>
    dispatch(persistSetPreference("advisoryProfile", { ...profile, ...patch }));

  const goals = profile.goals || [];
  const addGoal = () =>
    save({
      goals: [
        ...goals,
        {
          id: `g${Date.now()}`,
          name: "",
          targetAmount: "",
          targetYear: new Date().getFullYear() + 5,
        },
      ],
    });
  const updateGoal = (id, patch) =>
    save({ goals: goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  const removeGoal = (id) => save({ goals: goals.filter((g) => g.id !== id) });
  const age = new Date().getFullYear() - profile.birthYear;

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

  const { cards } = useMemo(
    () => runAdvisory(data, profile, market, advisoryFeedback),
    [data, profile, market, advisoryFeedback],
  );

  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [openReason, setOpenReason] = useState({});
  const [openLearn, setOpenLearn] = useState({});
  const [openGuide, setOpenGuide] = useState({});

  // "Do it" opens the step-by-step guide when one exists; else it deep-links.
  const doIt = (c) => {
    if (guideFor(c)) setOpenGuide((o) => ({ ...o, [c.id]: !o[c.id] }));
    else deepNav(deepLinkFor(c));
  };

  const activeCards = cards.filter((c) => !isSuppressed(advState, c.id));
  const hiddenCards = cards.filter((c) => isSuppressed(advState, c.id));
  const activeMoney = activeCards.reduce((s, c) => s + (c.saving || 0), 0);
  // Top-ranked live action — the single next best thing to do.
  const nextBest = activeCards[0] || null;

  // Nudge to fill in reward/fee data so best-card and fee-vs-benefit tips can
  // fire — they stay silent until at least one card carries reward info.
  const cardsMissingRewards = (data.cards ?? []).filter((c) => !hasRewardInfo(c));
  const showRewardHint = cardsMissingRewards.length > 0;
  const rewardHintHref =
    cardsMissingRewards.length === 1
      ? `/Solvency?highlight=${cardsMissingRewards[0].id}&focus=card`
      : "/Solvency";

  // Auto-resolution feedback: a recommendation that was live last time but is
  // no longer generated — and that the user didn't manually action — means the
  // underlying condition fixed itself (e.g. you invested your 80C shortfall).
  // We snapshot the live set each visit, diff it, and celebrate what resolved.
  useEffect(() => {
    const hasData =
      (data.investments?.length || 0) + (data.transactions?.length || 0) > 0;
    if (!hasData) return;
    // One timestamp for the whole resolution pass. Date.now() in an effect is a
    // legitimate side effect; the purity rule doesn't special-case effects.
    // eslint-disable-next-line react-hooks/purity
    const resolvedAt = Date.now();
    const activeMap = {};
    for (const c of activeCards) {
      activeMap[c.id] = { title: c.title, saving: c.saving || 0 };
    }
    const seen = advisorySeen || {};
    const winIds = new Set(advisoryWins.map((w) => w.id));
    const resolved = [];
    for (const id of Object.keys(seen)) {
      if (activeMap[id] || isSuppressed(advState, id) || winIds.has(id)) continue;
      resolved.push({
        id,
        title: seen[id].title,
        saving: seen[id].saving || 0,
        at: resolvedAt,
      });
    }
    const seenIds = Object.keys(seen);
    const activeIds = Object.keys(activeMap);
    const sameIds =
      seenIds.length === activeIds.length &&
      activeIds.every((id) => seen[id] !== undefined);
    if (resolved.length) {
      dispatch(
        persistSetPreference(
          "advisoryWins",
          [...advisoryWins, ...resolved].slice(-12),
        ),
      );
      dispatch(persistSetPreference("advisorySeen", activeMap));
    } else if (!sameIds) {
      dispatch(persistSetPreference("advisorySeen", activeMap));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, advState]);

  const byFilter = (list) =>
    filter === "all"
      ? list
      : filter === "opportunity"
        ? list.filter((c) => c.stream === "opportunity")
        : list.filter((c) => c.category === filter);

  // In the default "all" view the Next Best Action is pulled out into its own
  // banner, so drop it from the feed to avoid showing it twice.
  const feed =
    filter === "all" && nextBest
      ? activeCards.filter((c) => c.id !== nextBest.id)
      : byFilter(activeCards);
  const shown = showHidden ? hiddenCards : feed;

  return (
    <>
      <button
        type="button"
        className="adv-profile-chip"
        onClick={() => setShowProfile(true)}
      >
        <i className="fa-solid fa-sliders" /> {age}y · {profile.riskAppetite} ·{" "}
        {(profile.taxSlab * 100).toFixed(0)}% slab · target{" "}
        {profile.targetAllocation.equity}/{profile.targetAllocation.debt}/
        {profile.targetAllocation.gold}
        <i className="fa-solid fa-pen adv-profile-chev" />
      </button>

      <Modal
        open={showProfile}
        onClose={() => setShowProfile(false)}
        title="Your profile"
      >
        <div className="adv-profile">
            <div className="field">
              <input
                type="number"
                value={age}
                onChange={(e) => {
                  const a = parseInt(e.target.value) || 30;
                  save({
                    birthYear: new Date().getFullYear() - a,
                    targetAllocation: glidePath(a, profile.riskAppetite),
                  });
                }}
              />
              <label>Age</label>
            </div>
            <OptionField
              label="Risk"
              value={profile.riskAppetite}
              options={[
                { value: "conservative", label: "Conservative" },
                { value: "moderate", label: "Moderate" },
                { value: "aggressive", label: "Aggressive" },
              ]}
              onChange={(e) =>
                save({
                  riskAppetite: e.target.value,
                  targetAllocation: glidePath(age, e.target.value),
                })
              }
            />
            <OptionField
              label="Regime"
              value={profile.taxRegime}
              options={[
                { value: "new", label: "New" },
                { value: "old", label: "Old" },
              ]}
              onChange={(e) => save({ taxRegime: e.target.value })}
            />
            <OptionField
              label="Tax slab"
              value={profile.taxSlab}
              options={[0, 0.05, 0.1, 0.15, 0.2, 0.3].map((s) => ({
                value: s,
                label: `${(s * 100).toFixed(0)}%`,
              }))}
              onChange={(e) => save({ taxSlab: parseFloat(e.target.value) })}
            />
            <div className="field">
              <input
                type="number"
                value={profile.emergencyMonths}
                onChange={(e) =>
                  save({ emergencyMonths: parseInt(e.target.value) || 6 })
                }
              />
              <label>Emergency (months)</label>
            </div>
            <div className="field">
              <input
                type="number"
                value={profile.used80C}
                onChange={(e) =>
                  save({ used80C: parseFloat(e.target.value) || 0 })
                }
              />
              <label>80C used (₹)</label>
            </div>
            <div className="field">
              <input
                type="number"
                value={profile.npsExtraUsed}
                onChange={(e) =>
                  save({ npsExtraUsed: parseFloat(e.target.value) || 0 })
                }
              />
              <label>NPS extra used (₹)</label>
            </div>
            <div className="field">
              <input
                type="number"
                value={profile.ltcgRealized}
                onChange={(e) =>
                  save({ ltcgRealized: parseFloat(e.target.value) || 0 })
                }
              />
              <label>LTCG booked this yr (₹)</label>
            </div>
            <div className="field">
              <input
                type="number"
                placeholder="auto from income"
                value={profile.monthlyIncome ?? ""}
                onChange={(e) => save({ monthlyIncome: e.target.value })}
              />
              <label>Monthly take-home (₹)</label>
            </div>
            <div className="field">
              <input
                type="number"
                value={profile.dependents ?? 0}
                onChange={(e) =>
                  save({ dependents: parseInt(e.target.value) || 0 })
                }
              />
              <label>Dependents</label>
            </div>
            <div className="field">
              <input
                type="number"
                placeholder="existing sum assured"
                value={profile.termCover ?? ""}
                onChange={(e) => save({ termCover: e.target.value })}
              />
              <label>Term cover (₹)</label>
            </div>
            <div className="field">
              <input
                type="number"
                placeholder="existing cover"
                value={profile.healthCover ?? ""}
                onChange={(e) => save({ healthCover: e.target.value })}
              />
              <label>Health cover (₹)</label>
            </div>
            <div className="field">
              <input
                type="number"
                value={profile.retireAge ?? 60}
                onChange={(e) =>
                  save({ retireAge: parseInt(e.target.value) || 60 })
                }
              />
              <label>Retirement age</label>
            </div>
            <div className="adv-field adv-field--target">
              <span>Target % (eq / debt / gold / alt)</span>
              <div className="adv-target-inputs">
                {["equity", "debt", "gold", "alt"].map((k) => (
                  <input
                    key={k}
                    type="number"
                    value={profile.targetAllocation[k]}
                    onChange={(e) =>
                      save({
                        targetAllocation: {
                          ...profile.targetAllocation,
                          [k]: parseInt(e.target.value) || 0,
                        },
                      })
                    }
                  />
                ))}
              </div>
            </div>
            <div className="adv-field adv-field--target">
              <span>Goals</span>
              {goals.map((g) => (
                <div key={g.id} className="adv-goal-row">
                  <input
                    value={g.name}
                    placeholder="Name"
                    onChange={(e) => updateGoal(g.id, { name: e.target.value })}
                  />
                  <input
                    type="number"
                    value={g.targetAmount}
                    placeholder="₹ target"
                    onChange={(e) =>
                      updateGoal(g.id, { targetAmount: e.target.value })
                    }
                  />
                  <input
                    type="number"
                    value={g.targetYear}
                    placeholder="Year"
                    onChange={(e) =>
                      updateGoal(g.id, { targetYear: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="adv-goal-del"
                    onClick={() => removeGoal(g.id)}
                    aria-label="Remove goal"
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ))}
              <button type="button" className="adv-goal-add" onClick={addGoal}>
                <i className="fa-solid fa-plus" /> Add goal
              </button>
            </div>
        </div>
      </Modal>

      {advisoryWins.length > 0 && (
        <div className="adv-wins">
          <div className="adv-wins-head">
            <span className="adv-wins-title">
              <i className="fa-solid fa-circle-check" /> Sorted automatically —
              nice work
            </span>
            <button
              type="button"
              className="adv-wins-ack"
              onClick={() => dispatch(persistSetPreference("advisoryWins", []))}
            >
              Got it
            </button>
          </div>
          <ul className="adv-wins-list">
            {advisoryWins.map((w) => (
              <li key={w.id}>
                <i className="fa-solid fa-check" /> {w.title}
                {w.saving > 0 ? ` · ${INR.format(w.saving)}/yr` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="adv-hero">
        <span className="adv-hero-label">Money found</span>
        <span className="adv-hero-value">{INR.format(activeMoney)}/yr</span>
        <span className="adv-hero-sub">
          across {activeCards.length} open action
          {activeCards.length === 1 ? "" : "s"}, ranked by impact × confidence
          <InfoTooltip
            className="adv-hero-tip"
            label="What is confidence?"
            text={
              <>
                Every card carries a <strong>confidence score (0–100)</strong> —
                how sure we are it's worth your attention. It's built
                deterministically from a few factors:{" "}
                <strong>rule vs forecast</strong> (a tax rule scores higher than a
                projection), the <strong>size of the edge</strong>, how{" "}
                <strong>current the data</strong> is, and how well it{" "}
                <strong>fits your plan</strong>. <strong>80+</strong> is high,{" "}
                <strong>55–79</strong> moderate, under 55 is a softer nudge. Tap
                the <strong>score</strong> on any card for its exact breakdown.
                It's not a market prediction.
              </>
            }
          />
        </span>
      </div>

      {acted.count > 0 && (
        <div className="adv-acted">
          <i className="fa-solid fa-circle-check adv-acted-ico" />
          <span className="adv-acted-text">
            You&apos;ve acted on <strong>{acted.count}</strong> suggestion
            {acted.count === 1 ? "" : "s"}
            {acted.saving > 0 && (
              <>
                {" "}
                — worth about{" "}
                <strong>{INR.format(acted.saving)}/yr</strong> locked in
              </>
            )}
            .
          </span>
        </div>
      )}

      {nextBest && !showHidden && filter === "all" && (
        <div className="adv-nextbest">
          <div className="adv-nextbest-head">
            <span className="adv-nextbest-tag">
              <i className="fa-solid fa-wand-magic-sparkles" /> Do this next
            </span>
            <ConfidenceBadge score={nextBest.confidence} />
          </div>
          <p className="adv-nextbest-title">{nextBest.title}</p>
          <p className="adv-nextbest-action">{nextBest.action}</p>
          <div className="adv-card-foot">
            <span className="adv-card-impact">{nextBest.impactLabel}</span>
            <button
              type="button"
              className="adv-card-go"
              onClick={() => doIt(nextBest)}
            >
              <i
                className={`fa-solid ${guideFor(nextBest) ? "fa-list-check" : "fa-arrow-up-right-from-square"}`}
              />{" "}
              Do it
            </button>
            <CardMenu
              status={null}
              onDone={() => act(nextBest, { status: "done" })}
              onSnooze={() =>
                act(nextBest, { status: "snoozed", until: snoozeUntil() })
              }
              onDismiss={() => act(nextBest, { status: "dismissed" })}
              onRestore={() => act(nextBest, null)}
            />
          </div>
          <AnimatePresence initial={false}>
            {openGuide[nextBest.id] && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                style={{ overflow: "hidden" }}
              >
                <GuideBox
                  card={nextBest}
                  href={deepLinkFor(nextBest)}
                  onOpen={() => deepNav(deepLinkFor(nextBest))}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {showRewardHint && (
        <button
          type="button"
          className="adv-reward-hint"
          onClick={() => deepNav(rewardHintHref)}
        >
          <i className="fa-solid fa-wand-magic-sparkles adv-reward-hint-icon" />
          <span className="adv-reward-hint-text">
            <strong>Unlock card tips.</strong> Add reward rates and fees to{" "}
            {cardsMissingRewards.length === 1
              ? `your ${cardsMissingRewards[0].name || "card"}`
              : `${cardsMissingRewards.length} cards`}{" "}
            to get best-card routing and fee-vs-benefit suggestions.
          </span>
          <i className="fa-solid fa-arrow-right adv-reward-hint-go" />
        </button>
      )}

      <CoverageMeter
        data={data}
        profile={profile}
        onOpenProfile={() => setShowProfile(true)}
      />

      <div className="adv-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`adv-filter${filter === f.key && !showHidden ? " adv-filter--active" : ""}`}
            onClick={() => {
              setFilter(f.key);
              setShowHidden(false);
            }}
          >
            {f.label}
          </button>
        ))}
        {hiddenCards.length > 0 && (
          <button
            type="button"
            className={`adv-filter${showHidden ? " adv-filter--active" : ""}`}
            onClick={() => setShowHidden((v) => !v)}
          >
            Hidden ({hiddenCards.length})
          </button>
        )}
      </div>

      <CardMenuLegend />

      {shown.length === 0 ? (
        <p className="adv-empty">
          Nothing to act on here right now — you&apos;re in good shape. Add your
          tax slab and 80C used in the profile for sharper tax suggestions.
        </p>
      ) : (
        <div className="adv-feed">
          <AnimatePresence initial={false}>
            {shown.map((c) => (
              <motion.div
                key={c.id}
                layout
                className={`adv-card${statusOf(advState, c.id) ? " adv-card--muted" : ""}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <div className="adv-card-head">
                  <span className="adv-card-title">{c.title}</span>
                  <ConfidenceBadge
                    score={c.confidence}
                    open={!!openReason[c.id]}
                    onToggle={() =>
                      setOpenReason((o) => ({ ...o, [c.id]: !o[c.id] }))
                    }
                  />
                </div>
                <p className="adv-card-action">{c.action}</p>
                {c.conflictNote && (
                  <p className="adv-card-conflict">
                    <i className="fa-solid fa-arrow-down-wide-short" />{" "}
                    {c.conflictNote}
                  </p>
                )}
                <div className="adv-card-foot">
                  <span className="adv-card-impact">{c.impactLabel}</span>
                  <button
                    type="button"
                    className="adv-card-go"
                    onClick={() => doIt(c)}
                  >
                    <i
                      className={`fa-solid ${guideFor(c) ? "fa-list-check" : "fa-arrow-up-right-from-square"}`}
                    />{" "}
                    Do it
                  </button>
                  {learnFor(c) && (
                    <button
                      type="button"
                      className="adv-card-learn"
                      onClick={() =>
                        setOpenLearn((o) => ({ ...o, [c.id]: !o[c.id] }))
                      }
                    >
                      <i className="fa-solid fa-book-open" /> Learn
                    </button>
                  )}
                  <CardMenu
                    status={statusOf(advState, c.id)}
                    onDone={() => act(c, { status: "done" })}
                    onSnooze={() =>
                      act(c, { status: "snoozed", until: snoozeUntil() })
                    }
                    onDismiss={() => act(c, { status: "dismissed" })}
                    onRestore={() => act(c, null)}
                  />
                </div>
                <ConfidenceReveal open={!!openReason[c.id]} card={c} />

                <AnimatePresence initial={false}>
                  {openLearn[c.id] && learnFor(c) && (
                    <motion.div
                      className="adv-card-learn-box"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: EASE }}
                      style={{ overflow: "hidden" }}
                    >
                      <p className="adv-card-learn-title">{learnFor(c).title}</p>
                      <p className="adv-card-learn-body">{learnFor(c).body}</p>
                    </motion.div>
                  )}
                  {openGuide[c.id] && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: EASE }}
                      style={{ overflow: "hidden" }}
                    >
                      <GuideBox
                        card={c}
                        href={deepLinkFor(c)}
                        onOpen={() => deepNav(deepLinkFor(c))}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
