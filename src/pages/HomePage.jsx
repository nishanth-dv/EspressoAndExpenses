import { memo, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";
import Navbar from "../components/Navbar";
import Actions from "../components/Actions";
import OfflineBanner from "../components/OfflineBanner";
import PrivacyBanner from "../components/PrivacyBanner";
import { initializeDrive } from "../redux/slices/transactionSlice";
import { reconnectDrive } from "../utils/googleDrive";
import { showToast } from "../redux/slices/toastSlice";
import { useLoader } from "../preStyledElements/loader/LoaderContext";

const Home = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const fileID = useSelector((state) => state.transactions.fileID);
  const status = useSelector((state) => state.transactions.status);
  const privacyMode = useSelector(
    (state) => state.transactions.transactionData?.preferences?.privacyMode ?? false,
  );
  const { showLoader, hideLoader } = useLoader();
  const [reconnecting, setReconnecting] = useState(false);

  // Toggle a body-level class so the privacy CSS can blur all amounts at once.
  useEffect(() => {
    document.body.classList.toggle("privacy-on", privacyMode);
    return () => document.body.classList.remove("privacy-on");
  }, [privacyMode]);

  useEffect(() => {
    if (!fileID) dispatch(initializeDrive());
  }, [dispatch, fileID]);

  useEffect(() => {
    if (status === "idle" || status === "loading" || reconnecting) {
      showLoader({ label: "Brewing" });
    } else {
      hideLoader();
    }
  }, [status, reconnecting, showLoader, hideLoader]);

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
        <AnimatePresence mode="wait">
          <motion.div
            className="page-container"
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>
      <Actions />
    </>
  );
};

export default memo(Home);
