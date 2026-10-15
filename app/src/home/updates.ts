// The home screen's update cards and activity ticker, worked out from the warehouse's own data (never canned text).
// Only what the person may see: other clients' orders, deliveries and stock are left out.
import { SLOTS, isFloor, productById } from "../data/catalog";
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

// ---------- Ticker ----------
export interface TickerLine { text: string; sign: "+" | "−" | "move" | "fact" }

const short = (store: string) => store.split(" – ")[0];
const cs = (n: number) => `${Math.abs(n).toLocaleString()} cs`;

/** Recent activity, newest first: stock movements, new and shipped orders, deliveries on the dock; then a few facts */
export function tickerLines(state: State, me: User, max = 24): TickerLine[] {
  const events: { at: string; line: TickerLine }[] = [];
  const add = (at: string | undefined, line: TickerLine) => { if (at) events.push({ at, line }); };
  const sees = (productId?: string) => { const p = productId ? productById(productId) : undefined; return !p || canSeeClient(me, p.client); };
  const name = (productId?: string) => (productId ? productById(productId)?.name ?? "" : "");
  const orders = new Map(state.orders.map(o => [o.id, o]));

  for (const m of state.movements ?? []) {
    if (!sees(m.productId)) continue;
    const n = m.cases ?? 0;
    switch (m.type) {
      case "putaway": case "receive": case "return-approved":
        if (n && m.location) add(m.at, { sign: "+", text: `+${cs(n)}  ${name(m.productId)} → ${m.location}` }); break;
      case "pick": {
        const o = m.orderId ? orders.get(m.orderId) : undefined;
        if (n) add(m.at, { sign: "−", text: `−${cs(n)}  ${m.orderId ?? ""}${o ? ` · ${short(o.store)}` : ""}` }); break;
      }
      case "pick-undo": if (n) add(m.at, { sign: "+", text: `+${cs(n)}  ${m.orderId ?? ""} · pick undone` }); break;
      case "move": if (m.from && m.location) add(m.at, { sign: "move", text: `${m.from} → ${m.location}${m.productId ? `  ${name(m.productId)}` : ""}` }); break;
      case "count-correction": case "adjustment":
        if (n) add(m.at, { sign: n > 0 ? "+" : "−", text: `${n > 0 ? "+" : "−"}${cs(n)}  ${name(m.productId)} · ${m.type === "adjustment" ? "adjusted" : "recount"}` }); break;
    }
  }
  for (const o of state.orders) {
    if (!canSeeClient(me, o.client)) continue;
    add(o.createdAt, { sign: "+", text: `+1 order  ${short(o.store)}` });
    add(o.shippedAt, { sign: "move", text: `${o.id} shipped · ${short(o.store)}` });
  }
  for (const s of state.shipments) {
    if (!canSeeClient(me, s.client) || !s.receivedAt) continue;
    const pallets = new Set(s.lines.map(l => l.pallet)).size;
    add(s.receivedAt, { sign: "+", text: `+${pallets} pallet${pallets === 1 ? "" : "s"}  ${s.client} ${s.number} on the dock` });
  }
  const recent = events.filter(e => e.at <= new Date().toISOString()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, max).map(e => e.line);

  // A few facts from the same data
  const facts: TickerLine[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const movedToday = (state.movements ?? []).filter(m => m.at.startsWith(today) && sees(m.productId)).reduce((a, m) => a + Math.abs(m.cases ?? 0), 0);
  if (movedToday) facts.push({ sign: "fact", text: `today's cases moved, stacked: ${Math.round(movedToday * 0.3).toLocaleString()} m tall` });
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const busy = new Map<string, number>();
  for (const m of state.movements ?? []) if (m.at >= week && m.location && sees(m.productId)) busy.set(m.location, (busy.get(m.location) ?? 0) + 1);
  const busiest = [...busy].sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] > 1) facts.push({ sign: "fact", text: `busiest spot this week: ${busiest[0]}` });
  const empty = SLOTS.filter(s => !state.stock[s.code]?.length).length;
  facts.push({ sign: "fact", text: `${SLOTS.length.toLocaleString()} slots · ${empty.toLocaleString()} free` });
  const floor = Object.entries(state.stock).filter(([c, l]) => isFloor(c) && l.length).length;
  if (floor) facts.push({ sign: "fact", text: `${floor} pallet${floor === 1 ? "" : "s"} on the floor` });

  // One fact after every few events
  const out: TickerLine[] = [];
  recent.forEach((l, i) => { out.push(l); if (i % 4 === 3 && facts.length) out.push(facts.shift()!); });
  return [...out, ...facts];
}
