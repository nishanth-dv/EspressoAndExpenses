import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import "overlayscrollbars/overlayscrollbars.css";
import Toast from "./components/Toast";
import { isPageEnabled, isPageGated } from "./utils/pages";
import NoAccessPage from "./pages/NoAccessPage";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";
import "./styles/glass.css";
import LandingPage from "./pages/LandingPage";
import HomePage from "./pages/HomePage";
import Expense from "./pages/ExpensePage";
import Invest from "./pages/InvestmentPage";
import Dashboard from "./pages/DashboardPage";
import Solvency from "./pages/SolvencyPage";
import Subscriptions from "./pages/SubscriptionsPage";
import Preferences from "./pages/PreferencesPage";
import AdminPage from "./pages/AdminPage";
import AdvisoryLayout from "./pages/advisory/AdvisoryLayout";
import AdvisoryHome from "./pages/advisory/AdvisoryHome";
import GrowHome from "./pages/advisory/GrowHome";
import GrowChart from "./pages/advisory/GrowChart";
import GrowSignals from "./pages/advisory/GrowSignals";
import ActionsLens from "./pages/advisory/ActionsLens";
import UnderstandLens from "./pages/advisory/UnderstandLens";
import ReviewLens from "./pages/advisory/ReviewLens";
import AskLens from "./pages/advisory/AskLens";

function Protected({ children }) {
  const userInfo = useSelector((state) => state.auth.user);
  return userInfo ? children : <Navigate to="/Login" />;
}

// Gates an optional page: if the user has turned it off in Preferences, send
// them to the Dashboard instead of rendering it. Mandatory pages and pages
// that are enabled (or not yet loaded) pass straight through.
function PageGate({ pageKey, children }) {
  const preferences = useSelector(
    (state) => state.transactions.transactionData?.preferences,
  );
  return isPageEnabled(pageKey, preferences) ? (
    children
  ) : (
    <Navigate to="/Dashboard" replace />
  );
}

// Server-controlled access gate (DB-driven, applies to Drive users too). Ungated
// pages pass straight through. For gated pages we wait for access to load, then
// allow only if granted — and fail closed (no access on a load failure), so the
// page is unreachable even via a manual URL.
function AccessGate({ pageKey, children }) {
  const access = useSelector((state) => state.access);
  if (!isPageGated(pageKey)) return children;
  if (access.status === "idle" || access.status === "loading") {
    return (
      <div className="access-loading">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }
  if (access.status === "succeeded" && access.pages.includes(pageKey)) {
    return children;
  }
  return <NoAccessPage />;
}

// Admin-only route (the grant UI). Fail-closed for everyone but the admin email.
function AdminGate({ children }) {
  const access = useSelector((state) => state.access);
  if (access.status === "idle" || access.status === "loading") {
    return (
      <div className="access-loading">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }
  return access.isAdmin ? children : <NoAccessPage />;
}

export default function App() {
  // iOS Safari keeps its URL bars visible when the page body doesn't scroll
  // (our scroll lives inside .outlet), but 100dvh resolves to the bars-hidden
  // height — pushing the footer behind the bottom bar. Drive the app height off
  // the actual VisualViewport height (resize only, so no scroll jank).
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
    };
    apply();
    const target = vv || window;
    target.addEventListener("resize", apply);
    return () => target.removeEventListener("resize", apply);
  }, []);

  return (
    <BrowserRouter>
      <Toast />
      <Routes>
        <Route path="/Login" element={<LandingPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <HomePage />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/Transactions" replace />} />
          <Route
            path="Transactions"
            element={
              <Protected>
                <AccessGate pageKey="transactions">
                  <Expense />
                </AccessGate>
              </Protected>
            }
          />
          <Route
            path="Invest"
            element={
              <Protected>
                <AccessGate pageKey="investments">
                  <PageGate pageKey="investments">
                    <Invest />
                  </PageGate>
                </AccessGate>
              </Protected>
            }
          />
          <Route
            path="Dashboard"
            element={
              <Protected>
                <AccessGate pageKey="dashboard">
                  <Dashboard />
                </AccessGate>
              </Protected>
            }
          />
          <Route
            path="Solvency"
            element={
              <Protected>
                <AccessGate pageKey="solvency">
                  <PageGate pageKey="solvency">
                    <Solvency />
                  </PageGate>
                </AccessGate>
              </Protected>
            }
          />
          <Route
            path="Subscriptions"
            element={
              <Protected>
                <AccessGate pageKey="subscriptions">
                  <PageGate pageKey="subscriptions">
                    <Subscriptions />
                  </PageGate>
                </AccessGate>
              </Protected>
            }
          />
          <Route
            path="Preferences"
            element={
              <Protected>
                <Preferences />
              </Protected>
            }
          />
          <Route
            path="Advisory"
            element={
              <Protected>
                <AccessGate pageKey="advisory">
                  <AdvisoryLayout />
                </AccessGate>
              </Protected>
            }
          >
            <Route index element={<AdvisoryHome />} />
            <Route path="grow" element={<GrowHome />} />
            <Route path="grow/charts" element={<GrowChart />} />
            <Route path="grow/signals" element={<GrowSignals />} />
            <Route path="actions" element={<ActionsLens />} />
            <Route path="understand" element={<UnderstandLens />} />
            <Route path="review" element={<ReviewLens />} />
            <Route path="ask" element={<AskLens />} />
          </Route>
          <Route
            path="Admin"
            element={
              <Protected>
                <AdminGate>
                  <AdminPage />
                </AdminGate>
              </Protected>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
