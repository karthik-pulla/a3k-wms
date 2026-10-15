// DEMO stock: made-up pallets for the public demo site and fresh clones, where the real sheet stock
// (sampleStock.json, made from the owners' workbooks) is not available. Same shape as sampleStock.json.
// Real product names and the real layout; every quantity and location is invented, and the same on every load.
import { FACES, PRODUCTS, findProduct, type Client, type Product } from "../data/catalog";
import type { StockLine } from "./types";

/** Products the sample shipments and orders use, so they have stock to plan from */
const NEEDED: [Client, string][] = [
  ["Deccan", "1015"], ["Deccan", "1051"], ["Deccan", "1073"], ["Deccan", "1065"], ["Deccan", "1401"], ["Deccan", "1420"],
  ["Deccan", "1055"], ["Deccan", "1071"], ["Deccan", "1054"], ["Matco", "M001"], ["Matco", "M002"], ["Matco", "M006"], ["Matco", "M129"],
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoStock(): { asof: string; note: string; stock: Record<string, StockLine[]> } {
  const rnd = mulberry32(20261014);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  // Praj stays out, like the sheets, so one sample order shows a shortage
  const usable = PRODUCTS.filter(p => p.client !== "Praj" && !/DONOTUSE|CROSSDOCK/i.test(p.item ?? ""));
  const pool: Record<"Deccan" | "Matco", Product[]> = { Deccan: usable.filter(p => p.client === "Deccan"), Matco: usable.filter(p => p.client === "Matco") };
  const queue: Record<"Deccan" | "Matco", Product[]> = { Deccan: [], Matco: [] };
  for (const [client, code] of NEEDED) { const p = findProduct(client, code); if (p) queue[client as "Deccan" | "Matco"].push(p); }
  const full = (p: Product) => p.perPallet ?? 40;
  const stock: Record<string, StockLine[]> = {};

  for (const f of FACES) {
    const client = rnd() < 0.75 ? "Deccan" : "Matco";
    const next = () => queue[client].shift() ?? pick(pool[client]);
    let product = next();
    for (const [col, slots] of f.cols) {
      if (rnd() < 0.45) continue; // empty column
      if (rnd() > 0.6) product = next();
      for (const [level, bay] of slots) {
        if (rnd() < 0.25) continue;
        const code = `${f.id}-${String(col).padStart(2, "0")}-L${level}-B${bay}`;
        const n = full(product), r = rnd();
        if (r < 0.04) { // mixed pallet
          const other = pick(pool[client]);
          stock[code] = [{ productId: product.id, cases: Math.max(1, Math.round(n * 0.4)) }, { productId: other.id, cases: Math.max(1, Math.round(full(other) * 0.3)) }];
        } else stock[code] = [{ productId: product.id, cases: r < 0.18 ? Math.max(1, Math.round(n * (0.15 + rnd() * 0.7))) : n }];
      }
    }
    // A few pallets waiting on the rack side's floor
    if (!f.junction && rnd() < 0.3) {
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 1; i <= count; i++) stock[`${f.id}-FLOOR-P${String(i).padStart(2, "0")}`] = [{ productId: product.id, cases: full(product) }];
    }
  }
  for (const area of ["LINE-2-3", "NEARCOOLER-01", "NEARCOOLER-03", "LANE-7"]) {
    const count = 2 + Math.floor(rnd() * 4);
    for (let i = 1; i <= count; i++) { const p = pick(pool.Deccan); stock[`${area}-P${String(i).padStart(2, "0")}`] = [{ productId: p.id, cases: full(p) }]; }
  }
  return { asof: new Date().toISOString().slice(0, 10), note: "DEMO: made-up stock", stock };
}
