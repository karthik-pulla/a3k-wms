// The home screen's update cards, worked out from the warehouse's own data (never canned text).
// Only what the person may see: other clients' orders, deliveries and stock are left out.
import { productById } from "../data/catalog";
import { canSeeClient } from "../auth/permissions";
import { differences } from "../inventory/count";
import type { State, User } from "../store/types";

export type UpdateKind =
  | "outgoing"
  | "deadlines"
  | "ordersToApprove"
  | "incoming"
  | "toConfirm"
  | "expiry"
  | "returns"
  | "changesToApprove";

/** The cards in their default order */
export const UPDATE_KINDS: UpdateKind[] = ["outgoing", "deadlines", "ordersToApprove", "incoming", "toConfirm", "expiry", "returns", "changesToApprove"];

export type Tone = "ok" | "warn" | "danger" | "expired";

export interface UpdateItem {
  id: string;
  what: string;
  detail?: string;
  meta: string;
  tone?: Tone;
  /** Where the item opens; defaults to the card's mode */
  href?: string;
}

export interface UpdateGroup {
  kind: UpdateKind;
  title: string;
  subtitle: string;
  /** Total waiting in this group; may be more than the items listed. */
  count: number;
  tone?: Tone;
  items: UpdateItem[];
  mode: "inbounds" | "inventory" | "outbounds";
}

const agoText = (at: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 6e4));
  return m < 60 ? `${m} min ago` : m < 60 * 24 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Counts waiting for an owner: the differences still to decide (correct the stock or keep it) */
export function changesToApprove(state: State, me: User): UpdateGroup {
  const items: UpdateItem[] = [];
  let count = 0;
  for (const c of state.counts.filter(x => x.status === "review")) {
    const open = differences(c, state.stock).diffs.filter(d => !c.decided?.[d.code] && d.changes.some(ch => { const p = productById(ch.productId); return !p || canSeeClient(me, p.client); }));
    if (!open.length) continue;
    count += open.length;
    items.push({ id: c.id, what: c.name, detail: `${open.length} difference${open.length === 1 ? "" : "s"} to decide`, meta: agoText(c.startedAt), href: `#/inventory/count/${c.id}/review` });
  }
  return { kind: "changesToApprove", mode: "inventory", title: "Changes to approve", subtitle: "Count differences waiting for an owner", count, tone: count ? "warn" : undefined, items };
}
