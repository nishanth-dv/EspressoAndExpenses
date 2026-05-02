/* global google */
import { memo, useEffect } from "react";

// GoogleAuthManager (in App.jsx) owns initialize() and the credential callback.
// This component only renders the sign-in button into the DOM.
const GoogleLoginButton = () => {
  useEffect(() => {
    const render = () => {
      const el = document.getElementById("googleBtn");
      if (!el || !window.google) return;
      google.accounts.id.renderButton(el, { theme: "outline", size: "large" });
    };

    if (window.google) {
      render();
    } else {
      const script = document.querySelector('script[src*="accounts.google.com/gsi"]');
      script?.addEventListener("load", render, { once: true });
      return () => script?.removeEventListener("load", render);
    }
  }, []);

  return <div id="googleBtn"></div>;
};

export default memo(GoogleLoginButton);
