// Setting a warehouse up from the Team page (src/core/setup.ts): settings files, products, opening stock.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accept, browser, fails, ownerSignedIn } from "./warehouse.ts";

const A3K = join(import.meta.dirname, "../../app/public/tenants/a3k");
const json = (f: string) => JSON.parse(readFileSync(join(A3K, f), "utf8"));
const FMT = { slot: "{face}-{col}-L{level}-B{bay}", floor: "{face}-FLOOR-P{n}", areaSpot: "{area}-P{n}", rackDigits: 2, colDigits: 2, spotDigits: 2, acceptUnpadded: true };
const LAYOUT = { codeFormat: FMT, shapes: { standard: { levels: [1, 2, 3, 4], bays: 2 } }, defaultShape: "standard", racks: [{ id: "1", sides: "AB", columns: 2 }], areas: [{ id: "RECEIVING", name: "Receiving dock" }], receivingArea: "RECEIVING" };
const CONFIG = { branding: { appTitle: "Bravo Warehouse", mark: "BW" }, layout: LAYOUT, clients: [{ id: "Sunfield", name: "Sunfield" }, { id: "Lotus", name: "Lotus" }] };

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
  const config = { ...CONFIG, layout: { ...LAYOUT, codeFormat: fmt } };
  await w.owner.call("setup.saveSettings", { config });
  // The owner may change the name or racks, never the codes
  assert.deepEqual((await w.owner.call("setup.saveSettings", { config: { ...config, branding: { appTitle: "Bravo North", mark: "BN" } } })).saved, ["config"]);
  await fails(w.owner.call("setup.saveSettings", { config: { ...config, layout: { ...LAYOUT, codeFormat: { ...fmt, slot: "{face}{col}{level}{bay}" } } } }), "forbidden");
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

test("a layout change never strands stock: the server refuses racks, columns or levels that hold stock or an open task", async () => {
  const w = await ownerSignedIn();
  await w.owner.call("setup.saveSettings", { config: CONFIG });
  await w.owner.call("setup.importProducts", { products: [{ id: "S1", client: "Sunfield", code: "1001", name: "Rice" }] });
  // Stock only goes where the warehouse has a location
  await fails(w.owner.call("setup.importStock", { lines: [{ location: "01A-09-L1-B1", productId: "S1", cases: 3 }] }), "bad-request");
  await w.owner.call("setup.importStock", { lines: [{ location: "01B-02-L4-B2", productId: "S1", cases: 3 }, { location: "RECEIVING-P01", productId: "S1", cases: 1 }] });
  const conflict = async (layout: unknown, what: RegExp) => assert.rejects(w.owner.call("setup.saveSettings", { config: { ...CONFIG, layout } }), (e: any) => e.code === "conflict" && what.test(e.message));
  await conflict({ ...LAYOUT, racks: [] }, /01B-02-L4-B2/);                                            // the rack
  await conflict({ ...LAYOUT, racks: [{ id: "1", sides: "A", columns: 2 }] }, /01B-02-L4-B2/);          // its side
  await conflict({ ...LAYOUT, racks: [{ id: "1", sides: "AB", columns: 1 }] }, /01B-02-L4-B2/);         // the column
  await conflict({ ...LAYOUT, shapes: { standard: { levels: [1, 2, 3], bays: 2 } } }, /no longer exist/); // the level
  await conflict({ ...LAYOUT, areas: [{ id: "DOCK", name: "Dock" }], receivingArea: "DOCK" }, /RECEIVING-P01/); // the floor area
  // Mistakes the app couldn't draw
  await conflict({ ...LAYOUT, racks: [{ id: "1", sides: "AB", columns: 2 }, { id: "01", sides: "C", columns: 1 }] }, /listed twice/);
  await conflict({ ...LAYOUT, racks: [{ id: "1", sides: "AB", columns: 2, columnShapes: { "2": "tall" } }] }, /unknown column type/);
  await conflict({ ...LAYOUT, receivingArea: "NOWHERE" }, /receiving/);
  // Adding is always fine, and so is a column type exception that keeps the stocked slot
  const grown = { ...LAYOUT, shapes: { ...LAYOUT.shapes, top: { levels: [3, 4], bays: 3 } }, racks: [{ id: "1", sides: "AB", columns: 3, columnShapes: { "2": "top" } }, { id: "2", sides: "A", columns: 4 }] };
  assert.equal((await w.owner.call("setup.saveSettings", { config: { ...CONFIG, layout: grown }, reason: "Rack 2 added" })).layoutChanged, true);
});

test("setup mode: ticks, starting the practice over, and going live for good", async () => {
  const w = await ownerSignedIn();
  const { startSetup } = await import("../src/core/setup.ts");
  await w.db.query("INSERT INTO settings (key, value, updated_by) VALUES ('setup', $1, 'test')", [JSON.stringify(startSetup("2026-11-01T00:00:00.000Z"))]);
  assert.equal((await w.owner.call("tenant.config")).setup, "setup");
  await fails(w.owner.call("setup.goLive", {}), "bad-request"); // no racks yet
  await w.owner.call("setup.saveSettings", { config: CONFIG });
  await fails(w.owner.call("setup.goLive", {}), "bad-request"); // no products yet
  await w.owner.call("setup.importProducts", { products: [{ id: "S1", client: "Sunfield", code: "1001", name: "Rice" }] });
  assert.equal((await w.owner.call("setup.tick", { step: "labels", done: true })).ticks.labels.by, "Maya");
  await fails(w.owner.call("setup.tick", { step: "anything", done: true }), "bad-request");
  // Practice: stock and an order, then start over
  await w.owner.call("setup.importStock", { lines: [{ location: "01A-01-L1-B1", productId: "S1", cases: 8 }] });
  await w.owner.call("sync.push", { clientId: "device-test-0001", clientSeq: 1, type: "order/save", at: "2026-11-02T12:00:00.000Z", changes: [{ key: "order:SO-1", base: 0, data: { id: "SO-1", status: "draft", client: "Sunfield", store: "Practice", lines: [] } }] }).catch(() => null);
  const r = await w.owner.call("setup.clearPractice", {});
  assert.equal(r.stockLocations, 1);
  const status = await w.owner.call("setup.status");
  assert.equal(status.stockLocations, 0);
  assert.equal(status.setup.mode, "setup");
  const rows = (await w.owner.call("sync.pull", { since: 0 })).rows;
  assert.ok(rows.some((x: any) => x.key.startsWith("movement:M-practice-") && /Practice data cleared/.test(x.data.reason)), "the stock history says what was cleared");
  assert.ok(rows.some((x: any) => x.key.startsWith("audit:") && /Cleared the practice data/.test(x.data.action)));
  // The go-live count's stock stays; then setup mode ends for good
  await w.owner.call("setup.importStock", { lines: [{ location: "01A-01-L1-B1", productId: "S1", cases: 5 }] });
  const live = await w.owner.call("setup.goLive", { clearActivity: true });
  assert.equal(live.live.mode, "live");
  assert.equal((await w.owner.call("setup.status")).stockLocations, 1);
  assert.equal((await w.owner.call("tenant.config")).setup, "live");
  await fails(w.owner.call("setup.goLive", {}), "conflict");
  await fails(w.owner.call("setup.clearPractice", {}), "conflict");
  // Live: changing the racks needs a reason, which goes in the security log
  const more = { ...LAYOUT, racks: [...LAYOUT.racks, { id: "2", sides: "A", columns: 1 }] };
  await fails(w.owner.call("setup.saveSettings", { config: { ...CONFIG, layout: more } }), "bad-request");
  await w.owner.call("setup.saveSettings", { config: { ...CONFIG, layout: more }, reason: "New rack 2 installed" });
  const log = await w.owner.call("security.list");
  assert.ok(log.entries.some((e: any) => e.action === "changed the racks and saved the warehouse settings" && e.detail?.reason === "New rack 2 installed"));
  // A warehouse made before setup mode existed counts as live
  const old = await ownerSignedIn();
  assert.equal((await old.owner.call("tenant.config")).setup, "live");
});

test("only owners clear practice data or go live", async () => {
  const w = await ownerSignedIn();
  const inv = await w.owner.call("people.invite", { name: "Leo", username: "leo", roleId: "coordinator" });
  const leo = browser(w.ctx);
  await accept(leo, inv.link);
  for (const m of ["setup.clearPractice", "setup.goLive", "setup.tick"]) await fails(leo.call(m, { step: "labels", done: true }), "forbidden");
});
