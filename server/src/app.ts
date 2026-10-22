// The web server. One address per warehouse (its subdomain) and one for the ops console (OPS_HOST):
//   POST /api/<method>          the warehouse API (server/src/core/tenant-api.ts), for the warehouse at this address
//   GET  /api/auth/handoff      a one-time support link from the ops console
//   POST /ops/api/<method>      the ops console API (server/src/core/ops-api.ts), only at the ops address
//   GET  /api/health            for the load balancer
//   everything else             the app (index.html), or the console (ops.html) at the ops address
//
// The tenant comes only from the Host header, never from anything else the browser sends. Sessions are HttpOnly
// cookies; API calls must be JSON with an `x-wms: 1` header, which a form or link on another site can't send (no CORS),
// so other sites can't act as a signed-in person.
import { requestVisit } from "./core/site.ts";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { BusyError, type TenantPools } from "./db/pools.ts";
import { normalizeHost, type Tenant, type TenantDirectory } from "./tenancy.ts";
import { OPS_TABLES, TENANT_TABLES, type AuthEnv } from "./core/auth.ts";
import type { Db } from "./core/db.ts";
import { ApiError, obj } from "./core/errors.ts";
import { noMail, type Mailer } from "./core/mail.ts";
import { callTenant, tenantLog, useHandoff, type TenantCtx } from "./core/tenant-api.ts";
import { callOps, opsLog, type OpsCtx, type TenantCreator } from "./core/ops-api.ts";

declare module "fastify" {
  interface FastifyRequest { tenant?: Tenant; ops?: boolean; site?: boolean }
}

export interface AppDeps {
  directory: TenantDirectory;
  pools: TenantPools;
  /** Throws if the platform database can't be reached */
  platformHealth: () => Promise<void>;
  /** The platform database (the console's accounts, errors); absent in tests that don't need it */
  platform?: Db;
  /** Seals authenticator secrets; from Secrets Manager on AWS */
  appKey?: Uint8Array;
  mailer?: Mailer;
  /** The console's address, e.g. ops.example.com */
  opsHost?: string;
  /** HTTPS in front (cookies get Secure and the __Host- prefix) */
  secureCookies?: boolean;
  /** The built app (app/dist): index.html, ops.html and their files */
  staticDir?: string;
  creator?: TenantCreator;
  logger?: boolean;
  /** The product's own address (<domain>, and www.<domain>): the public page with "Book a visit" (core/site.ts) */
  siteHost?: string;
  productName?: string;
  /** Who gets an email for each visit request */
  visitNotify?: string;
}

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  "connect-src 'self'", "worker-src 'self' blob:", "frame-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

/** Methods anyone can call before signing in: limited per address, so passwords and links can't be guessed at speed */
const LIMITED = new Set(["auth.signIn", "auth.verify", "auth.confirm", "invite.read", "invite.password", "invite.finish", "requests.create"]);
class RateLimit {
  private readonly hits = new Map<string, { n: number; until: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) { this.limit = limit; this.windowMs = windowMs; }
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.until < now) { this.hits.set(key, { n: 1, until: now + this.windowMs }); if (this.hits.size > 50_000) this.hits.clear(); return true; }
    return ++h.n <= this.limit;
  }
}

export function buildApp(deps: AppDeps): FastifyInstance {
  // trustProxy only for the client's IP (from the load balancer); the tenant still comes from Host, never X-Forwarded-Host
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true, bodyLimit: 8_388_608 }); // a change may carry message photos (server/src/shared/sync.ts)
  app.register(cookie);
  const cookieName = deps.secureCookies ? "__Host-wms" : "wms";
  const limiter = new RateLimit(30, 60_000);
  const opsHost = deps.opsHost ? normalizeHost(deps.opsHost) : null;
  const siteHost = deps.siteHost ? normalizeHost(deps.siteHost) : null;
  const visitLimiter = new RateLimit(5, 60 * 60_000);
  const appKey = deps.appKey ?? new Uint8Array(32);
  const mailer = deps.mailer ?? noMail;

  /** A tenant's database through RDS Proxy, as the core code sees it */
  const tenantDb = (t: Tenant): Db => ({ query: (text, values) => deps.pools.query(t, text, values), tx: fn => deps.pools.tx(t, fn) });

  // The warehouse's settings from its own database (name, clients, groups), cached for a minute
  const configs = new Map<string, { c: any; until: number }>();
  async function configOf(t: Tenant) {
    const hit = configs.get(t.id);
    if (hit && hit.until > Date.now()) return hit.c;
    const { rows } = await deps.pools.query(t, "SELECT value FROM settings WHERE key = 'config'");
    const c = rows[0]?.value ?? {};
    configs.set(t.id, { c, until: Date.now() + 60_000 });
    return c;
  }

  async function tenantCtx(t: Tenant, req: FastifyRequest | null, token?: string): Promise<TenantCtx> {
    const c = await configOf(t);
    const appTitle = c.branding?.appTitle ?? t.name, mark = c.branding?.mark ?? "";
    const ip = req?.ip;
    const env: AuthEnv = { db: tenantDb(t), tables: TENANT_TABLES, appKey, now: Date.now, issuer: appTitle, ownWords: [t.id, t.name, appTitle, mark], log: tenantLog(ip) };
    const host = req ? normalizeHost(req.headers.host)! : (await primaryHost(t.id));
    return {
      env, token, meta: { ip, userAgent: req?.headers["user-agent"] }, mailer,
      baseUrl: `${deps.secureCookies ? "https" : "http"}://${host}`,
      tenant: {
        id: t.id, name: t.name, appTitle, mark, languages: c.languages ?? { default: "en", enabled: ["en"] },
        clients: (c.clients ?? []).map((x: any) => ({ id: x.id, name: x.name })), groups: (c.groups ?? []).map((x: any) => ({ id: x.id, name: x.name })),
      },
    };
  }
  async function primaryHost(tenantId: string): Promise<string> {
    const { rows } = await deps.platform!.query("SELECT host FROM domains WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [tenantId]);
    return rows[0]?.host ?? "localhost";
  }

  const setSession = (reply: FastifyReply, s: { token: string; maxAgeSec: number } | "clear" | undefined) => {
    if (!s) return;
    const opts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: !!deps.secureCookies };
    if (s === "clear") reply.clearCookie(cookieName, opts);
    else reply.setCookie(cookieName, s.token, { ...opts, maxAge: s.maxAgeSec });
  };

  // ---------- Every request: which tenant, or the console ----------
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/api/health" || req.url.startsWith("/api/health?")) return;
    const host = normalizeHost(req.headers.host);
    if (opsHost && host === opsHost) { req.ops = true; return; }
    if (siteHost && (host === siteHost || host === `www.${siteHost}`)) { req.site = true; return; }
    if (req.url.startsWith("/ops")) return reply.code(404).send({ error: "Not found" });
    const tenant = await deps.directory.resolve(req.headers.host);
    // The same answer for an unknown, suspended or deleted tenant: nothing says which warehouses exist
    if (!tenant) return reply.code(404).send({ error: "Not found" });
    req.tenant = tenant;
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("content-security-policy", CSP);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    if (deps.secureCookies) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (req.url.startsWith("/api") || req.url.startsWith("/ops/api")) reply.header("cache-control", "no-store");
  });

  app.get("/api/health", async (_req, reply) => {
    try { await deps.platformHealth(); return { ok: true }; } catch { return reply.code(503).send({ ok: false }); }
  });

  /** Same checks for both APIs: JSON with x-wms (no other site can send that), then the per-address limit */
  function guard(req: FastifyRequest, method: string) {
    if (req.headers["x-wms"] !== "1" || !String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new ApiError(400, "bad-request", "Not an app request");
    if (LIMITED.has(method) && !limiter.allow(`${req.ip}|${req.ops ? "ops" : req.tenant?.id}|${method}`)) throw new ApiError(429, "busy", "Too many tries from here. Wait a minute.");
  }

  app.post<{ Params: { method: string } }>("/api/:method", async (req, reply) => {
    // The public page: its name, and visit requests (5 an hour from one address)
    if (req.site) {
      guard(req, req.params.method);
      if (req.params.method === "site.info") return { productName: deps.productName ?? "Lattice" };
      if (req.params.method === "visit.request" && deps.platform) {
        if (!visitLimiter.allow(req.ip)) throw new ApiError(429, "busy", "Thanks, we have your request. To send another, wait a while or email us.");
        return requestVisit(deps.platform, obj(req.body), { ip: req.ip, mailer, notifyTo: deps.visitNotify, productName: deps.productName ?? "Lattice" });
      }
      return reply.code(404).send({ error: "Not found" });
    }
    if (req.ops || !req.tenant) return reply.code(404).send({ error: "Not found" });
    guard(req, req.params.method);
    const ctx = await tenantCtx(req.tenant, req, req.cookies[cookieName]);
    const r = await callTenant(req.params.method, req.body, ctx);
    setSession(reply, r.session);
    return r.body;
  });

  app.get<{ Querystring: { token?: string } }>("/api/auth/handoff", async (req, reply) => {
    if (!req.tenant) return reply.code(404).send({ error: "Not found" });
    const s = await useHandoff(await tenantCtx(req.tenant, req), String(req.query.token ?? ""));
    setSession(reply, s);
    return reply.redirect("/#/");
  });

  app.post<{ Params: { method: string } }>("/ops/api/:method", async (req, reply) => {
    if (!req.ops || !deps.platform || !deps.creator) return reply.code(404).send({ error: "Not found" });
    guard(req, req.params.method);
    const platform = deps.platform;
    const ctx: OpsCtx = {
      env: { db: platform, tables: OPS_TABLES, appKey, now: Date.now, issuer: "WMS console", ownWords: ["wms", "ops", "console"], log: opsLog(req.ip) },
      platform, token: req.cookies[cookieName], meta: { ip: req.ip, userAgent: req.headers["user-agent"] },
      baseUrl: `${deps.secureCookies ? "https" : "http"}://${opsHost}`, mailer, creator: deps.creator,
      tenant: async id => {
        const t = (await platform.query("SELECT t.id, t.name, t.status, t.db_name, t.db_user, t.db_host, t.db_port FROM tenants t WHERE t.id = $1", [id])).rows[0];
        if (!t) throw new ApiError(404, "not-found", "No such warehouse");
        return tenantCtx({ id: t.id, name: t.name, status: t.status, dbName: t.db_name, dbUser: t.db_user, dbHost: t.db_host, dbPort: Number(t.db_port) }, null);
      },
    };
    const r = await callOps(req.params.method, req.body, ctx);
    setSession(reply, r.session);
    return r.body;
  });

  // ---------- The app and the console ----------
  if (deps.staticDir && existsSync(deps.staticDir)) {
    // Every file in the build gets its own route at startup; file names under assets/ carry a hash, so they never change
    app.register(fastifyStatic, {
      root: deps.staticDir, index: false, wildcard: false,
      setHeaders: (res, path) => { res.header("cache-control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"); },
    });
    const page = (req: FastifyRequest, reply: FastifyReply) => reply.header("cache-control", "no-cache").sendFile(req.ops ? "ops.html" : req.site ? "landing.html" : "index.html");
    app.get("/", page);
    // Any other address that isn't a file or the API: the app (it routes itself with #/…)
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ops/api") ? page(req, reply) : reply.code(404).send({ error: "Not found" })));
  }

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.message, code: err.code, ...(err.info ? { info: err.info } : {}) });
    if (err instanceof BusyError) return reply.code(503).header("retry-after", "2").send({ error: "Busy, try again", code: "busy" });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: "Bad request", code: "bad-request" });
    req.log.error({ err, tenant: req.tenant?.id }, "request failed");
    // Counted per hour for the ops console (no details: those stay in the logs)
    const route = req.routeOptions?.url ?? "?";
    await deps.platform?.query(
      "INSERT INTO error_events (tenant_id, route, message, hour) VALUES ($1, $2, $3, date_trunc('hour', now())) ON CONFLICT (tenant_id, route, message, hour) DO UPDATE SET count = error_events.count + 1",
      [req.tenant?.id ?? "", `${req.method} ${route}${route.includes(":method") ? ` ${(req.params as any)?.method ?? ""}` : ""}`, String(e.message ?? "error").split("\n")[0].slice(0, 200)]).catch(() => {});
    return reply.code(500).send({ error: "Something went wrong", code: "server" });
  });

  return app;
}
