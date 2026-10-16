// A test warehouse on in-memory PostgreSQL (PGlite) with its first owner signed in, and a "browser" that keeps the
// session cookie. Shared by the warehouse API tests.
import assert from "node:assert/strict";
import { freshDb } from "./pg.ts";
import { TENANT_TABLES, type AuthEnv } from "../src/core/auth.ts";
import { totpAt, totpCounter } from "../src/core/crypto.ts";
import { ApiError } from "../src/core/errors.ts";
import { outbox } from "../src/core/mail.ts";
import { callTenant, tenantLog, type TenantCtx } from "../src/core/tenant-api.ts";

let clock = Date.parse("2026-10-16T12:00:00Z");
/** The tests' clock (moved on with tick) */
export const now = () => clock;
export const tick = (s = 31) => { clock += s * 1000; };
export const KEY = new Uint8Array(32).fill(3);

export async function warehouse() {
  const { db } = await freshDb("tenant");
  const mail = outbox();
  const env: AuthEnv = { db, tables: TENANT_TABLES, appKey: KEY, now, issuer: "Bravo Warehouse", ownWords: ["bravo"], log: tenantLog() };
  const tenant: TenantCtx["tenant"] = {
    id: "bravo", name: "Bravo Foods", appTitle: "Bravo Warehouse", mark: "BW", languages: { default: "en", enabled: ["en", "es"] },
    clients: [{ id: "Sunfield", name: "Sunfield" }, { id: "Lotus", name: "Lotus" }], groups: [{ id: "shift-am", name: "shift-am" }],
  };
  const ctx = (token?: string): TenantCtx => ({ env, tenant, token, meta: { ip: "203.0.113.5" }, baseUrl: "https://bravo.wms.test", mailer: mail });
  return { db, env, mail, ctx };
}

/** Calls a method, returning the body; a session the method sets is kept on the "browser" */
export function browser(make: (token?: string) => TenantCtx) {
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
export const code = (secret: string) => totpAt(secret, totpCounter(clock));
export const fails = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: ApiError) => e.code === c);
export const tokenOf = (link: string) => link.split("/#/invite/")[1];

/** Follows an invite link like a person would: password, then the authenticator code */
export async function accept(b: ReturnType<typeof browser>, link: string, password = "Correct-Horse-9!") {
  const t = tokenOf(link);
  const { secret } = await b.call("invite.password", { token: t, password });
  const me = await b.call("invite.finish", { token: t, code: await code(secret) });
  return { me, secret };
}

export async function ownerSignedIn() {
  const w = await warehouse();
  // The first owner comes from the ops console (restore access / invite an owner)
  const { tenantOps } = await import("../src/core/tenant-api.ts");
  const r = await tenantOps.restoreOwner(w.ctx(), { by: "Sam (WMS team)", name: "Maya", username: "maya", email: "maya@bravo.test" });
  const owner = browser(w.ctx);
  const { me, secret } = await accept(owner, r.link, "Rapid-Owner-Pass-1");
  await owner.call("auth.confirm", { password: "Rapid-Owner-Pass-1" });
  return { ...w, owner, ownerMe: me, ownerSecret: secret };
}
