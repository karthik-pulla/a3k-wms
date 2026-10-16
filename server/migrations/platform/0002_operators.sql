-- The WMS team's own accounts for the ops console (never accounts inside any warehouse), the onboarding checklist,
-- and server errors per warehouse. The API (wms_platform) may now write these, and change a tenant's status.

CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  password_hash text,
  totp_secret text,
  totp_last_step bigint,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  last_sign_in_at timestamptz
);

CREATE TABLE operator_tickets (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES operators (id),
  keep boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE operator_sessions (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES operators (id),
  keep boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  ip text,
  user_agent text,
  revoked_at timestamptz
);

CREATE TABLE operator_invites (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES operators (id),
  kind text NOT NULL CHECK (kind IN ('invite', 'reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  pending_password text,
  pending_totp text,
  used_at timestamptz
);

-- A new warehouse's setup checklist (docs/multi-tenant-design.md, section 8)
CREATE TABLE onboarding (
  tenant_id text NOT NULL REFERENCES tenants (id),
  step text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by text NOT NULL,
  PRIMARY KEY (tenant_id, step)
);

-- Server errors, per warehouse and route, counted per hour (details stay in CloudWatch)
CREATE TABLE error_events (
  -- '' for errors outside any warehouse (the console, the sign-in of an unknown address)
  tenant_id text NOT NULL DEFAULT '',
  route text NOT NULL,
  message text NOT NULL,
  hour timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, route, message, hour)
);

GRANT SELECT, INSERT, UPDATE ON operators, operator_tickets, operator_sessions, operator_invites TO wms_platform;
GRANT SELECT, INSERT, DELETE ON onboarding TO wms_platform;
GRANT SELECT, INSERT, UPDATE ON error_events TO wms_platform;
GRANT SELECT, INSERT ON platform_audit TO wms_platform;
GRANT USAGE ON SEQUENCE platform_audit_id_seq TO wms_platform;
GRANT SELECT ON tenant_migrations TO wms_platform;
GRANT UPDATE (status) ON tenants TO wms_platform;
