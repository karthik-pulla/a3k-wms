// Starts the server in its ECS task: the warehouse API, the ops console API and the app, all databases through RDS Proxy.
import { buildApp } from "./app.ts";
import { apiConfig } from "./config.ts";
import type { Db } from "./core/db.ts";
import { noMail } from "./core/mail.ts";
import { TenantPools } from "./db/pools.ts";
import { proxyPool, proxyPoolFactory } from "./db/pg.ts";
import { appKeyFrom, ecsCreator, sesMailer } from "./ops/aws-services.ts";
import { startInboundWorker } from "./ops/inbound-worker.ts";
import { TENANT_BY_HOST_SQL, TenantDirectory, rowToTenant } from "./tenancy.ts";

const cfg = apiConfig();
const logError = (e: Error) => console.error(JSON.stringify({ level: "error", msg: "idle database connection failed", err: e.message }));

// The platform database: tenants, addresses and the console's accounts. A few connections are enough (lookups are cached).
const platformPool = proxyPool(cfg.region, { id: "platform", dbName: cfg.platformDb, dbUser: cfg.platformUser, dbHost: cfg.proxyHost, dbPort: cfg.proxyPort },
  { max: 3, idleMs: 30_000 }, logError);
const platform: Db = {
  query: (text, values) => platformPool.query(text, values),
  async tx(fn) {
    const c = await platformPool.connect();
    try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); c.release(); return r; }
    catch (e) { await c.query("ROLLBACK").catch(() => {}); c.release(true); throw e; }
  },
};
const pools = new TenantPools(proxyPoolFactory(cfg.region, logError), { perTenantMax: cfg.perTenantMax, budget: cfg.budget });
const directory = new TenantDirectory(async host => {
  const { rows } = await platform.query(TENANT_BY_HOST_SQL, [host]);
  return rows[0] ? rowToTenant(rows[0]) : null;
});

const env = process.env;
const app = buildApp({
  directory, pools, platform,
  platformHealth: async () => { await platform.query("SELECT 1"); },
  appKey: await appKeyFrom(cfg.region, env.APP_KEY_SECRET_ARN ?? ""),
  mailer: env.MAIL_FROM ? sesMailer(cfg.region, env.MAIL_FROM) : noMail,
  opsHost: env.OPS_HOST,
  siteHost: env.SITE_HOST, productName: env.PRODUCT_NAME, visitNotify: env.VISIT_NOTIFY,
  secureCookies: env.COOKIE_SECURE === "1",
  staticDir: env.STATIC_DIR ?? "/app/public",
  creator: ecsCreator({
    region: cfg.region, cluster: env.ECS_CLUSTER ?? "", taskDefinition: env.OPS_TASK_DEFINITION ?? "",
    subnets: (env.OPS_SUBNETS ?? "").split(",").filter(Boolean), securityGroups: (env.OPS_SECURITY_GROUP ?? "").split(",").filter(Boolean),
  }),
  logger: true,
});

// Order emails: SES → queue → each warehouse's inbox (only when the domain and its mail are set up)
const inbound = env.INBOUND_QUEUE_URL && env.ORDERS_DOMAIN
  ? startInboundWorker({ region: cfg.region, queueUrl: env.INBOUND_QUEUE_URL, ordersDomain: env.ORDERS_DOMAIN, platform, pools })
  : null;

const stop = async () => { inbound?.stop(); await app.close(); await pools.closeAll(); await platformPool.end(); process.exit(0); };
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

await app.listen({ host: "0.0.0.0", port: cfg.port });
