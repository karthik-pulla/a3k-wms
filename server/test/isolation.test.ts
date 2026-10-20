// Two warehouses, each with marker values ("canaries") in its settings, products, stock and messages, behind the
// real web layer (src/app.ts) on in-memory PostgreSQL. Neither may ever see the other's data
// (docs/multi-tenant-design.md, section 7). These run with every test run, and so before every deploy.
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { TenantPools, type PoolLike } from "../src/db/pools.ts";
import { TenantDirectory, type Tenant } from "../src/tenancy.ts";
import { TENANT_TABLES } from "../src/core/auth.ts";
import { totpAt, totpCounter } from "../src/core/crypto.ts";
import { outbox } from "../src/core/mail.ts";
import { TENANT_METHODS, tenantLog, tenantOps, type TenantCtx } from "../src/core/tenant-api.ts";
import { addProducts } from "../src/core/products.ts";
import type { Db } from "../src/core/db.ts";
import { freshDb, pgliteSql } from "./pg.ts";

const KEY = new Uint8Array(32).fill(9);
const JSON_HEADERS = { "x-wms": "1", "content-type": "application/json" };
const CANARY = { alpha: "ALPHA-CANARY", bravo: "BRAVO-CANARY" } as const;
type Id = keyof typeof CANARY;
const other = (id: Id): Id => (id === "alpha" ? "bravo" : "alpha");
const host = (id: Id) => `${id}.wms.test`;

/** A PGlite database as a connection pool: one connection, handed out one transaction at a time */
function pgPool(db: Db & { sql: ReturnType<typeof pgliteSql> }): PoolLike {
  let chain: Promise<unknown> = Promise.resolve();
  const turn = () => { let free!: () => void; const mine = chain.then(() => undefined); chain = chain.then(() => new Promise<void>(r => { free = r; })); return mine.then(() => free); };
  return {
    totalCount: 1, idleCount: 1, waitingCount: 0, end: async () => {},
    query: async (text, values) => { const free = await turn(); try { return await db.sql.query(text, values); } finally { free(); } },
    connect: async () => { const free = await turn(); return { query: (text: string, values?: unknown[]) => db.sql.query(text, values), release: () => free() }; },
  };
}

async function world() {
  const dbs = {} as Record<Id, Db & { sql: ReturnType<typeof pgliteSql> }>;
  const tenants = {} as Record<Id, Tenant>;
  for (const id of ["alpha", "bravo"] as Id[]) {
    const { db, pg } = await freshDb("tenant");
    dbs[id] = Object.assign(db, { sql: pgliteSql(pg) });
    tenants[id] = { id, name: `${id} Foods`, status: "active", dbName: `t_${id}`, dbUser: `t_${id}`, dbHost: "proxy.internal", dbPort: 5432 };
    await db.query("INSERT INTO settings (key, value, updated_by) VALUES ('config', $1, 'test')", [JSON.stringify({ branding: { appTitle: `${CANARY[id]} Warehouse`, mark: "XX" }, clients: [{ id: `${CANARY[id]}-CLIENT`, name: `${CANARY[id]} Client` }], canary: CANARY[id] })]);
    await addProducts(db, [{ id: `${id}-P1`, client: `${CANARY[id]}-CLIENT`, code: "1001", name: `${CANARY[id]} Rice`, item: `Rice:${CANARY[id]}:1001` }]);
  }
  const byHost: Record<string, Tenant> = { [host("alpha")]: tenants.alpha, [host("bravo")]: tenants.bravo };
  const app = buildApp({
    directory: new TenantDirectory(async h => byHost[h] ?? null),
    pools: new TenantPools(t => pgPool(dbs[t.id as Id])),
    platformHealth: async () => {}, appKey: KEY, mailer: outbox(),
  });

  /** A signed-in owner of a warehouse: the cookie their browser would hold */
  const owner = async (id: Id) => {
    const ctx: TenantCtx = {
      env: { db: dbs[id], tables: TENANT_TABLES, appKey: KEY, now: Date.now, issuer: id, ownWords: [id], log: tenantLog() },
      tenant: { id, name: `${id} Foods`, appTitle: id, mark: "", languages: { default: "en", enabled: ["en"] }, clients: [], groups: [] },
      meta: {}, baseUrl: `http://${host(id)}`, mailer: outbox(),
    };
    const { link } = await tenantOps.restoreOwner(ctx, { by: "test", name: `${id} Owner`, username: `${id}owner`, email: `o@${id}.test` });
    const token = link.split("/#/invite/")[1];
    const call = async (method: string, input: Record<string, unknown>, cookie?: string) => app.inject({ method: "POST", url: `/api/${method}`, payload: JSON.stringify(input), headers: { host: host(id), ...JSON_HEADERS, ...(cookie ? { cookie } : {}) } });
    const { secret } = (await call("invite.password", { token, password: "Isolation-Test-Pass-42" })).json();
    const done = await call("invite.finish", { token, code: await totpAt(secret, totpCounter(Date.now())) });
    const setCookie = String(done.headers["set-cookie"]);
    return { cookie: setCookie.split(";")[0], setCookie };
  };
  const as = (cookie: string) => (id: Id, method: string, input: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/api/${method}`, payload: JSON.stringify(input), headers: { host: host(id), ...JSON_HEADERS, cookie } });

  const alpha = await owner("alpha"), bravo = await owner("bravo");
  // Each warehouse's own stock, task and team message, written the way a device writes them
  for (const [id, who] of [["alpha", alpha], ["bravo", bravo]] as const) {
    const me = (await as(who.cookie)(id, "auth.me")).json();
    const push = (type: string, changes: unknown[], n: number) => as(who.cookie)(id, "sync.push", { clientId: `device-${id}-00001`, clientSeq: n, type, at: new Date().toISOString(), changes });
    assert.equal((await push("stock/adjust", [{ key: "stock:01A-01-L1-B1", base: 0, data: [{ productId: `${id}-P1`, cases: 7, lot: `${CANARY[id]}-LOT` }] }], 1)).json().ok, true);
    assert.equal((await push("chat/add", [{ key: `msg:${id}-m1`, base: 0, data: { id: `${id}-m1`, conversationId: "team", authorId: me.person.id, text: `${CANARY[id]} message`, refs: [], photos: [], createdAt: new Date().toISOString(), status: "sent" } }], 2)).json().ok, true);
  }
  return { app, dbs, alpha, bravo, as };
}

const leaks = (body: string, id: Id) => body.includes(CANARY[other(id)]);

test("with one warehouse's session, every method at the other warehouse's address is refused, and nothing of the first leaks", async () => {
  const w = await world();
  const anon = async (method: string) => (await w.app.inject({ method: "POST", url: `/api/${method}`, payload: "{}", headers: { host: host("bravo"), ...JSON_HEADERS } })).statusCode;
  let protectedMethods = 0;
  for (const method of Object.keys(TENANT_METHODS)) {
    const asAlphaAtBravo = await w.as(w.alpha.cookie)("bravo", method, { since: 0, id: "alpha-P1", token: "x", code: "123456" });
    const body = asAlphaAtBravo.body;
    assert.ok(!body.includes(CANARY.alpha), `${method} at Bravo answered with Alpha's data`);
    // Methods that need a session answer Alpha's cookie exactly as they answer no cookie at all
    if ((await anon(method)) === 401) { protectedMethods++; assert.equal(asAlphaAtBravo.statusCode, 401, method); }
  }
  assert.ok(protectedMethods >= 20, `only ${protectedMethods} methods needed a session`);
});

test("each warehouse's catch-up, settings and products hold only its own data", async () => {
  const w = await world();
  for (const [id, who] of [["alpha", w.alpha], ["bravo", w.bravo]] as const) {
    for (const method of ["sync.pull", "tenant.config", "tenant.products", "people.list", "people.directory", "security.list", "auth.me"]) {
      const r = await w.as(who.cookie)(id, method, { since: 0 });
      assert.equal(r.statusCode, 200, `${id} ${method}`);
      assert.ok(!leaks(r.body, id), `${id} ${method} shows the other warehouse's data`);
    }
    const pull = (await w.as(who.cookie)(id, "sync.pull", { since: 0 })).json();
    assert.ok(pull.rows.some((r: any) => JSON.stringify(r.data).includes(CANARY[id])), "its own data is there");
  }
});

test("thousands of requests for both warehouses at once never cross over", async () => {
  const w = await world();
  const methods = ["sync.pull", "tenant.products", "tenant.config", "auth.me"];
  const jobs = Array.from({ length: 1200 }, (_, i) => {
    const id: Id = i % 2 ? "alpha" : "bravo";
    return w.as(id === "alpha" ? w.alpha.cookie : w.bravo.cookie)(id, methods[i % methods.length], { since: 0 }).then(r => ({ id, r }));
  });
  for (const { id, r } of await Promise.all(jobs)) {
    assert.equal(r.statusCode, 200);
    assert.ok(!leaks(r.body, id), `a ${id} answer held the other warehouse's data`);
  }
});

test("guessing the other warehouse's ids gets nothing and changes nothing", async () => {
  const w = await world();
  // Bravo's product id, from Alpha
  const edit = await w.as(w.alpha.cookie)("alpha", "products.update", { id: "bravo-P1", code: "X1", name: "Hijack", item: "Hijack", reason: "testing isolation" });
  assert.equal(edit.statusCode, 404);
  // Writing the same keys in Alpha only ever writes Alpha's database
  await w.as(w.alpha.cookie)("alpha", "sync.push", { clientId: "device-alpha-00002", clientSeq: 1, type: "stock/adjust", at: new Date().toISOString(), changes: [{ key: "stock:01A-01-L1-B1", base: 1, data: [] }] });
  const bravoSlot = (await w.dbs.bravo.query("SELECT data FROM entities WHERE key = 'stock:01A-01-L1-B1'")).rows[0].data;
  assert.equal(bravoSlot[0].lot, `${CANARY.bravo}-LOT`);
  const bravoProduct = (await w.dbs.bravo.query("SELECT name FROM products WHERE id = 'bravo-P1'")).rows[0].name;
  assert.equal(bravoProduct, `${CANARY.bravo} Rice`);
});

test("the session cookie belongs to the warehouse's own address only", async () => {
  const w = await world();
  // No Domain attribute: a browser never sends it to another warehouse's subdomain
  assert.doesNotMatch(w.alpha.setCookie, /domain=/i);
  assert.match(w.alpha.setCookie, /HttpOnly/i);
  assert.match(w.alpha.setCookie, /SameSite=Lax/i);
});
