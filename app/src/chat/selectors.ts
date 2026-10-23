import { locKind, productById } from "../data/catalog";
import { tenant } from "../tenant";
import { canSeeClient } from "../auth/permissions";
import type { Conversation, Message, State, StockLine, User } from "../store/types";

// ---------- Stock as chat sees it ----------
const thisMonth = () => new Date().toISOString().slice(0, 7);
/** Best-before months within the warehouse's warning time (tenant config: expiry.warnMonths) are "expiring" */
export const WARN_MONTHS = tenant().config.expiry.warnMonths;
const warnUntil = () => { const d = new Date(); d.setMonth(d.getMonth() + WARN_MONTHS); return d.toISOString().slice(0, 7); };
export type ExpiryTone = "ok" | "warn" | "expired";
export const expiryTone = (bb?: string): ExpiryTone => (!bb ? "ok" : bb < thisMonth() ? "expired" : bb <= warnUntil() ? "warn" : "ok");

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * When the stock arrived, for FIFO. Stock put away through In-bounds uses its delivery's arrival date.
 * SAMPLE: the 27 Sep sheet stock has no arrival dates, so it gets a made-up one (stable per slot and product).
 */
export function arrivalDate(state: State, code: string, line: StockLine): string {
  if (line.arrived) return line.arrived;
  if (line.shipmentId) {
    const s = state.shipments.find(x => x.id === line.shipmentId);
    const at = s?.receivedAt ?? s?.confirmedAt;
    if (at) return at.slice(0, 10);
  }
  const daysAgo = 20 + (hash(code + line.productId) % 220);
  return new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
}

export interface ProductLocation {
  code: string;
  line: StockLine;
  arrival: string;
  mixed: boolean;
  partial: boolean;
  tone: ExpiryTone;
}

/** Every location holding a product (mixed pallets included), oldest arrival first. */
export function productLocations(state: State, productId: string): ProductLocation[] {
  const p = productById(productId);
  const out: ProductLocation[] = [];
  for (const [code, lines] of Object.entries(state.stock)) {
    for (const line of lines) {
      if (line.productId !== productId) continue;
      out.push({
        code, line, arrival: arrivalDate(state, code, line), mixed: lines.length > 1,
        partial: !!p?.perPallet && line.cases < p.perPallet, tone: expiryTone(line.bestBefore),
      });
    }
  }
  return out.sort((a, b) => a.arrival.localeCompare(b.arrival) || a.code.localeCompare(b.code));
}

export const isPartial = (line: StockLine) => { const p = productById(line.productId); return !!p?.perPallet && line.cases < p.perPallet; };
export const locationKind = (code: string) => locKind(code);

// ---------- Conversations, unread and mentions ----------
/** The conversations someone is in (deleted group chats drop out) */
export const conversationsFor = (state: State, me: User) => state.chat.conversations.filter(c => c.members.includes(me.id) && !c.deletedAt);

/** The direct conversation between two people that both are still in */
export const dmBetween = (state: State, a: string, b: string) => state.chat.conversations.find(c => c.kind === "dm" && c.members.includes(a) && c.members.includes(b));

/** The people directory: everyone in the warehouse, matching every word typed (name, role, groups) */
export function searchPeople(users: User[], q: string): User[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return users.filter(u => words.every(w => `${u.name} ${u.roleName ?? ""} ${u.role} ${u.groups.join(" ")}`.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function lastMessage(state: State, convId: string): Message | undefined {
  for (let i = state.chat.messages.length - 1; i >= 0; i--) if (state.chat.messages[i].conversationId === convId) return state.chat.messages[i];
  return undefined;
}

export const isMentioned = (m: Message, me: User) => m.authorId !== me.id && m.refs.some(r => (r.type === "user" && r.userId === me.id) || (r.type === "group" && me.groups.includes(r.group)));

export function unreadIn(state: State, me: User, convId: string): { count: number; mentions: number } {
  const seen = state.chat.reads[me.id]?.[convId] ?? "";
  let count = 0, mentions = 0;
  for (const m of state.chat.messages) {
    if (m.conversationId !== convId || m.authorId === me.id || m.createdAt <= seen) continue;
    count++;
    if (isMentioned(m, me)) mentions++;
  }
  return { count, mentions };
}

export function unreadTotals(state: State, me: User) {
  let count = 0, mentions = 0;
  for (const c of conversationsFor(state, me)) { const u = unreadIn(state, me, c.id); count += u.count; mentions += u.mentions; }
  return { count, mentions };
}

/** Mentions of this person or their groups, newest first, in conversations they belong to. */
export function mentionsFor(state: State, me: User) {
  const mine = new Set(conversationsFor(state, me).map(c => c.id));
  return state.chat.messages
    .filter(m => mine.has(m.conversationId) && isMentioned(m, me))
    .map(m => ({ message: m, unread: m.createdAt > (state.chat.reads[me.id]?.[m.conversationId] ?? "") }))
    .reverse();
}

export function conversationTitle(c: Conversation, me: User, users: User[]): string {
  if (c.kind !== "dm") return c.title;
  const other = c.members.find(id => id !== me.id);
  return users.find(u => u.id === other)?.name ?? c.title;
}

/** Messages that mention or belong to a record (delivery, order, product or slot) — for "Messages about this". */
export function messagesAbout(state: State, me: User, target: { shipment?: string; order?: string; product?: string; slot?: string }) {
  const mine = new Set(conversationsFor(state, me).map(c => c.id));
  const thread = state.chat.conversations.find(c => (target.shipment && c.link?.type === "shipment" && c.link.id === target.shipment) || (target.order && c.link?.type === "order" && c.link.id === target.order));
  return state.chat.messages.filter(m => mine.has(m.conversationId) && (m.conversationId === thread?.id || m.refs.some(r =>
    (target.shipment && r.type === "shipment" && r.shipmentId === target.shipment) ||
    (target.order && r.type === "order" && r.orderId === target.order) ||
    (target.product && r.type === "product" && r.productId === target.product) ||
    (target.slot && r.type === "slot" && r.code === target.slot))));
}

/** Message text with references the viewer may not see replaced (for previews and search, which can't show chips). */
export function visibleText(state: State, me: User, m: Message, placeholder = "…"): string {
  let out = "", at = 0;
  for (const r of [...m.refs].sort((a, b) => a.start - b.start)) {
    const client = r.type === "product" ? productById(r.productId)?.client
      : r.type === "shipment" ? state.shipments.find(s => s.id === r.shipmentId)?.client
      : r.type === "order" ? state.orders.find(o => o.id === r.orderId)?.client : undefined;
    if (client && !canSeeClient(me, client)) { out += m.text.slice(at, r.start) + placeholder; at = r.end; }
  }
  return out + m.text.slice(at);
}
