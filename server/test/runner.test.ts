// The migration loop, against fake databases that keep their own schema_migrations table and lock.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { LOCK_KEY, migrateDatabase, runLoop, type Conn, type MigrationFile, type Target } from "../src/migrate/runner.ts";
import { readMigrations } from "../src/migrate/files.ts";
import { migrationsDir } from "../src/migrate/main.ts";

/** One fake database: remembers applied files, runs SQL by recording it, fails on SQL containing "FAIL" */
class FakeDb {
  applied = new Map<string, string>();
  ran: string[] = [];
  locked = false;
  log: string[] = [];
  inTx = false; pending: [string, string][] = [];
  conn(): Conn {
    return {
      query: async (text: string, values?: unknown[]) => {
        this.log.push(text.split(/\s+/).slice(0, 2).join(" "));
        if (text.startsWith("SELECT pg_advisory_lock")) { assert.equal(values?.[0], LOCK_KEY); this.locked = true; return { rows: [] }; }
        if (text.startsWith("SELECT pg_advisory_unlock")) { this.locked = false; return { rows: [] }; }
        if (text.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return { rows: [] };
        if (text.startsWith("SELECT file, checksum")) return { rows: [...this.applied].map(([file, checksum]) => ({ file, checksum })) };
        if (text === "BEGIN") { this.inTx = true; return { rows: [] }; }
        if (text === "COMMIT") { for (const [f, c] of this.pending) this.applied.set(f, c); this.pending = []; this.inTx = false; return { rows: [] }; }
        if (text === "ROLLBACK") { this.pending = []; this.inTx = false; return { rows: [] }; }
        if (text.startsWith("INSERT INTO schema_migrations")) { const v = values as [string, string]; if (this.inTx) this.pending.push(v); else this.applied.set(v[0], v[1]); return { rows: [] }; }
        if (text.includes("FAIL")) throw new Error("syntax error near FAIL");
        assert.ok(this.locked, "SQL ran without the migration lock");
        this.ran.push(text);
        return { rows: [] };
      },
      end: async () => {},
    };
  }
}

const file = (n: number, sql = `-- step ${n}`, extra: Partial<MigrationFile> = {}): MigrationFile =>
  ({ name: `${String(n).padStart(4, "0")}_step.sql`, sql, checksum: `c${n}`, noTransaction: false, ...extra });
const target = (id: string, db: FakeDb): Target => ({ id, connect: async () => db.conn() });

test("a new database gets every file in order, each in its own transaction; a second run does nothing", async () => {
  const db = new FakeDb();
  assert.deepEqual(await migrateDatabase(db.conn(), [file(1), file(2)]), ["0001_step.sql", "0002_step.sql"]);
  assert.deepEqual(db.ran, ["-- step 1", "-- step 2"]);
  assert.equal(db.log.filter(l => l === "BEGIN").length, 2);
  assert.equal(db.locked, false, "lock released");
  assert.deepEqual(await migrateDatabase(db.conn(), [file(1), file(2)]), []);
});

test("a file changed after it ran stops the loop", async () => {
  const db = new FakeDb();
  await migrateDatabase(db.conn(), [file(1)]);
  await assert.rejects(migrateDatabase(db.conn(), [{ ...file(1), checksum: "edited" }]), /changed after it ran/);
  assert.equal(db.locked, false);
});

test("a database ahead of the code (an older release) is never migrated", async () => {
  const db = new FakeDb();
  await migrateDatabase(db.conn(), [file(1), file(2)]);
  await assert.rejects(migrateDatabase(db.conn(), [file(1)]), /isn't in this release/);
});

test("a failing file is rolled back and not recorded", async () => {
  const db = new FakeDb();
  await assert.rejects(migrateDatabase(db.conn(), [file(1), file(2, "FAIL here")]), (e: Error & { file?: string }) => e.file === "0002_step.sql");
  assert.deepEqual([...db.applied.keys()], ["0001_step.sql"]);
  assert.ok(db.log.includes("ROLLBACK"));
});

test("a no-transaction file (CREATE INDEX CONCURRENTLY) runs outside a transaction", async () => {
  const db = new FakeDb();
  await migrateDatabase(db.conn(), [file(1, "-- no-transaction\nCREATE INDEX CONCURRENTLY x", { noTransaction: true })]);
  assert.ok(!db.log.includes("BEGIN"));
  assert.deepEqual([...db.applied.keys()], ["0001_step.sql"]);
});

test("the loop migrates the platform first, then every tenant, a few at a time", async () => {
  const platform = new FakeDb();
  const dbs = Array.from({ length: 10 }, () => new FakeDb());
  let running = 0, peak = 0;
  const tenants: Target[] = dbs.map((db, i) => ({ id: `t${i}`, connect: async () => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    const c = db.conn();
    return { ...c, end: async () => { running--; } };
  } }));
  const seen: string[] = [];
  const r = await runLoop({ platform: target("platform", platform), tenants, platformFiles: [file(1)], tenantFiles: [file(1), file(2)], concurrency: 3, onTenant: t => { seen.push(t.id); } });
  assert.equal(r.ok, true);
  assert.equal(r.tenants.length, 10);
  assert.ok(dbs.every(d => d.applied.size === 2));
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.equal(seen.length, 10);
});

test("after one tenant fails, no new tenant is started; the rest are listed as skipped", async () => {
  const dbs = Array.from({ length: 6 }, () => new FakeDb());
  const tenants: Target[] = dbs.map((db, i) => ({ id: `t${i}`, connect: async () => {
    if (i === 1) return { query: async (t: string) => { if (t.startsWith("SELECT file")) return { rows: [] }; if (t.includes("step")) throw new Error("disk full"); return { rows: [] }; }, end: async () => {} };
    return db.conn();
  } }));
  const r = await runLoop({ platform: target("platform", new FakeDb()), tenants, platformFiles: [], tenantFiles: [file(1)], concurrency: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.tenants.map(t => [t.id, t.ok]), [["t0", true], ["t1", false]]);
  assert.equal(r.tenants[1].failedFile, "0001_step.sql");
  assert.deepEqual(r.skipped, ["t2", "t3", "t4", "t5"]);
});

test("if the platform database fails, no tenant is touched", async () => {
  const r = await runLoop({ platform: target("platform", new FakeDb()), tenants: [target("t0", new FakeDb())], platformFiles: [file(1, "FAIL")], tenantFiles: [file(1)] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.skipped, ["t0"]);
});

test("a tenant that can't be reached is a failure, not a crash", async () => {
  const r = await runLoop({ platform: target("platform", new FakeDb()), tenants: [{ id: "t0", connect: async () => { throw new Error("timeout"); } }], platformFiles: [], tenantFiles: [file(1)] });
  assert.equal(r.ok, false);
  assert.equal(r.tenants[0].error, "timeout");
});

test("the real migration files are named, numbered and readable", () => {
  for (const kind of ["platform", "tenant"]) {
    const files = readMigrations(join(migrationsDir(), kind));
    assert.ok(files.length > 0, kind);
    assert.ok(files.every(f => /^[0-9a-f]{64}$/.test(f.checksum)));
  }
});
