// Tenant routing in the API: the Host header picks the tenant, nothing else does, and one tenant never reaches another's database.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { TenantPools, type PoolLike, type TenantDb } from "../src/db/pools.ts";
import { TenantDirectory, normalizeHost, type Tenant } from "../src/tenancy.ts";
import { checkTenantId, databaseSql, grantsSql, tenantDbName, withProxySecret } from "../src/ops/createTenant.ts";

const T = (id: string, status: Tenant["status"] = "active"): Tenant => ({ id, name: `${id} Foods`, status, dbName: `t_${id}`, dbUser: `t_${id}`, dbHost: "proxy.internal", dbPort: 5432 });
const TENANTS: Record<string, Tenant> = { "alpha.wms.test": T("alpha"), "bravo.wms.test": T("bravo"), "old.wms.test": T("old", "suspended") };
// Each tenant database holds its own config; a canary value says whose it is
const CONFIGS: Record<string, unknown> = {
  t_alpha: { branding: { appTitle: "Alpha Warehouse", mark: "AW" }, languages: { default: "en", enabled: ["en", "es"] }, canary: "ALPHA-ONLY" },
  t_bravo: { branding: { appTitle: "Bravo Warehouse", mark: "BW" }, languages: { default: "en", enabled: ["en"] }, canary: "BRAVO-ONLY" },
};

const JSON_HEADERS = { "x-wms": "1", "content-type": "application/json" };
/** An app request for the public tenant info */
const pub = (host: string, extra: Record<string, string> = {}, url = "/api/tenant.public") => ({ method: "POST" as const, url, payload: "{}", headers: { host, ...JSON_HEADERS, ...extra } });

function setup() {
  const queried: string[] = [];
  const pool = (db: TenantDb): PoolLike => ({
    totalCount: 0, idleCount: 0, waitingCount: 0, end: async () => {}, connect: async () => { throw new Error("no transactions here"); },
    query: async () => { queried.push(db.dbName); return { rows: CONFIGS[db.dbName] ? [{ value: CONFIGS[db.dbName] }] : [] }; },
  });
  const lookups: string[] = [];
  const directory = new TenantDirectory(async host => { lookups.push(host); return TENANTS[host] ?? null; });
  const app = buildApp({ directory, pools: new TenantPools(pool), platformHealth: async () => {} });
  return { app, queried, lookups };
}

test("the address picks the tenant, and only that tenant's database is read", async () => {
  const { app, queried } = setup();
  const a = await app.inject(pub("alpha.wms.test"));
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.json(), { id: "alpha", name: "alpha Foods", appTitle: "Alpha Warehouse", mark: "AW", languages: { default: "en", enabled: ["en", "es"] } });
  const b = await app.inject(pub("BRAVO.wms.test:443"));
  assert.equal(b.json().appTitle, "Bravo Warehouse");
  assert.deepEqual(queried, ["t_alpha", "t_bravo"]);
  assert.ok(!a.body.includes("canary") && !a.body.includes("BRAVO"));
});

test("headers, query strings and bodies can't switch the tenant", async () => {
  const { app, queried } = setup();
  for (const r of [
    pub("alpha.wms.test", {}, "/api/tenant.public?tenant=bravo"),
    pub("alpha.wms.test", { "x-forwarded-host": "bravo.wms.test", "x-tenant": "bravo" }),
  ]) {
    const res = await app.inject(r);
    assert.equal(res.json().appTitle, "Alpha Warehouse");
  }
  assert.ok(queried.every(q => q === "t_alpha"));
});

test("unknown, suspended and odd addresses all get the same 404, and no database is read", async () => {
  const { app, queried } = setup();
  for (const host of ["nobody.wms.test", "old.wms.test", "[::1]:8080", "alpha.wms.test/../bravo", ""]) {
    const res = await app.inject(pub(host));
    assert.equal(res.statusCode, 404, host);
    assert.deepEqual(res.json(), { error: "Not found" });
  }
  assert.deepEqual(queried, []);
});

test("API calls without the app's header or as a form are refused (another site can't send them)", async () => {
  const { app, queried } = setup();
  const noHeader = await app.inject({ method: "POST", url: "/api/tenant.public", payload: "{}", headers: { host: "alpha.wms.test", "content-type": "application/json" } });
  assert.equal(noHeader.statusCode, 400);
  const form = await app.inject({ method: "POST", url: "/api/tenant.public", payload: "a=1", headers: { host: "alpha.wms.test", "x-wms": "1", "content-type": "application/x-www-form-urlencoded" } });
  assert.ok([400, 415].includes(form.statusCode), String(form.statusCode));
  assert.deepEqual(queried, []);
});

test("the console's API isn't reachable at a warehouse's address", async () => {
  const { app } = setup();
  const res = await app.inject({ method: "POST", url: "/ops/api/auth.me", payload: "{}", headers: { host: "alpha.wms.test", ...JSON_HEADERS } });
  assert.equal(res.statusCode, 404);
});

test("answers carry the security headers", async () => {
  const { app } = setup();
  const res = await app.inject(pub("alpha.wms.test"));
  assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("health needs no tenant", async () => {
  const { app } = setup();
  assert.equal((await app.inject({ url: "/api/health", headers: { host: "anything" } })).statusCode, 200);
});

// CloudFront (infra/lib/api-stack.ts) keeps whatever the server says it may: hashed files for a year, nothing else
test("hashed files may be kept for a year; pages and other files are checked every time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wms-static-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "portal.html", "theme.js", "assets/index-Ab12Cd34.js", "assets/inter-latin-wght-normal-Xy9.woff2"]) writeFileSync(join(dir, f), f);
  const app = buildApp({ directory: new TenantDirectory(async h => TENANTS[h] ?? null), pools: new TenantPools(() => { throw new Error("no database"); }), platformHealth: async () => {}, staticDir: dir });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { host: "alpha.wms.test" } });
  for (const url of ["/assets/index-Ab12Cd34.js", "/assets/inter-latin-wght-normal-Xy9.woff2"]) {
    const r = await get(url);
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers["cache-control"], "public, max-age=31536000, immutable", url);
  }
  // Pages, the app's routes, unhashed files, and a hashed name that isn't there (it gets the app's page)
  for (const url of ["/", "/index.html", "/portal", "/inventory", "/theme.js", "/assets/index-Gone0000.js"]) {
    const r = await get(url);
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers["cache-control"], "no-cache", url);
  }
  assert.equal((await app.inject(pub("alpha.wms.test"))).headers["cache-control"], "no-store");
});

test("tenant lookups are cached per address", async () => {
  const { app, lookups } = setup();
  for (let i = 0; i < 5; i++) await app.inject(pub("alpha.wms.test"));
  assert.deepEqual(lookups, ["alpha.wms.test"]);
});

test("host names are normalised; IP literals and junk are refused", () => {
  assert.equal(normalizeHost("A3K.Example.COM:443"), "a3k.example.com");
  assert.equal(normalizeHost("a3k.example.com."), "a3k.example.com");
  for (const bad of ["[::1]", "a b.com", "-x.com", "x..com", "x.com/evil", undefined]) assert.equal(normalizeHost(bad), null, String(bad));
});

test("tenant IDs and database names", () => {
  assert.equal(tenantDbName("a3k"), "t_a3k");
  assert.equal(tenantDbName("bravo-foods"), "t_bravo_foods");
  for (const bad of ["A3K", "1abc", "a", "platform", "x--y", "y-", "a b", "a;drop"]) assert.throws(() => checkTenantId(bad), new RegExp(""), bad);
});

test("a new tenant's database is closed to everyone else, and its login can't change tables", () => {
  const sql = databaseSql("t_bravo", "pw'; DROP").join("\n");
  assert.match(sql, /REVOKE CONNECT, TEMPORARY ON DATABASE "t_bravo" FROM PUBLIC/);
  assert.match(sql, /GRANT CONNECT ON DATABASE "t_bravo" TO "t_bravo"/);
  assert.match(sql, /CONNECTION LIMIT 20/);
  assert.match(sql, /PASSWORD 'pw''; DROP'/, "the password is quoted");
  assert.doesNotMatch(sql, /SUPERUSER|CREATEDB|CREATEROLE/);
  const grants = grantsSql("t_bravo", "wmsadmin").join("\n");
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "t_bravo"/);
  assert.doesNotMatch(grants, /GRANT (ALL|CREATE)/);
});

test("adding a tenant's secret keeps the proxy's other logins and isn't added twice", () => {
  const before = [{ AuthScheme: "SECRETS" as const, SecretArn: "arn:platform", IAMAuth: "REQUIRED" as const }];
  const after = withProxySecret(before, "arn:t_bravo");
  assert.deepEqual(after.map(a => a.SecretArn), ["arn:platform", "arn:t_bravo"]);
  assert.equal(after[1].IAMAuth, "REQUIRED");
  assert.equal(withProxySecret(after, "arn:t_bravo").length, 2);
});
