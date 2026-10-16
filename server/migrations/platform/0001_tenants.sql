-- The platform database: who the tenants are and where their databases live. No warehouse data here.
-- The API reads it as wms_platform (SELECT only); tenant creation and the migration loop write it as the master role.

CREATE TABLE tenants (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,29}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'leaving', 'suspended', 'deleted')),
  db_name text NOT NULL UNIQUE,
  db_user text NOT NULL UNIQUE,
  -- The RDS Proxy endpoint the API uses for this tenant (a second proxy, or a silo instance, is just another value)
  db_host text NOT NULL,
  db_port integer NOT NULL DEFAULT 5432,
  -- The instance itself, for the migration loop only
  db_direct_host text NOT NULL,
  -- The tenant's own KMS key (files, nightly dumps, exports)
  kms_key_arn text,
  -- The last tenant migration file applied
  schema_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Addresses that open a tenant: its subdomain, and any custom domain
CREATE TABLE domains (
  host text PRIMARY KEY CHECK (host = lower(host)),
  tenant_id text NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domains_tenant ON domains (tenant_id);

-- What the migration loop did to each tenant database
CREATE TABLE tenant_migrations (
  tenant_id text NOT NULL REFERENCES tenants (id),
  run_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  applied text[] NOT NULL DEFAULT '{}',
  failed_file text,
  error text,
  PRIMARY KEY (tenant_id, run_at)
);

-- Plan defaults are in code; these are per-tenant overrides
CREATE TABLE feature_flags (
  tenant_id text NOT NULL REFERENCES tenants (id),
  flag text NOT NULL,
  enabled boolean NOT NULL,
  PRIMARY KEY (tenant_id, flag)
);

-- The platform's own log: tenant created, suspended, deleted, support access, refused cross-tenant requests
CREATE TABLE platform_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  tenant_id text,
  detail jsonb NOT NULL DEFAULT '{}'
);

GRANT SELECT ON tenants, domains, feature_flags TO wms_platform;
