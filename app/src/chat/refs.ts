import { findLocations, normalizeLocation, productById } from "../data/catalog";
import { tenant } from "../tenant";
import type { GroupId, MessageRef, State } from "../store/types";

// ---------- Location codes in text ----------
// Read with the warehouse's own code format (tenant/layout.ts): rack slots (padded or not), floor spots and named areas
export { findLocations, normalizeLocation };

// ---------- Labels and snapshots ----------
/** Groups people can @mention: owners and coordinators, plus the warehouse's own (receiving, shifts) */
export const GROUP_LABEL: Record<GroupId, string> = {
  owners: "owners", coordinators: "coordinators", ...Object.fromEntries(tenant().config.groups.map(g => [g.id, g.name])),
};

export type Part = string
  | { slot: string } | { product: string } | { user: string } | { group: GroupId }
  | { order: string } | { shipment: string } | { container: string };

export function slotSnapshot(state: State, code: string) {
  return { lines: (state.stock[code] ?? []).map(l => ({ productId: l.productId, cases: l.cases })) };
}
export function productSnapshot(state: State, productId: string) {
  const locs = Object.entries(state.stock).filter(([, ls]) => ls.some(l => l.productId === productId));
  const cases = locs.reduce((a, [, ls]) => a + ls.filter(l => l.productId === productId).reduce((b, l) => b + l.cases, 0), 0);
  return { name: productById(productId)?.name ?? productId, cases, locations: locs.length };
}

/** Build message text and structured references from parts (used by the composer and the sample data). */
export function compose(state: State, parts: Part[]): { text: string; refs: MessageRef[] } {
  let text = "";
  const refs: MessageRef[] = [];
  const add = (label: string, ref: (start: number, end: number) => MessageRef) => { const start = text.length; text += label; refs.push(ref(start, text.length)); };
  for (const p of parts) {
    if (typeof p === "string") { text += p; continue; }
    if ("slot" in p) { const code = normalizeLocation(p.slot) ?? p.slot; add(code, (s, e) => ({ type: "slot", code, start: s, end: e, snapshot: slotSnapshot(state, code) })); }
    else if ("product" in p) { const pr = productById(p.product)!; add(`#${pr.name} ${pr.size}`.trim(), (s, e) => ({ type: "product", productId: pr.id, start: s, end: e, snapshot: productSnapshot(state, pr.id) })); }
    else if ("user" in p) { const u = state.chat.users.find(x => x.id === p.user); add(`@${u?.name ?? p.user}`, (s, e) => ({ type: "user", userId: p.user, start: s, end: e })); }
    else if ("group" in p) add(`@${GROUP_LABEL[p.group]}`, (s, e) => ({ type: "group", group: p.group, start: s, end: e }));
    else if ("order" in p) { const o = state.orders.find(x => x.id === p.order); add(`#${p.order}`, (s, e) => ({ type: "order", orderId: p.order, start: s, end: e, snapshot: { store: o?.store ?? "" } })); }
    else if ("shipment" in p) { const sh = state.shipments.find(x => x.id === p.shipment); const title = sh ? `${sh.client} ${sh.number}` : p.shipment; add(`#${title}`, (s, e) => ({ type: "shipment", shipmentId: p.shipment, start: s, end: e, snapshot: { title, status: sh?.status ?? "" } })); }
    else if ("container" in p) add(`#${p.container}`, (s, e) => ({ type: "container", ref: p.container, start: s, end: e }));
  }
  return { text, refs };
}

/**
 * Before sending: turn typed location codes into slot references and save them in the padded form
 * (6B-08-L3-B1 becomes 06B-08-L3-B1), shifting the other references to match.
 */
export function finalize(state: State, text: string, refs: MessageRef[]): { text: string; refs: MessageRef[] } {
  const taken = (s: number, e: number) => refs.some(r => s < r.end && e > r.start);
  const found = findLocations(text).filter(f => !taken(f.start, f.end));
  const all: (MessageRef & { replace?: string })[] = [
    ...refs.map(r => ({ ...r })),
    ...found.map(f => ({ type: "slot" as const, code: f.code, start: f.start, end: f.end, snapshot: slotSnapshot(state, f.code), replace: f.code })),
  ].sort((a, b) => a.start - b.start);
  let out = "", cursor = 0;
  const result: MessageRef[] = [];
  for (const r of all) {
    out += text.slice(cursor, r.start);
    const label = r.replace ?? text.slice(r.start, r.end);
    const start = out.length;
    out += label;
    cursor = r.end;
    const { replace: _drop, ...clean } = r; void _drop;
    result.push({ ...clean, start, end: out.length } as MessageRef);
  }
  out += text.slice(cursor);
  return { text: out, refs: result };
}

/** Keep composer references attached to their labels while the person edits the text around them. */
export function reconcile<T extends { start: number; end: number; label: string }>(text: string, refs: T[]): T[] {
  const out: T[] = [];
  let from = 0;
  for (const r of [...refs].sort((a, b) => a.start - b.start)) {
    const near = text.indexOf(r.label, Math.max(from, r.start - 40));
    const at = near >= 0 ? near : text.indexOf(r.label, from);
    if (at < 0) continue;
    out.push({ ...r, start: at, end: at + r.label.length });
    from = at + r.label.length;
  }
  return out;
}
