// Making pallets the warehouse's way (server/src/shared/pallets.ts) and what was announced against what arrived
// (server/src/shared/receiving.ts): full pallets first, one partial pallet with the rest, like the inbound report's
// new palletization (received ÷ per pallet, and the remainder).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { palletSizes, spreadOverPallets, splitIntoPallets, palletGroups, tiHi } = await import(path.join(ROOT, "server/src/shared/pallets.ts"));
const { casesByProduct, receivingDifferences } = await import(path.join(ROOT, "server/src/shared/receiving.ts"));

test("full pallets, then one partial pallet with the rest", () => {
  assert.deepEqual(palletSizes(130, 60), [60, 60, 10]);
  assert.deepEqual(palletSizes(120, 60), [60, 60]);
  assert.deepEqual(palletSizes(25, 60), [25]);
  assert.deepEqual(palletSizes(0, 60), []);
  assert.deepEqual(palletSizes(40, 0), [40]);
  assert.equal(tiHi(8, 7), 56);
  assert.equal(tiHi(8, 0), null);
});

test("a delivery notice's pallets: full ones first when that's how many pallets the size needs, else shared out", () => {
  assert.deepEqual(spreadOverPallets(130, 3, 60), [60, 60, 10]);
  assert.deepEqual(spreadOverPallets(130, 2, 60), [65, 65]); // packed differently from the product's size
  assert.deepEqual(spreadOverPallets(81, 2, null), [41, 40]);
  assert.deepEqual(spreadOverPallets(5, 1, 60), [5]);
});

const L = (key, productId, cases, pallet, extra = {}) => ({ key, productId, cases, pallet, lot: "L1", bestBefore: "2027-06", ...extra });

test("splitting puts a product's own pallets back together and makes them again; mixed pallets stay as they are", () => {
  const lines = [L("a", "S1", 70, 1), L("b", "S1", 60, 2, { damaged: 12 }), L("m1", "S2", 10, 3), L("m2", "S3", 5, 3), L("c", "S4", 33, 4)];
  assert.deepEqual(palletGroups(lines).map(g => [g.productId, g.cases, g.pallets, g.damaged]), [["S1", 130, 2, 12], ["S4", 33, 1, 0]]);
  const out = splitIntoPallets(lines, { "S1|L1|2027-06": 60 });
  assert.deepEqual(out.map(l => [l.productId, l.cases, l.pallet, l.damaged ?? 0]), [
    ["S1", 60, 1, 0], ["S1", 60, 2, 2], ["S1", 10, 3, 10], // damaged cases on the last pallets
    ["S2", 10, 4, 0], ["S3", 5, 4, 0],                    // the mixed pallet keeps both lines together
    ["S4", 33, 5, 0],                                      // no size given: as it was
  ]);
  assert.equal(new Set(out.map(l => l.key)).size, out.length);
  // Nothing is lost or made up
  assert.deepEqual(casesByProduct(out), casesByProduct(lines));
});

test("different lots of one product are split apart", () => {
  const out = splitIntoPallets([L("a", "S1", 70, 1), L("b", "S1", 50, 2, { lot: "L2" })], { "S1|L1|2027-06": 60, "S1|L2|2027-06": 60 });
  assert.deepEqual(out.map(l => [l.lot, l.cases, l.pallet]), [["L1", 60, 1], ["L1", 10, 2], ["L2", 50, 3]]);
});

test("announced against received: only the products that differ, a product that wasn't announced counts from 0", () => {
  const announced = [{ productId: "S1", cases: 130 }, { productId: "S2", cases: 10 }];
  assert.deepEqual(receivingDifferences(announced, [L("a", "S1", 130, 1), L("b", "S2", 10, 2, { damaged: 1 })]), []);
  assert.deepEqual(receivingDifferences(announced, [L("a", "S1", 128, 1, { damaged: 3 }), L("c", "S9", 4, 2)]), [
    { productId: "S1", announced: 130, received: 128, damaged: 3 },
    { productId: "S2", announced: 10, received: 0, damaged: 0 },
    { productId: "S9", announced: 0, received: 4, damaged: 0 },
  ]);
  // A delivery from before announced quantities were kept has nothing to compare
  assert.deepEqual(receivingDifferences(undefined, [L("a", "S1", 1, 1)]), []);
});
