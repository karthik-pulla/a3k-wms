// Announcements from the owners (Manage warehouse → Warehouse), shown on the home and Work screens until their date.
import type { Announcement, State } from "./types";

const today = () => new Date().toISOString().slice(0, 10);
/** Still showing: no end date, or not past it; urgent first, then newest */
export const activeNotices = (state: Pick<State, "notices">): Announcement[] =>
  (state.notices ?? []).filter(n => !n.until || n.until >= today()).sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || b.at.localeCompare(a.at));
let seq = 0;
export const noticeId = () => `N${Date.now().toString(36)}${(++seq).toString(36)}`;
