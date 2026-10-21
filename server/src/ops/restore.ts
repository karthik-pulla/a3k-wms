// Restoring one warehouse from a nightly backup (docs/multi-tenant-design.md, section 9), as a one-off ECS task:
//   node dist/src/ops/restore.js --tenant a3k --date 2026-10-19
// downloads tenants/<id>/backups/<date>.dump from the files bucket, creates an empty database
// t_<id>_restore_<yyyy_mm_dd> (owned by the master login, closed to everyone else), pg_restores into it and prints
// row counts to compare. It never touches the live t_<id>.
//   node dist/src/ops/restore.js --tenant a3k --date 2026-10-19 --swap --confirm
// is the separate step that puts the restored database in place: only while the warehouse is suspended (console),
// and the old database is kept, renamed t_<id>_old_<yyyymmddhhmm> with connections off, never dropped.
// Runs inside the VPC on AWS only, straight to the instance as the master login (like the backup).
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PLATFORM_DB } from "../config.ts";
import type { Conn } from "../migrate/runner.ts";
import { checkTenantId, grantsSql } from "./createTenant.ts";
import { directConnector, getLogin, ident, literal, type Login } from "./aws.ts";

export interface RestoreArgs { tenant: string; date: string; swap: boolean }

/** The command line: a warehouse id and a backup date (a real day, not after today); --swap only with --confirm */
export function parseRestoreArgs(argv: string[], today: string): RestoreArgs {
  const { values } = parseArgs({ args: argv, strict: true, options: { tenant: { type: "string" }, date: { type: "string" }, swap: { type: "boolean" }, confirm: { type: "boolean" } } });
  if (!values.tenant || !values.date) throw new Error("Give --tenant <id> and --date <YYYY-MM-DD> (the night of the backup)");
  const tenant = checkTenantId(values.tenant);
  const date = values.date;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error(`"${date}" isn't a date (YYYY-MM-DD)`);
  if (date > today) throw new Error(`${date} is after today (${today}): there is no backup yet`);
  if (values.confirm && !values.swap) throw new Error("--confirm only goes with --swap");
  if (values.swap && !values.confirm) throw new Error("--swap replaces the live database: add --confirm once the restored copy has been checked and the warehouse is suspended");
  return { tenant, date, swap: !!values.swap };
}

export interface TenantRow { id: string; db_name: string; status: string }
export interface RestorePlan { tenant: string; key: string; liveDb: string; restoreDb: string }

/** Where the backup is and what the scratch database is called; it can never be the live one */
export function restorePlan(t: TenantRow, date: string): RestorePlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date ${date}`);
  if (!/^t_[a-z0-9_]+$/.test(t.db_name)) throw new Error(`Unexpected database name ${t.db_name}`);
  const restoreDb = `${t.db_name}_restore_${date.replace(/-/g, "_")}`;
  if (restoreDb === t.db_name || restoreDb.length > 63) throw new Error(`Can't name the restore database for ${t.db_name}`);
  return { tenant: t.id, key: `tenants/${t.id}/backups/${date}.dump`, liveDb: t.db_name, restoreDb };
}

/** SQL, as the master login on "postgres": the empty scratch database, closed to everyone but the master login */
export function createRestoreSql(p: RestorePlan): string[] {
  return [
    `CREATE DATABASE ${ident(p.restoreDb)}`,
    `REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(p.restoreDb)} FROM PUBLIC`,
  ];
}

/**
 * SQL, as the master login inside the scratch database before pg_restore: the backup has no privileges in it
 * (pg_dump --no-privileges), so the same default privileges as a new warehouse give its login read/write on
 * every restored table, ready in case it's swapped in.
 */
export const restoreGrantsSql = (p: RestorePlan, master: string) => grantsSql(p.liveDb, master);

/** pg_restore's arguments: all or nothing, objects owned by the master login, TLS checked. The password goes in the environment. */
export function restoreArgs(host: string, port: number, login: Login, database: string, file: string) {
  return {
    args: ["--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", `--dbname=host=${host} port=${port} dbname=${database} user=${login.username} sslmode=verify-full sslrootcert=${process.env.NODE_EXTRA_CA_CERTS ?? "system"}`, file],
    env: { ...process.env, PGPASSWORD: login.password, PGAPPNAME: "wms-restore" },
  };
}

/** What gets counted in the restored copy, to compare with the warehouse (removed pieces are rows with data NULL) */
export const COUNT_QUERIES = {
  entities: "SELECT kind, count(*) FILTER (WHERE data IS NOT NULL)::int AS live, count(*) FILTER (WHERE data IS NULL)::int AS removed FROM entities GROUP BY kind ORDER BY kind",
  products: "SELECT count(*)::int AS n FROM products",
  people: "SELECT status, count(*)::int AS n FROM people GROUP BY status ORDER BY status",
  lastChange: "SELECT seq::int AS seq FROM sync_state WHERE id = 1",
  lastMigration: "SELECT max(file) AS file FROM schema_migrations",
} as const;

export async function restoreCounts(conn: Pick<Conn, "query">) {
  const q = async (sql: string) => (await conn.query(sql)).rows as any[];
  const entities: Record<string, { live: number; removed: number }> = {};
  for (const r of await q(COUNT_QUERIES.entities)) entities[r.kind] = { live: r.live, removed: r.removed };
  const people: Record<string, number> = {};
  for (const r of await q(COUNT_QUERIES.people)) people[r.status] = r.n;
  return {
    entities, products: (await q(COUNT_QUERIES.products))[0]?.n ?? 0, people,
    lastChange: (await q(COUNT_QUERIES.lastChange))[0]?.seq ?? null, lastMigration: (await q(COUNT_QUERIES.lastMigration))[0]?.file ?? null,
  };
}

/** The live database's name once it's been swapped out: kept, never dropped */
export function oldDbName(liveDb: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/\D/g, "");
  return `${liveDb}_old_${stamp}`;
}

/** Refuses the swap unless the warehouse is suspended, the restored copy exists and the old name is free */
export function checkSwap(status: string, databases: string[], p: RestorePlan, oldDb: string): void {
  if (status !== "suspended") throw new Error(`${p.tenant} is "${status}": suspend it in the console before swapping (nobody may be working in it)`);
  if (!databases.includes(p.restoreDb)) throw new Error(`There is no ${p.restoreDb}: restore that night's backup first (without --swap) and check it`);
  if (!databases.includes(p.liveDb)) throw new Error(`There is no live database ${p.liveDb}`);
  if (databases.includes(oldDb)) throw new Error(`${oldDb} already exists`);
}

/**
 * SQL, as the master login on "postgres". close: no new connections to the live database, and the open ones (RDS
 * Proxy's, a stray look at the copy) ended, since a database in use can't be renamed. rename: both renames in one
 * transaction, so there is always a t_<id>. open: the warehouse's login may connect again. undo: if renaming failed.
 */
export function swapSql(p: RestorePlan, oldDb: string) {
  const live = ident(p.liveDb), copy = ident(p.restoreDb);
  return {
    close: [
      `ALTER DATABASE ${live} ALLOW_CONNECTIONS false`,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (${literal(p.liveDb)}, ${literal(p.restoreDb)}) AND pid <> pg_backend_pid()`,
    ],
    rename: ["BEGIN", `ALTER DATABASE ${live} RENAME TO ${ident(oldDb)}`, `ALTER DATABASE ${copy} RENAME TO ${live}`, "COMMIT"],
    open: [
      `REVOKE CONNECT, TEMPORARY ON DATABASE ${live} FROM PUBLIC`,
      `GRANT CONNECT ON DATABASE ${live} TO ${ident(p.liveDb)}`,
    ],
    undo: ["ROLLBACK", `ALTER DATABASE ${live} ALLOW_CONNECTIONS true`],
  };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "inherit", "pipe"] });
    let err = "";
    p.stderr.on("data", d => { err += String(d); });
    p.on("error", reject);
    p.on("close", code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(0, 500)}`))));
  });
}

async function main() {
  const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
  const today = new Date().toISOString().slice(0, 10);
  const args = parseRestoreArgs(process.argv.slice(2), today);
  const region = need("AWS_REGION"), host = need("DB_DIRECT_HOST"), port = Number(process.env.DB_DIRECT_PORT ?? 5432);
  const master = await getLogin(region, need("DB_MASTER_SECRET_ARN"));
  const connect = directConnector(host, port, master);

  const platform = await connect(PLATFORM_DB);
  const admin = await connect("postgres");
  try {
    const row = (await platform.query("SELECT id, db_name, status FROM tenants WHERE id = $1", [args.tenant])).rows[0] as TenantRow | undefined;
    if (!row) throw new Error(`No warehouse ${args.tenant}`);
    const plan = restorePlan(row, args.date);
    const databases = (await admin.query("SELECT datname FROM pg_database")).rows.map((r: any) => r.datname as string);
    const audit = (action: string, detail: object) =>
      platform.query("INSERT INTO platform_audit (actor, action, tenant_id, detail) VALUES ('restore', $1, $2, $3)", [action, plan.tenant, JSON.stringify(detail)]);

    if (args.swap) {
      const oldDb = oldDbName(plan.liveDb, new Date());
      checkSwap(row.status, databases, plan, oldDb);
      const sql = swapSql(plan, oldDb);
      for (const s of sql.close) await admin.query(s);
      try {
        for (const s of sql.rename) await admin.query(s);
      } catch (e) {
        for (const s of sql.undo) await admin.query(s).catch(() => {});
        throw e;
      }
      for (const s of sql.open) await admin.query(s);
      await audit("backup swapped in", { date: args.date, database: plan.liveDb, kept: oldDb });
      console.log(JSON.stringify({ ok: true, swapped: plan.tenant, live: plan.liveDb, restoredFrom: plan.key, oldDatabaseKept: oldDb,
        next: "Run the migration loop (the backup may predate newer migrations), check the warehouse, then set it back to Live in the console" }, null, 2));
      return;
    }

    if (databases.includes(plan.restoreDb)) throw new Error(`${plan.restoreDb} already exists: look at it, or drop it (DROP DATABASE) to restore again`);
    const dir = await mkdtemp(join(tmpdir(), "wms-restore-"));
    const file = join(dir, "backup.dump");
    let created = false;
    try {
      const s3 = new S3Client({ region });
      const obj = await s3.send(new GetObjectCommand({ Bucket: need("FILES_BUCKET"), Key: plan.key })).catch((e: any) => {
        throw new Error(e?.name === "NoSuchKey" ? `No backup at ${plan.key} (backups are kept 35 days)` : `Can't download ${plan.key}: ${e?.message ?? e}`);
      });
      await pipeline(obj.Body as Readable, createWriteStream(file));
      const bytes = (await stat(file)).size;

      for (const s of createRestoreSql(plan)) await admin.query(s);
      created = true;
      const copy = await connect(plan.restoreDb);
      try { for (const s of restoreGrantsSql(plan, master.username)) await copy.query(s); } finally { await copy.end(); }
      const started = Date.now();
      const { args: a, env } = restoreArgs(host, port, master, plan.restoreDb, file);
      await run("pg_restore", a, env);

      const check = await connect(plan.restoreDb);
      let counts;
      try { counts = await restoreCounts(check); } finally { await check.end(); }
      await audit("backup restored to a copy", { date: args.date, database: plan.restoreDb });
      console.log(JSON.stringify({ ok: true, restored: plan.tenant, from: plan.key, bytes, seconds: Math.round((Date.now() - started) / 1000), database: plan.restoreDb, counts,
        next: `Check it; to put it in place, suspend ${plan.tenant} in the console and run again with --swap --confirm. To throw it away: DROP DATABASE ${plan.restoreDb}` }, null, 2));
    } catch (e) {
      // Only the copy this run made is dropped; the live database was never part of it
      if (created) await admin.query(`DROP DATABASE IF EXISTS ${ident(plan.restoreDb)}`).catch(() => {});
      throw e;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    await admin.end().catch(() => {});
    await platform.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
