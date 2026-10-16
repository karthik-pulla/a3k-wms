// The ops console API (ops.<domain>, POST /ops/api/<method>): the WMS team's own accounts, every warehouse at a
// glance, creating warehouses, restoring an owner's access, support access, and the platform's log.
//
// What the console shows of a warehouse is its health and counts (people, sign-ins, errors), never its stock, orders
// or messages. Looking inside needs a support grant: an owner approves it, or, in an outage, the team opens it as an
// emergency and every owner is emailed at once. Everything is logged on both sides.
import {
  confirmPassword, createInvite, finishInvite, getSession, needConfirmed, readInvite, setInvitePassword, signIn, signOut, verifyCode,
  type AuthEnv, type Meta, type SessionRow,
} from "./auth.ts";
import type { Db, Sql } from "./db.ts";
import { ApiError, bad, bool, email as emailOf, forbidden, int, notFound, obj, str, strList, username as usernameOf } from "./errors.ts";
import { inviteMail, type Mailer } from "./mail.ts";
import { tenantOps, type TenantCtx } from "./tenant-api.ts";
import { ONBOARDING_STEPS, type OperatorMe, type TenantSummary } from "../shared/api.ts";

/** Starts creating a warehouse (on AWS: the tenant-creation task) and reports how it's going */
export interface TenantCreator {
  start(t: { id: string; name: string; hosts: string[] }): Promise<{ job: string }>;
  status(job: string): Promise<{ state: "running" | "done" | "failed"; detail?: string }>;
}

export interface OpsCtx {
  env: AuthEnv;
  platform: Db;
  token?: string;
  meta: Meta;
  /** The console's own address, for operator invite links */
  baseUrl: string;
  mailer: Mailer;
  /** One warehouse's context (its own database, its address), for the few things the console does inside it */
  tenant(id: string): Promise<TenantCtx>;
  creator: TenantCreator;
}

const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export function opsLog(ip?: string): AuthEnv["log"] {
  return async (q, e) => {
    const name = /^[0-9a-f-]{36}$/.test(e.actor) ? (await q.query("SELECT name FROM operators WHERE id = $1", [e.actor])).rows[0]?.name ?? e.actor : e.actor;
    await q.query("INSERT INTO platform_audit (actor, action, tenant_id, detail) VALUES ($1, $2, NULL, $3)", [name, e.action, JSON.stringify({ ...(e.detail ?? {}), ip: e.ip ?? ip ?? null })]);
  };
}

async function audit(q: Sql, actor: string, action: string, tenantId: string | null, detail: Record<string, unknown> = {}) {
  await q.query("INSERT INTO platform_audit (actor, action, tenant_id, detail) VALUES ($1, $2, $3, $4)", [actor, action, tenantId, JSON.stringify(detail)]);
}

interface Operator { session: SessionRow; id: string; name: string; username: string; email: string }
async function operator(ctx: OpsCtx): Promise<Operator> {
  const s = await getSession(ctx.env, ctx.token);
  if (!s) throw new ApiError(401, "not-signed-in", "Sign in again");
  const o = (await ctx.platform.query("SELECT id, name, username, email, status FROM operators WHERE id = $1", [s.person_id])).rows[0];
  if (!o || o.status !== "active") throw new ApiError(401, "not-signed-in", "Sign in again");
  return { session: s, id: o.id, name: o.name, username: o.username, email: o.email };
}
const meOf = (o: Operator): OperatorMe => ({ id: o.id, name: o.name, username: o.username, email: o.email });

async function tenantRow(q: Sql, id: string) {
  const t = (await q.query("SELECT id, name, status FROM tenants WHERE id = $1", [id])).rows[0];
  if (!t) throw notFound("No such warehouse");
  return t;
}
const tenantId = (v: unknown) => str(v, "Warehouse", { max: 30 });

type Method = (input: Record<string, unknown>, ctx: OpsCtx) => Promise<{ body: unknown; session?: { token: string; maxAgeSec: number } | "clear" }>;
const ok = (body: unknown = { ok: true }) => ({ body });

export const OPS_METHODS: Record<string, Method> = {
  // ----- The team's own sign-in (two steps, like everyone's) -----
  "auth.signIn": async (i, ctx) => ok(await signIn(ctx.env, { username: usernameOf(i.username), password: str(i.password, "Password", { max: 200 }), keep: false }, ctx.meta)),
  "auth.verify": async (i, ctx) => {
    const s = await verifyCode(ctx.env, { ticket: str(i.ticket, "Ticket", { max: 100 }), code: str(i.code, "Code", { max: 10 }) }, ctx.meta);
    return { body: meOf(await operator({ ...ctx, token: s.token })), session: s };
  },
  "auth.me": async (_i, ctx) => ok(meOf(await operator(ctx))),
  "auth.signOut": async (_i, ctx) => { await signOut(ctx.env, ctx.token); return { body: { ok: true }, session: "clear" }; },
  "auth.confirm": async (i, ctx) => { const o = await operator(ctx); await confirmPassword(ctx.env, o.session, str(i.password, "Password", { max: 200 }), ctx.meta); return ok(); },
  "invite.read": async (i, ctx) => ok({ ...(await readInvite(ctx.env, str(i.token, "Link", { max: 100 }))), warehouse: { id: "ops", name: "WMS team", appTitle: "WMS console", mark: "OPS", languages: { default: "en", enabled: ["en"] } } }),
  "invite.password": async (i, ctx) => ok(await setInvitePassword(ctx.env, str(i.token, "Link", { max: 100 }), str(i.password, "Password", { max: 200 }))),
  "invite.finish": async (i, ctx) => {
    const s = await finishInvite(ctx.env, str(i.token, "Link", { max: 100 }), str(i.code, "Code", { max: 10 }), ctx.meta);
    return { body: meOf(await operator({ ...ctx, token: s.token })), session: s };
  },

  // ----- Every warehouse at a glance -----
  "tenants.list": async (_i, ctx) => {
    await operator(ctx);
    const { rows } = await ctx.platform.query(
      `SELECT t.id, t.name, t.status, t.created_at, t.schema_version,
              coalesce((SELECT array_agg(host ORDER BY host) FROM domains d WHERE d.tenant_id = t.id), '{}') AS hosts,
              (SELECT row_to_json(m) FROM (SELECT ok, run_at, failed_file, error FROM tenant_migrations WHERE tenant_id = t.id ORDER BY run_at DESC LIMIT 1) m) AS last_migration,
              coalesce((SELECT sum(count)::int FROM error_events e WHERE e.tenant_id = t.id AND e.hour > now() - interval '24 hours'), 0) AS errors,
              coalesce((SELECT array_agg(step) FROM onboarding o WHERE o.tenant_id = t.id), '{}') AS onboarding
         FROM tenants t WHERE t.status <> 'deleted' ORDER BY t.created_at`);
    const out: TenantSummary[] = [];
    for (const r of rows) {
      // Counts from the warehouse's own database, one at a time (each uses a pool from the connection budget)
      let counts: Awaited<ReturnType<typeof tenantOps.summary>> | null = null;
      try { counts = await tenantOps.summary(await ctx.tenant(r.id)); } catch { counts = null; }
      out.push({
        id: r.id, name: r.name, status: r.status, hosts: r.hosts, createdAt: isoOrNull(r.created_at)!, schemaVersion: r.schema_version,
        lastMigration: r.last_migration ? { ok: r.last_migration.ok, at: isoOrNull(r.last_migration.run_at)!, failedFile: r.last_migration.failed_file, error: r.last_migration.error } : null,
        people: counts?.people ?? null, lastSignInAt: counts?.lastSignInAt ?? null, supportActive: counts?.supportActive ?? 0,
        errors24h: r.errors, onboarding: r.onboarding, ...(counts ? {} : { unreachable: true }),
      });
    }
    return ok(out);
  },

  "tenants.create": async (i, ctx) => {
    const o = await operator(ctx); needConfirmed(ctx.env, o.session);
    const id = str(i.id, "Address name", { min: 2, max: 30 }).toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,29}$/.test(id) || id.endsWith("-") || id.includes("--")) throw bad("The address name is 2–30 lower-case letters, numbers and single dashes, starting with a letter");
    if ((await ctx.platform.query("SELECT 1 FROM tenants WHERE id = $1", [id])).rows.length) throw new ApiError(409, "conflict", `There's already a warehouse called ${id}`);
    const hosts = strList(i.hosts, "Addresses", 5).map(h => h.toLowerCase());
    if (!hosts.length) throw bad("Give the warehouse at least one address");
    const job = await ctx.creator.start({ id, name: str(i.name, "Name", { max: 80 }), hosts });
    await audit(ctx.platform, o.name, "started creating a warehouse", id, { hosts, job: job.job });
    return ok(job);
  },
  "tenants.job": async (i, ctx) => { await operator(ctx); return ok(await ctx.creator.status(str(i.job, "Job", { max: 300 }))); },

  "tenants.setStatus": async (i, ctx) => {
    const o = await operator(ctx); needConfirmed(ctx.env, o.session);
    const id = tenantId(i.id), status = str(i.status, "Status", { max: 20 });
    if (!["setup", "active", "leaving", "suspended"].includes(status)) throw bad("Status is setup, active, leaving or suspended");
    const t = await tenantRow(ctx.platform, id);
    await ctx.platform.query("UPDATE tenants SET status = $2 WHERE id = $1", [id, status]);
    await audit(ctx.platform, o.name, `warehouse ${t.status} → ${status}`, id, { reason: str(i.reason, "Reason", { min: 3, max: 300 }) });
    return ok();
  },

  "tenants.onboarding": async (i, ctx) => {
    const o = await operator(ctx);
    const id = tenantId(i.id), step = str(i.step, "Step", { max: 30 });
    if (!ONBOARDING_STEPS.some(s => s.id === step)) throw bad("Unknown step");
    await tenantRow(ctx.platform, id);
    if (bool(i.done)) await ctx.platform.query("INSERT INTO onboarding (tenant_id, step, done_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, step, o.name]);
    else await ctx.platform.query("DELETE FROM onboarding WHERE tenant_id = $1 AND step = $2", [id, step]);
    await audit(ctx.platform, o.name, `setup step ${bool(i.done) ? "done" : "undone"}: ${step}`, id);
    return ok();
  },

  /** A warehouse's owners: names, status and last sign-in, to help one who's locked out */
  "tenants.owners": async (i, ctx) => { await operator(ctx); const id = tenantId(i.id); await tenantRow(ctx.platform, id); return ok(await tenantOps.owners(await ctx.tenant(id))); },

  /** Lost access: a new sign-in link for an owner (old password and phone stop working), or a new owner if none is left */
  "tenants.restoreOwner": async (i, ctx) => {
    const o = await operator(ctx); needConfirmed(ctx.env, o.session);
    const id = tenantId(i.id);
    await tenantRow(ctx.platform, id);
    const reason = str(i.reason, "Reason", { min: 5, max: 300 });
    const r = await tenantOps.restoreOwner(await ctx.tenant(id), {
      by: `${o.name} (WMS team)`, personId: i.personId ? str(i.personId, "Person", { max: 40 }) : undefined,
      name: i.name as string | undefined, username: i.username as string | undefined, email: emailOf(i.email),
    });
    await audit(ctx.platform, o.name, i.personId ? "restored an owner's access" : "invited a new owner", id, { owner: r.person.username, reason });
    return ok(r);
  },

  // ----- Support access -----
  "support.request": async (i, ctx) => {
    const o = await operator(ctx);
    const id = tenantId(i.tenantId);
    await tenantRow(ctx.platform, id);
    const emergency = bool(i.emergency);
    if (emergency) needConfirmed(ctx.env, o.session);
    const g = await tenantOps.requestSupport(await ctx.tenant(id), {
      operatorId: o.id, operator: o.name, reason: str(i.reason, "Reason", { min: 5, max: 500 }), ticket: str(i.ticket, "Ticket", { max: 40, optional: true }) || null,
      minutes: int(i.minutes ?? 60, "Minutes", 15, 1440), canChange: bool(i.canChange), emergency,
    });
    await audit(ctx.platform, o.name, emergency ? "opened emergency support access" : "asked for support access", id, { grant: g.id, minutes: g.minutes, canChange: g.canChange, reason: g.reason });
    return ok(g);
  },
  "support.list": async (i, ctx) => {
    await operator(ctx);
    const t = await ctx.tenant(tenantId(i.tenantId));
    const { rows } = await t.env.db.query("SELECT id, operator_name, reason, ticket, can_change, emergency, minutes, status, requested_at, starts_at, ends_at, decided_by FROM support_grants ORDER BY requested_at DESC LIMIT 20");
    return ok(rows.map(r => ({ id: r.id, operator: r.operator_name, reason: r.reason, ticket: r.ticket, canChange: r.can_change, emergency: r.emergency, minutes: r.minutes, status: r.status, requestedAt: isoOrNull(r.requested_at), startsAt: isoOrNull(r.starts_at), endsAt: isoOrNull(r.ends_at), decidedBy: r.decided_by })));
  },
  /** A one-time link (2 minutes) that opens the warehouse as support */
  "support.open": async (i, ctx) => {
    const o = await operator(ctx);
    const id = tenantId(i.tenantId), grant = str(i.grantId, "Grant", { max: 40 });
    const url = await tenantOps.openLink(await ctx.tenant(id), grant);
    await audit(ctx.platform, o.name, "opened the warehouse as support", id, { grant });
    return ok({ url });
  },

  // ----- The platform's log, errors, the team -----
  "audit.list": async (i, ctx) => {
    await operator(ctx);
    const t = i.tenantId ? tenantId(i.tenantId) : null;
    const { rows } = await ctx.platform.query("SELECT id, at, actor, action, tenant_id, detail FROM platform_audit WHERE ($1::text IS NULL OR tenant_id = $1) ORDER BY id DESC LIMIT 200", [t]);
    return ok(rows.map(r => ({ id: Number(r.id), at: isoOrNull(r.at), actor: r.actor, action: r.action, tenantId: r.tenant_id, detail: r.detail })));
  },
  "errors.list": async (_i, ctx) => {
    await operator(ctx);
    const { rows } = await ctx.platform.query("SELECT tenant_id, route, message, hour, count FROM error_events WHERE hour > now() - interval '7 days' ORDER BY hour DESC, count DESC LIMIT 200");
    return ok(rows.map(r => ({ tenantId: r.tenant_id || null, route: r.route, message: r.message, hour: isoOrNull(r.hour), count: r.count })));
  },
  "operators.list": async (_i, ctx) => {
    await operator(ctx);
    const { rows } = await ctx.platform.query("SELECT id, name, username, email, status, last_sign_in_at, created_at FROM operators ORDER BY lower(name)");
    return ok(rows.map(r => ({ id: r.id, name: r.name, username: r.username, email: r.email, status: r.status, lastSignInAt: isoOrNull(r.last_sign_in_at), createdAt: isoOrNull(r.created_at) })));
  },
  "operators.invite": async (i, ctx) => {
    const o = await operator(ctx); needConfirmed(ctx.env, o.session);
    return ok(await ctx.platform.tx(async q => {
      const user = usernameOf(i.username), mail = emailOf(i.email, false)!;
      if ((await q.query("SELECT 1 FROM operators WHERE username = $1 OR email = $2", [user, mail])).rows.length) throw new ApiError(409, "conflict", "That username or email is already on the team");
      const p = (await q.query("INSERT INTO operators (username, name, email, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [user, str(i.name, "Name", { max: 80 }), mail, o.name])).rows[0];
      const token = await createInvite(ctx.env, q, p.id, "invite", o.name);
      const link = `${ctx.baseUrl}/#/invite/${token}`;
      const emailed = await ctx.mailer.send(inviteMail({ to: mail, name: String(i.name), warehouse: "the WMS console", link, kind: "invite", from: o.name }));
      await audit(q, o.name, "invited a team member", null, { username: user });
      return { link, emailed };
    }));
  },
  "operators.disable": async (i, ctx) => {
    const o = await operator(ctx); needConfirmed(ctx.env, o.session);
    const id = str(i.id, "Team member", { max: 40 });
    if (id === o.id) throw forbidden("You can't turn off your own account");
    await ctx.platform.tx(async q => {
      const r = (await q.query("UPDATE operators SET status = 'disabled' WHERE id = $1 RETURNING username", [id])).rows[0];
      if (!r) throw notFound();
      await q.query("UPDATE operator_sessions SET revoked_at = $2 WHERE person_id = $1 AND revoked_at IS NULL", [id, iso(ctx.env.now())]);
      await audit(q, o.name, "turned off a team member", null, { username: r.username });
    });
    return ok();
  },
};

export async function callOps(method: string, input: unknown, ctx: OpsCtx) {
  const m = Object.hasOwn(OPS_METHODS, method) ? OPS_METHODS[method] : undefined;
  if (!m) throw notFound("No such method");
  return m(input === undefined ? {} : obj(input), ctx);
}

/** The very first team member (no one can invite them): run once as a one-off task, prints their invite link */
export async function firstOperator(env: AuthEnv, platform: Db, o: { name: string; username: string; email: string; baseUrl: string }): Promise<string> {
  return platform.tx(async q => {
    if ((await q.query("SELECT 1 FROM operators WHERE status <> 'disabled'")).rows.length) throw new ApiError(409, "conflict", "The team already has members: invite from the console instead");
    const p = (await q.query("INSERT INTO operators (username, name, email, created_by) VALUES ($1, $2, $3, 'first-operator task') RETURNING id", [usernameOf(o.username), o.name, emailOf(o.email, false)])).rows[0];
    const token = await createInvite(env, q, p.id, "invite", "first-operator task");
    await audit(q, "first-operator task", "created the first team member", null, { username: o.username });
    return `${o.baseUrl}/#/invite/${token}`;
  });
}
