// The migration loop (docs/multi-tenant-design.md, "The migration loop"): platform database first, then every tenant
// database, a few at a time. Every database ends at the same version, or the loop stops and says where.
//
// Rules the files follow: numbered, never edited after they've run (a checksum catches it), and they only add
// (new tables, columns with defaults, indexes), so the old code keeps working while databases change.

/** A connection straight to one database (not through RDS Proxy: DDL and advisory locks would pin it) */
export interface Conn {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
}

export interface MigrationFile {
  /** e.g. "0001_settings_products.sql"; files run in name order */
  name: string;
  sql: string;
  /** sha256 of the file */
  checksum: string;
  /** Starts with "-- no-transaction" (CREATE INDEX CONCURRENTLY can't run in a transaction): runs alone, then is recorded */
  noTransaction: boolean;
}

export interface Target {
  /** "platform" or the tenant's ID */
  id: string;
  connect(): Promise<Conn>;
}

export interface TargetResult {
  id: string;
  ok: boolean;
  applied: string[];
  /** The file that failed, and why */
  failedFile?: string;
  error?: string;
}

export interface LoopResult {
  ok: boolean;
  platform: TargetResult;
  tenants: TargetResult[];
  /** Tenants not started because another one failed first */
  skipped: string[];
}

/** One key for "migrating this database"; advisory locks are per database, so the same key never blocks another tenant */
export const LOCK_KEY = 726_100_001;

export class MigrationError extends Error {
  readonly file?: string;
  constructor(message: string, file?: string) { super(message); this.name = "MigrationError"; this.file = file; }
}

export const BOOKKEEPING_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  file text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

/** Brings one database up to date. Returns the files it ran (empty if it was already current). */
export async function migrateDatabase(conn: Conn, files: MigrationFile[]): Promise<string[]> {
  const applied: string[] = [];
  // Waits if another loop is migrating this same database
  await conn.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await conn.query(BOOKKEEPING_SQL);
    const { rows } = await conn.query("SELECT file, checksum FROM schema_migrations");
    const done = new Map<string, string>(rows.map(r => [r.file, r.checksum]));
    const known = new Set(files.map(f => f.name));
    // This database is ahead of the code: an older release must never run against it
    for (const name of done.keys()) if (!known.has(name)) throw new MigrationError(`${name} has run on this database but isn't in this release (is this an older release?)`, name);
    for (const f of files) {
      const was = done.get(f.name);
      if (was !== undefined) {
        if (was !== f.checksum) throw new MigrationError(`${f.name} was changed after it ran here. Add a new file instead.`, f.name);
        continue;
      }
      try {
        if (f.noTransaction) {
          await conn.query(f.sql);
          await conn.query("INSERT INTO schema_migrations (file, checksum) VALUES ($1, $2)", [f.name, f.checksum]);
        } else {
          await conn.query("BEGIN");
          try {
            await conn.query(f.sql);
            await conn.query("INSERT INTO schema_migrations (file, checksum) VALUES ($1, $2)", [f.name, f.checksum]);
            await conn.query("COMMIT");
          } catch (e) {
            await conn.query("ROLLBACK").catch(() => {});
            throw e;
          }
        }
      } catch (e) {
        throw new MigrationError((e as Error).message, f.name);
      }
      applied.push(f.name);
    }
  } finally {
    await conn.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
  }
  return applied;
}

async function runTarget(t: Target, files: MigrationFile[]): Promise<TargetResult> {
  let conn: Conn | undefined;
  try {
    conn = await t.connect();
    return { id: t.id, ok: true, applied: await migrateDatabase(conn, files) };
  } catch (e) {
    return { id: t.id, ok: false, applied: [], failedFile: (e as MigrationError).file, error: (e as Error).message };
  } finally {
    await conn?.end().catch(() => {});
  }
}

export interface LoopOptions {
  platform: Target;
  tenants: Target[];
  platformFiles: MigrationFile[];
  tenantFiles: MigrationFile[];
  /** Tenant databases migrated at the same time (default 4), so the instance isn't overloaded */
  concurrency?: number;
  /** Called after each tenant, e.g. to record it in the platform database */
  onTenant?: (r: TargetResult) => Promise<void> | void;
}

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const platform = await runTarget(o.platform, o.platformFiles);
  if (!platform.ok) return { ok: false, platform, tenants: [], skipped: o.tenants.map(t => t.id) };

  const queue = [...o.tenants];
  const tenants: TargetResult[] = [];
  let failed = false;
  const worker = async () => {
    // After the first failure no new tenant is started; the ones in progress finish
    while (!failed) {
      const t = queue.shift();
      if (!t) return;
      const r = await runTarget(t, o.tenantFiles);
      tenants.push(r);
      if (!r.ok) failed = true;
      await o.onTenant?.(r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, o.tenants.length || 1)) }, worker));
  return { ok: !failed, platform, tenants, skipped: queue.map(t => t.id) };
}
