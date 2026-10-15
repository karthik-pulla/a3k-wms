import { useConnection } from "../chat/connection";
import { useStore } from "../store/store";

/** Save status. Online: changes are saved to the server; offline: they're kept on this device and sync later. */
export function StatusPill() {
  const { online, simulated, queued } = useConnection();
  const { state } = useStore();
  const sending = online && state.chat.messages.some(m => m.status === "sent");
  const label = online
    ? sending ? "Sending…" : "All changes saved"
    : `Offline${simulated ? " (simulated)" : ""} · ${queued ? `${queued} message${queued > 1 ? "s" : ""} waiting` : "changes will sync"}`;
  return (
    <div className={`status glass${online ? (sending ? " sending" : "") : " offline"}`} role="status" aria-live="polite" title={label}>
      <span className="dot" aria-hidden="true" />
      <span className="label">{label}</span>
      {!online && queued > 0 && <span className="status-n" aria-hidden="true">{queued}</span>}
    </div>
  );
}
