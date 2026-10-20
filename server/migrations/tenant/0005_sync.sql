-- Stock, orders, tasks, counts and messages on the server (server/src/shared/sync.ts, server/src/core/sync.ts).
-- Each piece of the warehouse's data is one row with a version; every saved change gets the next number (seq),
-- so devices catch up with "everything after N". audience = who may receive the row (people ids); NULL = everyone
-- in the warehouse. Removed pieces stay as rows with data NULL so devices learn they're gone.
CREATE TABLE entities (
  key text PRIMARY KEY,
  kind text NOT NULL,
  data jsonb,
  version integer NOT NULL,
  seq bigint NOT NULL,
  created_seq bigint NOT NULL,
  audience text[],
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entities_seq ON entities (seq);
CREATE INDEX entities_kind ON entities (kind);

-- The number of the last saved change. Saving takes this row's lock, so numbers are given out in commit order.
CREATE TABLE sync_state (
  id integer PRIMARY KEY CHECK (id = 1),
  seq bigint NOT NULL
);
INSERT INTO sync_state (id, seq) VALUES (1, 1);

-- Every saved change: who, what kind, which pieces. A device's (client_id, client_seq) is saved once only,
-- so sending again after a lost answer changes nothing.
CREATE TABLE sync_log (
  seq bigint PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  device_at timestamptz,
  actor_id text,
  actor_name text NOT NULL,
  action text NOT NULL,
  keys text[] NOT NULL,
  client_id text,
  client_seq integer,
  UNIQUE (client_id, client_seq)
);

-- Every warehouse has the team channel from the start (change 1; devices catch up from 0)
INSERT INTO entities (key, kind, data, version, seq, created_seq, audience, updated_by)
VALUES ('conv:team', 'conv', '{"id": "team", "kind": "channel", "title": "warehouse-team", "members": [], "createdAt": "2026-01-01T00:00:00.000Z"}', 1, 1, 1, NULL, 'WMS');
INSERT INTO sync_log (seq, actor_name, action, keys) VALUES (1, 'WMS', 'warehouse created', ARRAY['conv:team']);

-- A key per person for the copy of the warehouse's data kept on their devices (encrypted with it, so it can't be
-- read without signing in). A new one on "Sign out everywhere", a reset or turning the account off.
ALTER TABLE people ADD COLUMN cache_key text;
