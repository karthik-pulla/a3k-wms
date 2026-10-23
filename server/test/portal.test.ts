// The client portal (src/core/portal-api.ts) behind the real web layer (src/app.ts): two warehouses, each with two
// clients and marker values ("canaries") in their products, stock, orders and messages. A client login may see only
// its own client's products and what its own client sent: never another client's, never the warehouse's own data,
// never another warehouse's. Its session opens no warehouse method, and a warehouse session opens no portal method.
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { TenantPools, type PoolLike } from "../src/db/pools.ts";
import { TenantDirectory, type Tenant } from "../src/tenancy.ts";
import { TENANT_TABLES } from "../src/core/auth.ts";
import { totpAt, totpCounter } from "../src/core/crypto.ts";
import { outbox } from "../src/core/mail.ts";
import { TENANT_METHODS, tenantLog, tenantOps, type TenantCtx } from "../src/core/tenant-api.ts";
import { PORTAL_METHODS } from "../src/core/portal-api.ts";
import { addProducts } from "../src/core/products.ts";
import type { Db } from "../src/core/db.ts";
import { freshDb, pgliteSql } from "./pg.ts";

const KEY = new Uint8Array(32).fill(7);
const JSON_HEADERS = { "x-wms": "1", "content-type": "application/json" };
type Id = "alpha" | "bravo";
const host = (id: Id) => `${id}.wms.test`;
/** Every warehouse has a client 1 and a client 2; each marker names whose it is */
const CLIENT = (id: Id, n: 1 | 2) => `${id.toUpperCase()}-CLIENT${n}`;
const CANARY = (id: Id, n: 0 | 1 | 2) => `${id.toUpperCase()}-CANARY-${n === 0 ? "WAREHOUSE" : `C${n}`}`;
const PASSWORD = "Portal-Test-Pass-42";
const today = () => new Date().toISOString().slice(0, 10);

function pgPool(db: Db & { sql: ReturnType<typeof pgliteSql> }): PoolLike {
  let chain: Promise<unknown> = Promise.resolve();
  const turn = () => { let free!: () => void; const mine = chain.then(() => undefined); chain = chain.then(() => new Promise<void>(r => { free = r; })); return mine.then(() => free); };
  return {
    totalCount: 1, idleCount: 1, waitingCount: 0, end: async () => {},
    query: async (text, values) => { const free = await turn(); try { return await db.sql.query(text, values); } finally { free(); } },
    connect: async () => { const free = await turn(); return { query: (text: string, values?: unknown[]) => db.sql.query(text, values), release: () => free() }; },
  };
}

const cookieOf = (setCookie: unknown, name: string) => String(setCookie).split(/,(?=\s*\w)/).map(c => c.trim()).find(c => c.startsWith(`${name}=`))!.split(";")[0];

async function world() {
  const dbs = {} as Record<Id, Db & { sql: ReturnType<typeof pgliteSql> }>;
  const tenants = {} as Record<Id, Tenant>;
  for (const id of ["alpha", "bravo"] as Id[]) {
    const { db, pg } = await freshDb("tenant");
    dbs[id] = Object.assign(db, { sql: pgliteSql(pg) });
    tenants[id] = { id, name: `${id} Foods`, status: "active", dbName: `t_${id}`, dbUser: `t_${id}`, dbHost: "proxy.internal", dbPort: 5432 };
    await db.query("INSERT INTO settings (key, value, updated_by) VALUES ('config', $1, 'test')", [JSON.stringify({
      branding: { appTitle: `${id} Warehouse`, mark: "XX" }, canary: CANARY(id, 0),
      clients: [1, 2].map(n => ({ id: CLIENT(id, n as 1 | 2), name: `${id} client ${n}`, defaultSupplier: `${CANARY(id, n as 1 | 2)} Supplier` })),
    })]);
    await addProducts(db, [1, 2].flatMap(n => [
      { id: `${id}-c${n}-P1`, client: CLIENT(id, n as 1 | 2), code: `${n}001`, name: `${CANARY(id, n as 1 | 2)} Rice`, item: `Rice:${CANARY(id, n as 1 | 2)}:1` },
      { id: `${id}-c${n}-P2`, client: CLIENT(id, n as 1 | 2), code: `${n}002`, name: `${CANARY(id, n as 1 | 2)} Lentils`, item: `Dal:${CANARY(id, n as 1 | 2)}:2` },
    ]));
  }
  const byHost: Record<string, Tenant> = { [host("alpha")]: tenants.alpha, [host("bravo")]: tenants.bravo };
  const mail = outbox();
  const app = buildApp({ directory: new TenantDirectory(async h => byHost[h] ?? null), pools: new TenantPools(t => pgPool(dbs[t.id as Id])), platformHealth: async () => {}, appKey: KEY, mailer: mail });

  const call = (path: "api" | "portal/api", id: Id, method: string, input: Record<string, unknown> = {}, cookie?: string) =>
    app.inject({ method: "POST", url: `/${path}/${method}`, payload: JSON.stringify(input), headers: { host: host(id), ...JSON_HEADERS, ...(cookie ? { cookie } : {}) } });
  const code = (secret: string) => totpAt(secret, totpCounter(Date.now()));

  /** A signed-in owner of a warehouse (first owner from the console), with the password given again */
  const owner = async (id: Id) => {
    const ctx: TenantCtx = {
      env: { db: dbs[id], tables: TENANT_TABLES, appKey: KEY, now: Date.now, issuer: id, ownWords: [id], log: tenantLog() },
      tenant: { id, name: `${id} Foods`, appTitle: id, mark: "", languages: { default: "en", enabled: ["en"] }, clients: [], groups: [] },
      meta: {}, baseUrl: `http://${host(id)}`, mailer: outbox(),
    };
    const { link } = await tenantOps.restoreOwner(ctx, { by: "test", name: `${id} Owner`, username: `${id}owner`, email: `o@${id}.test` });
    const token = link.split("/#/invite/")[1];
    const { secret } = (await call("api", id, "invite.password", { token, password: PASSWORD })).json();
    const done = await call("api", id, "invite.finish", { token, code: await code(secret) });
    const cookie = cookieOf(done.headers["set-cookie"], "wms");
    assert.equal((await call("api", id, "auth.confirm", { password: PASSWORD }, cookie)).statusCode, 200);
    return cookie;
  };
  /** A client login made by the owner, joined through its link: the portal cookie its browser holds */
  const client = async (id: Id, ownerCookie: string, n: 1 | 2, username: string) => {
    const made = await call("api", id, "clientLogins.invite", { name: `Buyer ${n}`, username, email: `${username}@client.test`, client: CLIENT(id, n) }, ownerCookie);
    assert.equal(made.statusCode, 200, made.body);
    const { link, login } = made.json();
    assert.match(link, new RegExp(`^http://${host(id)}/portal#/invite/`));
    const token = link.split("#/invite/")[1];
    // A portal link is no warehouse invite
    assert.equal((await call("api", id, "invite.read", { token })).statusCode, 404);
    const { secret } = (await call("portal/api", id, "invite.password", { token, password: PASSWORD })).json();
    const done = await call("portal/api", id, "invite.finish", { token, code: await code(secret) });
    assert.equal(done.statusCode, 200, done.body);
    assert.doesNotMatch(String(done.headers["set-cookie"]), /(^|,\s*)wms=/, "no warehouse cookie for a client");
    return { cookie: cookieOf(done.headers["set-cookie"], "wms-portal"), token: cookieOf(done.headers["set-cookie"], "wms-portal").split("=")[1], id: login.id as string, secret };
  };

  const owners = { alpha: await owner("alpha"), bravo: await owner("bravo") };
  // The warehouse's own data: a stock slot, an order typed in by the office, and a team message, each with a marker
  for (const id of ["alpha", "bravo"] as Id[]) {
    const me = (await call("api", id, "auth.me", {}, owners[id])).json();
    const push = (type: string, changes: unknown[], n: number) => call("api", id, "sync.push", { clientId: `device-${id}-00001`, clientSeq: n, type, at: new Date().toISOString(), changes }, owners[id]);
    for (const [n, c] of [[1, 1], [2, 2]] as const) {
      assert.equal((await push("stock/adjust", [{ key: `stock:0${c}A-01-L1-B1`, base: 0, data: [{ productId: `${id}-c${c}-P1`, cases: 9, lot: `${CANARY(id, c)}-LOT` }] }], n)).json().ok, true);
    }
    assert.equal((await push("order/save", [{ key: "order:Order 1", base: 0, data: { id: "Order 1", store: `${CANARY(id, 1)} Store`, client: CLIENT(id, 1), date: today(), lines: [{ productId: `${id}-c1-P1`, cases: 2 }], status: "approved", source: "app", notes: `${CANARY(id, 0)} office note` } }], 3)).json().ok, true);
    assert.equal((await push("chat/add", [{ key: `msg:${id}-m1`, base: 0, data: { id: `${id}-m1`, conversationId: "team", authorId: me.person.id, text: `${CANARY(id, 0)} message`, refs: [], photos: [], createdAt: new Date().toISOString(), status: "sent" } }], 4)).json().ok, true);
  }
  const clients = {
    alpha1: await client("alpha", owners.alpha, 1, "buyer1"), alpha2: await client("alpha", owners.alpha, 2, "buyer2"),
    bravo1: await client("bravo", owners.bravo, 1, "buyer1"),
  };
  return { app, dbs, mail, owners, clients, call, code };
}

/** Any marker that isn't this client's own (nor its warehouse's name) */
const foreign = (body: string, id: Id, n: 1 | 2) => [CANARY("alpha", 0), CANARY("alpha", 1), CANARY("alpha", 2), CANARY("bravo", 0), CANARY("bravo", 1), CANARY("bravo", 2)].filter(c => c !== CANARY(id, n)).filter(c => body.includes(c));
const order = (productId: string, extra: Record<string, unknown> = {}) => ({ requestId: `req-${Math.random().toString(36).slice(2, 12)}`, store: "Corner Market", ref: "PO-77", due: today(), lines: [{ productId, cases: 5 }], ...extra });

test("a client login sees only its own client's products, and nothing else of the warehouse", async () => {
  const w = await world();
  for (const method of Object.keys(PORTAL_METHODS).filter(m => m !== "auth.signOut")) {
    const r = await w.call("portal/api", "alpha", method, { since: 0, token: "x", code: "123456" }, w.clients.alpha1.cookie);
    assert.deepEqual(foreign(r.body, "alpha", 1), [], `${method} showed someone else's data`);
  }
  const products = (await w.call("portal/api", "alpha", "products", {}, w.clients.alpha1.cookie)).json();
  assert.deepEqual(products.map((p: any) => p.id).sort(), ["alpha-c1-P1", "alpha-c1-P2"]);
  // Product facts only: no stock, slots or lots
  assert.deepEqual(Object.keys(products[0]).sort(), ["brand", "code", "id", "name", "size", "units"]);
  const me = (await w.call("portal/api", "alpha", "auth.me", {}, w.clients.alpha1.cookie)).json();
  assert.deepEqual([me.client.id, me.account.username], [CLIENT("alpha", 1), "buyer1"]);
});

test("a client session opens no warehouse method, by either cookie name", async () => {
  const w = await world();
  const token = w.clients.alpha1.token;
  let refused = 0;
  for (const method of Object.keys(TENANT_METHODS)) {
    for (const cookie of [`wms=${token}`, `wms-portal=${token}`]) {
      const r = await w.call("api", "alpha", method, { since: 0, id: "alpha-c1-P1", token: "x", code: "123456" }, cookie);
      assert.deepEqual(foreign(r.body, "alpha", 1), [], `${method} with a client cookie showed warehouse data`);
      assert.ok(!r.body.includes(CANARY("alpha", 1)) || method === "tenant.public", `${method} answered a client session`);
      const anon = (await w.call("api", "alpha", method, { since: 0, id: "alpha-c1-P1", token: "x", code: "123456" })).statusCode;
      if (anon === 401) { refused++; assert.equal(r.statusCode, 401, `${method} let a client session in`); }
    }
  }
  assert.ok(refused >= 40, `only ${refused / 2} warehouse methods needed a session`);
});

test("a warehouse session opens no portal method, and a portal session works only at its own warehouse", async () => {
  const w = await world();
  const ownerToken = w.owners.alpha.split("=")[1];
  const open = ["portal.public", "invite.read", "invite.password", "invite.finish", "auth.signIn", "auth.verify", "auth.signOut"];
  for (const method of Object.keys(PORTAL_METHODS).filter(m => !open.includes(m))) {
    for (const cookie of [`wms-portal=${ownerToken}`, w.owners.alpha]) {
      const r = await w.call("portal/api", "alpha", method, order("alpha-c1-P1"), cookie);
      assert.equal(r.statusCode, 401, `${method} let a warehouse session into the portal`);
    }
    // Alpha's client at Bravo's address: not signed in there
    const r = await w.call("portal/api", "bravo", method, order("bravo-c1-P1"), w.clients.alpha1.cookie);
    assert.equal(r.statusCode, 401, `${method} at Bravo accepted Alpha's client`);
    assert.deepEqual(foreign(r.body, "alpha", 1), []);
  }
  // Same username in both warehouses, different people: Alpha's password and code don't sign in at Bravo's portal
  const ticket = await w.call("portal/api", "bravo", "auth.signIn", { username: "buyer1", password: "Wrong-Password-123" });
  assert.equal(ticket.statusCode, 401);
});

test("an order from the portal becomes a draft in Out-bounds, for its own client's products only", async () => {
  const w = await world();
  const c = w.clients.alpha1.cookie;
  // Another client's product, another warehouse's product, or one that doesn't exist: refused alike, nothing saved
  for (const productId of ["alpha-c2-P1", "bravo-c1-P1", "nope"]) {
    const r = await w.call("portal/api", "alpha", "order.send", order(productId), c);
    assert.equal(r.statusCode, 400, productId);
    assert.deepEqual(foreign(r.body, "alpha", 1), []);
  }
  assert.equal((await w.dbs.alpha.query("SELECT count(*)::int AS n FROM entities WHERE kind = 'order'")).rows[0].n, 1);

  const sent = order("alpha-c1-P1", { lines: [{ productId: "alpha-c1-P1", cases: 5 }, { productId: "alpha-c1-P2", cases: 3 }, { productId: "alpha-c1-P1", cases: 1 }], notes: "Back door please" });
  const r = await w.call("portal/api", "alpha", "order.send", sent, c);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().id, r.json().status, r.json().lines], ["Order 2", "draft", [{ code: "1001", name: `${CANARY("alpha", 1)} Rice`, cases: 6 }, { code: "1002", name: `${CANARY("alpha", 1)} Lentils`, cases: 3 }]]);
  // Sent again (a double click, a lost answer): saved once
  assert.equal((await w.call("portal/api", "alpha", "order.send", sent, c)).json().id, "Order 2");
  assert.equal((await w.dbs.alpha.query("SELECT count(*)::int AS n FROM portal_submissions")).rows[0].n, 1);

  // The office sees it with its next catch-up: a draft, from the portal, for the client, with a log line
  const pull = (await w.call("api", "alpha", "sync.pull", { since: 0 }, w.owners.alpha)).json();
  const o = pull.rows.find((x: any) => x.key === "order:Order 2").data;
  assert.deepEqual([o.status, o.source, o.client, o.store, o.ref, o.due], ["draft", "portal", CLIENT("alpha", 1), "Corner Market", "PO-77", today()]);
  assert.match(o.notes, /Back door please/);
  assert.ok(pull.rows.some((x: any) => x.key.startsWith("audit:") && /Created Order 2 for Corner Market from the client portal/.test(x.data.action)));
  // Approving it is the office's job, as with email
  const approved = await w.call("api", "alpha", "sync.push", { clientId: "device-alpha-00009", clientSeq: 1, type: "order/approve", at: new Date().toISOString(), changes: [{ key: "order:Order 2", base: 1, data: { ...o, status: "approved", picks: [{ location: "01A-01-L1-B1", productId: "alpha-c1-P1", cases: 6 }] } }] }, w.owners.alpha);
  assert.equal(approved.json().ok, true);
  const list = (await w.call("portal/api", "alpha", "sent", {}, c)).json();
  assert.deepEqual(list.map((x: any) => [x.id, x.status]), [["Order 2", "approved"]]);
  // Where it stands, never how the warehouse picks it
  assert.doesNotMatch(JSON.stringify(list), /01A-01|picks|location/);
  // Bravo's warehouse got nothing
  assert.equal((await w.dbs.bravo.query("SELECT count(*)::int AS n FROM entities WHERE key LIKE 'order:%' AND data->>'source' = 'portal'")).rows[0].n, 0);
});

test("a delivery notice becomes an expected delivery in In-bounds, one line per pallet", async () => {
  const w = await world();
  const c = w.clients.alpha1.cookie;
  const r = await w.call("portal/api", "alpha", "delivery.send", {
    requestId: "req-delivery-1", expected: today(), ref: "MSKU 482910",
    lines: [{ productId: "alpha-c1-P1", cases: 81, pallets: 2, lot: "L-9", bestBefore: "2027-06" }, { productId: "alpha-c1-P2", cases: 40 }],
  }, c);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().kind, r.json().status, r.json().number], ["delivery", "incoming", "1001"]);
  const s = (await w.dbs.alpha.query("SELECT data FROM entities WHERE key = $1", [`shipment:${CLIENT("alpha", 1).toLowerCase()}-1001`])).rows[0].data;
  assert.deepEqual([s.status, s.client, s.ref, s.supplier, s.expected], ["incoming", CLIENT("alpha", 1), "MSKU 482910", `${CANARY("alpha", 1)} Supplier`, today()]);
  assert.deepEqual(s.lines.map((l: any) => [l.pallet, l.productId, l.cases, l.lot, l.bestBefore]), [[1, "alpha-c1-P1", 41, "L-9", "2027-06"], [2, "alpha-c1-P1", 40, "L-9", "2027-06"], [3, "alpha-c1-P2", 40, "", ""]]);
  // Not another client's product, and not a date long gone
  assert.equal((await w.call("portal/api", "alpha", "delivery.send", { requestId: "req-delivery-2", expected: today(), lines: [{ productId: "alpha-c2-P1", cases: 4 }] }, c)).statusCode, 400);
  assert.equal((await w.call("portal/api", "alpha", "delivery.send", { requestId: "req-delivery-3", expected: "2020-01-01", lines: [{ productId: "alpha-c1-P1", cases: 4 }] }, c)).statusCode, 400);
});

test("each client sees only what its own logins sent", async () => {
  const w = await world();
  await w.call("portal/api", "alpha", "order.send", order("alpha-c1-P1"), w.clients.alpha1.cookie);
  await w.call("portal/api", "alpha", "order.send", order("alpha-c2-P1", { store: `${CANARY("alpha", 2)} Mart` }), w.clients.alpha2.cookie);
  await w.call("portal/api", "bravo", "order.send", order("bravo-c1-P1", { store: `${CANARY("bravo", 1)} Mart` }), w.clients.bravo1.cookie);
  const one = (await w.call("portal/api", "alpha", "sent", {}, w.clients.alpha1.cookie));
  assert.deepEqual(one.json().map((x: any) => x.id), ["Order 2"]);
  assert.deepEqual(foreign(one.body, "alpha", 1), []);
  const two = (await w.call("portal/api", "alpha", "sent", {}, w.clients.alpha2.cookie));
  assert.deepEqual(two.json().map((x: any) => x.id), ["Order 3"]);
  assert.deepEqual(foreign(two.body, "alpha", 2), []);
  // The office's own orders for client 1 (Order 1) stay out of client 1's list too
  assert.ok(!one.body.includes("office note"));
});

test("owners manage client logins: only owners, with their password again; turning one off ends its sessions", async () => {
  const w = await world();
  // Clients and the other warehouse can't list them
  assert.equal((await w.call("api", "alpha", "clientLogins.list", {}, w.clients.alpha1.cookie)).statusCode, 401);
  assert.equal((await w.call("api", "bravo", "clientLogins.list", {}, w.owners.alpha)).statusCode, 401);
  const list = (await w.call("api", "alpha", "clientLogins.list", {}, w.owners.alpha)).json();
  assert.deepEqual(list.map((l: any) => [l.username, l.client, l.status]).sort(), [["buyer1", CLIENT("alpha", 1), "active"], ["buyer2", CLIENT("alpha", 2), "active"]]);
  // A client that isn't the warehouse's is refused
  assert.equal((await w.call("api", "alpha", "clientLogins.invite", { name: "X", username: "x-buyer", client: CLIENT("bravo", 1) }, w.owners.alpha)).statusCode, 400);
  // The invite was emailed with the portal's link
  assert.ok(w.mail.sent.some(m => m.to === "buyer1@client.test" && /client portal/.test(m.subject) && m.text.includes("/portal#/invite/")));

  const off = await w.call("api", "alpha", "clientLogins.disable", { id: w.clients.alpha1.id }, w.owners.alpha);
  assert.equal(off.json().status, "disabled");
  assert.equal((await w.call("portal/api", "alpha", "products", {}, w.clients.alpha1.cookie)).statusCode, 401);
  const signIn = await w.call("portal/api", "alpha", "auth.signIn", { username: "buyer1", password: PASSWORD });
  assert.equal(signIn.statusCode, 401);
  // The other client's login carries on
  assert.equal((await w.call("portal/api", "alpha", "products", {}, w.clients.alpha2.cookie)).statusCode, 200);
  // Back on: the same password and phone work again (password, then the code)
  assert.equal((await w.call("api", "alpha", "clientLogins.enable", { id: w.clients.alpha1.id }, w.owners.alpha)).statusCode, 200);
  const { ticket } = (await w.call("portal/api", "alpha", "auth.signIn", { username: "buyer1", password: PASSWORD })).json();
  // The code used when joining doesn't work twice: the app's next code does
  const verify = await w.call("portal/api", "alpha", "auth.verify", { ticket, code: await totpAt(w.clients.alpha1.secret, totpCounter(Date.now()) + 1) });
  assert.equal(verify.statusCode, 200, verify.body);
  // The security log names client logins as such
  const log = (await w.call("api", "alpha", "security.list", {}, w.owners.alpha)).json().entries.map((e: any) => `${e.actor} ${e.action} ${e.target ?? ""}`).join("\n");
  assert.match(log, /turned off a client portal login buyer1/);
  assert.match(log, /Buyer 1 \(client portal, ALPHA-CLIENT1\) signed in/);
});
