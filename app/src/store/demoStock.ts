// DEMO stock: made-up pallets for a warehouse with no stock.json (the public demo site, fresh clones). Uses the
// warehouse's own products and layout; every quantity and location is invented, and the same on every load.
// The seed's demoStock says which clients to leave out and which floor areas to fill.
import { AREAS, CLIENTS, FACES, PRODUCTS, RECEIVING, findProduct, slotCode, spotCode, type Client, type Product } from "../data/catalog";
import { tenant } from "../tenant";
import type { StockLine } from "./types";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoStock(): { asof: string; note: string; stock: Record<string, StockLine[]> } {
  const seed = tenant().seed;
  const opts = seed?.demoStock ?? { seed: 20261014 };
  const rnd = mulberry32(opts.seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const leaveOut = new Set(opts.leaveOut ?? []);
  const usable = PRODUCTS.filter(p => !leaveOut.has(p.client) && !/DONOTUSE|CROSSDOCK/i.test(p.item ?? ""));
  const clients = CLIENTS.filter(c => usable.some(p => p.client === c));
  const pool = new Map<Client, Product[]>(clients.map(c => [c, usable.filter(p => p.client === c)]));
  // Products the sample orders use go first, so they have stock to plan from
  const queue = new Map<Client, Product[]>(clients.map(c => [c, []]));
  for (const o of seed?.orders ?? []) for (const [code] of o.lines) {
    const p = findProduct(o.client, code);
    if (p && queue.has(p.client) && !queue.get(p.client)!.includes(p)) queue.get(p.client)!.push(p);
  }
  // A rack side holds one client's stock; bigger clients get more sides
  const total = usable.length;
  const clientFor = () => { let r = rnd() * total; for (const c of clients) { r -= pool.get(c)!.length; if (r < 0) return c; } return clients[0]; };
  const full = (p: Product) => p.perPallet ?? 40;
  const stock: Record<string, StockLine[]> = {};
  if (!clients.length) return { asof: new Date().toISOString().slice(0, 10), note: "DEMO: no products", stock };

  for (const f of FACES) {
    const client = clientFor();
    const next = () => queue.get(client)!.shift() ?? pick(pool.get(client)!);
    let product = next();
    for (const [col, slots] of f.cols) {
      if (rnd() < 0.45) continue; // empty column
      if (rnd() > 0.6) product = next();
      for (const [level, bay] of slots) {
        if (rnd() < 0.25) continue;
        const code = slotCode(f.id, col, level, bay);
        const n = full(product), r = rnd();
        if (r < 0.04) { // mixed pallet
          const other = pick(pool.get(client)!);
          stock[code] = [{ productId: product.id, cases: Math.max(1, Math.round(n * 0.4)) }, { productId: other.id, cases: Math.max(1, Math.round(full(other) * 0.3)) }];
        } else stock[code] = [{ productId: product.id, cases: r < 0.18 ? Math.max(1, Math.round(n * (0.15 + rnd() * 0.7))) : n }];
      }
    }
    // A few pallets waiting on the rack side's floor
    if (!f.junction && rnd() < 0.3) {
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 1; i <= count; i++) stock[spotCode(f.id, i)] = [{ productId: product.id, cases: full(product) }];
    }
  }
  const areas = opts.areas ?? AREAS.map(a => a.id).filter(a => a !== RECEIVING);
  for (const area of areas) {
    const count = 2 + Math.floor(rnd() * 4);
    for (let i = 1; i <= count; i++) { const p = pick(pool.get(clients[0])!); stock[spotCode(area, i)] = [{ productId: p.id, cases: full(p) }]; }
  }
  return { asof: new Date().toISOString().slice(0, 10), note: "DEMO: made-up stock", stock };
}
