import { useEffect, useState } from "react";
import Modal from "../preStyledElements/modal/Modal";
import { APP_PAGES } from "../utils/pages";
import { listGrants, saveGrant, revokeGrant } from "../utils/adminAccess";

const GATED_PAGES = APP_PAGES.filter((p) => !p.open && !p.admin);

export default function AdminPage() {
  const [grants, setGrants] = useState([]);
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState(null);

  const refresh = () =>
    listGrants()
      .then(setGrants)
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (key) =>
    setSelected((s) =>
      s.includes(key) ? s.filter((k) => k !== key) : [...s, key],
    );

  const save = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setBusy(true);
    setError("");
    try {
      await saveGrant(e, selected);
      setEmail("");
      setSelected([]);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const edit = (g) => {
    setEmail(g.email);
    setSelected(Array.isArray(g.pages) ? g.pages : []);
  };

  const revoke = async (em) => {
    setBusy(true);
    setError("");
    try {
      await revokeGrant(em);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
    setRevokeTarget(null);
  };

  const labelFor = (key) =>
    APP_PAGES.find((p) => p.key === key)?.label ?? key;

  return (
    <div className="admin-page">
      <h2 className="admin-title">
        <i className="fa-solid fa-user-shield" /> Page access
      </h2>
      <p className="admin-hint">
        Grant gated pages to specific users by email. Anyone not listed has no
        access to gated pages.
      </p>

      {error && <p className="admin-error">{error}</p>}

      {GATED_PAGES.length === 0 ? (
        <p className="admin-empty">
          No gated pages yet. Any new page is gated by default (a page is public
          only when marked <code>open: true</code>) — it&apos;ll show up here to
          manage once added.
        </p>
      ) : (
        <div className="admin-form">
          <div className="field">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder=" "
              autoCapitalize="none"
              autoCorrect="off"
            />
            <label>User email</label>
          </div>

          <div className="admin-pages">
            {GATED_PAGES.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`admin-page-chip${
                  selected.includes(p.key) ? " admin-page-chip--on" : ""
                }`}
                onClick={() => toggle(p.key)}
              >
                <i className={`fa-solid ${p.icon}`} /> {p.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="generic-button"
            onClick={save}
            disabled={busy || !email.trim()}
          >
            <i className="fa-solid fa-floppy-disk" /> Save grant
          </button>
        </div>
      )}

      <h3 className="admin-subtitle">Current grants</h3>
      {grants.length === 0 ? (
        <p className="admin-empty">No grants yet.</p>
      ) : (
        <ul className="admin-grants">
          {grants.map((g) => (
            <li key={g.email} className="admin-grant-row">
              <div className="admin-grant-meta">
                <span className="admin-grant-email">{g.email}</span>
                <span className="admin-grant-pages">
                  {Array.isArray(g.pages) && g.pages.length
                    ? g.pages.map(labelFor).join(", ")
                    : "— no pages —"}
                </span>
              </div>
              <div className="admin-grant-actions">
                <button
                  type="button"
                  className="admin-icon-btn"
                  onClick={() => edit(g)}
                  title="Edit"
                >
                  <i className="fa-solid fa-pen" />
                </button>
                <button
                  type="button"
                  className="admin-icon-btn admin-icon-btn--del"
                  onClick={() => setRevokeTarget(g.email)}
                  disabled={busy}
                  title="Revoke"
                >
                  <i className="fa-solid fa-trash-can" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {revokeTarget && (
        <Modal open onClose={() => setRevokeTarget(null)} title="Revoke access?">
          <div className="delete-confirm-body">
            <p className="delete-confirm-name">{revokeTarget}</p>
            <p className="delete-confirm-hint">
              This removes all gated-page access for this user. They&apos;ll be
              locked out of those pages immediately.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setRevokeTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => revoke(revokeTarget)}
                disabled={busy}
              >
                <i className="fa-solid fa-trash-can" /> Revoke
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
