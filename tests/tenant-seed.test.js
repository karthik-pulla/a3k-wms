// Checks every warehouse in app/public/tenants/: its config builds a layout, and its sample data (seed.json) only
// points at products, slots, people and conversations that exist. Also keeps the demo free of A3K's names.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TENANTS = path.join(ROOT, "app/public/tenants");
const read = (t, f) => JSON.parse(fs.readFileSync(path.join(TENANTS, t, f), "utf8"));
const has = (t, f) => fs.existsSync(path.join(TENANTS, t, f));
const tenants = fs.readdirSync(TENANTS).filter(t => has(t, "config.json"));

test("there is A3K and a demo warehouse", () => {
  assert.ok(tenants.includes("a3k"));
  assert.ok(tenants.includes("demo"));
});

for (const t of tenants) {
  test(`${t}: settings, products and logos fit together`, async () => {
    const { buildLayout } = await import(path.join(ROOT, "app/src/tenant/layout.ts"));
    const config = read(t, "config.json"), products = read(t, "products.json"), logos = read(t, "logos.json");
    assert.equal(config.tenant.id, t);
    const L = buildLayout(config.layout);
    assert.ok(L.slots.length > 0);
    assert.ok(config.layout.areas.some(a => a.id === config.layout.receivingArea), "receiving area is one of the areas");
    const clients = new Set(config.clients.map(c => c.id));
    for (const p of products) assert.ok(clients.has(p.client), `${p.code}: unknown client ${p.client}`);
    assert.equal(new Set(products.map(p => p.id)).size, products.length, "product IDs are unique");
    for (const p of config.labels.profiles) if (p.logo) assert.ok(logos[p.logo], `label profile ${p.id}: no logo ${p.logo}`);
    assert.ok(config.labels.sheets.some(s => s.id === config.labels.defaultSheet));
  });

  if (!has(t, "seed.json")) continue;
  test(`${t}: sample data points only at things that exist`, async () => {
    const { buildLayout } = await import(path.join(ROOT, "app/src/tenant/layout.ts"));
    const config = read(t, "config.json"), products = read(t, "products.json"), seed = read(t, "seed.json");
    const L = buildLayout(config.layout);
    const product = (client, code) => products.find(p => p.client === client && p.code === code);
    const anyProduct = code => products.find(p => p.code === code);
    const people = new Set(seed.people.map(p => p.id));
    const groups = new Set(["owners", "coordinators", ...config.groups.map(g => g.id)]);
    for (const p of seed.people) for (const g of p.groups) assert.ok(groups.has(g), `${p.id}: unknown group ${g}`);
    assert.ok(people.has(seed.focus));
    for (const s of seed.shipments) for (const [code] of s.lines) assert.ok(product(s.client, code), `${s.id}: no ${s.client} product ${code}`);
    for (const o of seed.orders) for (const [code] of o.lines) assert.ok(product(o.client, code), `${o.id}: no ${o.client} product ${code}`);
    for (const r of seed.returns) {
      const o = seed.orders.find(x => x.id === r.orderId);
      assert.ok(o, `${r.id}: no order ${r.orderId}`);
      for (const [code] of r.items) assert.ok(product(o.client, code), `${r.id}: no product ${code}`);
    }
    const convs = new Set([
      ...seed.channels.map(c => c.id), ...seed.dms.map(([a, b]) => `dm-${a}-${b}`),
      ...seed.orders.map(o => `order-${o.id.replace(/\s+/g, "-").toLowerCase()}`), ...seed.shipments.map(s => `ship-${s.id}`),
    ]);
    for (const [conv, author, , parts] of seed.messages) {
      assert.ok(convs.has(conv), `message in unknown conversation ${conv}`);
      assert.ok(people.has(author), `message by unknown person ${author}`);
      for (const p of parts) {
        if (typeof p !== "object") continue;
        if ("slot" in p) assert.ok(L.normalize(p.slot), `${conv}: ${p.slot} is not a location here`);
        if ("product" in p) assert.ok(anyProduct(p.product), `${conv}: no product ${p.product}`);
        if ("user" in p) assert.ok(people.has(p.user), `${conv}: no person ${p.user}`);
        if ("group" in p) assert.ok(groups.has(p.group), `${conv}: no group ${p.group}`);
        if ("order" in p) assert.ok(seed.orders.some(o => o.id === p.order), `${conv}: no order ${p.order}`);
        if ("shipment" in p) assert.ok(seed.shipments.some(s => s.id === p.shipment), `${conv}: no delivery ${p.shipment}`);
      }
    }
    for (const id of Object.keys(seed.presence)) assert.ok(people.has(id));
    // Manage warehouse sample settings and work teams point at real clients and people
    const clients = new Set(config.clients.map(c => c.id));
    for (const r of seed.settings?.routes ?? []) { assert.ok(clients.has(r.client), `route ${r.match}: no client ${r.client}`); assert.ok(["order", "inbound"].includes(r.kind)); }
    for (const c of seed.settings?.contacts ?? []) if (c.client) assert.ok(clients.has(c.client), `contact ${c.name}: no client ${c.client}`);
    for (const t of seed.teams ?? []) for (const m of t.members) assert.ok(people.has(m), `team ${t.name}: no person ${m}`);
  });
}

test("the demo warehouse has nothing of A3K's", () => {
  const text = ["config.json", "products.json", "seed.json"].map(f => fs.readFileSync(path.join(TENANTS, "demo", f), "utf8")).join("\n");
  const a3k = read("a3k", "config.json"), a3kSeed = read("a3k", "seed.json");
  const names = [a3k.tenant.name, a3k.branding.mark, ...a3k.clients.map(c => c.name), ...a3k.clients.map(c => c.defaultSupplier),
    ...new Set(a3kSeed.orders.map(o => o.store.split(" – ")[0])), "a3kimports", "Karthik"];
  for (const n of names) assert.ok(!text.includes(n), `demo mentions ${n}`);
});
