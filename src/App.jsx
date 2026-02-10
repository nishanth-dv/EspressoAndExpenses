import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import LandingPage from "./pages/LandingPage";
import HomePage from "./pages/HomePage";
import Expense from "./pages/ExpensePage";
import Invest from "./pages/InvestmentPage";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";

function Protected({ children }) {
  const userInfo = useSelector((state) => state.auth.user);
  return userInfo ? children : <Navigate to="/Login" />;
}

export default function App() {
  return (
    <BrowserRouter>
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
          <Route
            path="Expense"
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
