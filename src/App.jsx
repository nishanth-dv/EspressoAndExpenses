import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import Toast from "./components/Toast";
import { isPageEnabled } from "./utils/pages";
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

export default function App() {
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
                <Expense />
              </Protected>
            }
          />
          <Route
            path="Invest"
            element={
              <Protected>
                <PageGate pageKey="investments">
                  <Invest />
                </PageGate>
              </Protected>
            }
          />
          <Route
            path="Dashboard"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route
            path="Solvency"
            element={
              <Protected>
                <PageGate pageKey="solvency">
                  <Solvency />
                </PageGate>
              </Protected>
            }
          />
          <Route
            path="Subscriptions"
            element={
              <Protected>
                <PageGate pageKey="subscriptions">
                  <Subscriptions />
                </PageGate>
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
