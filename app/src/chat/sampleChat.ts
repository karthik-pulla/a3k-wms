// SAMPLE chat for testing on localhost: made-up people (marked sample), channels, direct messages and
// one thread per order and per delivery. Product, slot and record references point at the sample store.
import { canSeeClient } from "../auth/permissions";
import { compose, type Part } from "./refs";
import type { ChatState, Conversation, Message, State, User } from "../store/types";

export const SAMPLE_USERS: User[] = [
  { id: "karthik", name: "Karthik", role: "owner", groups: ["owners"] },
  { id: "maya", name: "Maya", role: "owner", groups: ["owners"], sample: true },
  { id: "leo", name: "Leo", role: "coordinator", groups: ["coordinators", "shift-am", "receiving"], sample: true },
  { id: "nina", name: "Nina", role: "coordinator", groups: ["coordinators", "shift-pm"], sample: true },
  { id: "omar", name: "Omar", role: "worker", groups: ["receiving", "shift-am"], sample: true },
  // Scoped to two clients, to show that chips and maps never reveal another brand's stock
  { id: "tess", name: "Tess", role: "worker", groups: ["shift-pm"], clients: ["Deccan", "Praj"], sample: true },
];

const ago = (minutes: number) => new Date(Date.now() - minutes * 6e4).toISOString();

export function sampleChat(base: Omit<State, "chat" | "counts" | "inbox">): ChatState {
  const users = SAMPLE_USERS;
  const all = users.map(u => u.id);
  const state = { ...base, counts: [], inbox: [], chat: { users, conversations: [], messages: [], reads: {}, presence: {}, seq: 0 } } as State;
  const allowed = (client: Parameters<typeof canSeeClient>[1]) => users.filter(u => canSeeClient(u, client)).map(u => u.id);

  const conversations: Conversation[] = [
    { id: "team", kind: "channel", title: "warehouse-team", members: all, createdAt: ago(60 * 24 * 30) },
    { id: "shift-am", kind: "channel", title: "shift-am", shift: "am", members: ["karthik", "maya", "leo", "omar"], createdAt: ago(60 * 24 * 30) },
    { id: "shift-pm", kind: "channel", title: "shift-pm", shift: "pm", members: ["karthik", "maya", "nina", "tess"], createdAt: ago(60 * 24 * 30) },
    { id: "dm-karthik-leo", kind: "dm", title: "Karthik & Leo", members: ["karthik", "leo"], createdAt: ago(60 * 24 * 20) },
    { id: "dm-karthik-maya", kind: "dm", title: "Karthik & Maya", members: ["karthik", "maya"], createdAt: ago(60 * 24 * 20) },
    { id: "dm-leo-omar", kind: "dm", title: "Leo & Omar", members: ["leo", "omar"], createdAt: ago(60 * 24 * 20) },
    { id: "dm-karthik-tess", kind: "dm", title: "Karthik & Tess", members: ["karthik", "tess"], createdAt: ago(60 * 24 * 20) },
    ...base.orders.map(o => ({ id: `order-${o.id.replace(/\s+/g, "-").toLowerCase()}`, kind: "order" as const, title: `${o.id} · ${o.store}`, link: { type: "order" as const, id: o.id }, members: allowed(o.client), createdAt: `${o.date}T09:00:00.000Z` })),
    ...base.shipments.map(s => ({ id: `ship-${s.id}`, kind: "shipment" as const, title: `${s.client} ${s.number}`, link: { type: "shipment" as const, id: s.id }, members: allowed(s.client), createdAt: ago(60 * 24 * 3) })),
  ];

  let n = 0;
  const messages: Message[] = [];
  const say = (conv: string, author: string, minutesAgo: number, parts: Part[], extra: Partial<Message> = {}) => {
    const { text, refs } = compose(state, parts);
    messages.push({ id: `m${++n}`, conversationId: conv, authorId: author, text, refs, photos: [], createdAt: ago(minutesAgo), status: "delivered", ...extra });
  };

  say("ship-deccan-1028", "maya", 600, ["Packing list is in. Container ", { container: "MSKU 482910" }, ", due tomorrow."]);
  say("dm-karthik-tess", "tess", 500, ["I'm off tomorrow, swapped with Omar."]);
  say("dm-karthik-maya", "maya", 400, ["Matco called: ", { shipment: "matco-1028" }, " might arrive a day late."]);
  say("dm-karthik-maya", "karthik", 390, ["OK, noted."]);
  say("shift-pm", "nina", 300, ["Tonight please count ", { slot: "15A-03-L2-B1" }, " up to ", { slot: "15A-03-L4-B1" }, "."]);
  say("shift-pm", "tess", 280, ["On it."]);
  say("order-order-5", "nina", 260, ["Picked. Labels printed with the label maker."]);
  say("order-order-9", "leo", 200, ["Patel Brothers asked to swap 10 cs of ", { product: "D85" }, " for ", { product: "D80" }, "."]);
  say("team", "leo", 180, ["Morning all, AM shift is on. ", { shipment: "deccan-2930" }, " is on the dock waiting for confirmation."]);
  say("ship-deccan-2930", "omar", 170, ["Unloaded at Door 2. 5 lines, one mixed pallet (rava) on ", { slot: "RECV-FLOOR" }, "."]);
  say("team", "maya", 150, [{ user: "leo" }, " thanks. ", { slot: "6A-01-L4-B1" }, " and ", { slot: "6A-01-L4-B2" }, " are free for the Surti Kolam."]);
  say("shift-am", "leo", 120, ["Forklift 2 is charging until 10. Use forklift 1 for ", { slot: "D6A-01-L1-B1" }, "."]);
  say("team", "omar", 95, ["Pallet on ", { slot: "06B-FLOOR-P01" }, " is leaning. Can someone check it?"]);
  say("dm-karthik-leo", "leo", 70, ["Can you look at the return from ", { order: "Order 9" }, "? Photos are in."]);
  say("dm-karthik-leo", "karthik", 65, ["Will look after lunch."]);
  say("shift-am", "omar", 60, ["Rava pallet is mixed: ", { product: "D80" }, " + ", { product: "D82" }, "."]);
  say("dm-leo-omar", "leo", 50, ["Take ", { container: "MSKU 482910" }, " to Door 2 when it lands."]);
  say("team", "maya", 40, [{ user: "karthik" }, " can you check ", { product: "D80" }, "? Two lots expire in April."]);
  say("ship-matco-2931", "omar", 30, ["2 cases of ", { product: "O166" }, " crushed on arrival. Photos taken."]);
  say("dm-karthik-leo", "leo", 28, [{ user: "karthik" }, " also, ", { product: "O161" }, " is getting low."]);
  say("ship-matco-2931", "leo", 20, [{ group: "owners" }, " please confirm when you can."], { urgent: true, escalateAt: ago(5) });
  say("team", "nina", 12, ["PM shift starts at 3. ", { group: "owners" }, " we need a decision on ", { shipment: "matco-2931" }, "."]);

  // What each person has seen. Karthik has a few unread messages and mentions waiting.
  const lastAt = (conv: string, beforeMin = 0) => messages.filter(m => m.conversationId === conv && m.createdAt <= ago(beforeMin)).map(m => m.createdAt).sort().pop() ?? "";
  const reads: ChatState["reads"] = {};
  for (const u of users) {
    reads[u.id] = {};
    for (const c of conversations) if (c.members.includes(u.id)) reads[u.id][c.id] = lastAt(c.id, u.id === "karthik" ? 0 : 15);
  }
  reads.karthik.team = ago(90);
  reads.karthik["dm-karthik-leo"] = ago(64);
  reads.karthik["ship-matco-2931"] = "";

  return {
    users, conversations, messages, reads, seq: n,
    presence: {
      karthik: { userId: "karthik", state: "online", lastSeenAt: ago(0) },
      maya: { userId: "maya", state: "online", lastSeenAt: ago(1) },
      leo: { userId: "leo", state: "online", lastSeenAt: ago(0), manual: { kind: "receiving", door: 2 } },
      nina: { userId: "nina", state: "away", lastSeenAt: ago(9) },
      omar: { userId: "omar", state: "syncing", lastSeenAt: ago(18), lastSyncedAt: ago(18), manual: { kind: "forklift" } },
      tess: { userId: "tess", state: "offline", lastSeenAt: ago(60 * 20), manual: { kind: "off" } },
    },
  };
}
