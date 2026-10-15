/**
 * Opens the page again at a new address so the browser fetches the latest version. Used when a screen's file is
 * missing because the app was updated while it was open. Once per minute at most (shared with public/theme.js).
 */
export function freshLoad(): boolean {
  try {
    const last = Number(sessionStorage.getItem("wms.freshLoad") || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem("wms.freshLoad", String(Date.now()));
  } catch { return false; }
  location.replace(`${location.pathname}?v=${Date.now()}${location.hash}`);
  return true;
}

/** A screen's file couldn't be downloaded (an update replaced it, or the connection dropped) */
export const isLoadError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload/i.test(e.message);

/** DEMO only: forget everything this app saved on this device (sample data, accounts, settings) and start again */
export async function startOver() {
  try { Object.keys(localStorage).filter(k => k.startsWith("wms.")).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }
  try { indexedDB.deleteDatabase("wms-auth"); } catch { /* ignore */ }
  location.replace(location.pathname);
}
export const isDemo = import.meta.env.VITE_WMS_DEMO === "1";
