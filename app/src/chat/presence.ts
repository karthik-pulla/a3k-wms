import { can } from "../auth/permissions";
import type { HomeSettings } from "../settings";
import type { ManualStatus, Presence, User } from "../store/types";

/** Rough time only: "just now", "about 20 min ago", "2h ago", "yesterday", "Oct 3". Never to the second. */
export function roughAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const mins = (now - t) / 6e4;
  if (mins < 3) return "just now";
  if (mins < 60) return `about ${Math.max(5, Math.round(mins / 5) * 5)} min ago`;
  const d = new Date(t), today = new Date(now);
  const yest = new Date(now - 864e5);
  if (d.toDateString() === today.toDateString()) return `${Math.round(mins / 60)}h ago`;
  if (d.toDateString() === yest.toDateString()) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function manualLabel(m?: ManualStatus): string | null {
  if (!m) return null;
  if (m.kind === "forklift") return "On forklift";
  if (m.kind === "break") return `On break until ${hhmm(m.until)}`;
  if (m.kind === "receiving") return `Receiving at Door ${m.door}`;
  return "Off today";
}

export function outsideShift(s: HomeSettings, now = new Date()): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = s.shiftStart.split(":").map(Number), [eh, em] = s.shiftEnd.split(":").map(Number);
  return mins < sh * 60 + sm || mins >= eh * 60 + em;
}

export type PresenceDot = PresenceView["dot"];
export interface PresenceView {
  dot: "online" | "away" | "syncing" | "offline" | "hidden";
  /** Short label for lists: "Online", "Away", "Offline · syncing later", "Offline" */
  label: string;
  /** Extra detail the viewer is allowed to see: "last online 2h ago", "last synced 10:42", manual status */
  detail: string | null;
}

/** How one person's presence looks to the viewer, applying the visibility settings and role rules. */
export function presenceView(viewer: User, p: Presence | undefined, s: HomeSettings): PresenceView {
  if (!p) return { dot: "offline", label: "Offline", detail: null };
  if (s.hidePresenceOffShift && outsideShift(s) && viewer.id !== p.userId) return { dot: "hidden", label: "Off shift", detail: null };
  const exact = viewer.id === p.userId || can(viewer, "view-last-online", { lastOnline: s.lastOnlineVisibleTo });
  const manual = manualLabel(p.manual);
  switch (p.state) {
    case "online": return { dot: "online", label: "Online", detail: manual };
    case "away": return { dot: "away", label: "Away", detail: manual ?? (exact ? `active ${roughAgo(p.lastSeenAt)}` : null) };
    case "syncing": return { dot: "syncing", label: "Offline · syncing later", detail: [manual, exact && p.lastSyncedAt ? `last synced ${hhmm(p.lastSyncedAt)}` : null].filter(Boolean).join(" · ") || null };
    default: return { dot: "offline", label: "Offline", detail: [manual, exact ? `last online ${roughAgo(p.lastSeenAt)}` : null].filter(Boolean).join(" · ") || null };
  }
}

const ORDER = { online: 0, away: 1, syncing: 2, offline: 3, hidden: 4 };
/** Online people first, then away, syncing, offline. */
export const byPresence = (viewer: User, s: HomeSettings, presence: Record<string, Presence>) =>
  (a: User, b: User) => ORDER[presenceView(viewer, presence[a.id], s).dot] - ORDER[presenceView(viewer, presence[b.id], s).dot] || a.name.localeCompare(b.name);
