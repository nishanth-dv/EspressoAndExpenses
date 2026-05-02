/* global google */
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { useEffect, useCallback } from "react";
import { login } from "./redux/slices/authSlice";
import LandingPage from "./pages/LandingPage";
import HomePage from "./pages/HomePage";
import Expense from "./pages/ExpensePage";
import Invest from "./pages/InvestmentPage";
import Dashboard from "./pages/DashboardPage";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";

function parseCredential(jwt) {
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return {
    name: payload.name,
    email: payload.email,
    picture: payload.picture,
    sub: payload.sub,
    token: jwt,
  };
}

// Initializes Google Sign-In once on every page load.
// Handles credentials for both the sign-in button and One Tap / auto-select,
// so returning users are re-authenticated without visiting the login page.
function GoogleAuthManager() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleCredentialResponse = useCallback(
    (response) => {
      dispatch(login(parseCredential(response.credential)));
      navigate("/Transactions", { replace: true });
    },
    [dispatch, navigate]
  );

  useEffect(() => {
    let cleanup = () => {};

    const init = () => {
      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: true, // silently signs in returning users
      });
      // prompt() is a no-op if there is no active Google session;
      // for returning users it shows One Tap or auto-selects silently.
      google.accounts.id.prompt();
    };

    if (window.google) {
      init();
    } else {
      // GSI script is loaded async — wait for it
      const script = document.querySelector('script[src*="accounts.google.com/gsi"]');
      script?.addEventListener("load", init, { once: true });
      cleanup = () => script?.removeEventListener("load", init);
    }

    return cleanup;
  }, [handleCredentialResponse]);

  return null;
}

function Protected({ children }) {
  const userInfo = useSelector((state) => state.auth.user);
  return userInfo ? children : <Navigate to="/Login" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <GoogleAuthManager />
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
