-- One tenant's own database. Run by the migration loop as the master role; the tenant's role gets read/write on
-- tables through default privileges set when the tenant is created (server/src/ops/createTenant.ts), never DDL.

-- The tenant config (key 'config', format: app/src/tenant/types.ts TenantConfig) and other settings
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

-- Every change to a setting, kept (shown in the tenant's Logs)
CREATE TABLE settings_history (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  value jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL
);

-- Products: what app/src/tenant/types.ts calls Product
CREATE TABLE products (
  id text PRIMARY KEY,
  client text NOT NULL,
  brand text NOT NULL DEFAULT '',
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  units integer,
  per_pallet integer,
  item text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (client, code)
);
