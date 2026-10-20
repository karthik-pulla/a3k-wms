-- "Book a visit" requests from the product's public page (server/src/core/site.ts). Warehouses never sign themselves
-- up: the WMS team visits, then creates the warehouse in the ops console.
CREATE TABLE visit_requests (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  company text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  when_text text NOT NULL DEFAULT '',
  ip text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'booked', 'closed')),
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz,
  updated_by text
);
CREATE INDEX visit_requests_created ON visit_requests (created_at DESC);
GRANT SELECT, INSERT, UPDATE ON visit_requests TO wms_platform;
GRANT USAGE ON SEQUENCE visit_requests_id_seq TO wms_platform;
