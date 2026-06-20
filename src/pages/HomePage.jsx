import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";
import Navbar from "../components/Navbar";
import Actions from "../components/Actions";
import OfflineBanner from "../components/OfflineBanner";
import PrivacyBanner from "../components/PrivacyBanner";
import {
  initializeDrive,
  persistSyncGmail,
  persistQueueAlert,
} from "../redux/slices/transactionSlice";
import { reconnectDrive } from "../utils/googleDrive";
import { showToast } from "../redux/slices/toastSlice";
import { useLoader } from "../preStyledElements/loader/LoaderContext";
import { useGlassParallax } from "../hooks/useGlassParallax";
import RouteErrorBoundary from "../components/RouteErrorBoundary";

const Home = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const fileID = useSelector((state) => state.transactions.fileID);
  const status = useSelector((state) => state.transactions.status);
  const privacyMode = useSelector(
    (state) => state.transactions.transactionData?.preferences?.privacyMode ?? false,
  );
  const { showLoader, hideLoader } = useLoader();
  const autoReadEnabled = useSelector(
    (state) => state.transactions.transactionData?.autoRead?.enabled ?? false,
  );
  const gmailSyncedRef = useRef(false);
  const captureHandledRef = useRef(false);
  const [reconnecting, setReconnecting] = useState(false);

  const driveLoading =
    status === "idle" || status === "loading" || reconnecting;

  // Cursor-tracked specular glide across glass panes (no-op unless Glass skin).
  useGlassParallax();

  // Toggle a body-level class so the privacy CSS can blur all amounts at once.
  useEffect(() => {
    document.body.classList.toggle("privacy-on", privacyMode);
    return () => document.body.classList.remove("privacy-on");
  }, [privacyMode]);

  useEffect(() => {
    if (!fileID) dispatch(initializeDrive());
  }, [dispatch, fileID]);

  // Hold the fullscreen boot loader until Drive is ready.
  useEffect(() => {
    if (driveLoading) {
      showLoader({ label: "Brewing" });
    } else {
      hideLoader();
    }
  }, [driveLoading, showLoader, hideLoader]);

  // Auto-capture: once per session, after Drive is ready, pull new bank/UPI
  // alert mails from Gmail into the review inbox. Silent — no scope prompt
  // here (that only happens on the explicit "Sync now" tap).
  useEffect(() => {
    if (status !== "ready" || !autoReadEnabled || gmailSyncedRef.current) return;
    gmailSyncedRef.current = true;
    dispatch(persistSyncGmail());
  }, [status, autoReadEnabled, dispatch]);

  // Deep-link capture: an iOS Shortcut (or any link) opening the app with
  // ?capture=<alert text> queues that text into the review inbox, then lands
  // on the ledger so the dotted ghost row is visible. One tap per SMS, fully
  // within Apple's rules (no SMS reading — the user shares the text).
  useEffect(() => {
    if (status !== "ready" || captureHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const cap = params.get("capture");
    if (!cap) return;
    const at = params.get("at");
    captureHandledRef.current = true;
    dispatch(persistQueueAlert(cap, at)).then((res) => {
      if (res?.ok) {
        dispatch(showToast({ message: "Captured — review it in Transactions" }));
      }
    });
    navigate("/Transactions", { replace: true });
  }, [status, dispatch, navigate]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && status === "error") {
        dispatch(initializeDrive());
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [dispatch, status]);

  const handleReconnect = useCallback(async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      await reconnectDrive();
      dispatch(initializeDrive());
      dispatch(showToast({ message: "Google Drive reconnected" }));
    } catch {
      dispatch(
        showToast({
          message: "Reconnect failed — tap the button to try again.",
          type: "error",
        }),
      );
    } finally {
      setReconnecting(false);
    }
  }, [dispatch, reconnecting]);

  const needsManualReconnect = status === "needs-reconnect" && !reconnecting;

  // Reconnect screen renders standalone — no Navbar / Actions — so the user
  // doesn't see partial chrome above/below an empty page (which felt broken).
  if (needsManualReconnect) {
    return (
      <div className="reconnect-screen">
        <div className="reconnect-card">
          <p className="reconnect-title">Hold on a moment</p>
          <p className="reconnect-sub">
            Your Google session ran out. Sign back in to pick up right where
            you left off — your data is safe in your Drive.
          </p>
          <button
            className="generic-button reconnect-btn"
            onClick={handleReconnect}
          >
            <i className="fa-solid fa-rotate-right" /> Reconnect to Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <OfflineBanner />
      <PrivacyBanner />
      <div className="outlet">
        <RouteErrorBoundary resetKey={location.pathname}>
          <motion.div
            className="page-container"
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          >
            <Outlet />
          </motion.div>
        </RouteErrorBoundary>
      </div>
      <Actions />
    </>
  );
};

export default memo(Home);
