import { useCallback, useEffect, useState } from "react";
import type { UpdateKind } from "./home/updates";
import type { LastOnlineVisibility } from "./auth/permissions";
import type { Role } from "./store/types";

export type ThemeChoice = "system" | "light" | "dark";
export type GlassStrength = "subtle" | "frosted" | "heavy";
/** Widgets on the home screen, in order. "messages" is the Messages module, "stockByBrand" the live stock table. */
export type HomeCardKind = UpdateKind | "messages" | "stockByBrand";

export interface HomeSettings {
  /** Admin account only, for testing: use the app as this person ("" = yourself) */
  userId: string;
  /** Admin account only, for testing: use the app with this role, as yourself ("" = your own role) */
  testRole: Role | "";
  theme: ThemeChoice;
  glass: GlassStrength;
  movingBackground: boolean;
  /** 2 once the phone default for movingBackground applies (see load) */
  motionDefaults?: number;
  showSummary: boolean;
  /** Home widgets in display order; `visible` controls whether each shows. A new home starts with none: people pick them in the tour. */
  cards: { kind: HomeCardKind; visible: boolean }[];
  /** People (ids) on this device who have finished or skipped the tour; the others see it when they sign in */
  toured: string[];
  /** Workers' Work screen: show the Messages panel */
  workMessages: boolean;
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

const media = (q: string) => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;

export const DEFAULT_SETTINGS: HomeSettings = {
  userId: "",
  testRole: "",
  theme: "system",
  glass: "frosted",
  // Off if the OS asks for less motion, and on phones and tablets: moving colour behind frosted glass makes them slow
  movingBackground: !media("(prefers-reduced-motion: reduce)") && !media("(pointer: coarse)"),
  motionDefaults: 2,
  showSummary: false,
  cards: [
    { kind: "messages", visible: false },
    { kind: "outgoing", visible: false },
    { kind: "deadlines", visible: false },
    { kind: "ordersToApprove", visible: false },
    { kind: "incoming", visible: false },
    { kind: "toConfirm", visible: false },
    { kind: "expiry", visible: false },
    { kind: "returns", visible: false },
    { kind: "changesToApprove", visible: false },
    { kind: "stockByBrand", visible: false },
  ],
  toured: [],
  workMessages: true,
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
    const saved = JSON.parse(raw) as Partial<HomeSettings> & { role?: string; name?: string; showTicker?: boolean };
    delete saved.role; delete saved.name; // replaced by "Signed in as"
    delete saved.showTicker; // the activity ticker was removed (Oct 2026)
    // Saved before phones defaulted to a still background (the old default was saved, not chosen): use the new default
    if (saved.motionDefaults !== 2) saved.movingBackground = DEFAULT_SETTINGS.movingBackground && saved.movingBackground !== false;
    if ((saved.lastOnlineVisibleTo as string) === "owners-supervisors") saved.lastOnlineVisibleTo = "owners-coordinators"; // role renamed
    // Keep any widget kinds added since the settings were saved (at the end, hidden)
    const known = new Set((saved.cards ?? []).map(c => c.kind));
    const cards = [...(saved.cards ?? []).filter(c => DEFAULT_SETTINGS.cards.some(d => d.kind === c.kind)),
      ...DEFAULT_SETTINGS.cards.filter(c => !known.has(c.kind))];
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
  const reset = useCallback(() => setSettings(s => ({ ...DEFAULT_SETTINGS, userId: s.userId, testRole: s.testRole, toured: s.toured })), []);
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
