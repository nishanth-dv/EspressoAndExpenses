import { useDispatch } from "react-redux";
import { login } from "../redux/slices/authSlice";
import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

export default function GoogleLoginButton() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleCredentialResponse = useCallback(
    (response) => {
      const jwt = response.credential;

      const payload = JSON.parse(atob(jwt.split(".")[1]));

      const user = {
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
        sub: payload.sub,
        token: jwt,
      };

      dispatch(login(user));
      navigate("/Expense");
    },
    [dispatch, navigate]
  );

  useEffect(() => {
    /* global google */
    google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    });

    google.accounts.id.renderButton(document.getElementById("googleBtn"), {
      theme: "outline",
      size: "large",
    });
  }, [handleCredentialResponse]);

  return <div id="googleBtn"></div>;
}
