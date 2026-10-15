// Checks that a warehouse's slots and location codes come from its config (app/src/tenant/layout.ts):
// A3K's config must give exactly the owner's 3,662 slots and read codes as before, and a different warehouse
// with its own code format must work without any code change.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const load = () => import(path.join(ROOT, "app/src/tenant/layout.ts"));
const a3k = JSON.parse(fs.readFileSync(path.join(ROOT, "app/public/tenants/a3k/config.json"), "utf8"));

test("A3K: the owner's layout, 3,662 slots on 44 rack sides", async () => {
  const { buildLayout } = await load();
  const L = buildLayout(a3k.layout);
  assert.equal(L.slots.length, 3662);
  assert.equal(L.faces.length, 44);
  assert.equal(new Set(L.slots.map(s => s.code)).size, 3662);
  assert.deepEqual(L.levels, [4, 3, 2, 1]);
  // Column 12 on 13-column racks: levels 3-4 only, three bays
  assert.ok(L.slotMeta("12A-12-L3-B3"));
  assert.equal(L.slotMeta("12A-12-L1-B1"), undefined);
  // No 8B, 11B or 20B; junctions are levels 3-4, bays 1-3
  for (const face of ["08B", "11B", "20B"]) assert.ok(!L.isFace(face), face);
  assert.ok(L.slotMeta("1518A-01-L4-B3"));
  assert.equal(L.slotMeta("1518A-01-L1-B1"), undefined);
  assert.equal(L.rackName("D6"), "Door 6");
  assert.equal(L.rackName("1619"), "Junction 16/19");
  assert.equal(L.rackName("06"), "Rack 06");
});

test("A3K: reading typed codes, padded or not", async () => {
  const { buildLayout } = await load();
  const L = buildLayout(a3k.layout);
  const cases = {
    "06B-08-L3-B1": "06B-08-L3-B1", "6B-08-L3-B1": "06B-08-L3-B1", "6b-8-l3-b1": "06B-08-L3-B1",
    "d6b-6-L4-B2": "D6B-06-L4-B2", "D6A-07-L1-B1": null, "1619b-1-l4-b3": "1619B-01-L4-B3", "0C-10-L4-B2": "00C-10-L4-B2",
    "8B-01-L1-B1": null, "3A-12-L3-B3": "03A-12-L3-B3", "6b-floor-p3": "06B-FLOOR-P03", "1518A-FLOOR-P1": "1518A-FLOOR-P01",
    "99A-FLOOR-P01": null, "nearcooler-05": "NEARCOOLER-05", "NEARCOOLER-06": null, "LANE-7-P02": "LANE-7-P02",
    "RECV-FLOOR-P1": "RECV-FLOOR-P01", "junk": null,
  };
  for (const [typed, saved] of Object.entries(cases)) assert.equal(L.normalize(typed), saved, typed);
  assert.deepEqual(L.find("Move 6B-08-L3-B1 to D6A-01-L1-B1, then 99Z-01-L1-B1.").map(f => f.code), ["06B-08-L3-B1", "D6A-01-L1-B1"]);
  assert.equal(L.groupOf("06B-FLOOR-P02"), "06B");
  assert.equal(L.groupOf("LANE-7-P02"), "LANE-7");
  assert.deepEqual(L.parseSpot("LANE-7-P02"), { group: "LANE-7", n: 2 });
  assert.equal(L.kind("06B-FLOOR-P02"), "floor");
  assert.equal(L.kind("NEARCOOLER-01"), "area");
  assert.equal(L.spotCode("06B", 4), "06B-FLOOR-P04");
  assert.equal(L.spotCode("LANE-7", 4), "LANE-7-P04");
});

test("Another warehouse: its own racks and code format, no code change", async () => {
  const { buildLayout } = await load();
  const L = buildLayout({
    codeFormat: { slot: "{face}.{col}.{level}{bay}", floor: "{face}.F{n}", areaSpot: "{area}/{n}", rackDigits: 1, colDigits: 3, spotDigits: 1, acceptUnpadded: false },
    shapes: { tall: { levels: [1, 2, 3, 4, 5], bays: 3 } },
    defaultShape: "tall",
    racks: [{ id: "1", sides: "AB", columns: 4 }, { id: "C", name: "Cooler", sides: "A", columns: 2 }],
    areas: [{ id: "DOCK", name: "Dock" }],
    receivingArea: "DOCK",
  });
  assert.equal(L.slots.length, (2 * 4 + 2) * 5 * 3);
  assert.deepEqual(L.levels, [5, 4, 3, 2, 1]);
  assert.equal(L.slotCode("1A", 2, 5, 3), "1A.002.53");
  assert.equal(L.normalize("1a.2.53"), "1A.002.53");
  assert.equal(L.normalize("CA.001.11"), "CA.001.11");
  assert.equal(L.rackName("C"), "Cooler");
  assert.equal(L.normalize("1B.F3"), "1B.F3");
  assert.equal(L.normalize("dock/2"), "DOCK/2");
  assert.equal(L.normalize("DOCK"), "DOCK");
  // A3K's codes mean nothing here
  assert.equal(L.normalize("06B-08-L3-B1"), null);
  assert.equal(L.normalize("1A.005.11"), null);
});
