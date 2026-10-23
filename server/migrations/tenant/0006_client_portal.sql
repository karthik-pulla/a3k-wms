-- The client portal (<warehouse address>/portal): people from a client (a brand whose stock the warehouse keeps) sign
-- in to place orders and announce deliveries. Their accounts, sign-in tickets, sessions and links are kept apart from
-- the warehouse's own people: a client login never opens anything in the warehouse app, and a warehouse login never
-- opens the portal (server/src/core/portal-api.ts). Same sign-in rules as everyone: password + authenticator code.

CREATE TABLE client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- The one client (tenant config `clients`) whose products this login sees and orders
  client text NOT NULL CHECK (length(client) BETWEEN 1 AND 80),
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

CREATE TABLE client_tickets (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES client_accounts (id),
  keep boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE client_sessions (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES client_accounts (id),
  keep boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  ip text,
  user_agent text,
  revoked_at timestamptz
);
CREATE INDEX client_sessions_person ON client_sessions (person_id);

CREATE TABLE client_invites (
  id text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES client_accounts (id),
  kind text NOT NULL CHECK (kind IN ('invite', 'reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  pending_password text,
  pending_totp text,
  used_at timestamptz
);
CREATE INDEX client_invites_person ON client_invites (person_id);

-- What came in through the portal: one row per order or delivery notice. The order or delivery itself is a piece of
-- the warehouse's data (entities, key in entity_key); the portal shows a client only what its own logins sent.
-- request_id (made by the browser) saves a double click or a resend once.
CREATE TABLE portal_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES client_accounts (id),
  client text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('order', 'delivery')),
  entity_key text NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 8 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_id)
);
CREATE INDEX portal_submissions_client ON portal_submissions (client, created_at DESC);
