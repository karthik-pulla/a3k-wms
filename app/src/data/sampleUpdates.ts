// SAMPLE DATA for the home screen until the server exists. Stores, brands and products are real names
// from the order slips and stock sheets; every quantity, date and order number here is made up.

export type UpdateKind =
  | "outgoing"
  | "deadlines"
  | "ordersToApprove"
  | "incoming"
  | "toConfirm"
  | "expiry"
  | "returns"
  | "changesToApprove";

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

const day = 864e5;
const fmtDay = (offsetDays: number) => {
  if (offsetDays === 0) return "today";
  if (offsetDays === 1) return "tomorrow";
  if (offsetDays === -1) return "yesterday";
  return new Date(Date.now() + offsetDays * day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fmtMonth = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * day).toLocaleDateString(undefined, { month: "short", year: "numeric" });

export function sampleUpdates(): UpdateGroup[] {
  return [
    {
      kind: "outgoing", mode: "outbounds", title: "Going out today", subtitle: "Picked or being picked", count: 3,
      items: [
        { id: "o5", what: "Balaji Super Market", detail: "Order 5 · Millet Bank · 27 cases", meta: "picked" },
        { id: "o4", what: "Big Bazaar Farmers Market", detail: "Order 4 · Millet Bank · 12 cases", meta: "picking" },
        { id: "o9", what: "Patel Brothers – Hamilton", detail: "Order 9 · Deccan · 40 cases", meta: "4:30 pm" },
      ],
    },
    {
      kind: "deadlines", mode: "outbounds", title: "Due soon", subtitle: "Orders nearing their due date", count: 4, tone: "warn",
      items: [
        { id: "d11", what: "Patidar Supermarket – East Windsor", detail: "Order 11 · 23 cases", meta: `due ${fmtDay(1)}`, tone: "warn" },
        { id: "d12", what: "Subzi Mandi Farmers Market", detail: "Order 12 · 18 cases", meta: `due ${fmtDay(2)}` },
        { id: "d14", what: "Patel Brothers – Hamilton", detail: "Order 14 · 31 cases", meta: `due ${fmtDay(3)}` },
      ],
    },
    {
      kind: "ordersToApprove", mode: "outbounds", title: "Orders to approve", subtitle: "Read from email or PDF, not yet approved", count: 2,
      items: [
        { id: "a15", what: "Balaji Super Market", detail: "From orders@ inbox · 9 products", meta: "12 min ago" },
        { id: "a16", what: "Big Bazaar Farmers Market", detail: "Uploaded PDF · 5 products", meta: "1 h ago" },
      ],
    },
    {
      kind: "incoming", mode: "inbounds", title: "Arriving", subtitle: "Expected in-bounds", count: 3,
      items: [
        { id: "i1", what: "Deccan · container MSKU 482910", detail: "22 pallets · rice and rava", meta: fmtDay(0) },
        { id: "i2", what: "Matco · Falak", detail: "14 pallets · basmati, recipe mixes", meta: fmtDay(2) },
        { id: "i3", what: "Praj Natural Foods · Millet Bank", detail: "6 pallets · noodles, pasta", meta: fmtDay(5) },
      ],
    },
    {
      kind: "toConfirm", mode: "inbounds", title: "Waiting for confirmation", subtitle: "Received pallets to check before put-away", count: 5, tone: "warn",
      items: [
        { id: "c1", what: "Sona Masoori Rice 20 LBS × 2", detail: "Deccan · lot DSM-2609 · 55 cases", meta: "dock 2" },
        { id: "c2", what: "Extreme Basmati 10 LBS × 4", detail: "Falak · lot FX-1182 · 56 cases", meta: "dock 2" },
        { id: "c3", what: "Mixed pallet · 3 products", detail: "Deccan · rava and poha · 41 cases", meta: "receiving floor" },
      ],
    },
    {
      kind: "expiry", mode: "inventory", title: "Expiry alerts", subtitle: "Expired stock can't be picked", count: 6, tone: "danger",
      items: [
        { id: "e1", what: "Kaju Nankatai 250 G × 28", detail: "NEARCOOLER-01 · 20 cases", meta: `expired ${fmtMonth(-12)}`, tone: "expired" },
        { id: "e2", what: "Phool Makhana 200 G × 35", detail: "06A-11-L1-B1 · 3 cases", meta: `best before ${fmtMonth(40)}`, tone: "danger" },
        { id: "e3", what: "Idly Rava 2.2 LBS × 20", detail: "06B-13-L2-B1 · 42 cases", meta: `best before ${fmtMonth(150)}`, tone: "warn" },
      ],
    },
    {
      kind: "returns", mode: "inbounds", title: "Returns pending", subtitle: "Not in inventory until approved", count: 1,
      items: [
        { id: "r1", what: "Patel Brothers – Hamilton", detail: "4 cases Chocolate Muesli · damaged boxes", meta: fmtDay(-1) },
      ],
    },
    {
      kind: "changesToApprove", mode: "inventory", title: "Changes to approve", subtitle: "Quantity changes and moves with reasons", count: 2,
      items: [
        { id: "x1", what: "06A-04-L1-B2 · −6 cases", detail: "Thanjavoor PBR · reason: damaged", meta: "1 h ago" },
        { id: "x2", what: "15A-03-L2-B1 → 15A-03-L4-B1", detail: "Worker move · reason: consolidate", meta: "3 h ago" },
      ],
    },
  ];
}

/** Lines for the bottom-right ticker: recent stock movements, with the odd fun fact. */
export const TICKER_LINES: { text: string; sign: "+" | "−" | "fact" }[] = [
  { sign: "+", text: "+55 cs  Sona Masoori → 06A-04-L1-B1" },
  { sign: "−", text: "−27 cs  Order 5 · Balaji" },
  { sign: "+", text: "+1 order  Patidar Supermarket" },
  { sign: "+", text: "+56 cs  Extreme Basmati → 10A-01-L2-B2" },
  { sign: "fact", text: "today's cases, stacked: 41 m tall" },
  { sign: "−", text: "−12 cs  Order 4 · Big Bazaar" },
  { sign: "+", text: "+1 S/O  Subzi Mandi" },
  { sign: "+", text: "+42 cs  Idly Rava → 06B-13-L3-B1" },
  { sign: "fact", text: "that's about 9 forklift trips" },
  { sign: "−", text: "−3 cs  Phool Makhana · recount" },
  { sign: "+", text: "+10 cs  Foxtail Millet Noodles → 17A-02-L1-B1" },
  { sign: "fact", text: "busiest slot this week: 06A-05-L1-B1" },
  { sign: "−", text: "−40 cs  Order 9 · Patel Brothers" },
  { sign: "+", text: "+29 cs  Chinigora → 06A-02-L1-B1" },
  { sign: "fact", text: "3,662 slots · not one of them bored" },
];
