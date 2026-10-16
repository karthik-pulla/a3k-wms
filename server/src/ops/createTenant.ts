// Creates a tenant (docs/multi-tenant-design.md, section 8, step 1), as a one-off ECS task inside the VPC:
//   node dist/src/ops/createTenant.js --id bravo --name "Bravo Foods" --host bravo.example.com [--host wms.bravo.com]
// 1. a database login and a database of its own; nobody else may connect to it
// 2. its password in Secrets Manager, and that secret added to RDS Proxy (the API signs in to the proxy with IAM)
// 3. its own KMS key (files, nightly dumps, exports)
// 4. the platform database rows (tenant, addresses), then the tenant migrations
// It stops if anything with that name already exists, so it never half-redoes a tenant.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { CreateSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DescribeDBProxiesCommand, ModifyDBProxyCommand, RDSClient, type UserAuthConfig } from "@aws-sdk/client-rds";
import { CreateAliasCommand, CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { migrateConfig } from "../config.ts";
import { directConnector, getLogin, ident, literal } from "./aws.ts";
import { ROLE_LIMITS, migrationsDir } from "../migrate/main.ts";
import { readMigrations } from "../migrate/files.ts";
import { migrateDatabase } from "../migrate/runner.ts";
import { normalizeHost } from "../tenancy.ts";

/** Tenant IDs: lower-case letters, digits and dashes, starting with a letter (also the subdomain) */
export function checkTenantId(id: string): string {
  if (!/^[a-z][a-z0-9-]{1,29}$/.test(id) || id.endsWith("-") || id.includes("--")) throw new Error(`"${id}" isn't a tenant ID (2–30 lower-case letters, digits and single dashes, starting with a letter)`);
  if (["platform", "postgres", "rdsadmin", "template0", "template1", "admin", "ops", "www", "api"].includes(id)) throw new Error(`"${id}" is reserved`);
  return id;
}

/** The tenant's database and its login share one name: t_<id> */
export const tenantDbName = (id: string) => `t_${checkTenantId(id).replace(/-/g, "_")}`;

/** SQL, as the master login on the "postgres" database: the tenant's login and database, closed to everyone else */
export function databaseSql(db: string, password: string): string[] {
  return [
    `CREATE ROLE ${ident(db)} LOGIN PASSWORD ${literal(password)}`,
    ...ROLE_LIMITS(db),
    `CREATE DATABASE ${ident(db)}`,
    `REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(db)} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(db)}`,
  ];
}

/** SQL, as the master login on the tenant's database: its login may read and write tables the migrations make, never change them */
export function grantsSql(db: string, master: string): string[] {
  return [
    `REVOKE ALL ON SCHEMA public FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA public TO ${ident(db)}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(master)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(db)}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(master)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ident(db)}`,
  ];
}

/** A new warehouse's settings until its owner and the onboarding team fill them in (server/templates/starter-config.json) */
export function starterConfig(id: string, name: string) {
  const c = JSON.parse(readFileSync(join(dirname(migrationsDir()), "templates", "starter-config.json"), "utf8"));
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0]!.toUpperCase()).join("") || id.slice(0, 3).toUpperCase();
  return { ...c, tenant: { ...c.tenant, id, name }, branding: { appTitle: name, mark: initials } };
}

/** RDS Proxy's login list with this secret added (the API signs in with IAM; the proxy uses the secret) */
export function withProxySecret(auth: UserAuthConfig[], secretArn: string): UserAuthConfig[] {
  const keep = auth.map(a => ({ AuthScheme: a.AuthScheme, SecretArn: a.SecretArn, IAMAuth: a.IAMAuth, ClientPasswordAuthType: a.ClientPasswordAuthType }));
  return keep.some(a => a.SecretArn === secretArn) ? keep : [...keep, { AuthScheme: "SECRETS", SecretArn: secretArn, IAMAuth: "REQUIRED", ClientPasswordAuthType: "POSTGRES_SCRAM_SHA_256" }];
}

async function main() {
  const { values } = parseArgs({ options: { id: { type: "string" }, name: { type: "string" }, host: { type: "string", multiple: true } } });
  const id = checkTenantId(values.id ?? "");
  const name = (values.name ?? "").trim();
  const hosts = (values.host ?? []).map(h => { const n = normalizeHost(h); if (!n) throw new Error(`"${h}" isn't a host name`); return n; });
  if (!name || !hosts.length) throw new Error("Give --name and at least one --host");
  const cfg = migrateConfig();
  const db = tenantDbName(id);
  const master = await getLogin(cfg.region, cfg.masterSecretArn);
  const connect = directConnector(cfg.directHost, cfg.directPort, master);

  // Stop before changing anything if this tenant, its login, database or an address already exists
  const platform = await connect(cfg.platformDb);
  const admin = await connect("postgres");
  try {
    const clash = [
      ...(await platform.query("SELECT 'tenant ' || id AS what FROM tenants WHERE id = $1", [id])).rows,
      ...(await platform.query("SELECT 'address ' || host AS what FROM domains WHERE host = ANY($1)", [hosts])).rows,
      ...(await admin.query("SELECT 'login ' || rolname AS what FROM pg_roles WHERE rolname = $1", [db])).rows,
      ...(await admin.query("SELECT 'database ' || datname AS what FROM pg_database WHERE datname = $1", [db])).rows,
    ];
    if (clash.length) throw new Error(`Already exists: ${clash.map(r => r.what).join(", ")}`);

    // 1. Login and database
    const password = randomBytes(32).toString("base64url");
    for (const sql of databaseSql(db, password)) await admin.query(sql);
    const tenantConn = await connect(db);
    try {
      for (const sql of grantsSql(db, master.username)) await tenantConn.query(sql);
      // 4b. The tenant's tables (same files the migration loop runs everywhere), and its starting settings
      await migrateDatabase(tenantConn, readMigrations(join(migrationsDir(), "tenant")));
      await tenantConn.query("INSERT INTO settings (key, value, updated_by) VALUES ('config', $1, 'create-tenant')", [JSON.stringify(starterConfig(id, name))]);
    } finally {
      await tenantConn.end();
    }

    // 2. Secret for RDS Proxy, added to the proxy's login list
    const sm = new SecretsManagerClient({ region: cfg.region });
    const secret = await sm.send(new CreateSecretCommand({
      Name: `wms/${cfg.stage}/db/${db}`, Description: `RDS Proxy login for tenant ${id}`,
      SecretString: JSON.stringify({ username: db, password }), Tags: [{ Key: "wms:tenant", Value: id }],
      // The platform key (infra/): RDS Proxy's role may decrypt with it
      KmsKeyId: `alias/wms/${cfg.stage}/platform`,
    }));
    const rds = new RDSClient({ region: cfg.region });
    const proxy = (await rds.send(new DescribeDBProxiesCommand({ DBProxyName: cfg.proxyName }))).DBProxies?.[0];
    if (!proxy) throw new Error(`No RDS Proxy called ${cfg.proxyName}`);
    await rds.send(new ModifyDBProxyCommand({ DBProxyName: cfg.proxyName, Auth: withProxySecret(proxy.Auth ?? [], secret.ARN!) }));

    // 3. The tenant's own KMS key
    const kms = new KMSClient({ region: cfg.region });
    const key = await kms.send(new CreateKeyCommand({ Description: `WMS ${cfg.stage}: files, dumps and exports of tenant ${id}`, Tags: [{ TagKey: "wms:tenant", TagValue: id }] }));
    await kms.send(new CreateAliasCommand({ AliasName: `alias/wms/${cfg.stage}/tenant/${id}`, TargetKeyId: key.KeyMetadata!.KeyId! }));

    // 4. Platform rows: from here on the API serves the tenant at its addresses
    await platform.query("BEGIN");
    await platform.query(
      "INSERT INTO tenants (id, name, status, db_name, db_user, db_host, db_direct_host, kms_key_arn) VALUES ($1, $2, 'setup', $3, $3, $4, $5, $6)",
      [id, name, db, cfg.proxyHost, cfg.directHost, key.KeyMetadata!.Arn]);
    for (const h of hosts) await platform.query("INSERT INTO domains (host, tenant_id) VALUES ($1, $2)", [h, id]);
    await platform.query("INSERT INTO platform_audit (actor, action, tenant_id, detail) VALUES ('create-tenant', 'tenant created', $1, $2)", [id, JSON.stringify({ hosts })]);
    await platform.query("COMMIT");
    console.log(JSON.stringify({ ok: true, tenant: id, database: db, hosts, secret: secret.ARN, kmsKey: key.KeyMetadata!.Arn }, null, 2));
  } finally {
    await admin.end().catch(() => {});
    await platform.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
