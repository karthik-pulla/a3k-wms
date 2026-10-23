// The app's data (State) as the server stores it: one piece per slot's stock, delivery, order, task, count,
// counted slot, message and so on (keys and rules: server/src/shared/sync.ts). `diff` finds the pieces a change
// touched; `applyRows` puts pieces from the server back into a State. No React, no tenant: pure functions.
import type { State } from "../store/types";
import type { Kind } from "../../../server/src/shared/sync.ts";

export interface EntityChange { key: string; data: unknown }
/** A piece with the number of the change that made it (c): lists keep that order */
export interface EntityRow { key: string; data: unknown; c: number }

type Item = { id: string };
interface ListSpec { kind: Kind; get: (s: State) => Item[]; set: (s: State, v: Item[]) => State; newestFirst: boolean }

// Lists, by id. Most show the newest first (the reducer adds new ones at the top); conversations and messages run oldest first.
const LISTS: ListSpec[] = [
  { kind: "shipment", get: s => s.shipments, set: (s, v) => ({ ...s, shipments: v as State["shipments"] }), newestFirst: true },
  { kind: "return", get: s => s.returns, set: (s, v) => ({ ...s, returns: v as State["returns"] }), newestFirst: true },
  { kind: "movement", get: s => s.movements, set: (s, v) => ({ ...s, movements: v as State["movements"] }), newestFirst: true },
  { kind: "order", get: s => s.orders, set: (s, v) => ({ ...s, orders: v as State["orders"] }), newestFirst: true },
  { kind: "inbox", get: s => s.inbox, set: (s, v) => ({ ...s, inbox: v as State["inbox"] }), newestFirst: true },
  { kind: "task", get: s => s.tasks, set: (s, v) => ({ ...s, tasks: v as State["tasks"] }), newestFirst: true },
  { kind: "audit", get: s => s.audit ?? [], set: (s, v) => ({ ...s, audit: v as State["audit"] }), newestFirst: true },
  { kind: "notice", get: s => s.notices ?? [], set: (s, v) => ({ ...s, notices: v as State["notices"] }), newestFirst: true },
  { kind: "team", get: s => s.teams ?? [], set: (s, v) => ({ ...s, teams: v as State["teams"] }), newestFirst: true },
  { kind: "conv", get: s => s.chat.conversations, set: (s, v) => ({ ...s, chat: { ...s.chat, conversations: v as State["chat"]["conversations"] } }), newestFirst: false },
  { kind: "msg", get: s => s.chat.messages, set: (s, v) => ({ ...s, chat: { ...s.chat, messages: v as State["chat"]["messages"] } }), newestFirst: false },
];
const LIST_BY_KIND = new Map(LISTS.map(l => [l.kind, l]));

/** The same State with every piece the server keeps taken out (what's left is this device's own: the people list) */
export function blankState(s: State): State {
  let out: State = { ...s, stock: {}, seq: 0, counts: [], productEdits: {}, settings: undefined, chat: { ...s.chat, reads: {}, presence: {} } };
  for (const l of LISTS) out = l.set(out, []);
  return out;
}

const countMeta = (c: State["counts"][number]) => { const { entries: _e, ...meta } = c; return meta; };

/** The pieces that differ between two States (data null = removed). Unchanged items keep their object, so this is quick. */
export function diff(before: State, after: State): EntityChange[] {
  const out: EntityChange[] = [];
  for (const l of LISTS) {
    const a = l.get(before) ?? [], b = l.get(after) ?? [];
    if (a === b) continue;
    const old = new Map(a.map(x => [x.id, x]));
    for (const x of b) { if (old.get(x.id) !== x) out.push({ key: `${l.kind}:${x.id}`, data: x }); old.delete(x.id); }
    for (const id of old.keys()) out.push({ key: `${l.kind}:${id}`, data: null });
  }
  record(out, "stock", before.stock, after.stock);
  record(out, "presence", before.chat.presence, after.chat.presence);
  record(out, "product", before.productEdits ?? {}, after.productEdits ?? {});
  // Read markers: read:<person>:<conversation>, saved as { at }
  if (before.chat.reads !== after.chat.reads) {
    const people = new Set([...Object.keys(before.chat.reads), ...Object.keys(after.chat.reads)]);
    for (const p of people) {
      const x = before.chat.reads[p] ?? {}, y = after.chat.reads[p] ?? {};
      if (x === y) continue;
      for (const c of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[c] !== y[c]) out.push({ key: `read:${p}:${c}`, data: y[c] === undefined ? null : { at: y[c] } });
    }
  }
  if (before.seq !== after.seq) out.push({ key: "meta:seq", data: { value: after.seq } });
  // The warehouse's settings: one piece
  if (before.settings !== after.settings) out.push({ key: "setting:warehouse", data: after.settings ?? null });
  // Counts: the count itself, and each counted slot on its own (so people counting at once don't collide)
  if (before.counts !== after.counts) {
    const old = new Map((before.counts ?? []).map(c => [c.id, c]));
    for (const c of after.counts ?? []) {
      const o = old.get(c.id);
      old.delete(c.id);
      if (o === c) continue;
      if (!o || JSON.stringify(countMeta(o)) !== JSON.stringify(countMeta(c))) out.push({ key: `count:${c.id}`, data: countMeta(c) });
      record(out, `countentry`, o?.entries ?? {}, c.entries, `${c.id}:`);
    }
    for (const [id, o] of old) { out.push({ key: `count:${id}`, data: null }); for (const code of Object.keys(o.entries)) out.push({ key: `countentry:${id}:${code}`, data: null }); }
  }
  return out;
}

function record(out: EntityChange[], kind: string, a: Record<string, unknown>, b: Record<string, unknown>, prefix = "") {
  if (a === b) return;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push({ key: `${kind}:${prefix}${k}`, data: b[k] === undefined ? null : b[k] });
}

const kindOf = (key: string) => key.slice(0, key.indexOf(":"));
const idOf = (key: string) => key.slice(key.indexOf(":") + 1);
const after2 = (id: string) => { const i = id.indexOf(":"); return [id.slice(0, i), id.slice(i + 1)] as const; };

/**
 * Puts pieces from the server into a State. `order` gives each piece's c (the change that made it), so lists keep
 * the same order on every device; `all` is every piece this device holds, already including `rows`.
 */
export function applyRows(state: State, rows: EntityRow[], order: (key: string) => number, all: ReadonlyMap<string, { data: unknown; c: number }>): State {
  if (!rows.length) return state;
  let s = state;
  const byKind = new Map<string, EntityRow[]>();
  for (const r of rows) { const k = kindOf(r.key); byKind.set(k, [...(byKind.get(k) ?? []), r]); }
  for (const [kind, list] of byKind) {
    const spec = LIST_BY_KIND.get(kind as Kind);
    if (spec) { s = spec.set(s, mergeList(spec, spec.get(s) ?? [], list, order)); continue; }
    switch (kind) {
      case "stock": s = { ...s, stock: mergeRecord(s.stock, list) as State["stock"] }; break;
      case "presence": s = { ...s, chat: { ...s.chat, presence: mergeRecord(s.chat.presence, list) as State["chat"]["presence"] } }; break;
      case "product": s = { ...s, productEdits: mergeRecord(s.productEdits ?? {}, list) as State["productEdits"] }; break;
      case "setting": for (const r of list) if (idOf(r.key) === "warehouse") s = { ...s, settings: (r.data as State["settings"] | null) ?? undefined }; break;
      case "meta": for (const r of list) if (idOf(r.key) === "seq") s = { ...s, seq: (r.data as { value: number } | null)?.value ?? 0 }; break;
      case "read": {
        const reads = { ...s.chat.reads };
        for (const r of list) {
          const [p, c] = after2(idOf(r.key));
          const mine = { ...(reads[p] ?? {}) };
          if (r.data) mine[c] = (r.data as { at: string }).at; else delete mine[c];
          reads[p] = mine;
        }
        s = { ...s, chat: { ...s.chat, reads } };
        break;
      }
      case "count": case "countentry": break; // below, together
    }
  }
  const ids = new Set([...(byKind.get("count") ?? []).map(r => idOf(r.key)), ...(byKind.get("countentry") ?? []).map(r => after2(idOf(r.key))[0])]);
  if (ids.size) s = { ...s, counts: rebuildCounts(s.counts, ids, all, order) };
  return s;
}

function mergeRecord(cur: Record<string, unknown>, rows: EntityRow[]) {
  const out = { ...cur };
  for (const r of rows) { const id = idOf(r.key); if (r.data === null || r.data === undefined) delete out[id]; else out[id] = r.data; }
  return out;
}

function mergeList(spec: ListSpec, cur: Item[], rows: EntityRow[], order: (key: string) => number): Item[] {
  const byId = new Map(cur.map(x => [x.id, x]));
  let added = false, removed = false;
  for (const r of rows) {
    const id = idOf(r.key);
    if (r.data === null || r.data === undefined) { removed = byId.delete(id) || removed; continue; }
    if (!byId.has(id)) added = true;
    byId.set(id, r.data as Item);
  }
  if (!added) return removed ? cur.filter(x => byId.has(x.id)).map(x => byId.get(x.id)!) : cur.map(x => byId.get(x.id) ?? x);
  const c = (x: Item) => order(`${spec.kind}:${x.id}`);
  return [...byId.values()].sort((a, b) => (spec.newestFirst ? c(b) - c(a) : c(a) - c(b)));
}

/** Each touched count, rebuilt from every piece this device holds (its entries may arrive before or after it) */
function rebuildCounts(cur: State["counts"], ids: Set<string>, all: ReadonlyMap<string, { data: unknown; c: number }>, order: (key: string) => number): State["counts"] {
  const byId = new Map((cur ?? []).map(c => [c.id, c]));
  for (const id of ids) {
    const meta = all.get(`count:${id}`)?.data as Omit<State["counts"][number], "entries"> | null | undefined;
    if (!meta) { byId.delete(id); continue; }
    const prefix = `countentry:${id}:`;
    const entries: State["counts"][number]["entries"] = {};
    for (const [key, r] of all) if (r.data && key.startsWith(prefix)) entries[key.slice(prefix.length)] = r.data as State["counts"][number]["entries"][string];
    byId.set(id, { ...meta, entries });
  }
  return [...byId.values()].sort((a, b) => order(`count:${b.id}`) - order(`count:${a.id}`));
}
