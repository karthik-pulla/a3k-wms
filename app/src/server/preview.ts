// PREVIEW ONLY (VITE_WMS_BACKEND=preview): the real server code (server/src/core) running in this browser on PGlite,
// an in-memory PostgreSQL saved in this browser's storage. It's how the sign-in, invite, settings and console screens
// can be tried before AWS exists. Never part of a real build: client.ts loads this file only in preview.
//
// It plays the platform too: one warehouse (the one this app is built for), its first owner's invite waiting in the
// preview outbox, and a first console account for you.
import { PGlite } from "@electric-sql/pglite";
import { singleConnectionDb, type Db } from "../../../server/src/core/db.ts";
import { migrateDatabase, type Conn, type MigrationFile } from "../../../server/src/migrate/runner.ts";
import { OPS_TABLES, TENANT_TABLES, type AuthEnv } from "../../../server/src/core/auth.ts";
import { ApiError } from "../../../server/src/core/errors.ts";
import { type Mail, type Mailer } from "../../../server/src/core/mail.ts";
import { callTenant, tenantLog, tenantOps, useHandoff, type TenantCtx } from "../../../server/src/core/tenant-api.ts";
import { callOps, firstOperator, opsLog, type OpsCtx } from "../../../server/src/core/ops-api.ts";
import { totpAt, totpCounter, unseal } from "../../../server/src/core/crypto.ts";
import { addProducts, type ProductRow } from "../../../server/src/core/products.ts";
import { tenantId } from "../tenant";

const KEY = new Uint8Array(32).fill(42); // preview only: seals authenticator secrets in this browser
const BASE = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
/** The console is ops.html here (its own address on AWS): links made for it need the # right after the page */
const opsLink = (s: string) => s.replace("/ops.html/#", "/ops.html#");

// ---------- Migrations from the server's own SQL files ----------
const sqlFiles = import.meta.glob("../../../server/migrations/**/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const starter = import.meta.glob("../../../server/templates/starter-config.json", { import: "default", eager: true }) as Record<string, any>;
async function migrations(kind: "platform" | "tenant"): Promise<MigrationFile[]> {
  const files = Object.entries(sqlFiles).filter(([p]) => p.includes(`/migrations/${kind}/`)).sort(([a], [b]) => a.localeCompare(b));
  return Promise.all(files.map(async ([path, sql]) => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql)));
    return { name: path.split("/").pop()!, sql, checksum: [...digest].map(b => b.toString(16).padStart(2, "0")).join(""), noTransaction: /^--\s*no-transaction\b/.test(sql) };
  }));
}

/** PGlite as the core code's database: plain statements with values, whole files through exec */
function conn(pg: PGlite): Conn {
  return {
    query: async (text, values) => (values?.length ? { rows: (await pg.query(text, values)).rows as any[] } : { rows: ((await pg.exec(text)).at(-1)?.rows ?? []) as any[] }),
    end: async () => {},
  };
}

// ---------- The preview's outbox: the emails the server would have sent ----------
export interface PreviewMail extends Mail { at: string }
const OUTBOX_KEY = "wms.preview.outbox";
const readOutbox = (): PreviewMail[] => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]"); } catch { return []; } };
const listeners = new Set<() => void>();
const mailer: Mailer = {
  async send(m) {
    const all = [{ ...m, at: new Date().toISOString() }, ...readOutbox()].slice(0, 30);
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(all)); } catch { /* storage full */ }
    listeners.forEach(f => f());
    return true;
  },
};
export const previewOutbox = { read: readOutbox, subscribe: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); } };

// ---------- The databases ----------
interface Engine { platform: Db; tenants: Map<string, Db>; ready: Promise<void> }
let engine: Engine | null = null;
const idb = (name: string) => `idb://wms-preview-${name}`;

async function openTenantDb(id: string, fresh: boolean, config?: unknown, products?: unknown[]): Promise<Db> {
  const pg = new PGlite(idb(`t-${id}`), { relaxedDurability: true });
  const c = conn(pg);
  await migrateDatabase(c, await migrations("tenant"));
  const db = singleConnectionDb(c);
  if (fresh) {
    await db.query("INSERT INTO settings (key, value, updated_by) VALUES ('config', $1, 'preview') ON CONFLICT (key) DO NOTHING", [JSON.stringify(config)]);
    await addProducts(db, (products ?? []) as ProductRow[]);
  }
  return db;
}

function start(): Engine {
  const e: Engine = { platform: null as unknown as Db, tenants: new Map(), ready: Promise.resolve() };
  e.ready = (async () => {
    const pg = new PGlite(idb("platform"), { relaxedDurability: true });
    const c = conn(pg);
    if (!(await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'wms_platform'")).rows.length) await c.query("CREATE ROLE wms_platform");
    await migrateDatabase(c, await migrations("platform"));
    e.platform = singleConnectionDb(c);
    const id = tenantId();
    const known = (await e.platform.query("SELECT id FROM tenants WHERE status <> 'deleted'")).rows.map(r => r.id as string);
    if (!known.includes(id)) {
      // First time: this app's warehouse becomes a tenant with its own settings and products
      const base = `${import.meta.env.BASE_URL}tenants/${id}/`;
      const [config, products] = await Promise.all([fetch(`${base}config.json`).then(r => r.json()), fetch(`${base}products.json`).then(r => r.json())]);
      const db = await openTenantDb(id, true, config, products);
      e.tenants.set(id, db);
      await e.platform.query("INSERT INTO tenants (id, name, status, db_name, db_user, db_host, db_direct_host) VALUES ($1, $2, 'setup', $3, $3, 'preview', 'preview')", [id, config.tenant?.name ?? id, `t_${id}`]);
      await e.platform.query("INSERT INTO domains (host, tenant_id) VALUES ($1, $2)", [location.hostname.toLowerCase(), id]);
      // The first owner's invite, as the console would send it, and your own first console account
      const ctx = await tenantCtx(e, id, undefined);
      await tenantOps.restoreOwner(ctx, { by: "WMS team (preview)", name: "Owner", username: "owner", email: "owner@preview.test" });
      const link = await firstOperator(opsEnv(e), e.platform, { name: "You", username: "you", email: "you@preview.test", baseUrl: `${BASE}/ops.html` });
      await mailer.send({ to: "you@preview.test", subject: "Your WMS console account", text: `Open this link to choose your console password and connect an authenticator app:\n\n${opsLink(link)}` });
    }
    for (const t of known) if (!e.tenants.has(t)) e.tenants.set(t, await openTenantDb(t, false));
  })();
  return e;
}
async function ready(): Promise<Engine> { engine ??= start(); await engine.ready; return engine; }

const opsEnv = (e: Engine): AuthEnv => ({ db: e.platform, tables: OPS_TABLES, appKey: KEY, now: Date.now, issuer: "WMS console (preview)", ownWords: ["wms"], log: opsLog() });

async function tenantCtx(e: Engine, id: string, token: string | undefined): Promise<TenantCtx> {
  const db = e.tenants.get(id);
  if (!db) throw new ApiError(404, "not-found", "No such warehouse");
  const t = (await e.platform.query("SELECT name FROM tenants WHERE id = $1", [id])).rows[0];
  const c = (await db.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value ?? {};
  const appTitle = c.branding?.appTitle ?? t?.name ?? id;
  return {
    env: { db, tables: TENANT_TABLES, appKey: KEY, now: Date.now, issuer: `${appTitle} (preview)`, ownWords: [id, t?.name ?? "", appTitle, c.branding?.mark ?? ""], log: tenantLog() },
    tenant: { id, name: t?.name ?? id, appTitle, mark: c.branding?.mark ?? "", languages: c.languages ?? { default: "en", enabled: ["en"] },
      clients: (c.clients ?? []).map((x: any) => ({ id: x.id, name: x.name })), groups: (c.groups ?? []).map((x: any) => ({ id: x.id, name: x.name })) },
    token, meta: { ip: "preview", userAgent: navigator.userAgent }, baseUrl: BASE, mailer,
  };
}

// ---------- The "cookies" ----------
const SESSION = (scope: string) => `wms.preview.session.${scope}`;
const getToken = (scope: string) => { try { return localStorage.getItem(SESSION(scope)) ?? undefined; } catch { return undefined; } };
const setToken = (scope: string, s: { token: string } | "clear" | undefined) => {
  if (!s) return;
  try { if (s === "clear") localStorage.removeItem(SESSION(scope)); else localStorage.setItem(SESSION(scope), s.token); } catch { /* ignore */ }
};

/** Errors look like the real server's, so the screens handle them the same way */
async function asHttp<T>(f: () => Promise<T>): Promise<T> {
  const { ApiCallError } = await import("./client");
  try { return await f(); } catch (err) {
    if (err instanceof ApiError) throw new ApiCallError(err.status, { error: err.message, code: err.code, ...(err.info ? { info: err.info } : {}) });
    console.error(err);
    throw new ApiCallError(500, { error: "Something went wrong", code: "server" });
  }
}

export async function previewTenant(method: string, input: Record<string, unknown>) {
  return asHttp(async () => {
    const e = await ready();
    const id = tenantId();
    const r = await callTenant(method, input, await tenantCtx(e, id, getToken(id)));
    setToken(id, r.session);
    return r.body;
  });
}

/** The console's one-time support link: in the preview it opens this same page */
export async function previewHandoff(token: string) {
  return asHttp(async () => {
    const e = await ready();
    const id = tenantId();
    setToken(id, await useHandoff(await tenantCtx(e, id, undefined), token));
  });
}

export async function previewOps(method: string, input: Record<string, unknown>) {
  return asHttp(async () => {
    const e = await ready();
    const ctx: OpsCtx = {
      env: opsEnv(e), platform: e.platform, token: getToken("ops"), meta: { ip: "preview" }, baseUrl: `${BASE}/ops.html`, mailer,
      tenant: id => tenantCtx(e, id, undefined),
      creator: {
        // Creating a warehouse in the preview: a new PGlite database with the starter settings
        async start(t) {
          const config = { ...Object.values(starter)[0], tenant: { ...Object.values(starter)[0].tenant, id: t.id, name: t.name }, branding: { appTitle: t.name, mark: t.name.split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase() } };
          e.tenants.set(t.id, await openTenantDb(t.id, true, config, []));
          await e.platform.query("INSERT INTO tenants (id, name, status, db_name, db_user, db_host, db_direct_host) VALUES ($1, $2, 'setup', $3, $3, 'preview', 'preview')", [t.id, t.name, `t_${t.id}`]);
          for (const h of t.hosts) await e.platform.query("INSERT INTO domains (host, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [h, t.id]);
          return { job: `preview-${t.id}` };
        },
        async status() { return { state: "done" as const }; },
      },
    };
    const r = await callOps(method, input, ctx);
    setToken("ops", r.session);
    const body = r.body as any;
    // Support links point at the real server's handoff address; in the preview, this page handles them
    if (method === "support.open" && body?.url) body.url = body.url.replace(/\/api\/auth\/handoff\?token=/, "/#/handoff/");
    if (method === "operators.invite" && body?.link) body.link = opsLink(body.link);
    return body;
  });
}

/** Preview tools: the code an account's authenticator app would show right now */
export async function previewCode(scope: "tenant" | "ops", username: string): Promise<string | null> {
  const e = await ready();
  const db = scope === "ops" ? e.platform : e.tenants.get(tenantId())!;
  const row = (await db.query(`SELECT totp_secret FROM ${scope === "ops" ? "operators" : "people"} WHERE username = $1`, [username.trim().toLowerCase()])).rows[0];
  return row?.totp_secret ? totpAt(await unseal(KEY, row.totp_secret), totpCounter(Date.now())) : null;
}

/** Preview tools: forget everything the preview saved in this browser */
export async function previewReset() {
  for (const k of Object.keys(localStorage)) if (k.startsWith("wms.preview.")) localStorage.removeItem(k);
  const dbs = await indexedDB.databases?.() ?? [];
  await Promise.all(dbs.filter(d => d.name?.includes("wms-preview")).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name!); q.onsuccess = q.onerror = q.onblocked = () => r(null); })));
  location.reload();
}
