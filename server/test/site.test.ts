// The product's public page (src/core/site.ts, src/app.ts): served only at the product's own address, "Book a
// visit" requests kept and emailed to the team, bots and floods turned away, and the console's list of them.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { TenantPools } from "../src/db/pools.ts";
import { TenantDirectory, type Tenant } from "../src/tenancy.ts";
import { OPS_TABLES } from "../src/core/auth.ts";
import { outbox } from "../src/core/mail.ts";
import { callOps, opsLog, type OpsCtx } from "../src/core/ops-api.ts";
import { listVisits, updateVisit } from "../src/core/site.ts";
import { TENANT_METHODS } from "../src/core/tenant-api.ts";
import { freshDb } from "./pg.ts";

const JSON_HEADERS = { "x-wms": "1", "content-type": "application/json" };
const VISIT = { name: "Ravi Patel", company: "Ridge Cold Store", email: "ravi@ridge.example", phone: "555-0100", location: "Edison, NJ", size: "2,000–5,000", when: "Weekday mornings", message: "Three brands, orders by email." };

async function site() {
  const { db: platform } = await freshDb("platform");
  const dir = mkdtempSync(join(tmpdir(), "wms-static-"));
  for (const f of ["index.html", "ops.html", "landing.html"]) writeFileSync(join(dir, f), `<!doctype html><title>${f}</title>`);
  const mail = outbox();
  const alpha: Tenant = { id: "alpha", name: "Alpha", status: "active", dbName: "t_alpha", dbUser: "t_alpha", dbHost: "x", dbPort: 5432 };
  const app = buildApp({
    directory: new TenantDirectory(async h => (h === "alpha.wms.example" ? alpha : null)),
    pools: new TenantPools(() => { throw new Error("no tenant database in these tests"); }),
    platformHealth: async () => {}, platform, mailer: mail, staticDir: dir,
    siteHost: "wms.example", opsHost: "ops.wms.example", productName: "Rackwise", visitNotify: "team@wms.example",
  });
  const post = (host: string, method: string, body: unknown, ip = "198.51.100.7") => app.inject({ method: "POST", url: `/api/${method}`, payload: JSON.stringify(body), headers: { host, ...JSON_HEADERS }, remoteAddress: ip });
  return { app, platform, mail, post };
}

test("the product's address serves the public page; warehouse and console addresses serve their own", async () => {
  const s = await site();
  for (const [host, page] of [["wms.example", "landing.html"], ["www.wms.example", "landing.html"], ["ops.wms.example", "ops.html"], ["alpha.wms.example", "index.html"]]) {
    const r = await s.app.inject({ method: "GET", url: "/", headers: { host } });
    assert.equal(r.statusCode, 200, host);
    assert.match(r.body, new RegExp(page.replace(".", "\\.")), host);
  }
  assert.deepEqual((await s.post("wms.example", "site.info", {})).json(), { productName: "Rackwise" });
  // The public page has no warehouse methods, and a warehouse has no visit form
  assert.equal((await s.post("wms.example", "auth.me", {})).statusCode, 404);
  assert.equal("visit.request" in TENANT_METHODS, false);
});

test("a visit request is kept for the console and emailed to the team", async () => {
  const s = await site();
  assert.deepEqual((await s.post("wms.example", "visit.request", VISIT)).json(), { ok: true });
  const [v] = await listVisits(s.platform);
  assert.deepEqual([v.company, v.email, v.size, v.when, v.status], ["Ridge Cold Store", "ravi@ridge.example", "2,000–5,000", "Weekday mornings", "new"]);
  assert.equal(s.mail.sent[0].to, "team@wms.example");
  assert.match(s.mail.sent[0].subject, /^Rackwise: visit request from Ridge Cold Store/);
  const done = await updateVisit(s.platform, "Sam", { id: v.id, status: "booked", notes: "Tuesday 10am" });
  assert.deepEqual([done.status, done.notes, done.updatedBy], ["booked", "Tuesday 10am", "Sam"]);
  await assert.rejects(updateVisit(s.platform, "Sam", { id: v.id, status: "maybe" }));
});

test("bad requests are refused, bots are quietly ignored, and one address can't flood the list", async () => {
  const s = await site();
  assert.equal((await s.post("wms.example", "visit.request", { ...VISIT, email: "not-an-email" })).statusCode, 400);
  assert.equal((await s.post("wms.example", "visit.request", { ...VISIT, company: "" })).statusCode, 400);
  // The hidden field: looks accepted, nothing kept
  assert.deepEqual((await s.post("wms.example", "visit.request", { ...VISIT, website: "http://spam.example" }, "203.0.113.9")).json(), { ok: true });
  assert.equal((await listVisits(s.platform)).length, 0);
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await s.post("wms.example", "visit.request", VISIT, "192.0.2.50")).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429], "five an hour from one address");
  // Without the app's header (a plain form post from another site) nothing happens
  const form = await s.app.inject({ method: "POST", url: "/api/visit.request", payload: "name=x", headers: { host: "wms.example", "content-type": "application/x-www-form-urlencoded" } });
  assert.ok([400, 415].includes(form.statusCode));
});

test("only the WMS team's console lists the requests", async () => {
  const s = await site();
  const ctx = {
    env: { db: s.platform, tables: OPS_TABLES, appKey: new Uint8Array(32), now: Date.now, issuer: "WMS console", ownWords: ["wms"], log: opsLog() },
    platform: s.platform, meta: {}, baseUrl: "https://ops.wms.example", mailer: s.mail,
  } as unknown as OpsCtx;
  await assert.rejects(callOps("visits.list", {}, ctx), (e: any) => e.code === "not-signed-in");
});
