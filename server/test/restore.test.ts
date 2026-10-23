// Restoring one warehouse from its backup (src/ops/restore.ts): the command line, a scratch database that can never
// be the live one, the password never on the command line, and a swap that only runs on a suspended warehouse and
// keeps the old database.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSwap, createRestoreSql, oldDbName, parseRestoreArgs, restoreArgs, restoreCounts, restoreGrantsSql, restorePlan, swapSql } from "../src/ops/restore.ts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { migrationsDir } from "../src/migrate/main.ts";
import { freshDb } from "./pg.ts";

const today = "2026-10-20";

test("a warehouse id and a real backup date are needed; --swap only with --confirm", () => {
  assert.deepEqual(parseRestoreArgs(["--tenant", "a3k", "--date", "2026-10-19"], today), { tenant: "a3k", date: "2026-10-19", swap: false });
  assert.deepEqual(parseRestoreArgs(["--tenant", "a3k", "--date", "2026-10-19", "--swap", "--confirm"], today), { tenant: "a3k", date: "2026-10-19", swap: true });
  assert.throws(() => parseRestoreArgs(["--date", "2026-10-19"], today), /--tenant/);
  assert.throws(() => parseRestoreArgs(["--tenant", "a3k"], today), /--date/);
  assert.throws(() => parseRestoreArgs(["--tenant", "A3K!", "--date", "2026-10-19"], today), /tenant ID/);
  assert.throws(() => parseRestoreArgs(["--tenant", "platform", "--date", "2026-10-19"], today), /reserved/);
  for (const d of ["19 Oct", "2026-10-1", "2026-02-30", "2026-13-01"]) assert.throws(() => parseRestoreArgs(["--tenant", "a3k", "--date", d], today), /isn't a date/, d);
  assert.throws(() => parseRestoreArgs(["--tenant", "a3k", "--date", "2026-10-21"], today), /after today/);
  assert.throws(() => parseRestoreArgs(["--tenant", "a3k", "--date", "2026-10-19", "--swap"], today), /--confirm/);
  assert.throws(() => parseRestoreArgs(["--tenant", "a3k", "--date", "2026-10-19", "--confirm"], today), /only goes with --swap/);
  assert.throws(() => parseRestoreArgs(["--tenant", "a3k", "--date", "2026-10-19", "--force"], today));
});

test("the backup is the warehouse's own file, restored into a new database that is never the live one", () => {
  const p = restorePlan({ id: "bravo-foods", db_name: "t_bravo_foods", status: "active" }, "2026-10-19");
  assert.deepEqual(p, { tenant: "bravo-foods", key: "tenants/bravo-foods/backups/2026-10-19.dump", liveDb: "t_bravo_foods", restoreDb: "t_bravo_foods_restore_2026_10_19" });
  assert.throws(() => restorePlan({ id: "x", db_name: "t_x; DROP", status: "active" }, "2026-10-19"));
  assert.throws(() => restorePlan({ id: "a3k", db_name: "t_a3k", status: "active" }, "yesterday"));
  // Every statement before and during the restore names only the copy
  const before = [...createRestoreSql(p), ...restoreGrantsSql(p, "master")];
  assert.match(before[0]!, /^CREATE DATABASE "t_bravo_foods_restore_2026_10_19"$/);
  assert.ok(before.some(s => /REVOKE CONNECT, TEMPORARY ON DATABASE "t_bravo_foods_restore_2026_10_19" FROM PUBLIC/.test(s)));
  assert.ok(!before.some(s => /DATABASE "t_bravo_foods"(\s|$)/.test(s)), "the live database is never named");
  // The restored tables get the same read/write grants as a new warehouse's
  assert.ok(restoreGrantsSql(p, "master").some(s => /DEFAULT PRIVILEGES FOR ROLE "master" .* TO "t_bravo_foods"$/.test(s)));
});

test("pg_restore gets the password through the environment, checks the certificate and restores all or nothing", () => {
  const { args, env } = restoreArgs("db.internal", 5432, { username: "master", password: "s3cret!" }, "t_a3k_restore_2026_10_19", "/tmp/b.dump");
  assert.ok(!args.join(" ").includes("s3cret!"));
  assert.equal(env.PGPASSWORD, "s3cret!");
  for (const a of ["--no-owner", "--single-transaction", "--exit-on-error"]) assert.ok(args.includes(a), a);
  assert.ok(args.some(a => a.includes("sslmode=verify-full") && a.includes("dbname=t_a3k_restore_2026_10_19")));
  assert.equal(args.at(-1), "/tmp/b.dump");
});

test("the counts read a warehouse's own tables", async () => {
  const { pg } = await freshDb("tenant");
  await pg.query("INSERT INTO entities (key, kind, data, version, seq, created_seq, updated_by) VALUES ('stock:1', 'stock', '{}', 1, 2, 2, 't'), ('stock:2', 'stock', NULL, 2, 3, 2, 't')");
  const counts = await restoreCounts({ query: async (text: string) => ({ rows: (await pg.query(text)).rows as any[] }) });
  assert.deepEqual(counts.entities, { conv: { live: 1, removed: 0 }, stock: { live: 1, removed: 1 } });
  assert.equal(counts.products, 0);
  assert.deepEqual(counts.people, {});
  assert.equal(counts.lastChange, 1);
  assert.equal(counts.lastMigration, readdirSync(join(migrationsDir(), "tenant")).filter(f => f.endsWith(".sql")).sort().at(-1));
});

test("the swap runs only on a suspended warehouse with a restored copy, and keeps the old database", () => {
  const p = restorePlan({ id: "a3k", db_name: "t_a3k", status: "suspended" }, "2026-10-19");
  const old = oldDbName("t_a3k", new Date("2026-10-20T14:05:00Z"));
  assert.equal(old, "t_a3k_old_202610201405");
  const dbs = ["postgres", "platform", "t_a3k", "t_a3k_restore_2026_10_19"];
  assert.doesNotThrow(() => checkSwap("suspended", dbs, p, old));
  for (const status of ["active", "setup", "leaving", "deleted"]) assert.throws(() => checkSwap(status, dbs, p, old), /suspend/, status);
  assert.throws(() => checkSwap("suspended", ["t_a3k"], p, old), /restore that night's backup first/);
  assert.throws(() => checkSwap("suspended", [...dbs, old], p, old), /already exists/);

  const sql = swapSql(p, old);
  const all = Object.values(sql).flat().join("\n");
  assert.doesNotMatch(all, /DROP/i, "nothing is dropped");
  assert.deepEqual(sql.rename, ["BEGIN", `ALTER DATABASE "t_a3k" RENAME TO "t_a3k_old_202610201405"`, `ALTER DATABASE "t_a3k_restore_2026_10_19" RENAME TO "t_a3k"`, "COMMIT"]);
  assert.match(sql.close[0]!, /ALTER DATABASE "t_a3k" ALLOW_CONNECTIONS false/);
  assert.match(sql.close[1]!, /pg_terminate_backend/);
  assert.ok(sql.open.includes(`GRANT CONNECT ON DATABASE "t_a3k" TO "t_a3k"`));
  assert.ok(sql.undo.includes(`ALTER DATABASE "t_a3k" ALLOW_CONNECTIONS true`));
});
