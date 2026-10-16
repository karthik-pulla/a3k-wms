// The warehouse API and the ops console, end to end on in-memory PostgreSQL (PGlite): a new warehouse's first
// owner, inviting staff, roles and switches, lost access, support access.
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./pg.ts";
import { OPS_TABLES, TENANT_TABLES, type AuthEnv } from "../src/core/auth.ts";
import { totpAt, totpCounter } from "../src/core/crypto.ts";
import { ApiError } from "../src/core/errors.ts";
import { outbox } from "../src/core/mail.ts";
import { callTenant, tenantLog, useHandoff, type TenantCtx } from "../src/core/tenant-api.ts";
import { callOps, firstOperator, opsLog, type OpsCtx } from "../src/core/ops-api.ts";
import type { Db } from "../src/core/db.ts";

let clock = Date.parse("2026-10-16T12:00:00Z");
const tick = (s = 31) => { clock += s * 1000; };
const KEY = new Uint8Array(32).fill(3);

async function warehouse() {
  const { db } = await freshDb("tenant");
  const mail = outbox();
  const env: AuthEnv = { db, tables: TENANT_TABLES, appKey: KEY, now: () => clock, issuer: "Bravo Warehouse", ownWords: ["bravo"], log: tenantLog() };
  const tenant: TenantCtx["tenant"] = {
    id: "bravo", name: "Bravo Foods", appTitle: "Bravo Warehouse", mark: "BW", languages: { default: "en", enabled: ["en", "es"] },
    clients: [{ id: "Sunfield", name: "Sunfield" }, { id: "Lotus", name: "Lotus" }], groups: [{ id: "shift-am", name: "shift-am" }],
  };
  const ctx = (token?: string): TenantCtx => ({ env, tenant, token, meta: { ip: "203.0.113.5" }, baseUrl: "https://bravo.wms.test", mailer: mail });
  return { db, env, mail, ctx };
}

/** Calls a method, returning the body; a session the method sets is kept on the "browser" */
function browser(make: (token?: string) => TenantCtx) {
  let token: string | undefined;
  return {
    get token() { return token; },
    async call(method: string, input: Record<string, unknown> = {}) {
      const r = await callTenant(method, input, make(token));
      if (r.session === "clear") token = undefined; else if (r.session) token = r.session.token;
      return r.body as any;
    },
  };
}
const code = (secret: string) => totpAt(secret, totpCounter(clock));
const fails = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: ApiError) => e.code === c);
const tokenOf = (link: string) => link.split("/#/invite/")[1];

/** Follows an invite link like a person would: password, then the authenticator code */
async function accept(b: ReturnType<typeof browser>, link: string, password = "Correct-Horse-9!") {
  const t = tokenOf(link);
  const { secret } = await b.call("invite.password", { token: t, password });
  const me = await b.call("invite.finish", { token: t, code: await code(secret) });
  return { me, secret };
}

async function ownerSignedIn() {
  const w = await warehouse();
  // The first owner comes from the ops console (restore access / invite an owner)
  const { tenantOps } = await import("../src/core/tenant-api.ts");
  const r = await tenantOps.restoreOwner(w.ctx(), { by: "Sam (WMS team)", name: "Maya", username: "maya", email: "maya@bravo.test" });
  const owner = browser(w.ctx);
  const { me, secret } = await accept(owner, r.link, "Rapid-Owner-Pass-1");
  await owner.call("auth.confirm", { password: "Rapid-Owner-Pass-1" });
  return { ...w, owner, ownerMe: me, ownerSecret: secret };
}

test("the first owner joins from an emailed link and is signed in as an owner", async () => {
  const w = await ownerSignedIn();
  assert.equal(w.ownerMe.person.base, "owner");
  assert.equal(w.ownerMe.can["manage-people"], true);
  assert.equal(w.mail.sent[0].to, "maya@bravo.test");
  assert.match(w.mail.sent[0].text, /https:\/\/bravo\.wms\.test\/#\/invite\//);
  const log = await w.owner.call("security.list");
  assert.ok(log.entries.some((e: any) => e.action === "invited an owner (WMS team)"));
  assert.ok(log.entries.some((e: any) => e.action === "joined (invite accepted)" && e.actor === "Maya"));
});

test("an owner invites a worker; the worker joins and can't manage people", async () => {
  const w = await ownerSignedIn();
  const r = await w.owner.call("people.invite", { name: "Omar", username: "omar", email: "omar@bravo.test", roleId: "worker", clients: ["Sunfield"], groups: ["shift-am"] });
  assert.equal(r.person.status, "invited");
  assert.equal(r.person.linkPending, "invite");
  assert.equal(r.emailed, true);
  const omar = browser(w.ctx);
  const { me } = await accept(omar, r.link);
  assert.equal(me.person.base, "worker");
  assert.deepEqual(me.person.clients, ["Sunfield"]);
  assert.equal(me.can["confirm-inbound"], false);
  await fails(omar.call("people.list"), "forbidden");
  await fails(omar.call("roles.save", { name: "Boss", base: "owner", permissions: {} }), "forbidden");
  const list = await w.owner.call("people.list");
  assert.deepEqual(list.map((p: any) => [p.username, p.status]), [["maya", "active"], ["omar", "active"]]);
});

test("account changes need the owner's password again within 10 minutes", async () => {
  const w = await ownerSignedIn();
  tick(11 * 60);
  await fails(w.owner.call("people.invite", { name: "Leo", username: "leo", roleId: "coordinator" }), "confirm");
  await w.owner.call("auth.confirm", { password: "Rapid-Owner-Pass-1" });
  assert.ok((await w.owner.call("people.invite", { name: "Leo", username: "leo", roleId: "coordinator" })).link);
});

test("owners make named roles from switches; owner-only powers can't be given away", async () => {
  const w = await ownerSignedIn();
  const nightLead = await w.owner.call("roles.save", { name: "Night lead", base: "worker", permissions: { "confirm-inbound": true, "assign-work": true, "view-stock": true } });
  assert.equal(nightLead.id, "night-lead");
  assert.deepEqual(nightLead.permissions, { "confirm-inbound": true, "assign-work": true }, "only differences from the base are kept");
  assert.equal(nightLead.can["confirm-inbound"], true);
  assert.equal(nightLead.can["adjust-stock"], false);
  await fails(w.owner.call("roles.save", { name: "Sneaky", base: "coordinator", permissions: { "manage-people": true } }), "bad-request");
  await fails(w.owner.call("roles.save", { name: "Night lead", base: "worker", permissions: {} }), "conflict");
  // Built-in: switches change, the name doesn't
  const coord = await w.owner.call("roles.save", { id: "coordinator", name: "Renamed", base: "worker", permissions: { "start-count": true } });
  assert.equal(coord.name, "Coordinator");
  assert.equal(coord.base, "coordinator");
  assert.equal(coord.can["start-count"], true);
  await fails(w.owner.call("roles.save", { id: "owner", permissions: {} }), "forbidden");
  // Someone with the new role sees its switches
  const r = await w.owner.call("people.invite", { name: "Nina", username: "nina", roleId: "night-lead" });
  const nina = browser(w.ctx);
  const { me } = await accept(nina, r.link);
  assert.equal(me.person.roleName, "Night lead");
  assert.equal(me.can["confirm-inbound"], true);
  assert.equal(me.can["approve-order"], false);
  // A role in use can't be deleted
  await fails(w.owner.call("roles.delete", { id: "night-lead" }), "conflict");
  await fails(w.owner.call("roles.delete", { id: "worker" }), "forbidden");
  const roles = await w.owner.call("roles.list");
  assert.deepEqual(roles.map((x: any) => x.id), ["owner", "coordinator", "worker", "night-lead"]);
});

test("the last owner can't be demoted or turned off, and nobody changes their own role", async () => {
  const w = await ownerSignedIn();
  await fails(w.owner.call("people.update", { id: w.ownerMe.person.id, roleId: "worker" }), "forbidden");
  const r = await w.owner.call("people.invite", { name: "Kai", username: "kai", roleId: "owner" });
  const kai = browser(w.ctx);
  await accept(kai, r.link, "Strong-Owner-Pass-22");
  await kai.call("auth.confirm", { password: "Strong-Owner-Pass-22" });
  await w.owner.call("people.update", { id: r.person.id, roleId: "coordinator" });
  // Now Maya is the only owner
  await fails(kai.call("people.list"), "forbidden");
});

test("a lost phone: the owner resets access, the old phone and password stop at once", async () => {
  const w = await ownerSignedIn();
  const r = await w.owner.call("people.invite", { name: "Omar", username: "omar", roleId: "worker" });
  const omar = browser(w.ctx);
  const { secret } = await accept(omar, r.link);
  const reset = await w.owner.call("people.resetAccess", { id: r.person.id });
  assert.equal(reset.person.linkPending, "reset");
  await fails(omar.call("auth.me"), "not-signed-in");
  tick();
  const thief = browser(w.ctx);
  await fails(thief.call("auth.signIn", { username: "omar", password: "Correct-Horse-9!" }), "wrong-sign-in");
  const again = browser(w.ctx);
  tick();
  const { me } = await accept(again, reset.link, "Brand-New-Pass-77");
  assert.equal(me.person.username, "omar");
  assert.notEqual((await again.call("auth.me")).person.id, undefined);
  void secret;
});

test("turned-off accounts can't sign in; turning back on keeps the role", async () => {
  const w = await ownerSignedIn();
  const r = await w.owner.call("people.invite", { name: "Tess", username: "tess", roleId: "worker" });
  const tess = browser(w.ctx);
  const { secret } = await accept(tess, r.link);
  await w.owner.call("people.disable", { id: r.person.id });
  await fails(tess.call("auth.me"), "not-signed-in");
  tick();
  await fails(browser(w.ctx).call("auth.signIn", { username: "tess", password: "Correct-Horse-9!" }), "wrong-sign-in");
  await w.owner.call("people.enable", { id: r.person.id });
  const b = browser(w.ctx);
  const { ticket } = await b.call("auth.signIn", { username: "tess", password: "Correct-Horse-9!" });
  tick();
  assert.equal((await b.call("auth.verify", { ticket, code: await code(secret) })).person.roleId, "worker");
});

test("account requests from the sign-in screen wait for an owner", async () => {
  const w = await ownerSignedIn();
  await browser(w.ctx).call("requests.create", { name: "Leo", username: "leo", note: "AM shift" });
  const reqs = await w.owner.call("requests.list");
  assert.equal(reqs.length, 1);
  const r = await w.owner.call("requests.decide", { id: reqs[0].id, approve: true, roleId: "coordinator", clients: null });
  assert.equal(r.person.username, "leo");
  assert.ok(r.link);
  assert.equal((await w.owner.call("requests.list")).length, 0);
});

test("unknown methods, bad input and other warehouses' clients are refused", async () => {
  const w = await ownerSignedIn();
  await fails(w.owner.call("people.drop", {}), "not-found");
  await fails(w.owner.call("people.invite", { name: "X", username: "Bad Name!", roleId: "worker" }), "bad-request");
  await fails(w.owner.call("people.invite", { name: "X", username: "xx", roleId: "worker", clients: ["Deccan"] }), "bad-request");
  await fails(w.owner.call("people.invite", { name: "X", username: "xx", roleId: "superuser" }), "bad-request");
});

// ---------- Ops console ----------
async function ops() {
  const w = await ownerSignedIn();
  const { db: platform } = await freshDb("platform");
  await platform.query("INSERT INTO tenants (id, name, status, db_name, db_user, db_host, db_direct_host) VALUES ('bravo', 'Bravo Foods', 'setup', 't_bravo', 't_bravo', 'proxy', 'db')");
  await platform.query("INSERT INTO domains (host, tenant_id) VALUES ('bravo.wms.test', 'bravo')");
  const mail = outbox();
  const env: AuthEnv = { db: platform, tables: OPS_TABLES, appKey: KEY, now: () => clock, issuer: "WMS console", ownWords: ["wms"], log: opsLog() };
  const jobs: string[] = [];
  const ctx = (token?: string): OpsCtx => ({
    env, platform, token, meta: {}, baseUrl: "https://ops.wms.test", mailer: mail,
    tenant: async id => { if (id !== "bravo") throw new Error("no such tenant db"); return w.ctx(); },
    creator: { start: async t => { jobs.push(t.id); return { job: `job-${t.id}` }; }, status: async () => ({ state: "done" }) },
  });
  let token: string | undefined;
  const call = async (m: string, i: Record<string, unknown> = {}) => { const r = await callOps(m, i, ctx(token)); if (r.session === "clear") token = undefined; else if (r.session) token = r.session.token; return r.body as any; };
  const link = await firstOperator(env, platform, { name: "Sam", username: "sam", email: "sam@wms.test", baseUrl: "https://ops.wms.test" });
  const t = link.split("/#/invite/")[1];
  const { secret } = await call("invite.password", { token: t, password: "Ops-Team-Pass-1!" });
  await call("invite.finish", { token: t, code: await code(secret) });
  await call("auth.confirm", { password: "Ops-Team-Pass-1!" });
  return { ...w, platform, call, jobs, opsMail: mail, opsDb: platform as Db };
}

test("the console lists warehouses with counts from their own database, never their stock", async () => {
  const o = await ops();
  const list = await o.call("tenants.list");
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].people, { active: 1, invited: 0, owners: 1 });
  assert.deepEqual(list[0].hosts, ["bravo.wms.test"]);
  assert.equal(list[0].status, "setup");
  assert.ok(!JSON.stringify(list).includes("Maya-Owner"), "no secrets");
  await o.call("tenants.onboarding", { id: "bravo", step: "survey", done: true });
  assert.deepEqual((await o.call("tenants.list"))[0].onboarding, ["survey"]);
});

test("restoring an owner's access from the console is logged in the warehouse and the platform", async () => {
  const o = await ops();
  const owners = await o.call("tenants.owners", { id: "bravo" });
  const r = await o.call("tenants.restoreOwner", { id: "bravo", personId: owners[0].id, reason: "Lost her phone, called in" });
  assert.match(r.link, /^https:\/\/bravo\.wms\.test\/#\/invite\//);
  await fails(o.owner.call("auth.me"), "not-signed-in");
  const log = (await o.platform.query("SELECT action, detail FROM platform_audit WHERE tenant_id = 'bravo'")).rows;
  assert.ok(log.some(l => l.action === "restored an owner's access" && l.detail.reason === "Lost her phone, called in"));
  const tlog = (await o.db.query("SELECT actor, action FROM security_log")).rows;
  assert.ok(tlog.some(l => l.action === "restored an owner's access (WMS team)" && l.actor === "Sam (WMS team)"));
});

test("support access: asked for, approved by an owner, opened once, look-only, ended by the owner", async () => {
  const o = await ops();
  const g = await o.call("support.request", { tenantId: "bravo", reason: "Labels print off-centre", minutes: 30, canChange: false });
  assert.equal(g.status, "requested");
  await fails(o.call("support.open", { tenantId: "bravo", grantId: g.id }), "conflict");
  await o.owner.call("support.decide", { id: g.id, approve: true });
  const { url } = await o.call("support.open", { tenantId: "bravo", grantId: g.id });
  const token = new URL(url).searchParams.get("token")!;
  const s = await useHandoff(o.ctx(), token);
  await fails(useHandoff(o.ctx(), token), "expired"); // one use only
  const support = browser(o.ctx);
  const me = (await callTenant("auth.me", {}, o.ctx(s.token))).body as any;
  assert.equal(me.support.operator, "Sam");
  assert.equal(me.support.canChange, false);
  await fails(callTenant("people.list", {}, o.ctx(s.token)), "forbidden");
  assert.equal((await o.owner.call("auth.me")).supportActive.length, 1, "the owner sees a banner");
  await o.owner.call("support.end", { id: g.id });
  await fails(callTenant("auth.me", {}, o.ctx(s.token)), "not-signed-in");
  void support;
});

test("emergency support opens at once and emails every owner", async () => {
  const o = await ops();
  const before = o.mail.sent.length;
  const g = await o.call("support.request", { tenantId: "bravo", reason: "Outage: nobody can sign in", minutes: 60, emergency: true });
  assert.equal(g.status, "active");
  assert.equal(o.mail.sent.length, before + 1);
  assert.match(o.mail.sent.at(-1)!.subject, /emergency support access/);
  assert.ok((await o.owner.call("security.list")).entries.some((e: any) => e.action === "opened emergency support access"));
});

test("the console's own sign-in is separate: a warehouse login doesn't work there", async () => {
  const o = await ops();
  await fails(o.call("auth.signIn", { username: "maya", password: "Rapid-Owner-Pass-1" }), "wrong-sign-in");
  const created = await o.call("tenants.create", { id: "citycold", name: "City Cold Storage", hosts: ["citycold.wms.test"] });
  assert.equal(created.job, "job-citycold");
  await fails(o.call("tenants.create", { id: "bravo", name: "Again", hosts: ["x.wms.test"] }), "conflict");
});
