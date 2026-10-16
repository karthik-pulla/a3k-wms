// Settings from the environment (set by the ECS task definition in infra/). Nothing secret is in here: the API signs in
// to RDS Proxy with IAM, and the migration task reads the master login from Secrets Manager.

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
/** The platform database and the role the API reads it as (granted in migrations/platform/0001_tenants.sql) */
export const PLATFORM_DB = "platform";
export const PLATFORM_USER = "wms_platform";

const num = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);

export const apiConfig = () => ({
  region: need("AWS_REGION"),
  port: num("PORT", 8080),
  /** RDS Proxy endpoint for the platform database */
  proxyHost: need("DB_PROXY_HOST"),
  proxyPort: num("DB_PROXY_PORT", 5432),
  platformDb: PLATFORM_DB,
  platformUser: PLATFORM_USER,
  perTenantMax: num("DB_PER_TENANT_MAX", 3),
  budget: num("DB_CONNECTION_BUDGET", 30),
});

export const migrateConfig = () => ({
  region: need("AWS_REGION"),
  /** The database instance itself: migrations don't go through the proxy (DDL and advisory locks would pin it) */
  directHost: need("DB_DIRECT_HOST"),
  directPort: num("DB_DIRECT_PORT", 5432),
  /** Secrets Manager: the instance's master login, and the password RDS Proxy uses for the platform role */
  masterSecretArn: need("DB_MASTER_SECRET_ARN"),
  platformSecretArn: need("DB_PLATFORM_SECRET_ARN"),
  platformDb: PLATFORM_DB,
  platformUser: PLATFORM_USER,
  concurrency: num("MIGRATE_CONCURRENCY", 4),
  /** e.g. "staging" or "prod": names the tenant secrets (wms/<stage>/db/<user>) */
  stage: need("WMS_STAGE"),
  proxyName: need("DB_PROXY_NAME"),
  proxyHost: need("DB_PROXY_HOST"),
});
