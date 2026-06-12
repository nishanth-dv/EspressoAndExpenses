import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import LandingPage from "./pages/LandingPage";
import HomePage from "./pages/HomePage";
import Expense from "./pages/ExpensePage";
import Invest from "./pages/InvestmentPage";
import Dashboard from "./pages/DashboardPage";
import Solvency from "./pages/SolvencyPage";
import Preferences from "./pages/PreferencesPage";
import Toast from "./components/Toast";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";
import "./styles/glass.css";

function Protected({ children }) {
  const userInfo = useSelector((state) => state.auth.user);
  return userInfo ? children : <Navigate to="/Login" />;
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
                <Invest />
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
                <Solvency />
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
