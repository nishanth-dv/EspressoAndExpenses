import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { motion } from "framer-motion";
import { runAnalysis } from "../../utils/advisory/analysis";
import { runAdvisory } from "../../utils/advisory/engine";
import { mergeProfile } from "../../utils/advisory/profile";
import { isSuppressed } from "../../utils/advisory/state";
import { ledgerSummary } from "../../utils/advisory/ledger";

const EASE = [0.25, 0.46, 0.45, 0.94];

const INR_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

// The Advisory hub: the user picks a domain rather than landing straight in a
// lens. "Know your money" is the existing analysis suite; "Grow your money" is
// the make-money direction (Money Made ledger + opportunities), still building.
export default function AdvisoryHome() {
  const navigate = useNavigate();
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const stored = data.preferences?.advisoryProfile;
  const advState = data.preferences?.advisoryState;
  const advisoryFeedback = data.preferences?.advisoryFeedback;

  const analysis = useMemo(() => runAnalysis(data), [data]);
  const profile = useMemo(() => mergeProfile(data, stored), [data, stored]);
  // Market-independent pass — enough to count live actions for a teaser without
  // waiting on the market fetch. The Actions lens runs the full pass with market.
  const { cards } = useMemo(
    () => runAdvisory(data, profile, null, advisoryFeedback),
    [data, profile, advisoryFeedback],
  );

  const actionCount = cards.filter((c) => !isSuppressed(advState, c.id)).length;
  const netWorth = analysis.netWorth?.netWorth ?? 0;
  const moneyMade = useMemo(
    () => ledgerSummary(data.preferences?.moneyMade).total,
    [data.preferences?.moneyMade],
  );

  return (
    <div className="adv-home">
      <div className="adv-home-head">
        <h2>Your money, two ways</h2>
        <p>Understand where you stand — then put it to work.</p>
      </div>

      <div className="adv-home-tiles">
        <motion.button
          type="button"
          className="adv-tile adv-tile--know"
          onClick={() => navigate("understand")}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: EASE }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.99 }}
        >
          <span className="adv-tile-icon">
            <i className="fa-solid fa-magnifying-glass-chart" />
          </span>
          <span className="adv-tile-title">Know your money</span>
          <span className="adv-tile-desc">
            Understand &amp; optimise what you already have.
          </span>
          <span className="adv-tile-stats">
            {analysis.hasData ? (
              <>Net worth {INR_COMPACT.format(netWorth)}</>
            ) : (
              "Add data to begin"
            )}
            {actionCount > 0 && (
              <>
                {" "}
                · {actionCount} action{actionCount > 1 ? "s" : ""} ready
              </>
            )}
          </span>
          <span className="adv-tile-go">
            Explore <i className="fa-solid fa-arrow-right" />
          </span>
        </motion.button>

        <motion.button
          type="button"
          className="adv-tile adv-tile--grow"
          onClick={() => navigate("grow")}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: EASE, delay: 0.06 }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.99 }}
        >
          <span className="adv-tile-badge">New</span>
          <span className="adv-tile-icon">
            <i className="fa-solid fa-arrow-trend-up" />
          </span>
          <span className="adv-tile-title">Grow your money</span>
          <span className="adv-tile-desc">
            Turn advice into realised gains you can see.
          </span>
          <span className="adv-tile-stats">
            {moneyMade > 0 ? (
              <>{INR_COMPACT.format(moneyMade)} made so far</>
            ) : (
              "Start capturing →"
            )}
          </span>
          <span className="adv-tile-go">
            Explore <i className="fa-solid fa-arrow-right" />
          </span>
        </motion.button>
      </div>
    </div>
  );
}
