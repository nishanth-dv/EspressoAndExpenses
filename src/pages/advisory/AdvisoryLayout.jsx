import { useState } from "react";
import { motion } from "framer-motion";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import AdvisoryReport from "./AdvisoryReport";
import { useInvestments } from "../../hooks/useInvestments";
import { useLedger } from "../../hooks/useLedger";

// Tabs per domain.
const ANALYSE_TABS = [
  { to: "understand", label: "Understand" },
  { to: "review", label: "Review" },
  { to: "actions", label: "Actions" },
  { to: "ask", label: "Ask" },
];
const GROW_TABS = [
  { to: "/Advisory/grow", label: "Overview", end: true },
  { to: "/Advisory/grow/charts", label: "Charts" },
  { to: "/Advisory/grow/signals", label: "Signals" },
];

// "home" = the chooser at /Advisory; "grow" = make-money domain; anything else
// under /Advisory is an analysis lens.
function sectionFor(pathname) {
  const seg = pathname.replace(/^\/Advisory\/?/, "").split("/")[0];
  if (!seg) return "home";
  if (seg === "grow") return "grow";
  return "analyse";
}

export default function AdvisoryLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [reportOpen, setReportOpen] = useState(false);
  useLedger();
  useInvestments();

  const section = sectionFor(pathname);
  const tabs = section === "grow" ? GROW_TABS : section === "analyse" ? ANALYSE_TABS : [];

  // Back button climbs one level: a lens returns to the hub; the hub returns to
  // Investments (where the Advisory CTA lives).
  const backTo = section === "home" ? "/Invest" : "/Advisory";
  const backLabel = section === "home" ? "Investments" : "Advisory";

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <button
          type="button"
          className="adv-back-btn"
          onClick={() => navigate(backTo)}
        >
          <i className="fa-solid fa-arrow-left" /> {backLabel}
        </button>
        <button
          type="button"
          className="adv-report-btn"
          onClick={() => setReportOpen(true)}
        >
          <i className="fa-solid fa-file-arrow-down" /> Report
        </button>
      </div>

      {tabs.length > 0 && (
        <div className="adv-subnav">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `adv-subnav-tab${isActive ? " adv-subnav-tab--active" : ""}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="advSubnavPill"
                      className="adv-subnav-tab-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
                    />
                  )}
                  {t.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}

      <Outlet />

      <AdvisoryReport open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
