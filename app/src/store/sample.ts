// SAMPLE DATA for testing on localhost. Stock comes from the 27 Sep stock sheets (moved onto the new codes);
// shipments, orders and returns are made up, using real client, store and product names.
// The sheet stock is real business data, so it stays out of git and out of the demo build (VITE_WMS_DEMO=1,
// see vite.config.ts); without it the made-up demo stock is used.
import { demoStock } from "./demoStock";
import { findProduct, type Client } from "../data/catalog";
import type { InboxMail, Shipment, ShipmentLine, State, StockLine, StoreOrder, ReturnRequest } from "./types";
import { planOrder, takeFrom } from "../outbound/plan";
import { nextSlot } from "./tasks";
import { sampleChat } from "../chat/sampleChat";

const sheets = import.meta.glob<{ stock: Record<string, StockLine[]> } | null>("../data/generated/sampleStock.json", { eager: true, import: "default" });
const sheetStock = () => Object.values(sheets)[0]?.stock ?? demoStock().stock;

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const month = (offsetMonths: number) => { const d = new Date(); d.setMonth(d.getMonth() + offsetMonths); return d.toISOString().slice(0, 7); };
let k = 0;
const key = () => `l${++k}`;
const line = (client: Client, code: string, cases: number, pallet: number, lot: string, bbMonths: number): ShipmentLine => {
  const p = findProduct(client, code);
  if (!p) throw new Error(`Sample product ${client} ${code} not found`);
  return { key: key(), productId: p.id, cases, pallet, lot, bestBefore: month(bbMonths) };
};
const pid = (client: Client, code: string) => findProduct(client, code)!.id;

export function sampleState(): State {
  const shipments: Shipment[] = [
    {
      id: "deccan-1028", client: "Deccan", number: "1028", supplier: "Deccan Foods", ref: "MSKU 482910", expected: iso(1), status: "incoming",
      lines: [
        line("Deccan", "1015", 55, 1, "DSM-2610", 14), line("Deccan", "1015", 55, 2, "DSM-2610", 14),
        line("Deccan", "1051", 55, 3, "DAB-2609", 18), line("Deccan", "1420", 40, 4, "DIR-2611", 7), line("Deccan", "1071", 55, 5, "DSM-2612", 14),
      ],
    },
    {
      id: "matco-1028", client: "Matco", number: "1028", supplier: "Matco Foods", ref: "BOL 77-1028", expected: iso(2), status: "incoming",
      lines: [line("Matco", "M001", 56, 1, "FX-1190", 20), line("Matco", "M001", 56, 2, "FX-1190", 20), line("Matco", "M002", 60, 3, "FX-1191", 20), line("Matco", "M360", 48, 4, "RM-0412", 10)],
    },
    {
      id: "praj-1031", client: "Praj", number: "1031", supplier: "Praj Natural Foods", ref: "PNF-1031", expected: iso(5), status: "incoming",
      lines: [line("Praj", "PNFNDLFXT", 30, 1, "MB-NDL-09", 9), line("Praj", "PNFPSTMLT", 20, 1, "MB-PST-08", 11), line("Praj", "PNFPCKCHO", 20, 2, "MB-PCK-07", 8)],
    },
    {
      id: "deccan-2930", client: "Deccan", number: "2930", supplier: "Deccan Foods", ref: "TGHU 310298", expected: iso(-1), status: "pending",
      receivedAt: new Date(Date.now() - 864e5 * 0.6).toISOString(), receivedBy: "Dock team", condition: "ok",
      lines: [
        line("Deccan", "1073", 55, 1, "DSK-2608", 16), line("Deccan", "1073", 55, 2, "DSK-2608", 16), line("Deccan", "1065", 55, 3, "DCG-2607", 15),
        line("Deccan", "1401", 20, 4, "DIR-2605", 6), line("Deccan", "1403", 20, 4, "DWR-2605", 6),
      ],
    },
    {
      id: "matco-2931", client: "Matco", number: "2931", supplier: "Matco Foods", ref: "BOL 77-2931", expected: iso(0), status: "pending",
      receivedAt: new Date(Date.now() - 36e5 * 3).toISOString(), receivedBy: "Dock team", condition: "damaged",
      lines: [{ ...line("Matco", "M006", 48, 1, "HM-0388", 22), damaged: 2 }],
    },
  ];
  const orders: StoreOrder[] = [
    { id: "Order 4", store: "Big Bazaar Farmers Market – Plainsboro", client: "Praj", date: iso(-9), lines: [{ productId: pid("Praj", "PNFNDLFXT"), cases: 1 }, { productId: pid("Praj", "PNFPSTMLT"), cases: 1 }] },
    { id: "Order 5", store: "Balaji Super Market", client: "Praj", date: iso(-8), lines: [{ productId: pid("Praj", "PNFMSLCHO"), cases: 1 }, { productId: pid("Praj", "PNFPCKCHO"), cases: 2 }] },
    { id: "Order 9", store: "Patel Brothers – Hamilton", client: "Deccan", date: iso(-6), lines: [{ productId: pid("Deccan", "1015"), cases: 20 }, { productId: pid("Deccan", "1420"), cases: 10 }] },
    { id: "Order 11", store: "Patidar Supermarket – East Windsor", client: "Praj", date: iso(-4), lines: [{ productId: pid("Praj", "PNFMSLCHO"), cases: 1 }] },
    { id: "Order 12", store: "Subzi Mandi Farmers Market – Parsippany", client: "Matco", date: iso(-3), lines: [{ productId: pid("Matco", "M001"), cases: 6 }] },
  ];
  const returns: ReturnRequest[] = [
    {
      id: "R-0001", orderId: "Order 9", store: "Patel Brothers – Hamilton", status: "pending", reason: "Damaged in transit", photos: [],
      items: [{ key: key(), productId: pid("Deccan", "1420"), cases: 3 }], notes: "Two boxes crushed, one torn. Driver noted it on delivery.",
      createdAt: new Date(Date.now() - 864e5 * 1.2).toISOString(), createdBy: "Dock team",
    },
  ];
  const base = {
    version: 1 as const, shipments, orders, returns, movements: [], seq: 2,
    stock: withSampleDates(sheetStock()),
  };
  // Orders first, so every sample order (and delivery) gets its message thread
  const out = withOutbound({ ...base, counts: [], inbox: [] } as unknown as State);
  return { ...out, chat: sampleChat(out) };
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/**
 * SAMPLE: the 27 Sep sheets have no lot numbers or best-before dates, so sheet stock gets made-up ones
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

// ---------- Out-bounds (SAMPLE) ----------
const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();

/** SAMPLE text of an order PDF and an order email, to show how drafts are read */
const PDF_TEXT = `PATEL BROTHERS – EDISON
PURCHASE ORDER   PO# PB-77812
Ship to: Patel Brothers – Edison      Deliver by: ${iso(4)}
Item   Description                         Qty (cs)
1055   Deccan Gujarat 17 Rice 10 LB x4     20
1071   Deccan Sona Masoori 10 LB x4        30
1054   Deccan Gobindbhog 10 LB x4          8
Thank you`;
const MAIL_BODY = `Hi team,

Please send the following for Thursday:

M001 Extreme Basmati Rice 10lb - 24 cases
M129 Amber XXL 40lb - 6 cases

Thanks,
Purchasing, Big Bazaar Farmers Market – Plainsboro`;

/**
 * Gives sample orders a status, due date and picking plan, adds orders in every stage, and the sample inbox.
 * Also used once on data saved before Out-bounds existed (fields already there are kept).
 */
export function withOutbound(state: State): State {
  const set: Record<string, Partial<StoreOrder>> = {
    "Order 4": { status: "shipped", due: iso(-7), source: "pdf", shippedAt: ago(24 * 7), shippedBy: "Leo" },
    "Order 5": { status: "shipped", due: iso(-6), source: "pdf", shippedAt: ago(4), shippedBy: "Nina" },
    "Order 9": { status: "shipped", due: iso(-4), source: "email", shippedAt: ago(24 * 4), shippedBy: "Leo" },
    // Praj stock isn't in the sample sheets, so this one shows what a shortage looks like
    "Order 11": { status: "approved", due: iso(1), source: "app", approvedBy: "Maya", approvedAt: ago(20) },
    "Order 12": { status: "approved", due: iso(2), source: "email", approvedBy: "Karthik", approvedAt: ago(6) },
  };
  const pid = (client: Client, code: string) => findProduct(client, code)!.id;
  const extra: StoreOrder[] = [
    { id: "Order 13", store: "Patel Brothers – Hamilton", client: "Deccan", date: iso(-1), due: iso(0), source: "app", status: "approved", approvedBy: "Karthik", approvedAt: ago(5), createdBy: "Karthik", createdAt: ago(26),
      lines: [{ productId: pid("Deccan", "1073"), cases: 70 }, { productId: pid("Deccan", "1065"), cases: 30 }, { productId: pid("Deccan", "1401"), cases: 12 }] },
    { id: "Order 14", store: "Balaji Super Market", client: "Deccan", date: iso(0), due: iso(3), source: "app", status: "approved", approvedBy: "Maya", approvedAt: ago(2), createdBy: "Maya", createdAt: ago(3),
      lines: [{ productId: pid("Deccan", "1015"), cases: 60 }, { productId: pid("Deccan", "1051"), cases: 25 }] },
    { id: "Order 15", store: "Patel Brothers – Edison", client: "Deccan", date: iso(0), due: iso(4), source: "pdf", status: "draft", ref: "PB-77812", sourceName: "PB-77812.pdf", sourceText: PDF_TEXT, createdBy: "Order inbox", createdAt: ago(1),
      lines: [{ productId: pid("Deccan", "1055"), cases: 20 }, { productId: pid("Deccan", "1071"), cases: 30 }, { productId: pid("Deccan", "1054"), cases: 8 }] },
  ];
  let next: State = {
    ...state,
    orders: [...extra.filter(e => !state.orders.some(o => o.id === e.id)), ...state.orders.map(o => ({ ...set[o.id], ...o, ...(o.status ? {} : set[o.id] ?? {}), status: o.status ?? set[o.id]?.status ?? "draft" }))],
    inbox: state.inbox ?? [],
  };
  // Plan the approved ones (oldest stock first, open pallets first)
  for (const o of next.orders) {
    if (o.status !== "approved" || o.picks) continue;
    const plan = planOrder(next, o, "fifo-open-first");
    next = { ...next, orders: next.orders.map(x => (x.id === o.id ? { ...x, strategy: "fifo-open-first", picks: plan.picks, short: plan.short } : x)) };
  }
  // Order 13 is being picked: the first pallet on its list is done
  const o13 = next.orders.find(o => o.id === "Order 13");
  const first = o13?.picks?.find(p => !p.picked);
  if (o13 && first && o13.status === "approved") {
    const { lines, taken } = takeFrom(next.stock[first.location] ?? [], first.productId, first.cases, next, first.location);
    const stock = { ...next.stock };
    if (lines.length) stock[first.location] = lines; else delete stock[first.location];
    const picked = { cases: taken.reduce((a, l) => a + l.cases, 0), by: "Omar", at: ago(1), taken };
    next = { ...next, stock, orders: next.orders.map(o => (o.id === "Order 13" ? { ...o, status: "picking", picks: o.picks!.map(p => (p.key === first.key ? { ...p, picked } : p)) } : o)) };
  }
  if (!next.inbox.length) {
    const mails: InboxMail[] = [
      { id: "mail-1", sample: true, from: "Purchasing <purchasing@example.com>", subject: "Order for Thursday – Big Bazaar Plainsboro", receivedAt: ago(0.5), body: MAIL_BODY, attachments: [], status: "new" },
      { id: "mail-2", sample: true, from: "Patel Brothers Edison <orders.pbedison@example.com>", subject: "PO PB-77812", receivedAt: ago(1.2), body: "Please see attached PO.", attachments: [{ name: "PB-77812.pdf", text: PDF_TEXT }], status: "drafted", orderId: "Order 15" },
      { id: "mail-3", sample: true, from: "Newsletter <news@example.com>", subject: "Your weekly freight rates", receivedAt: ago(30), body: "Rates for next week attached.", attachments: [], status: "ignored" },
    ];
    next = { ...next, inbox: mails };
  }
  return next;
}

/** SAMPLE: a few pallet tasks and a packing assignment, so the Work and Tasks screens have something to show */
export function withSampleWork(state: State): State {
  const t = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
  const floor = Object.keys(state.stock).filter(c => /-FLOOR-P\d+$/.test(c) && state.stock[c].length).slice(0, 2);
  const tasks = floor.map((from, i) => {
    const to = nextSlot({ ...state, tasks: [] } as State, from);
    return { id: `T-sample-${i + 1}`, kind: "move" as const, status: "open" as const, from, to, lines: state.stock[from], reason: i === 0 ? "Floor pallet into the rack" : "Clearing the aisle",
      assignee: i === 0 ? "omar" : undefined, createdBy: "Leo", createdAt: t(1 + i) };
  });
  // two tasks can't get the same slot
  if (tasks.length === 2 && tasks[0].to === tasks[1].to) tasks[1].to = nextSlot({ ...state, tasks: [tasks[0]] } as State, tasks[1].from);
  return { ...state, tasks, orders: state.orders.map(o => (o.id === "Order 13" && !o.assignee ? { ...o, assignee: "omar" } : o)) };
}
