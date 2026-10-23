// Setting a warehouse up from the Team page (src/core/setup.ts): settings files, products, opening stock.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accept, browser, fails, ownerSignedIn } from "./warehouse.ts";

const A3K = join(import.meta.dirname, "../../app/public/tenants/a3k");
const json = (f: string) => JSON.parse(readFileSync(join(A3K, f), "utf8"));
const CONFIG = { branding: { appTitle: "Bravo Warehouse", mark: "BW" }, layout: { racks: [] }, clients: [{ id: "Sunfield", name: "Sunfield" }, { id: "Lotus", name: "Lotus" }] };

test("A3K loads as a warehouse: its settings, logos and all 480 products from the team's files", async () => {
  const w = await ownerSignedIn();
  const config = json("config.json"), products = json("products.json"), logos = json("logos.json");
  assert.deepEqual((await w.owner.call("setup.saveSettings", { config, logos })).saved, ["config", "logos"]);
  const r = await w.owner.call("setup.importProducts", { products });
  assert.deepEqual(r, { added: 480, skipped: 0 });
  // Again: nothing new
  assert.deepEqual(await w.owner.call("setup.importProducts", { products }), { added: 0, skipped: 480 });
  const loaded = await w.owner.call("tenant.config");
  assert.equal(loaded.config.branding.appTitle, config.branding.appTitle);
  assert.equal(Object.keys(loaded.logos).length, Object.keys(logos).length);
  assert.equal((await w.owner.call("tenant.products")).length, 480);
  const status = await w.owner.call("setup.status");
  assert.equal(status.products, 480);
  assert.equal(status.config.by, "Maya");
  const log = await w.owner.call("security.list");
  assert.ok(log.entries.some((e: any) => e.action === "imported products"));
});

test("products from the template get stable ids and must belong to the warehouse's clients", async () => {
  const w = await ownerSignedIn();
  await fails(w.owner.call("setup.importProducts", { products: [{ client: "Sunfield", code: "1", name: "Rice" }] }), "bad-request"); // no settings yet
  await w.owner.call("setup.saveSettings", { config: CONFIG });
  const rows = [{ client: "Sunfield", code: "1108", name: "Janthikalu", item: "Snacks:1108:Janthikalu", units: "24", perPallet: 60 }, { client: "Sunfield", code: "1108", name: "Janthikalu (BOGO)", item: "Snacks:1108:Janthikalu (BOGO)" }];
  assert.deepEqual(await w.owner.call("setup.importProducts", { products: rows }), { added: 2, skipped: 0 });
  const list = await w.owner.call("tenant.products");
  assert.equal(list.length, 2);
  assert.ok(list.every((p: any) => /^p-[0-9a-f]{16}$/.test(p.id)));
  assert.equal(list.find((p: any) => p.name === "Janthikalu").units, 24);
  // The same rows again get the same ids: nothing is added twice
  assert.deepEqual(await w.owner.call("setup.importProducts", { products: rows }), { added: 0, skipped: 2 });
  await fails(w.owner.call("setup.importProducts", { products: [{ client: "Nobody", code: "1", name: "X" }] }), "bad-request");
  await fails(w.owner.call("setup.importProducts", { products: [{ client: "Sunfield", code: "1", name: "X", units: "lots" }] }), "bad-request");
});

test("the opening stock goes in through the sync: every device gets it, with the movement and change logs", async () => {
  const w = await ownerSignedIn();
  await w.owner.call("setup.saveSettings", { config: CONFIG });
  await w.owner.call("setup.importProducts", { products: [{ id: "S1", client: "Sunfield", code: "1001", name: "Rice" }, { id: "S2", client: "Sunfield", code: "1002", name: "Dal" }] });
  const r = await w.owner.call("setup.importStock", { lines: [
    { location: "01A-01-L1-B1", productId: "S1", cases: 40, lot: "L7", bestBefore: "2027-04-30", arrived: "2026-09-27" },
    { location: "01A-01-L1-B1", productId: "S2", cases: "5" },
    { location: "01A-02-L1-B1", productId: "S2", cases: 60 },
  ] });
  assert.deepEqual(r, { locations: 2, lines: 3, replaced: 0 });
  const inv = await w.owner.call("people.invite", { name: "Omar", username: "omar", roleId: "worker" });
  const omar = browser(w.ctx);
  await accept(omar, inv.link);
  const rows = (await omar.call("sync.pull", { since: 0 })).rows;
  const slot = rows.find((x: any) => x.key === "stock:01A-01-L1-B1").data;
  assert.deepEqual(slot, [{ productId: "S1", cases: 40, lot: "L7", bestBefore: "2027-04", arrived: "2026-09-27" }, { productId: "S2", cases: 5 }]);
  assert.equal(rows.filter((x: any) => x.key.startsWith("movement:")).length, 3);
  assert.match(rows.find((x: any) => x.key.startsWith("audit:")).data.action, /^Loaded the opening stock: 3 lines in 2 locations/);
  // Loading again over stock needs "replace"
  await assert.rejects(w.owner.call("setup.importStock", { lines: [{ location: "01A-02-L1-B1", productId: "S1", cases: 1 }] }), (e: any) => e.code === "conflict" && e.info.locations[0] === "01A-02-L1-B1");
  assert.equal((await w.owner.call("setup.importStock", { lines: [{ location: "01A-02-L1-B1", productId: "S1", cases: 1 }], replace: true })).replaced, 1);
  // Bad lines are refused before anything is written
  await fails(w.owner.call("setup.importStock", { lines: [{ location: "X", productId: "nope", cases: 1 }] }), "bad-request");
  await fails(w.owner.call("setup.importStock", { lines: [{ location: "X", productId: "S1", cases: 0 }] }), "bad-request");
  await fails(w.owner.call("setup.importStock", { lines: [{ location: "X", productId: "S1", cases: 1, bestBefore: "April" }] }), "bad-request");
});

test("only owners set the warehouse up, with their password again", async () => {
  const w = await ownerSignedIn();
  const inv = await w.owner.call("people.invite", { name: "Leo", username: "leo", roleId: "coordinator" });
  const leo = browser(w.ctx);
  await accept(leo, inv.link);
  for (const m of ["setup.status", "setup.saveSettings", "setup.importProducts", "setup.importStock"]) await fails(leo.call(m, { config: CONFIG }), "forbidden");
  await fails(w.owner.call("setup.saveSettings", { config: { nonsense: true } }), "bad-request");
});

test("the slot code format is the Lattice team's: owners can't change it, the team can until stock is saved", async () => {
  const w = await ownerSignedIn();
  const fmt = { slot: "{face}-{col}-L{level}-B{bay}", floor: "{face}-FLOOR-P{n}", areaSpot: "{area}-{n}", rackDigits: 2, colDigits: 2, spotDigits: 2, acceptUnpadded: true };
  const config = { ...CONFIG, layout: { racks: [], codeFormat: fmt } };
  await w.owner.call("setup.saveSettings", { config });
  // The owner may change the name or racks, never the codes
  assert.deepEqual((await w.owner.call("setup.saveSettings", { config: { ...config, branding: { appTitle: "Bravo North", mark: "BN" } } })).saved, ["config"]);
  await fails(w.owner.call("setup.saveSettings", { config: { ...config, layout: { racks: [], codeFormat: { ...fmt, slot: "{face}{col}{level}{bay}" } } } }), "forbidden");
  // The team (ops console → setCodeFormat): checked, then saved while there's no stock
  const { setCodeFormat, codeFormatProblems } = await import("../src/core/setup.ts");
  assert.ok(codeFormatProblems({ ...fmt, slot: "{face}-{col}" }).some(p => p.includes("{level}")));
  await assert.rejects(setCodeFormat(w.db, "Ops", { ...fmt, rackDigits: 9 }));
  const next = { ...fmt, slot: "{face}-{col}-{level}-{bay}" };
  await setCodeFormat(w.db, "Ops", next);
  assert.deepEqual((await w.owner.call("tenant.config")).config.layout.codeFormat, next);
  assert.equal((await w.owner.call("tenant.config")).config.branding.appTitle, "Bravo North", "the rest of the settings stay");
  // Once stock is saved under the codes, changing them is a data move, not a setting
  await w.owner.call("setup.importProducts", { products: [{ id: "S1", client: "Sunfield", code: "1001", name: "Rice" }] });
  await w.owner.call("setup.importStock", { lines: [{ location: "01A-01-1-1", productId: "S1", cases: 4 }] }).catch(() => null);
  await w.owner.call("sync.push", { clientId: "device-test-9999", clientSeq: 1, type: "stock/adjust", at: "2026-10-16T12:00:00.000Z", changes: [{ key: "stock:X-1", base: 0, data: [{ productId: "S1", cases: 1 }] }] });
  await assert.rejects(setCodeFormat(w.db, "Ops", fmt), /already has stock/);
});
