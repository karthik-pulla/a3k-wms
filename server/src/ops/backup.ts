// The nightly backup (one-off ECS task, started every night by a schedule in infra/lib/data-stack.ts): every
// warehouse's database dumped on its own with pg_dump and stored in the files bucket under
// tenants/<id>/backups/<date>.dump, encrypted with that warehouse's own key; the platform database likewise under
// platform/backups/. Tagged so the bucket deletes them after 35 days. A warehouse's NAS (A3K's) can copy its own
// folder (docs/aws-setup.md). Restore: pg_restore into a new database (docs/multi-tenant-design.md, section 9).
// Runs inside the VPC on AWS only, straight to the instance as the master login (like the migration loop).
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PLATFORM_DB } from "../config.ts";
import { directConnector, getLogin, type Login } from "./aws.ts";

export interface BackupTarget { label: string; database: string; key: string; kmsKey: string }

/** What tonight's backup writes: every warehouse that isn't deleted, then the platform */
export function backupPlan(tenants: { id: string; db_name: string; status: string; kms_key_arn: string | null }[], date: string, platformKey: string): BackupTarget[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date ${date}`);
  const out: BackupTarget[] = [];
  for (const t of tenants) {
    if (t.status === "deleted") continue;
    // A warehouse made before its own key existed falls back to the platform key, and says so in the log
    out.push({ label: t.id, database: t.db_name, key: `tenants/${t.id}/backups/${date}.dump`, kmsKey: t.kms_key_arn ?? platformKey });
  }
  out.push({ label: "platform", database: PLATFORM_DB, key: `platform/backups/${date}.dump`, kmsKey: platformKey });
  return out;
}

/** pg_dump's arguments: one database, PostgreSQL's own compressed format, TLS required. The password goes in the environment, never the arguments. */
export function dumpArgs(host: string, port: number, login: Login, database: string, file: string) {
  return {
    args: ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", `--file=${file}`, `--dbname=host=${host} port=${port} dbname=${database} user=${login.username} sslmode=verify-full sslrootcert=${process.env.NODE_EXTRA_CA_CERTS ?? "system"}`],
    env: { ...process.env, PGPASSWORD: login.password, PGAPPNAME: "wms-backup" },
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
  const region = need("AWS_REGION"), host = need("DB_DIRECT_HOST"), port = Number(process.env.DB_DIRECT_PORT ?? 5432);
  const bucket = need("FILES_BUCKET"), platformKey = need("PLATFORM_KEY_ARN");
  const master = await getLogin(region, need("DB_MASTER_SECRET_ARN"));
  const platform = await directConnector(host, port, master)(PLATFORM_DB);
  const { rows } = await platform.query("SELECT id, db_name, status, kms_key_arn FROM tenants ORDER BY id");
  await platform.end();
  const date = new Date().toISOString().slice(0, 10);
  const plan = backupPlan(rows as any, date, platformKey);
  const s3 = new S3Client({ region });
  const dir = await mkdtemp(join(tmpdir(), "wms-backup-"));
  const failed: string[] = [];
  try {
    for (const t of plan) {
      const file = join(dir, `${t.label}.dump`);
      const started = Date.now();
      try {
        const { args, env } = dumpArgs(host, port, master, t.database, file);
        await run("pg_dump", args, env);
        const size = (await stat(file)).size;
        await s3.send(new PutObjectCommand({
          Bucket: bucket, Key: t.key, Body: createReadStream(file), ContentLength: size, ContentType: "application/octet-stream",
          ServerSideEncryption: "aws:kms", SSEKMSKeyId: t.kmsKey, Tagging: "wms-kind=backup",
        }));
        console.log(JSON.stringify({ ok: true, backup: t.label, key: t.key, bytes: size, seconds: Math.round((Date.now() - started) / 1000), ownKey: t.kmsKey !== platformKey || t.label === "platform" }));
      } catch (e) {
        failed.push(t.label);
        console.error(JSON.stringify({ ok: false, backup: t.label, error: e instanceof Error ? e.message : String(e) }));
      } finally { await rm(file, { force: true }); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  // A failed run stops with an error: the alarm on failed backups emails the team (infra/lib/data-stack.ts)
  if (failed.length) { console.error(`Backups failed: ${failed.join(", ")}`); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
