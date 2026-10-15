// SAMPLE chat from the warehouse's seed.json: made-up people (marked sample), channels, direct messages and one
// thread per order and per delivery. Product, slot and record references point at the sample data.
// A warehouse without a seed starts with just the team channel.
import { canSeeClient } from "../auth/permissions";
import { findProduct } from "../data/catalog";
import { tenant } from "../tenant";
import { compose, type Part } from "./refs";
import type { ChatState, Conversation, Message, State, User } from "../store/types";

const ago = (minutes: number) => new Date(Date.now() - minutes * 6e4).toISOString();

/** Just the team channel; people join it when they sign in */
export function emptyChat(): ChatState {
  return { users: [], conversations: [{ id: "team", kind: "channel", title: "warehouse-team", members: [], createdAt: ago(0) }], messages: [], reads: {}, presence: {}, seq: 0 };
}

export function sampleChat(base: Omit<State, "chat" | "counts" | "inbox">): ChatState {
  const seed = tenant().seed;
  if (!seed) return emptyChat();
  const users: User[] = seed.people.map(p => ({ ...p, sample: true }));
  const all = users.map(u => u.id);
  const name = (id: string) => users.find(u => u.id === id)?.name ?? id;
  const state = { ...base, counts: [], inbox: [], chat: { users, conversations: [], messages: [], reads: {}, presence: {}, seq: 0 } } as State;
  const allowed = (client: Parameters<typeof canSeeClient>[1]) => users.filter(u => canSeeClient(u, client)).map(u => u.id);

  const conversations: Conversation[] = [
    ...seed.channels.map(c => ({ id: c.id, kind: "channel" as const, title: c.title, ...(c.shift ? { shift: c.shift } : {}), members: c.members === "everyone" ? all : c.members, createdAt: ago(60 * 24 * 30) })),
    ...seed.dms.map(([a, b]) => ({ id: `dm-${a}-${b}`, kind: "dm" as const, title: `${name(a)} & ${name(b)}`, members: [a, b], createdAt: ago(60 * 24 * 20) })),
    ...base.orders.map(o => ({ id: `order-${o.id.replace(/\s+/g, "-").toLowerCase()}`, kind: "order" as const, title: `${o.id} · ${o.store}`, link: { type: "order" as const, id: o.id }, members: allowed(o.client), createdAt: `${o.date}T09:00:00.000Z` })),
    ...base.shipments.map(s => ({ id: `ship-${s.id}`, kind: "shipment" as const, title: `${s.client} ${s.number}`, link: { type: "shipment" as const, id: s.id }, members: allowed(s.client), createdAt: ago(60 * 24 * 3) })),
  ];

  // Product references in the seed are codes: the saved reference is the product's ID
  const productId = (code: string) => {
    for (const client of tenant().config.clients) { const p = findProduct(client.id, code); if (p) return p.id; }
    return code;
  };
  let n = 0;
  const messages: Message[] = seed.messages.map(([conv, author, minutesAgo, rawParts, extra]) => {
    const parts = (rawParts as Part[]).map(p => (typeof p === "object" && "product" in p ? { product: productId(p.product) } : p));
    const { text, refs } = compose(state, parts);
    return {
      id: `m${++n}`, conversationId: conv, authorId: author, text, refs, photos: [], createdAt: ago(minutesAgo), status: "delivered" as const,
      ...(extra?.urgent ? { urgent: true } : {}), ...(extra?.escalateMinutesAgo !== undefined ? { escalateAt: ago(extra.escalateMinutesAgo) } : {}),
    };
  });

  // What each person has seen: the focus person has a few unread messages and mentions waiting
  const lastAt = (conv: string, beforeMin = 0) => messages.filter(m => m.conversationId === conv && m.createdAt <= ago(beforeMin)).map(m => m.createdAt).sort().pop() ?? "";
  const reads: ChatState["reads"] = {};
  for (const u of users) {
    reads[u.id] = {};
    for (const c of conversations) if (c.members.includes(u.id)) reads[u.id][c.id] = lastAt(c.id, u.id === seed.focus ? 0 : 15);
  }
  for (const [conv, minutes] of Object.entries(seed.reads ?? {})) if (reads[seed.focus]) reads[seed.focus][conv] = minutes === null ? "" : ago(minutes);

  const presence: ChatState["presence"] = Object.fromEntries(Object.entries(seed.presence).map(([id, p]) => [id, {
    userId: id, state: p.state, lastSeenAt: ago(p.minutesAgo), ...(p.state === "syncing" ? { lastSyncedAt: ago(p.minutesAgo) } : {}), ...(p.manual ? { manual: p.manual } : {}),
  }]));
  return { users, conversations, messages, reads, seq: n, presence };
}
