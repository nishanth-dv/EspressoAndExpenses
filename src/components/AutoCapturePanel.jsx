import { memo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  persistQueueAlert,
  persistSyncGmail,
  persistAutoReadEnabled,
} from "../redux/slices/transactionSlice";
import { reconnectDrive } from "../utils/googleDrive";

// Auto-capture: reads bank/UPI alert mails from Gmail into the review inbox
// (rendered as dotted ghost rows in the ledger). A manual paste box remains
// as a fallback / for SMS text.
const AutoCapturePanel = () => {
  const dispatch = useDispatch();
  const inbox = useSelector(
    (s) => s.transactions.transactionData?.autoReadInbox ?? [],
  );
  const enabled = useSelector(
    (s) => s.transactions.transactionData?.autoRead?.enabled ?? false,
  );
  const [text, setText] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("");

  async function parse() {
    const t = text.trim();
    if (!t) return;
    const res = await dispatch(persistQueueAlert(t));
    if (res?.ok) setText("");
  }

  async function syncNow() {
    setSyncing(true);
    setStatus("");
    let res = await dispatch(persistSyncGmail());
    if (res?.error === "gmail-scope") {
      try {
        await reconnectDrive();
        res = await dispatch(persistSyncGmail());
      } catch {
        res = { ok: false, error: "gmail-scope" };
      }
    }
    setSyncing(false);
    if (res?.ok) {
      setStatus(
        res.added
          ? `Captured ${res.added} new transaction${res.added === 1 ? "" : "s"}`
          : "No new transactions found",
      );
    } else if (res?.error === "gmail-scope") {
      setStatus("Gmail access wasn't granted.");
    } else {
      setStatus("Sync failed — try again.");
    }
  }

  return (
    <div className="autocapture">
      <p className="pref-section-hint">
        Reads bank / UPI alert emails from Gmail and drops each as a dotted row
        at the top of your Transactions ledger to review before it&apos;s added.
      </p>

      <div className="pref-row">
        <div className="pref-row-text">
          <p className="pref-row-label">Read from Gmail on open</p>
          <p className="pref-row-hint">
            Auto-syncs new alert mails each time you open the app.
          </p>
        </div>
        <button
          type="button"
          className={`pref-switch${enabled ? " pref-switch--on" : ""}`}
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle Gmail auto-read"
          onClick={() => dispatch(persistAutoReadEnabled(!enabled))}
        >
          <span className="pref-switch-thumb" />
        </button>
      </div>

      <button
        type="button"
        className="generic-button autocapture-parse"
        onClick={syncNow}
        disabled={syncing}
      >
        <i
          className={`fa-solid ${syncing ? "fa-spinner fa-spin" : "fa-rotate"}`}
        />
        {syncing ? "Syncing…" : "Sync from Gmail now"}
      </button>
      {status && <p className="autocapture-status">{status}</p>}

      <p className="pref-section-hint autocapture-or">or paste an alert manually</p>
      <textarea
        className="autocapture-input"
        rows="4"
        placeholder="Paste a bank alert (email or SMS) here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="generic-button autocapture-parse"
        onClick={parse}
        disabled={!text.trim()}
      >
        <i className="fa-solid fa-wand-magic-sparkles" /> Parse alert
      </button>

      {inbox.length > 0 && (
        <p className="autocapture-note">
          <i className="fa-solid fa-inbox" />
          {inbox.length} captured · review them as dotted rows at the top of
          your Transactions ledger.
        </p>
      )}
    </div>
  );
};

export default memo(AutoCapturePanel);
