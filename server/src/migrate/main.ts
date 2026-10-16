// The migration loop as a one-off ECS task, run before each deploy (infra/: the "Migrate" task definition):
// 1. make sure the platform database and the API's role exist, 2. migrate the platform database, 3. migrate every
// tenant database, a few at a time. Exits non-zero if anything failed, which stops the deploy.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateConfig } from "../config.ts";
import { directConnector, getLogin, ident, literal } from "../ops/aws.ts";
import { readMigrations } from "./files.ts";
import { runLoop, type Conn, type TargetResult } from "./runner.ts";

/** Where the SQL files are: server/migrations, found from this file whether it runs from src/ or dist/src/ */
export function migrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!dir.endsWith("/src")) dir = dirname(dir);
  return join(dir.endsWith("/dist/src") ? dirname(dirname(dir)) : dirname(dir), "migrations");
}

/** Role settings that keep one tenant (or the API) from hurting everyone: per-role limits instead of session SET */
export const ROLE_LIMITS = (role: string) => [
  `ALTER ROLE ${ident(role)} CONNECTION LIMIT 20`,
  `ALTER ROLE ${ident(role)} SET statement_timeout = '15s'`,
  `ALTER ROLE ${ident(role)} SET idle_in_transaction_session_timeout = '30s'`,
  `ALTER ROLE ${ident(role)} SET lock_timeout = '5s'`,
];

/** The platform database and the API's role (wms_platform), with the password RDS Proxy has for it */
async function bootstrap(connect: (db: string) => Promise<Conn>, platformDb: string, platformUser: string, platformPassword: string) {
  const admin = await connect("postgres");
  try {
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [platformUser]);
    await admin.query(`${role.rows.length ? "ALTER" : "CREATE"} ROLE ${ident(platformUser)} LOGIN PASSWORD ${literal(platformPassword)}`);
    for (const sql of ROLE_LIMITS(platformUser)) await admin.query(sql);
    const db = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [platformDb]);
    if (!db.rows.length) await admin.query(`CREATE DATABASE ${ident(platformDb)}`);
    await admin.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(platformDb)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${ident(platformDb)} TO ${ident(platformUser)}`);
  } finally {
    await admin.end();
  }
}

async function main() {
  const cfg = migrateConfig();
  const master = await getLogin(cfg.region, cfg.masterSecretArn);
  const platformLogin = await getLogin(cfg.region, cfg.platformSecretArn);
  const connect = directConnector(cfg.directHost, cfg.directPort, master);
  await bootstrap(connect, cfg.platformDb, cfg.platformUser, platformLogin.password);

  const dir = migrationsDir();
  const platformFiles = readMigrations(join(dir, "platform"));
  const tenantFiles = readMigrations(join(dir, "tenant"));

  // The tenant list comes from the platform database, so it must be migrated before it's read
  const platformConn = await connect(cfg.platformDb);
  try {
    const listTenants = async () => (await platformConn.query("SELECT id, db_name, db_direct_host FROM tenants WHERE status <> 'deleted' ORDER BY id")).rows;
    const record = async (r: TargetResult) => {
      await platformConn.query("INSERT INTO tenant_migrations (tenant_id, ok, applied, failed_file, error) VALUES ($1, $2, $3, $4, $5)", [r.id, r.ok, r.applied, r.failedFile ?? null, r.error ?? null]);
      if (r.ok) await platformConn.query("UPDATE tenants SET schema_version = $2 WHERE id = $1", [r.id, tenantFiles.at(-1)?.name ?? null]);
    };
    // Platform first, on its own (the tenants table may not exist yet)
    const first = await runLoop({ platform: { id: "platform", connect: () => connect(cfg.platformDb) }, tenants: [], platformFiles, tenantFiles, concurrency: 1 });
    if (!first.ok) { report(first); process.exit(1); }
    const tenants = await listTenants();
    const result = await runLoop({
      platform: { id: "platform", connect: () => connect(cfg.platformDb) },
      tenants: tenants.map(t => ({ id: t.id, connect: () => directConnector(t.db_direct_host, cfg.directPort, master)(t.db_name) })),
      platformFiles, tenantFiles, concurrency: cfg.concurrency, onTenant: record,
    });
    report(result);
    process.exit(result.ok ? 0 : 1);
  } finally {
    await platformConn.end().catch(() => {});
  }
}

function report(r: Awaited<ReturnType<typeof runLoop>>) {
  console.log(JSON.stringify({
    ok: r.ok,
    platform: r.platform,
    tenants: { migrated: r.tenants.filter(t => t.ok).length, failed: r.tenants.filter(t => !t.ok), skipped: r.skipped },
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
