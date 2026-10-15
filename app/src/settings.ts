import { useCallback, useEffect, useState } from "react";
import type { UpdateKind } from "./data/sampleUpdates";
import type { LastOnlineVisibility } from "./auth/permissions";
import type { Role } from "./store/types";

export type ThemeChoice = "system" | "light" | "dark";
export type GlassStrength = "subtle" | "frosted" | "heavy";
/** Cards on the home screen, in order. "messages" is the Messages module. */
export type HomeCardKind = UpdateKind | "messages";

export interface HomeSettings {
  /** Admin account only, for testing: use the app as this person ("" = yourself) */
  userId: string;
  /** Admin account only, for testing: use the app with this role, as yourself ("" = your own role) */
  testRole: Role | "";
  theme: ThemeChoice;
  glass: GlassStrength;
  movingBackground: boolean;
  showSummary: boolean;
  showTicker: boolean;
  /** Home cards in display order; `visible` controls whether each shows on the home screen. */
  cards: { kind: HomeCardKind; visible: boolean }[];
  // Messages
  lastOnlineVisibleTo: LastOnlineVisibility;
  hidePresenceOffShift: boolean;
  shiftStart: string;
  shiftEnd: string;
  /** Urgent mentions still unread after this many minutes are marked to escalate */
  escalateMinutes: number;
  /** "On break" clears itself after this many minutes */
  breakMinutes: number;
  /** Developer switch: behave as if there were no connection */
  simulateOffline: boolean;
}

export const DEFAULT_SETTINGS: HomeSettings = {
  userId: "",
  testRole: "",
  theme: "system",
  glass: "frosted",
  movingBackground: !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  showSummary: true,
  showTicker: true,
  cards: [
    { kind: "messages", visible: true },
    { kind: "outgoing", visible: true },
    { kind: "deadlines", visible: true },
    { kind: "ordersToApprove", visible: true },
    { kind: "incoming", visible: true },
    { kind: "toConfirm", visible: true },
    { kind: "expiry", visible: true },
    { kind: "returns", visible: true },
    { kind: "changesToApprove", visible: true },
  ],
  lastOnlineVisibleTo: "owners-coordinators",
  hidePresenceOffShift: false,
  shiftStart: "07:00",
  shiftEnd: "19:00",
  escalateMinutes: 15,
  breakMinutes: 30,
  simulateOffline: false,
};

// Per-device for now; moves to the user's account once sign-in exists.
const KEY = "wms.home.settings.v1";

function load(): HomeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<HomeSettings> & { role?: string; name?: string };
    delete saved.role; delete saved.name; // replaced by "Signed in as"
    if (saved.userId === "karthik") saved.userId = ""; // the old default, from before sign-in existed
    if ((saved.lastOnlineVisibleTo as string) === "owners-supervisors") saved.lastOnlineVisibleTo = "owners-coordinators"; // role renamed
    // Keep any card kinds added since the settings were saved (new ones go first, like the defaults)
    const known = new Set((saved.cards ?? []).map(c => c.kind));
    const cards = [...DEFAULT_SETTINGS.cards.filter(c => !known.has(c.kind)),
      ...(saved.cards ?? []).filter(c => DEFAULT_SETTINGS.cards.some(d => d.kind === c.kind))];
    return { ...DEFAULT_SETTINGS, ...saved, cards };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<HomeSettings>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked: settings last for this visit */ }
  }, [settings]);
  const update = useCallback((patch: Partial<HomeSettings>) => setSettings(s => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings(s => ({ ...DEFAULT_SETTINGS, userId: s.userId, testRole: s.testRole })), []);
  return { settings, update, reset };
}

/** Applies the theme and glass strength to <html>, following the system theme when asked. */
export function useAppearance(theme: ThemeChoice, glass: GlassStrength) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      try { localStorage.setItem("wms.theme", resolved); } catch { /* ignore */ }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => { document.documentElement.dataset.glass = glass; }, [glass]);
}
