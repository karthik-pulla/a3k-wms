-- Products can be edited (code, name, full description) by people with the "edit-products" switch.
-- Every edit is kept here with what it was before, who made it and why; the id never changes.
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_by text;

CREATE TABLE product_changes (
  id bigserial PRIMARY KEY,
  product_id text NOT NULL REFERENCES products (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL,
  reason text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL
);
CREATE INDEX product_changes_product ON product_changes (product_id, changed_at DESC);
