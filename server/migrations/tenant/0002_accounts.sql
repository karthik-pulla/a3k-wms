-- Sign-in for one warehouse: its people, roles, sessions, invites, account requests, security log and support access.
-- Passwords are stored only as PBKDF2 hashes, tokens only as SHA-256, authenticator secrets only sealed with the
-- server's app key (server/src/core/crypto.ts).

-- Built-in roles (changeable switches, fixed names) and the warehouse's own named roles
CREATE TABLE roles (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL UNIQUE,
  base text NOT NULL CHECK (base IN ('owner', 'coordinator', 'worker')),
  built_in boolean NOT NULL DEFAULT false,
  -- Only switches that differ from the base role's defaults (server/src/shared/permissions.ts)
  permissions jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'system'
);
INSERT INTO roles (id, name, base, built_in) VALUES ('owner', 'Owner', 'owner', true), ('coordinator', 'Coordinator', 'coordinator', true), ('worker', 'Worker', 'worker', true);

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id text NOT NULL REFERENCES roles (id),
  -- Clients whose stock this person may see; NULL = all
  clients text[],
  groups text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  password_hash text,
  totp_secret text,
  -- The last authenticator time step used: no code works twice
  totp_last_step bigint,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  last_sign_in_at timestamptz
);

-- Password checked, waiting for the authenticator code (5 minutes)
CREATE TABLE sign_in_tickets (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people (id),
  keep boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE support_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id text NOT NULL,
  operator_name text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  ticket text,
  -- false: support can look but not change anything
  can_change boolean NOT NULL DEFAULT false,
  -- Opened without an owner's approval (outages only); every owner is told at once
  emergency boolean NOT NULL DEFAULT false,
  minutes integer NOT NULL CHECK (minutes BETWEEN 15 AND 1440),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'active', 'ended', 'refused')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  ended_by text
);

CREATE TABLE sessions (
  -- SHA-256 of the token; the token itself is only in the person's cookie
  id text PRIMARY KEY,
  person_id uuid REFERENCES people (id),
  -- A support session belongs to a grant instead of a person
  support_grant_id uuid REFERENCES support_grants (id),
  keep boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- When the password was last given again (owner actions need it within 10 minutes)
  confirmed_at timestamptz,
  ip text,
  user_agent text,
  revoked_at timestamptz,
  CHECK (person_id IS NOT NULL OR support_grant_id IS NOT NULL)
);
CREATE INDEX sessions_person ON sessions (person_id);

-- Links that set a password and an authenticator: a new person's invite, or an access reset
CREATE TABLE invites (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people (id),
  kind text NOT NULL CHECK (kind IN ('invite', 'reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  -- After step 1 (password): the new password and authenticator secret wait here until a code proves the app works
  pending_password text,
  pending_totp text,
  used_at timestamptz
);
CREATE INDEX invites_person ON invites (person_id);

-- "Ask for an account" from the sign-in screen
CREATE TABLE account_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  username text NOT NULL,
  email text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz
);

-- One-time links from the WMS team's console into this warehouse (for an active support grant)
CREATE TABLE handoffs (
  id text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES support_grants (id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Sign-ins, account and role changes, support access. Never edited.
CREATE TABLE security_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}',
  ip text
);
