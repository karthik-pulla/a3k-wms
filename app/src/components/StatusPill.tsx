import { useConnection } from "../chat/connection";
import { useStore } from "../store/store";
import { useSyncStatus } from "../sync/context";

/** Save status. Online: changes are saved to the server; offline: they're kept on this device and sync later. */
export function StatusPill() {
  const { online, simulated, queued } = useConnection();
  const { state } = useStore();
  const sync = useSyncStatus();
  // With the server: saving while changes wait to be saved; offline, they wait on this device
  const sending = online && (sync ? sync.state === "saving" : state.chat.messages.some(m => m.status === "sent"));
  const what = sync ? `change${queued > 1 ? "s" : ""}` : `message${queued > 1 ? "s" : ""}`;
  const label = online
    ? sending ? (sync ? "Saving…" : "Sending…") : "All changes saved"
    : `Offline${simulated ? " (simulated)" : ""} · ${queued ? `${queued} ${what} waiting` : "changes will sync"}`;
  return (
    <div className={`status glass${online ? (sending ? " sending" : "") : " offline"}`} role="status" aria-live="polite" title={label}>
      <span className="dot" aria-hidden="true" />
      <span className="label">{label}</span>
      {!online && queued > 0 && <span className="status-n" aria-hidden="true">{queued}</span>}
    </div>
  );
}
