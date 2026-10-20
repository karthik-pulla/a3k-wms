// The setup template (app/src/setup/importSheets.ts) and the .xlsx reader (app/src/utils/xlsxRead.ts): what the app
// writes reads back the same, and a filled-in sheet becomes products and opening stock, or a list of rows to fix.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const mod = f => import(path.join(ROOT, "app/src", f));
const a3k = JSON.parse(fs.readFileSync(path.join(ROOT, "app/public/tenants/a3k/config.json"), "utf8"));
const products = JSON.parse(fs.readFileSync(path.join(ROOT, "app/public/tenants/a3k/products.json"), "utf8"));

async function roundTrip(sheets) {
  const { buildXlsx } = await mod("utils/xlsx.ts");
  const { readXlsx } = await mod("utils/xlsxRead.ts");
  return readXlsx(await buildXlsx(sheets).arrayBuffer());
}

test("an .xlsx the app writes reads back with the same sheets, text and numbers", async () => {
  const back = await roundTrip([
    { name: "Products", header: ["Client", "Code", "Name"], rows: [["Deccan", "1073", "Surti Kolam & <Rice>"], ["Matco", 42, ""]] },
    { name: "Second", header: ["A"], rows: [["ünïcödé ✓"]] },
  ]);
  assert.deepEqual(back.map(s => s.name), ["Products", "Second"]);
  assert.deepEqual(back[0].rows, [["Client", "Code", "Name"], ["Deccan", "1073", "Surti Kolam & <Rice>"], ["Matco", "42", ""]]);
  assert.deepEqual(back[1].rows[1], ["ünïcödé ✓"]);
});

test("the template reads back as its example product and stock, on A3K's own location codes", async () => {
  const { templateSheets, readProducts, readStock } = await mod("setup/importSheets.ts");
  const { buildLayout } = await mod("tenant/layout.ts");
  const L = buildLayout(a3k.layout);
  const clients = a3k.clients.map(c => c.id);
  const sheets = await roundTrip(templateSheets({ clients, exampleSlot: "06B-08-L3-B1", exampleFloor: "06B-FLOOR-P01" }));
  const p = readProducts(sheets, clients);
  assert.deepEqual(p.problems, []);
  assert.equal(p.products.length, 1);
  assert.equal(p.products[0].client, clients[0]);
  // The example product as if it were in the warehouse, so the stock rows can find it
  const known = [{ id: "X1", client: clients[0], code: "1073", name: p.products[0].name, item: p.products[0].item }];
  const s = readStock(sheets, { products: known, normalize: L.normalize, today: "2026-10-20" });
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.lines, [
    { location: "06B-08-L3-B1", productId: "X1", cases: 40, lot: "L2209", bestBefore: "2027-04", arrived: "2026-09-27" },
    { location: "06B-FLOOR-P01", productId: "X1", cases: 12, arrived: "2026-10-20" },
  ]);
});

test("rows with problems are listed by row in plain words, and nothing from them is loaded", async () => {
  const { readProducts, readStock } = await mod("setup/importSheets.ts");
  const { buildLayout } = await mod("tenant/layout.ts");
  const L = buildLayout(a3k.layout);
  const sheets = await roundTrip([
    { name: "Products", header: ["Client", "Code", "Name", "Units per case", "Full description"], rows: [["Nobody", "1", "X", "", ""], ["Deccan", "2", "", "lots", ""], ["deccan", "3", "Dal", "", "Dal:3"], ["Deccan", "4", "Dal again", "", "dal:3"]] },
    { name: "Opening stock", header: ["Location", "Product", "Client", "Cases", "Best before", "Arrived"], rows: [
      ["6B-08-L3-B1", "1108", "", "5", "", ""], // old unpadded code is fine; 1108 is two products (BOGO)
      ["99Z-01-L1-B1", "Rice:Deccan:10LBS*4:1073:SurtiKolam", "", "5", "", ""],
      ["06B-08-L3-B1", "no such thing", "", "five", "April", "yesterday"],
      ["06B-08-L3-B2", "1073", "Deccan", "7", "46000", "46300"], // Excel day numbers for dates
    ] },
  ]);
  const p = readProducts(sheets, ["Deccan", "Matco"]);
  assert.deepEqual(p.problems.map(x => [x.row, x.text.slice(0, 22)]), [[2, `"Nobody" isn't one of `], [3, "No name"], [3, "Units per case must be"], [5, "Same full description "]]);
  assert.equal(p.products[2].client, "Deccan", "client names match whatever the case");
  const s = readStock(sheets, { products, normalize: L.normalize, today: "2026-10-20" });
  const texts = s.problems.map(x => `${x.row}: ${x.text}`);
  assert.ok(texts.some(t => t.startsWith('2: "1108" is the code of 2 products')), texts.join("\n"));
  assert.ok(texts.some(t => t.startsWith('3: "99Z-01-L1-B1" isn\'t a slot')));
  assert.ok(texts.some(t => t.startsWith('4: No product "no such thing"')));
  assert.ok(texts.some(t => t.startsWith("4: Cases must be")));
  assert.ok(texts.some(t => t.startsWith("4: Best before must be")));
  assert.ok(texts.some(t => t.startsWith("4: Arrived must be")));
  const ok = s.lines.find(l => l.location === "06B-08-L3-B2");
  assert.deepEqual({ cases: ok.cases, bestBefore: ok.bestBefore, arrived: ok.arrived }, { cases: 7, bestBefore: "2025-12", arrived: "2026-10-05" });
});
