import { AREAS, FACES, productById, slotMeta } from "../data/catalog";
import type { GroupId, MessageRef, State } from "../store/types";

// ---------- Location codes in text ----------
// Rack slots (padded or old unpadded), Door 6, junctions, floor spots and named areas
const SLOT_RE = /\b(D6[AB]|1518[AB]|1619[AB]|\d{1,2}[A-C])-(\d{1,2})-L(\d)-B(\d)\b|\b(D6[AB]|1518[AB]|1619[AB]|\d{1,2}[A-C])-FLOOR-P(\d{1,2})\b|\b(NEARCOOLER-0[1-5]|LINE-2-3|LANE-7|DOOR-2-3|LOAD-AREA|RECV-FLOOR)(?:-P(\d{1,2}))?\b/gi;
const FACE_IDS = new Set(FACES.map(f => f.id));
const AREA_IDS = new Set(AREAS.map(a => a.id));
const padFace = (f: string) => { const u = f.toUpperCase(); return /^\d[A-C]$/.test(u) ? `0${u}` : u; };

// One code on its own. Kept separate from SLOT_RE: sharing a global regex's position inside findLocations' loop never ends
const ONE_RE = new RegExp(`^(?:${SLOT_RE.source})$`, "i");

/** The saved (padded) form of a location code, or null if it isn't a real slot, floor spot or area. */
export function normalizeLocation(raw: string): string | null {
  const m = ONE_RE.exec(raw.trim());
  if (!m) return null;
  if (m[1]) {
    const code = `${padFace(m[1])}-${m[2].padStart(2, "0")}-L${m[3]}-B${m[4]}`;
    return slotMeta(code) ? code : null;
  }
  if (m[5]) { const face = padFace(m[5]); return FACE_IDS.has(face) ? `${face}-FLOOR-P${m[6].padStart(2, "0")}` : null; }
  const area = m[7].toUpperCase();
  return AREA_IDS.has(area) ? (m[8] ? `${area}-P${m[8].padStart(2, "0")}` : area) : null;
}

/** Every valid location code in a text, with its position and saved form. */
export function findLocations(text: string): { start: number; end: number; code: string }[] {
  const out: { start: number; end: number; code: string }[] = [];
  const re = new RegExp(SLOT_RE.source, "gi");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const code = normalizeLocation(m[0]);
    if (code) out.push({ start: m.index, end: m.index + m[0].length, code });
  }
  return out;
}

// ---------- Labels and snapshots ----------
export const GROUP_LABEL: Record<GroupId, string> = { owners: "owners", coordinators: "coordinators", receiving: "receiving", "shift-am": "shift-am", "shift-pm": "shift-pm" };

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
