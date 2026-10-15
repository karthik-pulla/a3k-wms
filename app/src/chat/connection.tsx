import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../store/store";

export interface Connection {
  online: boolean;
  /** Offline because of the developer switch rather than the network */
  simulated: boolean;
  /** Messages waiting for a connection */
  queued: number;
  /** When this device last had a connection */
  lastSyncedAt: string;
}

const Ctx = createContext<Connection>({ online: true, simulated: false, queued: 0, lastSyncedAt: new Date().toISOString() });

/** Network state for the whole app: the browser's own online flag plus the "Simulate offline" developer switch. */
export function ConnectionProvider({ simulateOffline, children }: { simulateOffline: boolean; children: ReactNode }) {
  const { state } = useStore();
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setBrowserOnline(true), off = () => setBrowserOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const online = browserOnline && !simulateOffline;
  // The moment the connection dropped is the last time this device synced
  const [lastSyncedAt, setLastSyncedAt] = useState(() => new Date().toISOString());
  useEffect(() => { if (!online) setLastSyncedAt(new Date().toISOString()); }, [online]);
  const queued = state.chat.messages.filter(m => m.status === "queued").length;
  const simulated = browserOnline && simulateOffline;
  const value = useMemo(() => ({ online, simulated, queued, lastSyncedAt }), [online, simulated, queued, lastSyncedAt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useConnection = () => useContext(Ctx);
