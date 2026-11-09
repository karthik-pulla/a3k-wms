-- The fuller intake on the public page's "Book a visit" (server/src/core/site.ts): what the warehouse is like and how
-- it works today, so the visit is planned before anyone drives out; and which warehouse was made from the request.
ALTER TABLE visit_requests ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE visit_requests ADD COLUMN tenant_id text;
