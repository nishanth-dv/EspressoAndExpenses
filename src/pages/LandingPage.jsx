import { useEffect } from "react";
import GoogleLogin from "../components/Login";

export default function LandingPage() {
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");
    return () => {
      if (prev) document.documentElement.setAttribute("data-theme", prev);
      else document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true">
        <div className="landing-orb landing-orb--1" />
        <div className="landing-orb landing-orb--2" />
        <div className="landing-orb landing-orb--3" />
      </div>

      <div className="landing-card">
        <h1 className="landing-title">Login</h1>

        <div className="landing-divider" />

        <GoogleLogin />
      </div>
    </div>
  );
}
