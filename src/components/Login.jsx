import { memo, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { login } from "../redux/slices/authSlice";
import { loginWithGoogle } from "../utils/googleDrive";

const GoogleLoginButton = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const userInfo = await loginWithGoogle();
      dispatch(login(userInfo));
      navigate("/Transactions", { replace: true });
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="google-login-wrap">
      <button
        className="google-login-btn"
        onClick={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <>
            <i className="fa-solid fa-spinner fa-spin" /> Signing in…
          </>
        ) : (
          <>
            <i className="fa-brands fa-google" /> Sign in with Google
          </>
        )}
      </button>
      {error && <p className="google-login-error">{error}</p>}
    </div>
  );
};

export default memo(GoogleLoginButton);
