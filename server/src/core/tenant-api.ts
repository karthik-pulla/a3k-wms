// The warehouse API: one function per method, called by the HTTP server (POST /api/<method>) and by the app's
// preview. Every method runs in one warehouse's own database (ctx.env.db) and checks who's asking first.
import {
  confirmPassword, createInvite, endSessions, finishInvite, getSession, needConfirmed, readInvite, setInvitePassword,
  signIn, signOut, verifyCode, createSession, type AuthEnv, type Meta, type SessionRow,
} from "./auth.ts";
import { randomToken, tokenId } from "./crypto.ts";
import type { Sql } from "./db.ts";
import { ApiError, bad, bool, email as emailOf, forbidden, int, notFound, obj, str, strList, username as usernameOf } from "./errors.ts";
import { inviteMail, type Mailer } from "./mail.ts";
import { allows, cleanPermissions, effective, roleProblems, type Action, type BaseRole, type Permissions } from "../shared/permissions.ts";
import { cleanProductText, productChanges, productEditProblems, PRODUCT_LIMITS, type ProductText } from "../shared/products.ts";
import type { GrantView, InviteInfo, LinkResult, LogView, Me, PersonView, RequestView, RoleView, TenantPublic } from "../shared/api.ts";

export interface TenantCtx {
  env: AuthEnv;
  tenant: TenantPublic & { id: string; clients: { id: string; name: string }[]; groups: { id: string; name: string }[] };
  /** The session cookie, if any */
  token?: string;
  meta: Meta;
  /** e.g. https://a3k.example.com: invite links start with it */
  baseUrl: string;
  mailer: Mailer;
}

/** What a method returns; `session` sets or clears the cookie */
export interface Result { body: unknown; session?: { token: string; maxAgeSec: number } | "clear" }

const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// ---------- Who's asking ----------
interface Actor {
  session: SessionRow;
  /** The person (null for a support session) */
  person: { id: string; name: string; username: string; email: string | null; role_id: string; role_name: string; base: BaseRole; permissions: Permissions; clients: string[] | null; groups: string[] } | null;
  support: { grantId: string; operator: string; canChange: boolean; endsAt: string } | null;
  /** For logs: "Maya" or "Support: Jane (WMS team)" */
  name: string;
  base: BaseRole;
  perms: Permissions;
}

async function actor(ctx: TenantCtx): Promise<Actor> {
  const s = await getSession(ctx.env, ctx.token);
  if (!s) throw new ApiError(401, "not-signed-in", "Sign in again");
  if (s.support_grant_id) {
    const { rows } = await ctx.env.db.query("SELECT operator_name, can_change, ends_at FROM support_grants WHERE id = $1 AND status = 'active' AND ends_at > $2", [s.support_grant_id, iso(ctx.env.now())]);
    if (!rows[0]) throw new ApiError(401, "not-signed-in", "Support access has ended");
    const g = rows[0];
    return { session: s, person: null, support: { grantId: s.support_grant_id, operator: g.operator_name, canChange: g.can_change, endsAt: isoOrNull(g.ends_at)! }, name: `Support: ${g.operator_name} (WMS team)`, base: "owner", perms: {} };
  }
  const { rows } = await ctx.env.db.query(
    `SELECT p.id, p.name, p.username, p.email, p.role_id, r.name AS role_name, r.base, r.permissions, p.clients, p.groups, p.status
       FROM people p JOIN roles r ON r.id = p.role_id WHERE p.id = $1`, [s.person_id]);
  const p = rows[0];
  if (!p || p.status !== "active") throw new ApiError(401, "not-signed-in", "Sign in again");
  return { session: s, person: p, support: null, name: p.name, base: p.base, perms: p.permissions ?? {} };
}

/** May they? Owner-only powers (people, roles, support access) are never done through a support session. */
function must(a: Actor, action: Action) {
  if (a.support && ["manage-people", "manage-support", "manage-settings"].includes(action)) throw forbidden("Support sessions can't change people, roles or access. Use the ops console.");
  if (!allows(a.base, a.perms, action)) throw forbidden();
}
/** Support may look; changing anything needs a grant that allows it */
function mayChange(a: Actor) {
  if (a.support && !a.support.canChange) throw new ApiError(403, "read-only", "This support session can look but not change anything");
}

async function log(ctx: TenantCtx, q: Sql, a: { actor: string; action: string; target?: string; detail?: Record<string, unknown> }) {
  await q.query("INSERT INTO security_log (actor, action, target, detail, ip) VALUES ($1, $2, $3, $4, $5)", [a.actor, a.action, a.target ?? null, JSON.stringify(a.detail ?? {}), ctx.meta.ip ?? null]);
}

/** The log in auth.ts names people by id; the security log shows names */
export function tenantLog(ip?: string): AuthEnv["log"] {
  return async (q, e) => {
    const looksLikeId = (v?: string) => !!v && /^[0-9a-f-]{36}$/.test(v);
    const name = async (v?: string) => (looksLikeId(v) ? (await q.query("SELECT name FROM people WHERE id = $1", [v])).rows[0]?.name ?? v : v);
    await q.query("INSERT INTO security_log (actor, action, target, detail, ip) VALUES ($1, $2, $3, $4, $5)", [await name(e.actor), e.action, (await name(e.target)) ?? null, JSON.stringify(e.detail ?? {}), e.ip ?? ip ?? null]);
  };
}

// ---------- Views ----------
async function me(ctx: TenantCtx, a: Actor): Promise<Me> {
  const { rows } = await ctx.env.db.query("SELECT operator_name, ends_at, emergency FROM support_grants WHERE status = 'active' AND ends_at > $1 ORDER BY ends_at", [iso(ctx.env.now())]);
  const p = a.person;
  return {
    person: p
      ? { id: p.id, name: p.name, username: p.username, email: p.email, roleId: p.role_id, roleName: p.role_name, base: p.base, clients: p.clients, groups: p.groups }
      : { id: `support-${a.support!.grantId}`, name: a.name, username: "support", email: null, roleId: "owner", roleName: a.support!.canChange ? "Support" : "Support (look only)", base: "owner", clients: null, groups: [] },
    perms: a.perms,
    // Support looks in as an owner would, but never manages people, settings or access (that's the ops console's job)
    can: a.support ? { ...effective(a.base, a.perms), "manage-people": false, "manage-settings": false, "manage-support": false } : effective(a.base, a.perms),
    support: a.support ? { operator: a.support.operator, canChange: a.support.canChange, endsAt: a.support.endsAt } : null,
    supportActive: rows.map(r => ({ operator: r.operator_name, endsAt: isoOrNull(r.ends_at)!, emergency: r.emergency })),
    tenant: publicOf(ctx),
  };
}
const publicOf = (ctx: TenantCtx): TenantPublic => ({ id: ctx.tenant.id, name: ctx.tenant.name, appTitle: ctx.tenant.appTitle, mark: ctx.tenant.mark, languages: ctx.tenant.languages });

async function personView(q: Sql, where: string, values: unknown[]): Promise<PersonView[]> {
  const { rows } = await q.query(
    `SELECT p.id, p.name, p.username, p.email, p.role_id, r.name AS role_name, r.base, p.clients, p.groups, p.status, p.last_sign_in_at, p.created_at,
            (SELECT i.kind FROM invites i WHERE i.person_id = p.id AND i.used_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC LIMIT 1) AS link_pending
       FROM people p JOIN roles r ON r.id = p.role_id ${where} ORDER BY lower(p.name)`, values);
  return rows.map(r => ({
    id: r.id, name: r.name, username: r.username, email: r.email, roleId: r.role_id, roleName: r.role_name, base: r.base, clients: r.clients, groups: r.groups,
    status: r.status, linkPending: r.link_pending ?? null, lastSignInAt: isoOrNull(r.last_sign_in_at), createdAt: isoOrNull(r.created_at)!,
  }));
}

const grantView = (r: any): GrantView => ({
  id: r.id, operator: r.operator_name, reason: r.reason, ticket: r.ticket, canChange: r.can_change, emergency: r.emergency, minutes: r.minutes,
  status: r.status, requestedAt: isoOrNull(r.requested_at)!, startsAt: isoOrNull(r.starts_at), endsAt: isoOrNull(r.ends_at), decidedBy: r.decided_by,
});

// ---------- Checks on people and roles ----------
const clientsOf = (ctx: TenantCtx, v: unknown): string[] | null => {
  if (v === null || v === undefined) return null;
  const list = strList(v, "Clients");
  for (const c of list) if (!ctx.tenant.clients.some(x => x.id === c)) throw bad(`Unknown client ${c}`);
  return list;
};
const groupsOf = (ctx: TenantCtx, v: unknown): string[] => {
  const list = v === undefined ? [] : strList(v, "Groups");
  for (const g of list) if (!["owners", "coordinators", ...ctx.tenant.groups.map(x => x.id)].includes(g)) throw bad(`Unknown group ${g}`);
  return list;
};
async function roleOf(q: Sql, id: unknown): Promise<{ id: string; base: BaseRole }> {
  const { rows } = await q.query("SELECT id, base FROM roles WHERE id = $1", [str(id, "Role", { max: 40 })]);
  if (!rows[0]) throw bad("Unknown role");
  return rows[0];
}
/** There must always be at least one owner who can sign in */
async function keepAnOwner(q: Sql, exceptPersonId: string) {
  const { rows } = await q.query("SELECT count(*)::int AS n FROM people p JOIN roles r ON r.id = p.role_id WHERE r.base = 'owner' AND p.status = 'active' AND p.id <> $1", [exceptPersonId]);
  if (rows[0].n < 1) throw new ApiError(409, "conflict", "The warehouse needs at least one active owner. Make someone else an owner first.");
}

async function makeLink(ctx: TenantCtx, q: Sql, a: { personId: string; kind: "invite" | "reset"; by: string }): Promise<LinkResult> {
  const token = await createInvite(ctx.env, q, a.personId, a.kind, a.by);
  // The token is after #, so it never reaches server logs or other sites (Referer)
  const link = `${ctx.baseUrl}/#/invite/${token}`;
  const { rows } = await q.query("SELECT name, email FROM people WHERE id = $1", [a.personId]);
  const emailed = rows[0]?.email ? await ctx.mailer.send(inviteMail({ to: rows[0].email, name: rows[0].name, warehouse: ctx.tenant.appTitle, link, kind: a.kind, from: a.by })) : false;
  return { link, emailed };
}

const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "role";

// ---------- The methods ----------
type Method = (input: Record<string, unknown>, ctx: TenantCtx) => Promise<Result>;
const ok = (body: unknown = { ok: true }): Result => ({ body });

const PRODUCT_COLS = "id, client, brand, code, name, category, size, units, per_pallet, item";
/** A products row as the app's Product (app/src/tenant/types.ts) */
const productView = (r: any) => ({ id: r.id, client: r.client, brand: r.brand, code: r.code, name: r.name, cat: r.category, size: r.size, units: r.units, perPallet: r.per_pallet, item: r.item });

export const TENANT_METHODS: Record<string, Method> = {
  // ----- Before sign-in -----
  "tenant.public": async (_i, ctx) => ok(publicOf(ctx)),

  "auth.signIn": async (i, ctx) => ok(await signIn(ctx.env, { username: usernameOf(i.username), password: str(i.password, "Password", { max: 200 }), keep: bool(i.keep) }, ctx.meta)),

  "auth.verify": async (i, ctx) => {
    const s = await verifyCode(ctx.env, { ticket: str(i.ticket, "Ticket", { max: 100 }), code: str(i.code, "Code", { max: 10 }) }, ctx.meta);
    return { body: await me({ ...ctx, token: s.token }, await actor({ ...ctx, token: s.token })), session: s };
  },

  "invite.read": async (i, ctx) => {
    const v = await readInvite(ctx.env, str(i.token, "Link", { max: 100 }));
    return ok({ ...v, warehouse: publicOf(ctx) } satisfies InviteInfo);
  },
  "invite.password": async (i, ctx) => ok(await setInvitePassword(ctx.env, str(i.token, "Link", { max: 100 }), str(i.password, "Password", { max: 200 }))),
  "invite.finish": async (i, ctx) => {
    const s = await finishInvite(ctx.env, str(i.token, "Link", { max: 100 }), str(i.code, "Code", { max: 10 }), ctx.meta);
    return { body: await me({ ...ctx, token: s.token }, await actor({ ...ctx, token: s.token })), session: s };
  },

  /** "Ask for an account" on the sign-in screen: only owners see it */
  "requests.create": async (i, ctx) => {
    const name = str(i.name, "Name", { max: 80 }), user = usernameOf(i.username), mail = emailOf(i.email), note = str(i.note, "Note", { max: 300, optional: true });
    const { rows } = await ctx.env.db.query("SELECT count(*)::int AS n FROM account_requests WHERE status = 'pending'");
    if (rows[0].n >= 50) throw new ApiError(429, "busy", "There are too many requests waiting. Ask your manager.");
    await ctx.env.db.query("INSERT INTO account_requests (name, username, email, note) VALUES ($1, $2, $3, $4)", [name, user, mail, note]);
    return ok();
  },

  // ----- Signed in -----
  "auth.me": async (_i, ctx) => ok(await me(ctx, await actor(ctx))),
  "auth.signOut": async (_i, ctx) => { await signOut(ctx.env, ctx.token); return { body: { ok: true }, session: "clear" }; },
  "auth.signOutEverywhere": async (_i, ctx) => {
    const a = await actor(ctx);
    if (!a.person) throw forbidden();
    await ctx.env.db.tx(async q => { await endSessions(ctx.env, q, a.person!.id); await log(ctx, q, { actor: a.name, action: "signed out on every device" }); });
    return { body: { ok: true }, session: "clear" };
  },
  "auth.confirm": async (i, ctx) => { const a = await actor(ctx); await confirmPassword(ctx.env, a.session, str(i.password, "Password", { max: 200 }), ctx.meta); return ok(); },

  // ----- The warehouse's settings and products (what the app loads after sign-in) -----
  "tenant.config": async (_i, ctx) => {
    await actor(ctx);
    const { rows } = await ctx.env.db.query("SELECT key, value FROM settings WHERE key IN ('config', 'logos')");
    const by = new Map(rows.map(r => [r.key, r.value]));
    return ok({ config: by.get("config") ?? null, logos: by.get("logos") ?? {} });
  },
  "tenant.products": async (_i, ctx) => {
    await actor(ctx);
    const { rows } = await ctx.env.db.query(`SELECT ${PRODUCT_COLS} FROM products WHERE active ORDER BY client, code, id`);
    return ok(rows.map(productView));
  },
  /** Code, name and full description; the id stays. `expect` is what the editor saw, so two people can't overwrite each other unseen. */
  "products.update": async (i, ctx) => {
    const a = await actor(ctx); must(a, "edit-products"); mayChange(a);
    const id = str(i.id, "Product", { max: 80 });
    const next = cleanProductText({ code: str(i.code, "Code", { max: PRODUCT_LIMITS.code }), name: str(i.name, "Name", { max: PRODUCT_LIMITS.name }), item: str(i.item, "Full description", { max: PRODUCT_LIMITS.item }) });
    const reason = str(i.reason, "Reason", { min: 4, max: PRODUCT_LIMITS.reason });
    const problems = productEditProblems(next, reason);
    if (problems.length) throw bad(problems.join(". "));
    return ok(await ctx.env.db.tx(async q => {
      const cur = (await q.query(`SELECT ${PRODUCT_COLS} FROM products WHERE id = $1 AND active FOR UPDATE`, [id])).rows[0];
      if (!cur) throw notFound();
      if (a.person?.clients && !a.person.clients.includes(cur.client)) throw notFound();
      const before: ProductText = { code: cur.code, name: cur.name, item: cur.item ?? "" };
      if (i.expect !== undefined) {
        const e = obj(i.expect);
        if (e.code !== before.code || e.name !== before.name || (e.item ?? "") !== before.item) throw new ApiError(409, "conflict", "Someone else changed this product a moment ago. Look at it again before saving.");
      }
      if (!productChanges(before, next)) return productView(cur);
      const { rows } = await q.query(`UPDATE products SET code = $2, name = $3, item = $4, updated_at = now(), updated_by = $5 WHERE id = $1 RETURNING ${PRODUCT_COLS}`, [id, next.code, next.name, next.item, a.name]);
      await q.query("INSERT INTO product_changes (product_id, changed_by, reason, before, after) VALUES ($1, $2, $3, $4, $5)", [id, a.name, reason, JSON.stringify(before), JSON.stringify(next)]);
      return productView(rows[0]);
    }));
  },

  // ----- People -----
  "people.list": async (_i, ctx) => { must(await actor(ctx), "manage-people"); return ok(await personView(ctx.env.db, "", [])); },

  "people.invite": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session);
    return ok(await ctx.env.db.tx(async q => {
      const user = usernameOf(i.username);
      if ((await q.query("SELECT 1 FROM people WHERE username = $1", [user])).rows.length) throw new ApiError(409, "conflict", `The username ${user} is taken`);
      const role = await roleOf(q, i.roleId);
      const { rows } = await q.query("INSERT INTO people (username, name, email, role_id, clients, groups, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [user, str(i.name, "Name", { max: 80 }), emailOf(i.email), role.id, role.base === "owner" ? null : clientsOf(ctx, i.clients), groupsOf(ctx, i.groups), a.name]);
      const link = await makeLink(ctx, q, { personId: rows[0].id, kind: "invite", by: a.name });
      await log(ctx, q, { actor: a.name, action: "invited", target: user, detail: { role: role.id } });
      return { person: (await personView(q, "WHERE p.id = $1", [rows[0].id]))[0], ...link };
    }));
  },

  "people.update": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people");
    const id = str(i.id, "Person", { max: 40 });
    return ok(await ctx.env.db.tx(async q => {
      const cur = (await q.query("SELECT p.id, p.role_id, r.base FROM people p JOIN roles r ON r.id = p.role_id WHERE p.id = $1 FOR UPDATE OF p", [id])).rows[0];
      if (!cur) throw notFound();
      const changes: Record<string, unknown> = {};
      if (i.roleId !== undefined && i.roleId !== cur.role_id) {
        needConfirmed(ctx.env, a.session);
        if (a.person?.id === id) throw forbidden("You can't change your own role. Ask another owner.");
        const role = await roleOf(q, i.roleId);
        if (cur.base === "owner" && role.base !== "owner") await keepAnOwner(q, id);
        await q.query("UPDATE people SET role_id = $2 WHERE id = $1", [id, role.id]);
        changes.role = role.id;
      }
      if (i.name !== undefined) { await q.query("UPDATE people SET name = $2 WHERE id = $1", [id, str(i.name, "Name", { max: 80 })]); changes.name = true; }
      if (i.email !== undefined) { await q.query("UPDATE people SET email = $2 WHERE id = $1", [id, emailOf(i.email)]); changes.email = true; }
      if (i.clients !== undefined) { await q.query("UPDATE people SET clients = $2 WHERE id = $1", [id, clientsOf(ctx, i.clients)]); changes.clients = i.clients; }
      if (i.groups !== undefined) { await q.query("UPDATE people SET groups = $2 WHERE id = $1", [id, groupsOf(ctx, i.groups)]); changes.groups = i.groups; }
      const p = (await personView(q, "WHERE p.id = $1", [id]))[0];
      if (Object.keys(changes).length) await log(ctx, q, { actor: a.name, action: "changed account", target: p.username, detail: changes });
      return p;
    }));
  },

  "people.disable": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session);
    const id = str(i.id, "Person", { max: 40 });
    if (a.person?.id === id) throw forbidden("You can't turn off your own account");
    return ok(await ctx.env.db.tx(async q => {
      const cur = (await q.query("SELECT p.username, r.base FROM people p JOIN roles r ON r.id = p.role_id WHERE p.id = $1 FOR UPDATE OF p", [id])).rows[0];
      if (!cur) throw notFound();
      if (cur.base === "owner") await keepAnOwner(q, id);
      await q.query("UPDATE people SET status = 'disabled' WHERE id = $1", [id]);
      await q.query("UPDATE invites SET used_at = now() WHERE person_id = $1 AND used_at IS NULL", [id]);
      await endSessions(ctx.env, q, id);
      await log(ctx, q, { actor: a.name, action: "turned off account", target: cur.username });
      return (await personView(q, "WHERE p.id = $1", [id]))[0];
    }));
  },

  "people.enable": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session);
    const id = str(i.id, "Person", { max: 40 });
    return ok(await ctx.env.db.tx(async q => {
      const cur = (await q.query("SELECT username, password_hash IS NOT NULL AND totp_secret IS NOT NULL AS ready FROM people WHERE id = $1 AND status = 'disabled' FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound();
      // Someone who never finished joining gets a fresh invite instead
      await q.query("UPDATE people SET status = $2, failed_count = 0, locked_until = NULL WHERE id = $1", [id, cur.ready ? "active" : "invited"]);
      const link = cur.ready ? null : await makeLink(ctx, q, { personId: id, kind: "invite", by: a.name });
      await log(ctx, q, { actor: a.name, action: "turned account back on", target: cur.username });
      return { person: (await personView(q, "WHERE p.id = $1", [id]))[0], ...(link ?? {}) };
    }));
  },

  /** Lost phone or forgotten password: the old ones stop working at once; a 24-hour link sets new ones */
  "people.resetAccess": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session);
    const id = str(i.id, "Person", { max: 40 });
    return ok(await ctx.env.db.tx(async q => {
      const cur = (await q.query("SELECT username, status FROM people WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur || cur.status === "disabled") throw notFound();
      const invited = cur.status === "invited";
      if (!invited) await q.query("UPDATE people SET password_hash = NULL, totp_secret = NULL, totp_last_step = NULL, failed_count = 0, locked_until = NULL WHERE id = $1", [id]);
      await endSessions(ctx.env, q, id);
      const link = await makeLink(ctx, q, { personId: id, kind: invited ? "invite" : "reset", by: a.name });
      await log(ctx, q, { actor: a.name, action: invited ? "sent a new invite" : "reset sign-in (password and authenticator)", target: cur.username });
      return { person: (await personView(q, "WHERE p.id = $1", [id]))[0], ...link };
    }));
  },

  // ----- Roles and switches -----
  "roles.list": async (_i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people");
    const { rows } = await ctx.env.db.query("SELECT r.id, r.name, r.base, r.built_in, r.permissions, (SELECT count(*)::int FROM people p WHERE p.role_id = r.id AND p.status <> 'disabled') AS people FROM roles r ORDER BY r.built_in DESC, array_position(ARRAY['owner','coordinator','worker'], r.base), lower(r.name)");
    return ok(rows.map((r): RoleView => ({ id: r.id, name: r.name, base: r.base, builtIn: r.built_in, permissions: r.permissions, can: effective(r.base, r.permissions), people: r.people })));
  },

  "roles.save": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session); mayChange(a);
    const permissions = obj(i.permissions ?? {});
    return ok(await ctx.env.db.tx(async q => {
      const id = i.id === undefined || i.id === null ? null : str(i.id, "Role", { max: 40 });
      const cur = id ? (await q.query("SELECT id, name, base, built_in FROM roles WHERE id = $1 FOR UPDATE", [id])).rows[0] : null;
      if (id && !cur) throw notFound();
      const name = cur?.built_in ? cur.name : str(i.name, "Name", { min: 2, max: 40 });
      const base = (cur?.built_in ? cur.base : str(i.base, "Base role", { max: 20 })) as BaseRole;
      const problems = roleProblems({ name, base, permissions });
      if (problems.length) throw new ApiError(400, "bad-request", problems.join(". "), { problems });
      if (cur?.built_in && base === "owner") throw forbidden("Owners always have every switch");
      if (cur && !cur.built_in && cur.base !== base) {
        // Changing the base moves everyone with the role; there must still be an owner afterwards
        if (cur.base === "owner") {
          const others = (await q.query("SELECT count(*)::int AS n FROM people p JOIN roles r ON r.id = p.role_id WHERE r.base = 'owner' AND p.status = 'active' AND r.id <> $1", [cur.id])).rows[0].n;
          if (others < 1) throw new ApiError(409, "conflict", "The warehouse needs at least one active owner");
        }
      }
      const clean = cleanPermissions(base, permissions as Permissions);
      if ((await q.query("SELECT 1 FROM roles WHERE lower(name) = lower($1) AND id <> coalesce($2, '')", [name, id])).rows.length) throw new ApiError(409, "conflict", `There's already a role called ${name}`);
      let roleId = id;
      if (cur) {
        await q.query("UPDATE roles SET name = $2, base = $3, permissions = $4, updated_at = now(), updated_by = $5 WHERE id = $1", [cur.id, name, base, JSON.stringify(clean), a.name]);
      } else {
        roleId = slug(name);
        for (let n = 2; (await q.query("SELECT 1 FROM roles WHERE id = $1", [roleId])).rows.length; n++) roleId = `${slug(name).slice(0, 33)}-${n}`;
        await q.query("INSERT INTO roles (id, name, base, permissions, updated_by) VALUES ($1, $2, $3, $4, $5)", [roleId, name, base, JSON.stringify(clean), a.name]);
      }
      await log(ctx, q, { actor: a.name, action: cur ? "changed role" : "made role", target: name, detail: { base, switches: clean } });
      const r = (await q.query("SELECT r.id, r.name, r.base, r.built_in, r.permissions, (SELECT count(*)::int FROM people p WHERE p.role_id = r.id AND p.status <> 'disabled') AS people FROM roles r WHERE r.id = $1", [roleId])).rows[0];
      return { id: r.id, name: r.name, base: r.base, builtIn: r.built_in, permissions: r.permissions, can: effective(r.base, r.permissions), people: r.people } satisfies RoleView;
    }));
  },

  "roles.delete": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session);
    const id = str(i.id, "Role", { max: 40 });
    return ok(await ctx.env.db.tx(async q => {
      const r = (await q.query("SELECT name, built_in FROM roles WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!r) throw notFound();
      if (r.built_in) throw forbidden("Built-in roles can't be deleted");
      if ((await q.query("SELECT 1 FROM people WHERE role_id = $1", [id])).rows.length) throw new ApiError(409, "conflict", "Give the people with this role another role first");
      await q.query("DELETE FROM roles WHERE id = $1", [id]);
      await log(ctx, q, { actor: a.name, action: "deleted role", target: r.name });
      return { ok: true };
    }));
  },

  // ----- Account requests -----
  "requests.list": async (_i, ctx) => {
    must(await actor(ctx), "manage-people");
    const { rows } = await ctx.env.db.query("SELECT id, name, username, email, note, created_at FROM account_requests WHERE status = 'pending' ORDER BY created_at");
    return ok(rows.map((r): RequestView => ({ id: r.id, name: r.name, username: r.username, email: r.email, note: r.note, createdAt: isoOrNull(r.created_at)! })));
  },
  "requests.decide": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-people"); needConfirmed(ctx.env, a.session);
    const id = str(i.id, "Request", { max: 40 }), approve = bool(i.approve);
    return ok(await ctx.env.db.tx(async q => {
      const r = (await q.query("SELECT name, username, email FROM account_requests WHERE id = $1 AND status = 'pending' FOR UPDATE", [id])).rows[0];
      if (!r) throw notFound();
      await q.query("UPDATE account_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1", [id, approve ? "approved" : "rejected", a.name]);
      if (!approve) { await log(ctx, q, { actor: a.name, action: "rejected account request", target: r.username }); return { ok: true }; }
      const user = i.username ? usernameOf(i.username) : r.username;
      if ((await q.query("SELECT 1 FROM people WHERE username = $1", [user])).rows.length) throw new ApiError(409, "conflict", `The username ${user} is taken: choose another`);
      const role = await roleOf(q, i.roleId);
      const p = (await q.query("INSERT INTO people (username, name, email, role_id, clients, groups, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [user, r.name, r.email, role.id, role.base === "owner" ? null : clientsOf(ctx, i.clients), groupsOf(ctx, i.groups), a.name])).rows[0];
      const link = await makeLink(ctx, q, { personId: p.id, kind: "invite", by: a.name });
      await log(ctx, q, { actor: a.name, action: "approved account request", target: user, detail: { role: role.id } });
      return { person: (await personView(q, "WHERE p.id = $1", [p.id]))[0], ...link };
    }));
  },

  // ----- Security log -----
  "security.list": async (i, ctx) => {
    must(await actor(ctx), "view-security-log");
    const before = i.before === undefined ? Number.MAX_SAFE_INTEGER : int(i.before, "Before", 0, Number.MAX_SAFE_INTEGER);
    const { rows } = await ctx.env.db.query("SELECT id, at, actor, action, target, detail, ip FROM security_log WHERE id < $1 ORDER BY id DESC LIMIT 200", [before]);
    return ok({ entries: rows.map((r): LogView & { id: number } => ({ id: Number(r.id), at: isoOrNull(r.at)!, actor: r.actor, action: r.action, target: r.target, detail: r.detail, ip: r.ip })), more: rows.length === 200 });
  },

  // ----- Support access -----
  "support.list": async (_i, ctx) => {
    must(await actor(ctx), "manage-support");
    const { rows } = await ctx.env.db.query("SELECT * FROM support_grants ORDER BY requested_at DESC LIMIT 50");
    return ok(rows.map(grantView));
  },
  "support.decide": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-support");
    const id = str(i.id, "Request", { max: 40 }), approve = bool(i.approve);
    if (approve) needConfirmed(ctx.env, a.session);
    return ok(await ctx.env.db.tx(async q => {
      const g = (await q.query("SELECT * FROM support_grants WHERE id = $1 AND status = 'requested' FOR UPDATE", [id])).rows[0];
      if (!g) throw notFound();
      if (approve) await q.query("UPDATE support_grants SET status = 'active', decided_by = $2, starts_at = $3, ends_at = $4 WHERE id = $1", [id, a.name, iso(ctx.env.now()), iso(ctx.env.now() + g.minutes * 60_000)]);
      else await q.query("UPDATE support_grants SET status = 'refused', decided_by = $2 WHERE id = $1", [id, a.name]);
      await log(ctx, q, { actor: a.name, action: approve ? "allowed support access" : "refused support access", target: `Support: ${g.operator_name}`, detail: { minutes: g.minutes, canChange: g.can_change, reason: g.reason } });
      return grantView((await q.query("SELECT * FROM support_grants WHERE id = $1", [id])).rows[0]);
    }));
  },
  /** Any owner ends support access at once, and support's open sessions with it */
  "support.end": async (i, ctx) => {
    const a = await actor(ctx); must(a, "manage-support");
    const id = str(i.id, "Grant", { max: 40 });
    return ok(await ctx.env.db.tx(async q => {
      const g = (await q.query("SELECT operator_name FROM support_grants WHERE id = $1 AND status = 'active' FOR UPDATE", [id])).rows[0];
      if (!g) throw notFound();
      await q.query("UPDATE support_grants SET status = 'ended', ends_at = $2, ended_by = $3 WHERE id = $1", [id, iso(ctx.env.now()), a.name]);
      await q.query("UPDATE sessions SET revoked_at = $2 WHERE support_grant_id = $1 AND revoked_at IS NULL", [id, iso(ctx.env.now())]);
      await log(ctx, q, { actor: a.name, action: "ended support access", target: `Support: ${g.operator_name}` });
      return { ok: true };
    }));
  },
};

export async function callTenant(method: string, input: unknown, ctx: TenantCtx): Promise<Result> {
  const m = Object.hasOwn(TENANT_METHODS, method) ? TENANT_METHODS[method] : undefined;
  if (!m) throw notFound("No such method");
  return m(input === undefined ? {} : obj(input), ctx);
}

/** The WMS team's one-time link into this warehouse (GET /api/auth/handoff): becomes a support session */
export async function useHandoff(ctx: TenantCtx, token: string): Promise<{ token: string; maxAgeSec: number }> {
  return ctx.env.db.tx(async q => {
    const h = (await q.query(
      `SELECT h.id, g.id AS grant_id, g.ends_at, g.operator_name FROM handoffs h JOIN support_grants g ON g.id = h.grant_id
        WHERE h.id = $1 AND h.used_at IS NULL AND h.expires_at > $2 AND g.status = 'active' AND g.ends_at > $2 FOR UPDATE OF h`, [await tokenId(token), iso(ctx.env.now())])).rows[0];
    if (!h) throw new ApiError(404, "expired", "This support link has expired");
    await q.query("UPDATE handoffs SET used_at = $2 WHERE id = $1", [h.id, iso(ctx.env.now())]);
    const minutes = Math.max(1, Math.floor((new Date(h.ends_at).getTime() - ctx.env.now()) / 60_000));
    const s = await createSession(ctx.env, q, { supportGrantId: h.grant_id, keep: false, maxMinutes: minutes }, ctx.meta);
    await log(ctx, q, { actor: `Support: ${h.operator_name} (WMS team)`, action: "support opened the warehouse" });
    return s;
  });
}

/** For the ops console (server/src/core/ops-api.ts), run in the warehouse's own database */
export const tenantOps = {
  async requestSupport(ctx: TenantCtx, g: { operatorId: string; operator: string; reason: string; ticket: string | null; minutes: number; canChange: boolean; emergency: boolean }): Promise<GrantView> {
    return ctx.env.db.tx(async q => {
      const now = ctx.env.now();
      const r = (await q.query(
        `INSERT INTO support_grants (operator_id, operator_name, reason, ticket, minutes, can_change, emergency, status, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [g.operatorId, g.operator, g.reason, g.ticket, g.minutes, g.canChange, g.emergency, g.emergency ? "active" : "requested", g.emergency ? iso(now) : null, g.emergency ? iso(now + g.minutes * 60_000) : null])).rows[0];
      await log(ctx, q, { actor: `Support: ${g.operator} (WMS team)`, action: g.emergency ? "opened emergency support access" : "asked for support access", detail: { reason: g.reason, ticket: g.ticket, minutes: g.minutes, canChange: g.canChange } });
      if (g.emergency) {
        // Every owner hears about it at once
        const owners = (await q.query("SELECT p.name, p.email FROM people p JOIN roles r ON r.id = p.role_id WHERE r.base = 'owner' AND p.status = 'active' AND p.email IS NOT NULL")).rows;
        for (const o of owners) await ctx.mailer.send({ to: o.email, subject: `${ctx.tenant.appTitle}: the WMS team opened emergency support access`,
          text: `Hi ${o.name},\n\n${g.operator} from the WMS team opened support access to ${ctx.tenant.appTitle} without waiting for approval, because: ${g.reason}\n\nIt ends by itself after ${g.minutes} minutes. You can end it now in Settings → Support access, and everything support does is in the security log.` });
      }
      return grantView(r);
    });
  },
  async openLink(ctx: TenantCtx, grantId: string): Promise<string> {
    const g = (await ctx.env.db.query("SELECT id FROM support_grants WHERE id = $1 AND status = 'active' AND ends_at > $2", [grantId, iso(ctx.env.now())])).rows[0];
    if (!g) throw new ApiError(409, "conflict", "This support access isn't active (not approved yet, or ended)");
    const token = randomToken();
    await ctx.env.db.query("INSERT INTO handoffs (id, grant_id, expires_at) VALUES ($1, $2, $3)", [await tokenId(token), grantId, iso(ctx.env.now() + 2 * 60_000)]);
    return `${ctx.baseUrl}/api/auth/handoff?token=${encodeURIComponent(token)}`;
  },
  /** Lost access: reset an owner's sign-in, or invite a new owner if none can sign in */
  async restoreOwner(ctx: TenantCtx, o: { by: string; personId?: string; name?: string; username?: string; email?: string | null }): Promise<LinkResult & { person: PersonView }> {
    return ctx.env.db.tx(async q => {
      let id = o.personId;
      if (id) {
        const cur = (await q.query("SELECT p.username, r.base FROM people p JOIN roles r ON r.id = p.role_id WHERE p.id = $1 FOR UPDATE OF p", [id])).rows[0];
        if (!cur || cur.base !== "owner") throw bad("That person isn't an owner");
        await q.query("UPDATE people SET password_hash = NULL, totp_secret = NULL, totp_last_step = NULL, failed_count = 0, locked_until = NULL, status = CASE WHEN status = 'disabled' THEN 'active' ELSE status END WHERE id = $1", [id]);
        await endSessions(ctx.env, q, id);
      } else {
        const user = usernameOf(o.username);
        if ((await q.query("SELECT 1 FROM people WHERE username = $1", [user])).rows.length) throw new ApiError(409, "conflict", `The username ${user} is taken`);
        id = (await q.query("INSERT INTO people (username, name, email, role_id, created_by) VALUES ($1, $2, $3, 'owner', $4) RETURNING id", [user, str(o.name, "Name", { max: 80 }), o.email ?? null, o.by])).rows[0].id as string;
      }
      const status = (await q.query("SELECT status FROM people WHERE id = $1", [id])).rows[0].status;
      const link = await makeLink(ctx, q, { personId: id, kind: status === "invited" ? "invite" : "reset", by: o.by });
      await log(ctx, q, { actor: o.by, action: o.personId ? "restored an owner's access (WMS team)" : "invited an owner (WMS team)", target: (await q.query("SELECT username FROM people WHERE id = $1", [id])).rows[0].username });
      return { person: (await personView(q, "WHERE p.id = $1", [id]))[0], ...link };
    });
  },
  async summary(ctx: TenantCtx) {
    const r = (await ctx.env.db.query(
      `SELECT count(*) FILTER (WHERE p.status = 'active')::int AS active, count(*) FILTER (WHERE p.status = 'invited')::int AS invited,
              count(*) FILTER (WHERE p.status = 'active' AND r.base = 'owner')::int AS owners, max(p.last_sign_in_at) AS last_sign_in,
              (SELECT count(*)::int FROM support_grants WHERE status = 'active' AND ends_at > now()) AS support
         FROM people p JOIN roles r ON r.id = p.role_id`)).rows[0];
    return { people: { active: r.active, invited: r.invited, owners: r.owners }, lastSignInAt: isoOrNull(r.last_sign_in), supportActive: r.support };
  },
  async owners(ctx: TenantCtx): Promise<PersonView[]> { return personView(ctx.env.db, "WHERE r.base = 'owner'", []); },
};

