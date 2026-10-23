// SAMPLE DATA a new vault starts with, from the warehouse's seed.json (tenant/types.ts, `Seed`): made-up deliveries,
// orders, returns, emails and tasks for testing and the demo. A warehouse without a seed starts empty.
// Stock comes from the warehouse's stock.json if it has one (A3K: the 27 Sep stock sheets, on this computer only),
// otherwise made-up stock (demoStock.ts).
import { demoStock } from "./demoStock";
import { findProduct, locKind, type Client } from "../data/catalog";
import { tenant } from "../tenant";
import type { Seed } from "../tenant/types";
import type { InboxMail, Shipment, State, StockLine, StoreOrder, ReturnRequest } from "./types";
import { planOrder, takeFrom } from "../outbound/plan";
import { nextSlot } from "./tasks";
import { emptyChat, sampleChat } from "../chat/sampleChat";

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const month = (offsetMonths: number) => { const d = new Date(); d.setMonth(d.getMonth() + offsetMonths); return d.toISOString().slice(0, 7); };
const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();

/** The seed's product: by code within a client */
const pid = (client: Client, code: string) => {
  const p = findProduct(client, code);
  if (!p) throw new Error(`Sample product ${client} ${code} not found`);
  return p.id;
};
/** "@pdf" → the seed's text called pdf; "{date:+4}" → the date 4 days from today */
const text = (seed: Seed, s: string) => (s.startsWith("@") ? seed.texts?.[s.slice(1)] ?? "" : s).replace(/\{date:([+-]?\d+)\}/g, (_, n: string) => iso(Number(n)));

export function sampleState(): State {
  const seed = tenant().seed;
  const stock = withSampleDates(tenant().stock ?? demoStock().stock);
  if (!seed) return { ...emptyState(), stock };
  let k = 0;
  const key = () => `l${++k}`;

  const shipments: Shipment[] = seed.shipments.map(s => ({
    id: s.id, client: s.client, number: s.number, supplier: s.supplier, ref: s.ref, expected: iso(s.expected), status: s.status,
    ...(s.received ? { receivedAt: ago(s.received.hoursAgo), receivedBy: s.received.by, condition: s.received.condition } : {}),
    lines: s.lines.map(([code, cases, pallet, lot, bb, damaged]) => ({ key: key(), productId: pid(s.client, code), cases, pallet, lot, bestBefore: month(bb), ...(damaged ? { damaged } : {}) })),
  }));
  const orders: StoreOrder[] = seed.orders.map(o => ({
    id: o.id, store: o.store, client: o.client, date: iso(o.date), due: iso(o.due), source: o.source, status: o.status,
    lines: o.lines.map(([code, cases]) => ({ productId: pid(o.client, code), cases })),
    ...(o.created ? { createdBy: o.created.by, createdAt: ago(o.created.hoursAgo) } : {}),
    ...(o.approved ? { approvedBy: o.approved.by, approvedAt: ago(o.approved.hoursAgo) } : {}),
    ...(o.shipped ? { shippedBy: o.shipped.by, shippedAt: ago(o.shipped.hoursAgo) } : {}),
    ...(o.ref ? { ref: o.ref } : {}), ...(o.sourceName ? { sourceName: o.sourceName } : {}), ...(o.sourceText ? { sourceText: text(seed, o.sourceText) } : {}),
  }));
  const returns: ReturnRequest[] = seed.returns.map(r => {
    const client = seed.orders.find(o => o.id === r.orderId)?.client ?? seed.orders[0]?.client;
    return { id: r.id, orderId: r.orderId, store: r.store, status: "pending", reason: r.reason, photos: [], notes: r.notes, createdAt: ago(r.created.hoursAgo), createdBy: r.created.by,
      items: r.items.map(([code, cases]) => ({ key: key(), productId: pid(client, code), cases })) };
  });
  const inbox: InboxMail[] = seed.inbox.map(m => ({
    id: m.id, sample: true, from: m.from, subject: m.subject, receivedAt: ago(m.hoursAgo), body: text(seed, m.body), status: m.status,
    attachments: m.attachments.map(a => ({ name: a.name, text: text(seed, a.text) })), ...(m.orderId ? { orderId: m.orderId } : {}),
  }));

  let next = withOutbound({ ...emptyState(), shipments, orders, returns, inbox, stock });
  // Orders being picked: the first pallet on each list is done
  for (const o of seed.orders.filter(x => x.picking)) {
    const order = next.orders.find(x => x.id === o.id);
    const first = order?.picks?.find(p => !p.picked);
    if (!order || !first) continue;
    const { lines, taken } = takeFrom(next.stock[first.location] ?? [], first.productId, first.cases, next, first.location);
    const stockNow = { ...next.stock };
    if (lines.length) stockNow[first.location] = lines; else delete stockNow[first.location];
    const picked = { cases: taken.reduce((a, l) => a + l.cases, 0), by: o.picking!.by, at: ago(o.picking!.hoursAgo), taken };
    next = { ...next, stock: stockNow, orders: next.orders.map(x => (x.id === o.id ? { ...x, status: "picking", picks: x.picks!.map(p => (p.key === first.key ? { ...p, picked } : p)) } : x)) };
  }
  // The warehouse's own settings, announcements and work teams (Manage warehouse, Tasks → Teams)
  const settings = seed.settings ? {
    routes: (seed.settings.routes ?? []).map((r, i) => ({ id: `R${i + 1}`, ...r })),
    contacts: (seed.settings.contacts ?? []).map((c, i) => ({ id: `C${i + 1}`, ...c })),
  } : undefined;
  const notices = (seed.notices ?? []).map((n, i) => ({ id: `N${i + 1}`, text: n.text, by: n.by, at: ago(n.hoursAgo), ...(n.urgent ? { urgent: true } : {}) }));
  const teams = (seed.teams ?? []).map((t, i) => ({ id: `T${i + 1}`, name: t.name, members: t.members, createdBy: t.by, createdAt: ago(48) }));
  // Orders first, so every sample order (and delivery) gets its message thread
  return { ...next, settings, notices, teams, chat: sampleChat(next) };
}

/** A warehouse with nothing in it yet: the team channel and nothing else. (No tasks field: the store adds the sample tasks.) */
export function emptyState(): State {
  return { version: 1, shipments: [], orders: [], returns: [], movements: [], seq: 2, stock: {}, counts: [], inbox: [], chat: emptyChat() } as unknown as State;
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/**
 * SAMPLE: stock sheets have no lot numbers or best-before dates, so sample stock gets made-up ones
 * (stable per slot and product) to test expiry and FIFO screens. Lines that already have them keep theirs.
 */
export function withSampleDates(stock: Record<string, StockLine[]>): Record<string, StockLine[]> {
  const out: Record<string, StockLine[]> = {};
  for (const [code, lines] of Object.entries(stock)) {
    out[code] = lines.map(l => {
      if (l.bestBefore || l.shipmentId) return l;
      const h = hash(code + l.productId);
      return { ...l, bestBefore: month((h % 34) - 3), lot: l.lot ?? `S-${(h % 9000) + 1000}` };
    });
  }
  return out;
}

/**
 * Orders get a status (draft if none) and approved ones a picking plan; there is an inbox.
 * Also used once on data saved before Out-bounds existed.
 */
export function withOutbound(state: State): State {
  let next: State = { ...state, orders: state.orders.map(o => ({ ...o, status: o.status ?? "draft" })), inbox: state.inbox ?? [] };
  // Plan the approved ones (oldest stock first, open pallets first)
  for (const o of next.orders) {
    if (o.status !== "approved" || o.picks) continue;
    const plan = planOrder(next, o, "fifo-open-first");
    next = { ...next, orders: next.orders.map(x => (x.id === o.id ? { ...x, strategy: "fifo-open-first", picks: plan.picks, short: plan.short } : x)) };
  }
  return next;
}

/** SAMPLE: a few pallet tasks and packing assignments, so the Work and Tasks screens have something to show */
export function withSampleWork(state: State): State {
  const seed = tenant().seed;
  if (!seed?.tasks) return { ...state, tasks: state.tasks ?? [] };
  const { createdBy, assignee } = seed.tasks;
  const floor = Object.keys(state.stock).filter(c => locKind(c) === "floor" && state.stock[c].length).slice(0, 2);
  const tasks = floor.map((from, i) => {
    const to = nextSlot({ ...state, tasks: [] } as State, from);
    return { id: `T-sample-${i + 1}`, kind: "move" as const, status: "open" as const, from, to, lines: state.stock[from], reason: i === 0 ? "Floor pallet into the rack" : "Clearing the aisle",
      assignee: i === 0 ? assignee : undefined, createdBy, createdAt: ago(1 + i) };
  });
  // two tasks can't get the same slot
  if (tasks.length === 2 && tasks[0].to === tasks[1].to) tasks[1].to = nextSlot({ ...state, tasks: [tasks[0]] } as State, tasks[1].from);
  const packers = new Map(seed.orders.filter(o => o.assignee).map(o => [o.id, o.assignee!]));
  return { ...state, tasks, orders: state.orders.map(o => (packers.has(o.id) && !o.assignee ? { ...o, assignee: packers.get(o.id) } : o)) };
}
