// The order reader (app/src/outbound/readText.ts) on a brand's sales order / packing slip, laid out like the real ones
// (docs/design-notes.md, "Reference documents") but made up: the demo warehouse's products, a made-up brand, store and numbers.
// The text is what pdfText gives: a PDF's columns joined by three spaces, one line per height on the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { readOrderText } = await import(path.join(ROOT, "app/src/outbound/readText.ts"));
const products = JSON.parse(fs.readFileSync(path.join(ROOT, "app/public/tenants/demo/products.json"), "utf8"));
const search = (q, _client, limit) => products.filter(p => q.toLowerCase().split(/\s+/).every(w => p.name.toLowerCase().includes(w))).slice(0, limit);
const catalog = { products, search };
const NOW = new Date("2026-11-03T12:00:00");

const header = [
  "PACKING SLIP",
  "Sunfield Foods   DATE   SALES ORDER #",
  "12 Example Road, #100",
  "11/2/2026   4821",
  "Springfield ZZ 00000 US",
  "BILL TO   SHIP TO   PO #   SHIP METHOD",
  "Corner Market   Corner Market",
  "1 Main St   1 Main St",
  "Riverton ZZ 00001 USA   Riverton ZZ 00001 USA",
  "#   DESCRIPTION   WT.   QTY",
];
const SLIP = [
  ...header,
  "1   Rice:Sunfield:10LBS*4:SF101",
  "Sunfield Jasmine Rice 10lbs*4   2255.00   55.00",
  "2   Rice:Sunfield:20lbs*2:SF102",            // lowercase size, and wording that isn't the product list's
  "Basmati 20 lbs*2   410.00   10.00",
  "3   Grain:Regular:SF111",                     // the item text's prefix differs from the product's: matched by the code
  "Semolina 4lbs*10   120.00   3.00",
  ...header,                                     // page 2 repeats the whole header
  "4   Pulses:Sunfield:2LBS*20:SF120",
  "Red Lentils 2lbs*20   1600.00   40.00",
  "TOTAL WT.   4,385.00",
].join("\n");

test("a two-page sales order reads every line by its code, with the cases from the QTY column", () => {
  const r = readOrderText(SLIP, catalog, [], undefined, NOW);
  assert.deepEqual(r.lines.map(l => [l.productId, l.cases, l.how]), [["SF101", 55, "code"], ["SF102", 10, "code"], ["SF111", 3, "code"], ["SF120", 40, "code"]]);
  assert.equal(r.client, "Sunfield");
  // The total weight isn't a product, and the repeated header's address lines aren't "unread"
  assert.deepEqual(r.unread, []);
});

test("a sales order's header: store from SHIP TO, the sales order number and date; an empty PO stays empty, no due date", () => {
  const r = readOrderText(SLIP, catalog, [], undefined, NOW);
  assert.equal(r.store, "Corner Market");
  assert.equal(r.salesOrder, "4821");
  assert.equal(r.date, "2026-11-02");
  assert.equal(r.ref, undefined);
  assert.equal(r.due, undefined);
  // A store already known is used as it's written in the WMS
  assert.equal(readOrderText(SLIP, catalog, ["CORNER MARKET"], undefined, NOW).store, "CORNER MARKET");
});

test("a filled-in PO and a due date are read from their columns", () => {
  const text = SLIP.replace("BILL TO   SHIP TO   PO #   SHIP METHOD", "BILL TO   SHIP TO   PO #   DUE DATE")
    .replace("Corner Market   Corner Market\n1 Main St", "Corner Market   Corner Market   PO-7731   11/9/2026\n1 Main St");
  const r = readOrderText(text, catalog, [], undefined, NOW);
  assert.equal(r.ref, "PO-7731");
  assert.equal(r.due, "2026-11-09");
});

test("the line number is never taken as the cases, and a fractional quantity isn't read as anything", () => {
  const r = readOrderText([...header, "1   Rice:Sunfield:10LBS*4:SF101", "Jasmine Rice", "2   Rice:Sunfield:20LBS*2:SF102", "Basmati Rice   410.00   2.50"].join("\n"), catalog, [], undefined, NOW);
  // Line 1 has no quantity (not 1, its line number); line 2's 2.50 isn't cases, and its weight isn't either
  assert.deepEqual(r.lines, []);
  assert.equal(r.unread.length, 2);
});

test("plain email lines still read as before", () => {
  const r = readOrderText("Hi, please send\nSF101 24 cases\n12 x SF120\nDeliver Friday\nPO 5512", catalog, [], undefined, NOW);
  assert.deepEqual(r.lines.map(l => [l.productId, l.cases]), [["SF101", 24], ["SF120", 12]]);
  assert.equal(r.ref, "5512");
  assert.equal(r.due, "2026-11-06");
});
