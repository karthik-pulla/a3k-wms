// Every product on a warehouse's list reaches its database, including ones that share a code with another
// (A3K: BOGO packs, "XXXX" placeholders, items with no code).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, pgliteSql } from "./pg.ts";
import { addProducts, type ProductRow } from "../src/core/products.ts";
import { readMigrations } from "../src/migrate/files.ts";
import { migrateDatabase } from "../src/migrate/runner.ts";
import { migrationsDir } from "../src/migrate/main.ts";

const tenantsDir = join(import.meta.dirname, "../../app/public/tenants");
const lists = readdirSync(tenantsDir).map(id => {
  try { return { id, products: JSON.parse(readFileSync(join(tenantsDir, id, "products.json"), "utf8")) as ProductRow[] }; } catch { return null; }
}).filter(x => x !== null);

test("there are product lists to check", () => {
  assert.ok(lists.some(l => l.id === "a3k") && lists.some(l => l.id === "demo"), lists.map(l => l.id).join(", "));
});

for (const { id, products } of lists) {
  test(`${id}: every product is stored, codes shared or not`, async () => {
    const { db } = await freshDb("tenant");
    assert.equal(await addProducts(db, products), products.length);
    const { rows } = await db.query("SELECT id, client, code, units, per_pallet, item FROM products ORDER BY id");
    assert.equal(rows.length, products.length);
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const p of products) {
      const r = byId.get(p.id);
      assert.ok(r, `missing ${p.id}`);
      assert.deepEqual([r.client, r.code, r.units, r.per_pallet, r.item], [p.client, p.code, p.units ?? null, p.perPallet ?? null, p.item ?? null], p.id);
    }
    // Adding the same list again changes nothing
    assert.equal(await addProducts(db, products), 0);
  });
}

test("a3k really has products sharing a code (so the test above means something)", () => {
  const a3k = lists.find(l => l.id === "a3k")!.products;
  const keys = a3k.map(p => `${p.client}\u0000${p.code}`);
  assert.ok(new Set(keys).size < keys.length);
});

test("a database made before 0003 takes products with a shared code after migrating", async () => {
  const pg = new PGlite();
  const sql = pgliteSql(pg);
  const files = readMigrations(join(migrationsDir(), "tenant"));
  await migrateDatabase(sql, files.filter(f => f.name < "0003"));
  const p = (id: string, item: string): ProductRow => ({ id, client: "c1", code: "1108", name: item, item });
  await addProducts(sql, [p("a", "Snack 1108")]);
  await assert.rejects(addProducts(sql, [p("b", "Snack 1108 (BOGO)")]), /unique|duplicate/i);
  await migrateDatabase(sql, files);
  assert.equal(await addProducts(sql, [p("b", "Snack 1108 (BOGO)")]), 1);
  assert.equal((await sql.query("SELECT count(*)::int AS n FROM products WHERE client = 'c1' AND code = '1108'")).rows[0].n, 2);
});
