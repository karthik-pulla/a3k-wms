// The client portal's API (POST /portal/api/<method>, the page at <warehouse address>/portal): a client's people sign
// in and place orders or tell the warehouse about deliveries on their way. Every method runs in the warehouse's own
// database, like the warehouse API, but with its own accounts, sessions and cookie (client_accounts, client_sessions;
// auth.ts CLIENT_TABLES), so a client session opens no warehouse method and a warehouse session opens no portal method.
//
// A client login sees only its own client's products, and what its own client's logins sent; never stock, slots,
// other clients, the warehouse's people or its messages. Orders arrive as drafts in Out-bounds for a coordinator to
// approve, and delivery notices as expected deliveries in In-bounds, written the way the WMS writes an import
// (writeSystem), so every open device gets them with its next catch-up.
import { CLIENT_TABLES, createInvite, finishInvite, getSession, readInvite, setInvitePassword, signIn, signOut, verifyCode, type AuthEnv } from "./auth.ts";
import { randomToken } from "./crypto.ts";
import type { Sql } from "./db.ts";
import { ApiError, bad, bool, int, notFound, obj, str, username as usernameOf } from "./errors.ts";
import { portalInviteMail } from "./mail.ts";
import { writeSystem } from "./sync.ts";
import type { Result, TenantCtx } from "./tenant-api.ts";
import { PORTAL_LIMITS, type ClientLoginView, type InviteInfo, type LinkResult, type PortalMe, type PortalProduct, type PortalSent, type TenantPublic } from "../shared/api.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** The sign-in rules with the portal's own tables, and a security log that names client logins */
export function portalEnv(ctx: TenantCtx): AuthEnv {
  return { ...ctx.env, tables: CLIENT_TABLES, issuer: `${ctx.env.issuer} (client portal)`, log: portalLog(ctx.meta.ip) };
}

/** The warehouse's security log, with client logins named as such: "Priya (client portal, Sunfield)" */
export function portalLog(ip?: string): AuthEnv["log"] {
  return async (q, e) => {
    const name = async (v?: string) => {
      if (!v || !/^[0-9a-f-]{36}$/.test(v)) return v;
      const r = (await q.query("SELECT name, client FROM client_accounts WHERE id = $1", [v])).rows[0];
      return r ? `${r.name} (client portal, ${r.client})` : v;
    };
    await q.query("INSERT INTO security_log (actor, action, target, detail, ip) VALUES ($1, $2, $3, $4, $5)", [await name(e.actor), e.action, (await name(e.target)) ?? null, JSON.stringify(e.detail ?? {}), e.ip ?? ip ?? null]);
  };
}

const publicOf = (ctx: TenantCtx): TenantPublic => ({ id: ctx.tenant.id, name: ctx.tenant.name, appTitle: ctx.tenant.appTitle, mark: ctx.tenant.mark, languages: ctx.tenant.languages });
const clientName = (ctx: TenantCtx, id: string) => ctx.tenant.clients.find(c => c.id === id)?.name ?? id;

// ---------- Who's asking ----------
interface ClientWho { id: string; name: string; username: string; email: string | null; client: string; clientName: string }

async function who(ctx: TenantCtx): Promise<ClientWho> {
  const s = await getSession(portalEnv(ctx), ctx.token);
  if (!s) throw new ApiError(401, "not-signed-in", "Sign in again");
  const a = (await ctx.env.db.query("SELECT id, name, username, email, client, status FROM client_accounts WHERE id = $1", [s.person_id])).rows[0];
  if (!a || a.status !== "active") throw new ApiError(401, "not-signed-in", "Sign in again");
  // A client the warehouse no longer has: its logins stop working
  if (!ctx.tenant.clients.some(c => c.id === a.client)) throw new ApiError(401, "not-signed-in", "This login no longer works. Ask the warehouse.");
  return { id: a.id, name: a.name, username: a.username, email: a.email, client: a.client, clientName: clientName(ctx, a.client) };
}

const meOf = (ctx: TenantCtx, c: ClientWho): PortalMe => ({
  account: { id: c.id, name: c.name, username: c.username, email: c.email }, client: { id: c.client, name: c.clientName }, warehouse: publicOf(ctx),
});

// ---------- Checking what the browser sent ----------
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A date from today to a year ahead (yesterday too: the browser may be a time zone behind) */
function day(ctx: TenantCtx, v: unknown, name: string, optional: boolean): string | null {
  const s = str(v, name, { max: 10, optional });
  if (!s) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!DAY.test(s) || Number.isNaN(t) || iso(t).slice(0, 10) !== s) throw bad(`${name} must be a date`);
  const today = Date.parse(`${iso(ctx.env.now()).slice(0, 10)}T00:00:00Z`);
  if (t < today - 864e5 || t > today + 366 * 864e5) throw bad(`${name} must be from today to a year ahead`);
  return s;
}
/** The browser's own date (it may be a day either side of the server's), else the server's */
function localDay(ctx: TenantCtx, v: unknown): string {
  const server = iso(ctx.env.now()).slice(0, 10);
  if (typeof v !== "string" || !DAY.test(v)) return server;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && iso(t).slice(0, 10) === v && Math.abs(t - Date.parse(`${server}T00:00:00Z`)) <= 864e5 ? v : server;
}
const requestIdOf = (v: unknown) => {
  const s = str(v, "Request", { min: 8, max: 80 });
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw bad("Request is missing");
  return s;
};
function linesOf(v: unknown) {
  if (!Array.isArray(v) || !v.length || v.length > PORTAL_LIMITS.lines) throw bad(`Add 1–${PORTAL_LIMITS.lines} lines`);
  return v.map(raw => obj(raw));
}

/** The client's own active products among `ids`; any other id (another client's, or none) is refused the same way */
async function ownProducts(q: Sql, client: string, ids: string[]): Promise<Map<string, { id: string; code: string; name: string }>> {
  const { rows } = await q.query("SELECT id, code, name FROM products WHERE active AND client = $1 AND id = ANY($2)", [client, [...new Set(ids)]]);
  const by = new Map(rows.map(r => [r.id as string, r]));
  if (ids.some(id => !by.has(id))) throw bad("One of the products isn't on your list. Reload the page and try again.");
  return by;
}

const lineText = (ls: { productId: string; cases: number }[], by: Map<string, { code: string; name: string }>) =>
  ls.map(l => `${by.get(l.productId)?.code ?? ""} ${by.get(l.productId)?.name ?? l.productId} × ${l.cases}`.trim()).join(", ");
const auditId = (now: number) => `Aportal-${now.toString(36)}-${randomToken().slice(0, 6)}`;

/** One save at a time per warehouse (the same lock devices' saves take), so the next free number stays free */
const lockSaves = (q: Sql) => q.query("SELECT seq FROM sync_state WHERE id = 1 FOR UPDATE");

// ---------- What the client sent, and where it stands ----------
async function sentList(db: Sql, client: string, onlyKey?: string): Promise<PortalSent[]> {
  const { rows } = await db.query(
    `SELECT s.kind, s.entity_key, s.created_at, a.name AS by, e.data FROM portal_submissions s
       JOIN client_accounts a ON a.id = s.account_id LEFT JOIN entities e ON e.key = s.entity_key
      WHERE s.client = $1 AND ($2::text IS NULL OR s.entity_key = $2) ORDER BY s.created_at DESC, s.id LIMIT 100`, [client, onlyKey ?? null]);
  const ids = [...new Set(rows.flatMap(r => (Array.isArray(r.data?.lines) ? r.data.lines.map((l: any) => String(l.productId)) : [])))];
  const products = new Map(ids.length ? (await db.query("SELECT id, code, name FROM products WHERE client = $1 AND id = ANY($2)", [client, ids])).rows.map(r => [r.id as string, r]) : []);
  const out: PortalSent[] = [];
  for (const r of rows) {
    const d = r.data;
    // Moved to another client by the warehouse: no longer this client's to see
    if (d && d.client !== client) continue;
    const base = { key: r.entity_key as string, sentAt: isoOrNull(r.created_at)!, sentBy: r.by as string };
    // Only the client's own products; never slots, picks, lots planned or notes the warehouse added
    const sum = new Map<string, { code: string; name: string; cases: number; pallets: number }>();
    for (const l of Array.isArray(d?.lines) ? d.lines : []) {
      const p = products.get(String(l.productId));
      if (!p) continue;
      const cur = sum.get(p.id) ?? { code: p.code, name: p.name, cases: 0, pallets: 0 };
      cur.cases += Number(l.cases) || 0; cur.pallets += 1;
      sum.set(p.id, cur);
    }
    const id = String(r.entity_key).slice(String(r.entity_key).indexOf(":") + 1);
    if (r.kind === "order") {
      out.push({ ...base, kind: "order", id, status: d ? d.status ?? "draft" : "removed", store: d?.store ?? "", ref: d?.ref || null, due: d?.due || null, lines: [...sum.values()].map(({ pallets: _p, ...l }) => l) });
    } else {
      out.push({ ...base, kind: "delivery", id, number: d?.number ?? "", status: d ? d.status ?? "incoming" : "removed", expected: d?.expected ?? "", ref: d?.ref || null, lines: [...sum.values()] });
    }
  }
  return out;
}

// ---------- The methods ----------
type Method = (input: Record<string, unknown>, ctx: TenantCtx) => Promise<Result>;
const ok = (body: unknown = { ok: true }): Result => ({ body });

export const PORTAL_METHODS: Record<string, Method> = {
  // ----- Before sign-in -----
  "portal.public": async (_i, ctx) => ok(publicOf(ctx)),
  "auth.signIn": async (i, ctx) => ok(await signIn(portalEnv(ctx), { username: usernameOf(i.username), password: str(i.password, "Password", { max: 200 }), keep: bool(i.keep) }, ctx.meta)),
  "auth.verify": async (i, ctx) => {
    const s = await verifyCode(portalEnv(ctx), { ticket: str(i.ticket, "Ticket", { max: 100 }), code: str(i.code, "Code", { max: 10 }) }, ctx.meta);
    return { body: meOf(ctx, await who({ ...ctx, token: s.token })), session: s };
  },
  "invite.read": async (i, ctx) => ok({ ...(await readInvite(portalEnv(ctx), str(i.token, "Link", { max: 100 }))), warehouse: publicOf(ctx) } satisfies InviteInfo),
  "invite.password": async (i, ctx) => ok(await setInvitePassword(portalEnv(ctx), str(i.token, "Link", { max: 100 }), str(i.password, "Password", { max: 200 }))),
  "invite.finish": async (i, ctx) => {
    const s = await finishInvite(portalEnv(ctx), str(i.token, "Link", { max: 100 }), str(i.code, "Code", { max: 10 }), ctx.meta);
    return { body: meOf(ctx, await who({ ...ctx, token: s.token })), session: s };
  },

  // ----- Signed in -----
  "auth.me": async (_i, ctx) => ok(meOf(ctx, await who(ctx))),
  "auth.signOut": async (_i, ctx) => { await signOut(portalEnv(ctx), ctx.token); return { body: { ok: true }, session: "clear" }; },

  /** The client's own products, to order or announce (no stock, no locations) */
  "products": async (_i, ctx) => {
    const c = await who(ctx);
    const { rows } = await ctx.env.db.query("SELECT id, code, name, brand, size, units FROM products WHERE active AND client = $1 ORDER BY code, name, id", [c.client]);
    return ok(rows.map((r): PortalProduct => ({ id: r.id, code: r.code, name: r.name, brand: r.brand, size: r.size, units: r.units ?? null })));
  },
  "sent": async (_i, ctx) => { const c = await who(ctx); return ok(await sentList(ctx.env.db, c.client)); },

  /** An order for a store: a draft in Out-bounds, for a coordinator to check and approve */
  "order.send": async (i, ctx) => {
    const c = await who(ctx);
    const requestId = requestIdOf(i.requestId);
    const store = str(i.store, "Store", { max: PORTAL_LIMITS.store });
    const ref = str(i.ref, "PO number", { max: PORTAL_LIMITS.ref, optional: true });
    const due = day(ctx, i.due, "Due date", true);
    const notes = str(i.notes, "Notes", { max: PORTAL_LIMITS.notes, optional: true });
    // The order date is the client's own day (their browser's), within a day of the server's
    const orderDay = localDay(ctx, i.today);
    const merged = new Map<string, number>();
    for (const l of linesOf(i.lines)) {
      const id = str(l.productId, "Product", { max: 80 });
      merged.set(id, Math.min(PORTAL_LIMITS.cases, (merged.get(id) ?? 0) + int(l.cases, "Cases", 1, PORTAL_LIMITS.cases)));
    }
    const lines = [...merged].map(([productId, cases]) => ({ productId, cases }));
    const key = await ctx.env.db.tx(async q => {
      await lockSaves(q);
      const dup = (await q.query("SELECT entity_key FROM portal_submissions WHERE account_id = $1 AND request_id = $2", [c.id, requestId])).rows[0];
      if (dup) return dup.entity_key as string;
      const by = await ownProducts(q, c.client, lines.map(l => l.productId));
      // The next order number after every order there has ever been (the app counts the same way: outbound/plan.ts)
      const n = Number((await q.query("SELECT coalesce(max(substring(key from '(\\d{1,9})$')::int), 0) AS n FROM entities WHERE kind = 'order'")).rows[0].n);
      const id = `Order ${n + 1}`;
      const now = ctx.env.now(), at = iso(now), byName = `${c.name} (client portal)`;
      const order = {
        id, store, client: c.client, date: orderDay, ...(due ? { due } : {}), ...(ref ? { ref } : {}), lines, status: "draft", source: "portal",
        sourceName: `${c.name} (@${c.username}, ${c.clientName})`, ...(notes ? { notes: `From ${c.name}: ${notes}` } : {}), createdBy: byName, createdAt: at,
      };
      const audit = { id: auditId(now), at, byId: `portal:${c.id}`, by: byName, area: "outbound", action: `Created ${id} for ${store} from the client portal (${c.clientName}): ${lineText(lines, by)}` };
      await writeSystem(q, [{ key: `order:${id}`, data: order }, { key: `audit:${audit.id}`, data: audit }], byName, "portal order");
      await q.query("INSERT INTO portal_submissions (account_id, client, kind, entity_key, request_id) VALUES ($1, $2, 'order', $3, $4)", [c.id, c.client, `order:${id}`, requestId]);
      return `order:${id}`;
    });
    return ok((await sentList(ctx.env.db, c.client, key))[0] ?? null);
  },

  /** A delivery on its way (ASN): an expected delivery in In-bounds → Incoming, one line per pallet */
  "delivery.send": async (i, ctx) => {
    const c = await who(ctx);
    const requestId = requestIdOf(i.requestId);
    const expected = day(ctx, i.expected, "Expected date", false)!;
    const ref = str(i.ref, "Container / BOL", { max: PORTAL_LIMITS.ref, optional: true });
    const supplierIn = str(i.supplier, "Supplier", { max: PORTAL_LIMITS.supplier, optional: true });
    const notes = str(i.notes, "Notes", { max: PORTAL_LIMITS.notes, optional: true });
    const asked = linesOf(i.lines).map(l => {
      const bestBefore = str(l.bestBefore, "Best before", { max: 7, optional: true });
      if (bestBefore && !/^\d{4}-(0[1-9]|1[0-2])$/.test(bestBefore)) throw bad("Best before must be a month (YYYY-MM)");
      return {
        productId: str(l.productId, "Product", { max: 80 }), cases: int(l.cases, "Cases", 1, PORTAL_LIMITS.cases),
        pallets: l.pallets === undefined ? 1 : int(l.pallets, "Pallets", 1, PORTAL_LIMITS.palletsPerLine),
        lot: str(l.lot, "Lot", { max: PORTAL_LIMITS.lot, optional: true }), bestBefore,
      };
    });
    if (asked.some(l => l.pallets > l.cases)) throw bad("Each pallet needs at least one case");
    if (asked.reduce((s, l) => s + l.pallets, 0) > PORTAL_LIMITS.pallets) throw bad(`At most ${PORTAL_LIMITS.pallets} pallets in one delivery`);
    // One line per pallet, as the warehouse records a delivery; a line's cases are shared out over its pallets
    const lines: { key: string; productId: string; cases: number; pallet: number; lot: string; bestBefore: string }[] = [];
    for (const l of asked) {
      const each = Math.floor(l.cases / l.pallets), extra = l.cases % l.pallets;
      for (let p = 0; p < l.pallets; p++) lines.push({ key: `p${lines.length + 1}`, productId: l.productId, cases: each + (p < extra ? 1 : 0), pallet: lines.length + 1, lot: l.lot, bestBefore: l.bestBefore });
    }
    const key = await ctx.env.db.tx(async q => {
      await lockSaves(q);
      const dup = (await q.query("SELECT entity_key FROM portal_submissions WHERE account_id = $1 AND request_id = $2", [c.id, requestId])).rows[0];
      if (dup) return dup.entity_key as string;
      const by = await ownProducts(q, c.client, lines.map(l => l.productId));
      // The next delivery number (In-bounds → New delivery counts the same way), and its id "<client>-<number>"
      let n = Math.max(1000, Number((await q.query("SELECT coalesce(max(substring(data->>'number' from '^(\\d{1,9})$')::int), 0) AS n FROM entities WHERE kind = 'shipment' AND data IS NOT NULL")).rows[0].n)) + 1;
      const idOf = (num: number) => `${c.client}-${num}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      while ((await q.query("SELECT 1 FROM entities WHERE key = $1", [`shipment:${idOf(n)}`])).rows.length) n++;
      const id = idOf(n), number = String(n);
      const config = (await q.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
      const supplier = supplierIn || ((config?.clients ?? []).find((x: any) => x?.id === c.client)?.defaultSupplier ?? "");
      const now = ctx.env.now(), at = iso(now), byName = `${c.name} (client portal)`;
      const shipment = { id, client: c.client, number, supplier, ref, expected, status: "incoming", lines, notes: `From the client portal (${c.name}, @${c.username})${notes ? `: ${notes}` : ""}` };
      const audit = { id: auditId(now), at, byId: `portal:${c.id}`, by: byName, area: "inbound", action: `Added delivery ${c.client} ${number} from the client portal: ${lineText(lines, by)}` };
      await writeSystem(q, [{ key: `shipment:${id}`, data: shipment }, { key: `audit:${audit.id}`, data: audit }], byName, "portal delivery notice");
      await q.query("INSERT INTO portal_submissions (account_id, client, kind, entity_key, request_id) VALUES ($1, $2, 'delivery', $3, $4)", [c.id, c.client, `shipment:${id}`, requestId]);
      return `shipment:${id}`;
    });
    return ok((await sentList(ctx.env.db, c.client, key))[0] ?? null);
  },
};

export async function callPortal(method: string, input: unknown, ctx: TenantCtx): Promise<Result> {
  const m = Object.hasOwn(PORTAL_METHODS, method) ? PORTAL_METHODS[method] : undefined;
  if (!m) throw notFound("No such method");
  return m(input === undefined ? {} : obj(input), ctx);
}

// ---------- For the warehouse's owners (tenant-api.ts, clientLogins.*): the portal's logins ----------
export async function clientLoginViews(ctx: TenantCtx, q: Sql, id?: string): Promise<ClientLoginView[]> {
  const { rows } = await q.query(
    `SELECT a.id, a.name, a.username, a.email, a.client, a.status, a.last_sign_in_at, a.created_at,
            (SELECT i.kind FROM client_invites i WHERE i.person_id = a.id AND i.used_at IS NULL AND i.expires_at > $2 ORDER BY i.created_at DESC LIMIT 1) AS link_pending
       FROM client_accounts a WHERE ($1::uuid IS NULL OR a.id = $1) ORDER BY lower(a.client), lower(a.name)`, [id ?? null, iso(ctx.env.now())]);
  return rows.map(r => ({
    id: r.id, name: r.name, username: r.username, email: r.email, client: r.client, clientName: clientName(ctx, r.client), status: r.status,
    linkPending: r.link_pending ?? null, lastSignInAt: isoOrNull(r.last_sign_in_at), createdAt: isoOrNull(r.created_at)!,
  }));
}

/** An invite or reset link for a client login: <warehouse address>/portal#/invite/<token> (after #, so it never reaches logs) */
export async function portalLink(ctx: TenantCtx, q: Sql, a: { personId: string; kind: "invite" | "reset"; by: string }): Promise<LinkResult> {
  const token = await createInvite(portalEnv(ctx), q, a.personId, a.kind, a.by);
  const link = `${ctx.portalUrl ?? `${ctx.baseUrl}/portal`}#/invite/${token}`;
  const r = (await q.query("SELECT name, email, client FROM client_accounts WHERE id = $1", [a.personId])).rows[0];
  const emailed = r?.email ? await ctx.mailer.send(portalInviteMail({ to: r.email, name: r.name, warehouse: ctx.tenant.appTitle, client: clientName(ctx, r.client), link, kind: a.kind, from: a.by })) : false;
  return { link, emailed };
}
