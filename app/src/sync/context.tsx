// The sync engine for the screens (server sign-in only; the device-only app has none)
import { createContext, useContext, useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "./engine";

export const SyncContext = createContext<SyncEngine | null>(null);
export const useSync = () => useContext(SyncContext);

const none = () => () => {};
const noStatus = () => null;
/** Saved / saving / offline and how many changes wait on this device; null without the server */
export function useSyncStatus(): SyncStatus | null {
  const e = useSync();
  return useSyncExternalStore(e ? e.subscribe : none, e ? e.getStatus : noStatus);
}

/** This device's id for the server (so a change sent twice is saved once) */
export function deviceId(): string {
  const KEY = "wms.sync.device";
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) return cur;
    const id = `d-${Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("")}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch { return `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}
