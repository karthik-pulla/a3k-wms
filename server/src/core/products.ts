// A warehouse's product list into its database (format: app/src/tenant/types.ts Product). One statement for the
// whole list: one insert per product means a round trip each (and, in the preview, a browser-storage save each).
import type { Sql } from "./db.ts";

export interface ProductRow {
  id: string; client: string; brand?: string; code: string; name: string;
  cat?: string; size?: string; units?: number | null; perPallet?: number | null; item?: string | null;
}

/** Adds the products not there yet (by id); returns how many were added */
export async function addProducts(db: Sql, products: readonly ProductRow[]): Promise<number> {
  if (!products.length) return 0;
  const rows = products.map(p => ({ id: p.id, client: p.client, brand: p.brand ?? "", code: p.code, name: p.name,
    category: p.cat ?? "", size: p.size ?? "", units: p.units ?? null, per_pallet: p.perPallet ?? null, item: p.item ?? null }));
  const { rows: added } = await db.query(`INSERT INTO products (id, client, brand, code, name, category, size, units, per_pallet, item)
    SELECT id, client, brand, code, name, category, size, units, per_pallet, item
    FROM jsonb_to_recordset($1::jsonb) AS x(id text, client text, brand text, code text, name text, category text, size text, units integer, per_pallet integer, item text)
    ON CONFLICT (id) DO NOTHING
    RETURNING id`, [JSON.stringify(rows)]);
  return added.length;
}
