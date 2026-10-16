// Editing a product's code, name and full description through the warehouse API: who may, brand limits,
// checks, the kept history, and two people editing at once.
import test from "node:test";
import assert from "node:assert/strict";
import { addProducts } from "../src/core/products.ts";
import { itemWithCode, productChanges, productEditProblems } from "../src/shared/products.ts";
import { accept, browser, fails, ownerSignedIn } from "./warehouse.ts";

async function withProducts() {
  const w = await ownerSignedIn();
  await addProducts(w.db, [
    { id: "S1", client: "Sunfield", brand: "Sunfield", code: "1108", name: "Janthikalu", size: "170g", units: 24, perPallet: 60, item: "Snacks:170gms*24:1108:Janthikalu" },
    { id: "L1", client: "Lotus", brand: "Blue Lotus", code: "2001", name: "Basmati", item: "Rice:Lotus:10LBS*4:2001:Basmati" },
  ]);
  return w;
}
const edit = (over: Record<string, unknown> = {}) => ({ id: "S1", code: "1108B", name: "Janthikalu (BOGO)", item: "Snacks:170gms*24:1108B:Janthikalu (BOGO)", reason: "Brand renamed the BOGO pack", ...over });

test("an owner edits a product; the id, client and pallet size stay and the change is kept", async () => {
  const w = await withProducts();
  const p = await w.owner.call("products.update", edit({ name: "  Janthikalu   (BOGO) " }));
  assert.deepEqual([p.id, p.client, p.code, p.name, p.perPallet, p.units], ["S1", "Sunfield", "1108B", "Janthikalu (BOGO)", 60, 24]);
  const list = await w.owner.call("tenant.products");
  assert.equal(list.find((x: any) => x.id === "S1").item, "Snacks:170gms*24:1108B:Janthikalu (BOGO)");
  const { rows } = await w.db.query("SELECT changed_by, reason, before, after FROM product_changes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].changed_by, "Maya");
  assert.equal(rows[0].reason, "Brand renamed the BOGO pack");
  assert.deepEqual(rows[0].before, { code: "1108", name: "Janthikalu", item: "Snacks:170gms*24:1108:Janthikalu" });
  // Saving the same again records nothing new
  await w.owner.call("products.update", edit());
  assert.equal((await w.db.query("SELECT count(*)::int AS n FROM product_changes")).rows[0].n, 1);
});

test("coordinators need the Edit products switch, and only see their own brands", async () => {
  const w = await withProducts();
  const r = await w.owner.call("people.invite", { name: "Leo", username: "leo", roleId: "coordinator", clients: ["Lotus"] });
  const leo = browser(w.ctx);
  const { me } = await accept(leo, r.link);
  assert.equal(me.can["edit-products"], false);
  await fails(leo.call("products.update", edit({ id: "L1", code: "2002" })), "forbidden");
  await w.owner.call("roles.save", { id: "coordinator", permissions: { "edit-products": true } });
  assert.equal((await leo.call("products.update", edit({ id: "L1", code: "2002", name: "Basmati", item: "Rice:Lotus:10LBS*4:2002:Basmati" }))).code, "2002");
  // Another client's product looks like it isn't there
  await fails(leo.call("products.update", edit()), "not-found");
});

test("workers can't edit products, and bad edits are refused", async () => {
  const w = await withProducts();
  const r = await w.owner.call("people.invite", { name: "Omar", username: "omar", roleId: "worker" });
  const omar = browser(w.ctx);
  await accept(omar, r.link);
  await fails(omar.call("products.update", edit()), "forbidden");
  await fails(w.owner.call("products.update", edit({ reason: "no" })), "bad-request");
  await fails(w.owner.call("products.update", edit({ code: "" })), "bad-request");
  await fails(w.owner.call("products.update", edit({ name: "x".repeat(121) })), "bad-request");
  await fails(w.owner.call("products.update", edit({ item: "bell\u0007" })), "bad-request");
  // Line breaks and tabs pasted in become single spaces
  assert.equal((await w.owner.call("products.update", edit({ item: "two\n\tlines" }))).item, "two lines");
  await fails(w.owner.call("products.update", edit({ id: "nope" })), "not-found");
});

test("an edit based on an old copy is refused, so nobody overwrites someone else's change unseen", async () => {
  const w = await withProducts();
  const seen = { code: "1108", name: "Janthikalu", item: "Snacks:170gms*24:1108:Janthikalu" };
  await w.owner.call("products.update", edit({ expect: seen }));
  await fails(w.owner.call("products.update", edit({ code: "1108C", expect: seen })), "conflict");
});

test("the shared rules: problems, the change in words, and the code inside the full description", () => {
  assert.deepEqual(productEditProblems({ code: "1108", name: "A", item: "B" }, "typo fixed"), []);
  assert.equal(productEditProblems({ code: " ", name: "A", item: "B" }, "x").length, 2);
  assert.equal(productChanges({ code: "1", name: "A", item: "I" }, { code: "2", name: "A", item: "I" }), "code 1 → 2");
  assert.equal(productChanges({ code: "1", name: "A", item: "I" }, { code: "1", name: "A", item: "I" }), "");
  assert.equal(itemWithCode("Anaganaga:170gms*24:1108:Janthikalu", "1108", "1108B"), "Anaganaga:170gms*24:1108B:Janthikalu");
  assert.equal(itemWithCode("Misc. Items", "", "M1"), "Misc. Items");
  assert.equal(itemWithCode("Rice:Falak:10Lbs*4:M006.1:Jasmine", "M007", "M008"), "Rice:Falak:10Lbs*4:M006.1:Jasmine");
});
