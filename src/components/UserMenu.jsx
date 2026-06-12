/* global google */
import { memo, useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logout } from "../redux/slices/authSlice";
import {
  reset as resetTransactions,
  initializeDrive,
} from "../redux/slices/transactionSlice";
import { resetFilter } from "../redux/slices/filterSlice";
import { showToast } from "../redux/slices/toastSlice";
import { clearAccessToken } from "../utils/googleDrive";

const UserMenu = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const userInfo = useSelector((state) => state.auth.user);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSync() {
    setOpen(false);
    if (syncing) return;
    setSyncing(true);
    try {
      await dispatch(initializeDrive());
      dispatch(showToast({ message: "Synced with Drive" }));
    } catch {
      dispatch(showToast({ message: "Sync failed", type: "error" }));
    } finally {
      setSyncing(false);
    }
  }

  function handlePreferences() {
    setOpen(false);
    navigate("/Preferences");
  }

  function handleLogout() {
    setOpen(false);
    clearAccessToken();
    dispatch(resetTransactions());
    dispatch(resetFilter());
    dispatch(logout());
    if (window.google) {
      google.accounts.id.disableAutoSelect();
      if (userInfo?.email) {
        google.accounts.id.revoke(userInfo.email, () => {});
      }
    }
  }

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`user-menu-trigger${open ? " user-menu-trigger--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <img
          className="display-picture"
          src={userInfo?.picture}
          alt={userInfo?.name}
          referrerPolicy="no-referrer"
        />
      </button>
      {open && (
        <div className="user-menu" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-name">{userInfo?.name}</div>
            {userInfo?.email && (
              <div className="user-menu-email">{userInfo.email}</div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={handleSync}
            disabled={syncing}
          >
            <i
              className={`fa-solid ${syncing ? "fa-spinner fa-spin" : "fa-rotate"}`}
            />
            <span>{syncing ? "Syncing…" : "Sync now"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={handlePreferences}
          >
            <i className="fa-solid fa-sliders" />
            <span>Preferences</span>
          </button>
          <div className="user-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="user-menu-item user-menu-item--danger"
            onClick={handleLogout}
          >
            <i className="fa-solid fa-arrow-right-from-bracket" />
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default memo(UserMenu);
