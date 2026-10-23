// A warehouse's stock, orders, tasks, counts and messages on the server: saving a device's change (push) and
// catching a device up (pull). The rules are in ../shared/sync.ts; docs/multi-tenant-design.md, "Data on the server".
// Every query is plain (no session settings, no advisory locks), so it works through RDS Proxy without pinning.
import type { Db, Sql } from "./db.ts";
import { ApiError, bad, forbidden } from "./errors.ts";
import { allows, type Action, type BaseRole, type Permissions } from "../shared/permissions.ts";
import { ACTION_RULES, APPEND_ONLY, SERVER_ONLY, SYNC_LIMITS, idOf, kindOf, type Change, type Kind, type PullResult, type PushInput, type PushResult, type SyncRow } from "../shared/sync.ts";

/** Who is saving: a person, or the WMS team through a support grant (personId null) */
export interface SyncWho {
  personId: string | null;
  name: string;
  base: BaseRole;
  perms: Permissions;
  /** Support sessions change data only when the grant allows it */
  readOnly: boolean;
  /** Clients whose stock this person may see (null = all): order and delivery threads follow it */
  clients: string[] | null;
}

interface Row { key: string; version: number; data: any; audience: string[] | null }

const isIso = (v: unknown) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** What the browser sent, checked before anything is read */
function checked(input: Record<string, unknown>): PushInput {
  const { clientId, clientSeq, type, at, changes } = input;
  if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) throw bad("Device id is missing");
  if (typeof clientSeq !== "number" || !Number.isInteger(clientSeq) || clientSeq < 1) throw bad("Change number is missing");
  if (typeof type !== "string" || type.length > 40) throw bad("Change type is missing");
  if (!isIso(at)) throw bad("Change time is missing");
  if (!Array.isArray(changes) || !changes.length || changes.length > SYNC_LIMITS.changesPerPush) throw bad(`A change needs 1–${SYNC_LIMITS.changesPerPush} pieces`);
  const seen = new Set<string>();
  const out: Change[] = changes.map((c: any) => {
    if (!c || typeof c.key !== "string" || c.key.length > 300 || !kindOf(c.key) || !idOf(c.key)) throw bad("A piece has no valid key");
    if (seen.has(c.key)) throw bad(`${c.key} is in the change twice`);
    seen.add(c.key);
    if (typeof c.base !== "number" || !Number.isInteger(c.base) || c.base < 0) throw bad(`${c.key} has no version`);
    if (c.data !== null && (typeof c.data !== "object" || JSON.stringify(c.data).length > SYNC_LIMITS.bytesPerChange)) throw bad(`${c.key} is too big or not an object`);
    return { key: c.key, base: c.base, data: c.data };
  });
  return { clientId, clientSeq, type, at: at as string, changes: out };
}

/** Who may receive a piece: channels and everything that isn't a message go to everyone, the rest to members */
function audienceOf(kind: Kind, data: any, convOf: (id: string) => any): string[] | null {
  if (kind === "conv") return data && data.kind !== "channel" ? (Array.isArray(data.members) ? data.members.map(String) : []) : null;
  // Messages and read markers go to the conversation's members (read markers are passed in as { conversationId })
  if (kind === "msg") {
    const conv = convOf(String(data?.conversationId ?? ""));
    return conv && conv.kind !== "channel" ? (conv.members ?? []).map(String) : null;
  }
  return null;
}

/** The conversation a read marker belongs to: read:<personId>:<conversationId> */
const readConv = (key: string) => { const rest = idOf(key); return rest.slice(rest.indexOf(":") + 1); };
const readPerson = (key: string) => { const rest = idOf(key); return rest.slice(0, rest.indexOf(":")); };

/** Messages and memberships: people write only their own messages, markers and presence, and join or leave only themselves */
function checkChat(who: SyncWho, c: Change, cur: Row | undefined, convOf: (id: string) => any, linked: Map<string, any>) {
  const kind = kindOf(c.key)!;
  const me = who.personId;
  if (!me) throw forbidden("Support sessions don't write messages");
  const data = c.data as any;
  if (kind === "presence") { if (idOf(c.key) !== me || data === null) throw forbidden("You can only set your own status"); return; }
  if (kind === "read") { if (readPerson(c.key) !== me || data === null) throw forbidden("You can only mark your own messages read"); return; }
  if (kind === "msg") {
    if (cur?.data) throw forbidden("Messages can't be changed after they're sent");
    if (!data || data.authorId !== me || data.id !== idOf(c.key)) throw forbidden("You can only send your own messages");
    const conv = convOf(String(data.conversationId));
    if (!conv) throw bad("That conversation doesn't exist");
    if (conv.kind !== "channel" && !(conv.members ?? []).includes(me)) throw forbidden("You're not in that conversation");
    if (conv.deletedAt) throw forbidden("That group chat was deleted");
    return;
  }
  if (kind === "conv") {
    if (!data || data.id !== idOf(c.key)) throw bad("A conversation needs its id");
    const members: string[] = Array.isArray(data.members) ? data.members.map(String) : [];
    if (!cur?.data) {
      if (data.kind === "channel" ? who.base !== "owner" : !members.includes(me)) throw forbidden(data.kind === "channel" ? "Only owners add channels" : "You can only start conversations you're in");
      if (data.kind === "group" && data.createdBy !== me) throw forbidden("A group chat is started by the person creating it");
      if (data.kind === "group" && data.deletedAt) throw bad("A new group chat can't be deleted already");
      return;
    }
    // A group chat's creator names it, adds and removes people, and deletes it; what it is and who made it never change
    if (cur.data.kind === "group" && cur.data.createdBy === me) {
      for (const k of ["kind", "createdBy", "createdAt", "link"]) if (JSON.stringify(cur.data[k]) !== JSON.stringify(data[k])) throw forbidden("Only the group's name, members and deletion can change");
      if (cur.data.deletedAt && JSON.stringify(cur.data) !== JSON.stringify(data)) throw forbidden("That group chat was deleted");
      return;
    }
    // An existing conversation: only one's own membership may change
    const { members: oldMembers = [], ...oldRest } = cur.data;
    const { members: _n, ...newRest } = data;
    if (JSON.stringify(oldRest) !== JSON.stringify(newRest)) throw forbidden("Only the conversation's own changes can be made there");
    const before = new Set<string>(oldMembers), after = new Set(members);
    for (const m of new Set([...before, ...after])) if (before.has(m) !== after.has(m) && m !== me) throw forbidden("You can only add or remove yourself");
    if (!before.has(me) && after.has(me)) {
      // Joining: channels are open to everyone; direct conversations never; a thread only if you may see its client
      if (data.kind === "dm" || data.kind === "group") throw forbidden(data.kind === "dm" ? "You can't join someone else's direct conversation" : "Only the group's creator adds people");
      if (data.kind !== "channel") {
        const rec = data.link ? linked.get(`${data.link.type}:${data.link.id}`) : undefined;
        if (who.clients && (!rec || !who.clients.includes(rec.client))) throw forbidden("That thread is about a client you don't see");
      }
    }
  }
}

const CHAT: Kind[] = ["conv", "msg", "read", "presence"];

/** Saves one change from a device, or says which pieces changed in the meantime */
export async function push(db: Db, who: SyncWho, raw: Record<string, unknown>): Promise<PushResult> {
  const input = checked(raw);
  const rule = ACTION_RULES[input.type];
  if (!rule || rule === "local") throw bad(`"${input.type}" isn't saved on the server`);
  if (rule === "refused") throw forbidden("That can only be done in the device-only app");
  if (who.readOnly) throw new ApiError(403, "read-only", "This support session can look but not change anything");
  if (rule.can && !allows(who.base, who.perms, rule.can as Action)) throw forbidden();
  for (const c of input.changes) {
    const kind = kindOf(c.key)!;
    if (SERVER_ONLY.includes(kind) || !rule.kinds.includes(kind)) throw forbidden(`"${input.type}" can't change ${kind}`);
  }

  return db.tx(async q => {
    // One save at a time per warehouse, so change numbers follow the order changes are saved in
    const seq0 = Number((await q.query("SELECT seq FROM sync_state WHERE id = 1 FOR UPDATE")).rows[0].seq);
    const keys = input.changes.map(c => c.key);
    const dup = (await q.query("SELECT seq, actor_id FROM sync_log WHERE client_id = $1 AND client_seq = $2", [input.clientId, input.clientSeq])).rows[0];
    if (dup && dup.actor_id !== who.personId) throw bad("That change number belongs to someone else's device");
    if (dup) {
      // Sent again after the answer was lost: already saved
      const { rows } = await q.query("SELECT key, version FROM entities WHERE key = ANY($1)", [keys]);
      return { ok: true, seq: Number(dup.seq), versions: Object.fromEntries(rows.map(r => [r.key, r.version])) };
    }
    const cur = new Map<string, Row>(((await q.query("SELECT key, version, data, audience FROM entities WHERE key = ANY($1) FOR UPDATE", [keys])).rows as Row[]).map(r => [r.key, r]));
    const conflicts = input.changes.filter(c => (cur.get(c.key)?.version ?? 0) !== c.base).map(c => c.key);
    if (conflicts.length) return { ok: false, reason: "conflict", keys: conflicts };

    // Conversations the messages in this change belong to: in the change itself, or already saved
    const convIds = new Set<string>();
    for (const c of input.changes) {
      const k = kindOf(c.key);
      if (k === "msg" && c.data) convIds.add(String((c.data as any).conversationId));
      if (k === "read") convIds.add(readConv(c.key));
    }
    const inChange = new Map(input.changes.filter(c => kindOf(c.key) === "conv" && c.data).map(c => [idOf(c.key), c.data as any]));
    const missing = [...convIds].filter(id => !inChange.has(id)).map(id => `conv:${id}`);
    const saved = new Map<string, any>(missing.length ? (await q.query("SELECT key, data FROM entities WHERE key = ANY($1)", [missing])).rows.map(r => [idOf(r.key), r.data]) : []);
    const convOf = (id: string) => inChange.get(id) ?? saved.get(id) ?? null;
    // The order or delivery each changed thread is about (whose client decides who may join it)
    const links = [...new Set(input.changes.filter(c => kindOf(c.key) === "conv" && (c.data as any)?.link).map(c => `${(c.data as any).link.type === "shipment" ? "shipment" : "order"}:${(c.data as any).link.id}`))];
    const linked = new Map<string, any>(links.length ? (await q.query("SELECT key, data FROM entities WHERE key = ANY($1)", [links])).rows.map(r => [r.key, r.data]) : []);

    const rows = input.changes.map(c => {
      const kind = kindOf(c.key)!;
      const before = cur.get(c.key);
      if (APPEND_ONLY.includes(kind) && (before?.data || c.data === null)) throw forbidden(`The ${kind === "audit" ? "change log" : "movement log"} is never changed`);
      if (CHAT.includes(kind)) checkChat(who, c, before, convOf, linked);
      let data = c.data as any;
      // The log says who made the change as the server knows them, not as the device claims
      if (data && kind === "audit") data = { ...data, by: who.name, byId: who.personId ?? "support" };
      if (data && kind === "movement") data = { ...data, by: who.name };
      let audience = kind === "read" ? audienceOf("msg", { conversationId: readConv(c.key) }, convOf) : audienceOf(kind, data, convOf);
      // Someone taken out of (or leaving) a conversation still gets this one change, so their device learns it
      if (kind === "conv" && audience && Array.isArray(before?.data?.members)) audience = [...new Set([...audience, ...before.data.members.map(String)])];
      return { key: c.key, kind, data, audience };
    });

    const seq = seq0 + 1;
    const versions = await upsert(q, rows, seq, who.name);
    await q.query("UPDATE sync_state SET seq = $1 WHERE id = 1", [seq]);
    await q.query("INSERT INTO sync_log (seq, device_at, actor_id, actor_name, action, keys, client_id, client_seq) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [seq, input.at, who.personId, who.name, input.type, keys, input.clientId, input.clientSeq]);
    return { ok: true, seq, versions };
  });
}

/** Writes pieces with the next change number; returns their new versions */
async function upsert(q: Sql, rows: { key: string; kind: string; data: unknown; audience: string[] | null }[], seq: number, by: string): Promise<Record<string, number>> {
  const { rows: out } = await q.query(`INSERT INTO entities (key, kind, data, version, seq, created_seq, audience, updated_by)
    SELECT key, kind, data, 1, $2, $2, audience, $3 FROM jsonb_to_recordset($1::jsonb) AS x(key text, kind text, data jsonb, audience text[])
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, version = entities.version + 1, seq = EXCLUDED.seq, audience = EXCLUDED.audience, updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING key, version`, [JSON.stringify(rows), seq, by]);
  return Object.fromEntries(out.map(r => [r.key, r.version]));
}

/**
 * Pieces written by the WMS itself (an import, product edits, the preview's sample data): no version check, no
 * device. Runs inside the caller's transaction.
 */
export async function writeSystem(q: Sql, changes: { key: string; data: unknown }[], by: string, action: string): Promise<number> {
  let seq = Number((await q.query("SELECT seq FROM sync_state WHERE id = 1 FOR UPDATE")).rows[0].seq);
  if (!changes.length) return seq;
  const convs = new Map<string, any>(changes.filter(c => kindOf(c.key) === "conv" && c.data).map(c => [idOf(c.key), c.data]));
  const convIds = [...new Set(changes.map(c => (kindOf(c.key) === "msg" ? String((c.data as any)?.conversationId) : kindOf(c.key) === "read" ? readConv(c.key) : "")).filter(id => id && !convs.has(id)))];
  if (convIds.length) for (const r of (await q.query("SELECT key, data FROM entities WHERE key = ANY($1)", [convIds.map(id => `conv:${id}`)])).rows) convs.set(idOf(r.key), r.data);
  const convOf = (id: string) => convs.get(id) ?? null;
  const rows = changes.map(c => {
    const kind = kindOf(c.key);
    if (!kind) throw bad(`${c.key} has no valid key`);
    const audience = kind === "read" ? audienceOf("msg", { conversationId: readConv(c.key) }, convOf) : audienceOf(kind, c.data, convOf);
    return { key: c.key, kind, data: c.data, audience };
  });
  // In blocks the size of one device change, each with its own number, so a catch-up page never has to split one
  for (let i = 0; i < rows.length; i += SYNC_LIMITS.changesPerPush) {
    const block = rows.slice(i, i + SYNC_LIMITS.changesPerPush);
    seq++;
    await upsert(q, block, seq, by);
    await q.query("INSERT INTO sync_log (seq, actor_name, action, keys) VALUES ($1, $2, $3, $4)", [seq, by, action, block.slice(0, 50).map(c => c.key)]);
  }
  await q.query("UPDATE sync_state SET seq = $1 WHERE id = 1", [seq]);
  return seq;
}

/** Everything this person may receive that changed after `since` (oldest first, in pages) */
export async function pull(db: Sql, who: SyncWho, since: number): Promise<PullResult> {
  if (!Number.isInteger(since) || since < 0) throw bad("Since is missing");
  // Read the saved number first: every piece numbered up to it is already saved (numbers are given under a lock)
  const cur = Number((await db.query("SELECT seq FROM sync_state WHERE id = 1")).rows[0].seq);
  if (since >= cur) return { rows: [], seq: cur, more: false };
  const limit = SYNC_LIMITS.rowsPerPull;
  const { rows } = await db.query(
    `SELECT key, version AS v, seq AS s, created_seq AS c, data FROM entities
      WHERE seq > $1 AND seq <= $2 AND (audience IS NULL OR $3 = ANY(audience))
      ORDER BY seq, key LIMIT $4`, [since, cur, who.personId ?? "", limit + 1]);
  const out: SyncRow[] = rows.map(r => ({ key: r.key, v: r.v, s: Number(r.s), c: Number(r.c), data: r.data }));
  if (out.length <= limit) return { rows: out, seq: cur, more: false };
  // A page never splits one change: stop before the first change that didn't fit (a change is at most changesPerPush pieces)
  const cut = out[limit].s;
  const page = out.filter(r => r.s < cut);
  return { rows: page, seq: cut - 1, more: true };
}

/** Everyone in the warehouse, for Messages and for naming people (no emails or sign-in details) */
export async function directory(db: Sql): Promise<{ id: string; name: string; role: BaseRole; roleName: string; groups: string[]; clients: string[] | null }[]> {
  const { rows } = await db.query("SELECT p.id, p.name, r.base, r.name AS role_name, p.groups, p.clients FROM people p JOIN roles r ON r.id = p.role_id WHERE p.status = 'active' ORDER BY p.name");
  return rows.map(r => ({ id: r.id, name: r.name, role: r.base, roleName: r.role_name, groups: r.groups ?? [], clients: r.clients }));
}
