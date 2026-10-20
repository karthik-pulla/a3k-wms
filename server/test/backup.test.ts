// The nightly backup's plan (src/ops/backup.ts): one dump per warehouse with its own key, never a deleted one,
// the platform last, and the password never on the command line.
import test from "node:test";
import assert from "node:assert/strict";
import { backupPlan, dumpArgs } from "../src/ops/backup.ts";

test("every warehouse that isn't deleted is dumped on its own, encrypted with its own key", () => {
  const plan = backupPlan([
    { id: "a3k", db_name: "t_a3k", status: "active", kms_key_arn: "arn:key/a3k" },
    { id: "gone", db_name: "t_gone", status: "deleted", kms_key_arn: "arn:key/gone" },
    { id: "new", db_name: "t_new", status: "setup", kms_key_arn: null },
  ], "2026-10-20", "arn:key/platform");
  assert.deepEqual(plan, [
    { label: "a3k", database: "t_a3k", key: "tenants/a3k/backups/2026-10-20.dump", kmsKey: "arn:key/a3k" },
    { label: "new", database: "t_new", key: "tenants/new/backups/2026-10-20.dump", kmsKey: "arn:key/platform" },
    { label: "platform", database: "platform", key: "platform/backups/2026-10-20.dump", kmsKey: "arn:key/platform" },
  ]);
  assert.throws(() => backupPlan([], "20 Oct", "k"));
});

test("pg_dump gets the password through the environment, and checks the database's certificate", () => {
  const { args, env } = dumpArgs("db.internal", 5432, { username: "master", password: "s3cret!" }, "t_a3k", "/tmp/x.dump");
  assert.ok(!args.join(" ").includes("s3cret!"));
  assert.equal(env.PGPASSWORD, "s3cret!");
  assert.ok(args.some(a => a.includes("sslmode=verify-full") && a.includes("dbname=t_a3k")));
  assert.ok(args.includes("--format=custom"));
});
