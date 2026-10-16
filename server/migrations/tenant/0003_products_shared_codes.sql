-- Two products of one client may share a code: a BOGO pack keeps the normal pack's code, placeholder codes such as
-- "XXXX" or no code at all are common on brands' lists. A product is its id (the full item text tells them apart),
-- so the code is no longer unique; it stays indexed for lookups. Loosening only: older code never relied on it.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_client_code_key;
CREATE INDEX IF NOT EXISTS products_client_code ON products (client, code);
