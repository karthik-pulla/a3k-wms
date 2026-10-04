// The count page's Excel export must keep the stock workbook's layout: same tab names, the
// Location/Item/No. of Cases columns, side A in A-F, side B in H-M, side C in O-T.
// Runs the export code straight out of tools/warehouse-count/template.html.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const ROOT = path.join(__dirname, "..");
const tpl = fs.readFileSync(path.join(ROOT, "tools/warehouse-count/template.html"), "utf8");
const code = tpl.split("/*XLSX-START*/")[1].split("/*XLSX-END*/")[0];
const { buildWorkbook } = new Function(code + "\nreturn { buildWorkbook };")();
const D = JSON.parse(fs.readFileSync(path.join(ROOT, "data/generated/count.json"), "utf8"));

const FACES = D.faces.map(f => ({ id: f.id, rack: f.id.startsWith("D") ? "D" + f.id.slice(1, -1) : f.id.slice(0, -1), side: f.id.slice(-1), cols: f.cols.map(([c, slots]) => ({ c, slots })) }));
const P = new Map(D.products.map(p => [p.k, p]));
const AREA_LABELS = [["LINE-2-3", "Between line 2 & 3"], ["LANE-7", "Lane 7"], ["DOOR-2-3", "DOOR 2N3"], ["LOAD-AREA", "LOAD_AREA_01"], ["RECV-FLOOR", "Recv Floor"], ...[1, 2, 3, 4, 5].map(n => ["NEARCOOLER-0" + n, "NEARCOOLER-0" + n])];
const k = i => D.products[i].k;

async function exportWith(entries) {
  const cells = new Map(entries.map(([code, lines]) => [code, { lines: lines.map(([i, q]) => ({ k: k(i), q })) }]));
  const wb = buildWorkbook(ExcelJS, { faces: FACES, cells, products: P, areaLabels: AREA_LABELS });
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  return back;
}
const findRow = (ws, col, value) => { let hit = null; ws.eachRow((row, n) => { if (row.getCell(col).value === value && !hit) hit = n; }); return hit; };

test("tabs keep the stock workbook names, one per rack", async () => {
  const wb = await exportWith([]);
  const names = wb.worksheets.map(w => w.name);
  for (const n of ["RACK", "TOTALS", "Anaganaga", "NearCooler", "DOOR6", "DOOR2N3", "Front", "CSFloor", "Rack00", "RACK01", "RACK06", "RACK17", "RACK20"]) assert.ok(names.includes(n), `missing tab ${n}`);
});

test("rack tabs: header row and slot order match RACK06 in the stock workbook", async () => {
  const ws = (await exportWith([])).getWorksheet("RACK06");
  assert.deepStrictEqual(ws.getRow(1).values.slice(1, 7), ["Location", "Item", "No. of Cases", "Best Before Date", "Batch No", "Container"]);
  assert.deepStrictEqual([2, 3, 4, 5, 6].map(r => ws.getRow(r).getCell(1).value), ["6A-01-L1-B1", "6A-01-L2-B1", "6A-01-L3-B1", "6A-01-L4-B1", "6A-01-L1-B2"]);
  assert.strictEqual(ws.getRow(2).getCell(8).value, "6B-01-L1-B1", "side B sits in column H");
  assert.strictEqual(ws.getRow(10).getCell(1).value, null, "blank row after each rack column");
});

test("a counted slot, a mixed pallet and side C land in the right cells", async () => {
  const wb = await exportWith([["6A-01-L1-B1", [[0, 55]]], ["6A-02-L1-B1", [[1, 30], [2, 12]]], ["0C-03-L2-B1", [[3, 33]]]]);
  const r6 = wb.getWorksheet("RACK06");
  const r = findRow(r6, 1, "6A-01-L1-B1");
  assert.strictEqual(r6.getRow(r).getCell(2).value, k(0)); assert.strictEqual(r6.getRow(r).getCell(3).value, 55);
  const m = findRow(r6, 1, "6A-02-L1-B1");
  assert.strictEqual(r6.getRow(m + 1).getCell(1).value, "6A-02-L1-B1", "mixed pallet repeats its location");
  const r0 = wb.getWorksheet("Rack00");
  assert.strictEqual(r0.getRow(1).getCell(15).value, "Location", "side C header in column O");
  const c = findRow(r0, 15, "0C-03-L2-B1");
  assert.strictEqual(r0.getRow(c).getCell(17).value, 33);
});

test("removed slot 3A-12-L4-B4 never appears", async () => {
  const ws = (await exportWith([])).getWorksheet("RACK03");
  assert.strictEqual(findRow(ws, 1, "3A-12-L4-B4"), null);
});
