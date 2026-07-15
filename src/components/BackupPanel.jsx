import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Modal from "../preStyledElements/modal/Modal";
import {
  persistDailyBackup,
  persistRestoreFromBackup,
  listBackups,
} from "../redux/slices/transactionSlice";
import { showToast } from "../redux/slices/toastSlice";

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BackupPanel() {
  const dispatch = useDispatch();
  const lastBackup = useSelector(
    (s) => s.transactions.transactionData?.preferences?.driveBackup ?? null,
  );

  const [backups, setBackups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBackups(await listBackups());
    } catch {
      setBackups([]);
      dispatch(showToast({ message: "Couldn't list backups", type: "error" }));
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  const backupNow = async () => {
    setBackingUp(true);
    try {
      const ok = await dispatch(persistDailyBackup({ force: true }));
      dispatch(
        showToast({
          message: ok ? "Backup saved to Drive" : "Backup failed",
          type: ok ? "success" : "error",
        }),
      );
      if (ok) await load();
    } finally {
      setBackingUp(false);
    }
  };

  const doRestore = async () => {
    if (!confirmTarget) return;
    setRestoring(true);
    try {
      await dispatch(persistRestoreFromBackup(confirmTarget.id));
    } catch (e) {
      setRestoring(false);
      setConfirmTarget(null);
      dispatch(
        showToast({
          message: e?.message
            ? `Restore failed: ${e.message}`
            : "Restore failed",
          type: "error",
        }),
      );
    }
  };

  return (
    <div className="backup-panel">
      <p className="backup-status">
        {lastBackup?.at
          ? `Last backup: ${formatWhen(lastBackup.at)}`
          : "No backup yet."}
      </p>
      <p className="backup-hint">
        A full copy of your data is saved to your Google Drive once a day. Only
        the latest backup is kept.
      </p>

      <button className="generic-button" onClick={backupNow} disabled={backingUp}>
        {backingUp ? "Backing up…" : "Back up now"}
      </button>

      <div className="backup-list">
        {loading && <p className="backup-hint">Loading backups…</p>}
        {!loading && backups?.length === 0 && (
          <p className="backup-hint">No backups found in Drive.</p>
        )}
        {!loading &&
          backups?.map((b) => (
            <div key={b.id} className="backup-row">
              <div className="backup-row-info">
                <span className="backup-row-name">{b.name}</span>
                <span className="backup-row-when">
                  {formatWhen(b.modifiedTime)}
                </span>
              </div>
              <button
                className="generic-button backup-danger"
                onClick={() => setConfirmTarget(b)}
              >
                Restore
              </button>
            </div>
          ))}
      </div>

      <Modal
        open={!!confirmTarget}
        onClose={() => (restoring ? null : setConfirmTarget(null))}
        title="Restore from backup?"
      >
        <div className="backup-confirm">
          <p>
            This restores everything from the backup
            {confirmTarget
              ? ` taken ${formatWhen(confirmTarget.modifiedTime)}`
              : ""}
            . Anything missing or changed is brought back; data you&apos;ve added
            since won&apos;t be deleted. The app will reload.
          </p>
          <div className="backup-confirm-actions">
            <button
              className="generic-button"
              onClick={() => setConfirmTarget(null)}
              disabled={restoring}
            >
              Cancel
            </button>
            <button
              className="generic-button backup-danger"
              onClick={doRestore}
              disabled={restoring}
            >
              {restoring ? "Restoring…" : "Restore & reload"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
