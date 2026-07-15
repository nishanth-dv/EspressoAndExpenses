import { useNavigate } from "react-router-dom";

export default function NoAccessPage() {
  const navigate = useNavigate();
  return (
    <div className="noaccess-screen">
      <div className="noaccess-icon">
        <i className="fa-solid fa-lock" />
      </div>
      <h2 className="noaccess-title">No access</h2>
      <p className="noaccess-text">
        This section isn&apos;t available for your account.
      </p>
      <div className="noaccess-actions">
        <button
          type="button"
          className="generic-button"
          onClick={() => navigate(-1)}
        >
          <i className="fa-solid fa-arrow-left" /> Go back
        </button>
        <button
          type="button"
          className="cancel-button"
          onClick={() => navigate("/Dashboard", { replace: true })}
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
