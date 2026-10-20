// Setting a warehouse up (onboarding, docs/multi-tenant-design.md section 8): its settings and logos as our team
// prepared them, its products, and its opening stock. Owners do it from the Team page (Data), usually with our
// team on site. Stock goes in through the same sync as every other change (core/sync.ts), so every device gets it.
import type { Db } from "./db.ts";
import { ApiError, bad } from "./errors.ts";
import { addProducts, type ProductRow } from "./products.ts";
import { writeSystem } from "./sync.ts";
import { PRODUCT_LIMITS } from "../shared/products.ts";

export const IMPORT_LIMITS = { products: 20_000, stockLines: 20_000, settingsBytes: 2_000_000, logosBytes: 6_000_000 } as const;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, name: string, max: number, optional = false): string => {
  if (v === undefined || v === null || v === "") { if (optional) return ""; throw bad(`${name} is missing`); }
  if (typeof v !== "string" && typeof v !== "number") throw bad(`${name} must be text`);
  const s = String(v).trim().replace(/\s+/g, " ");
  if (!s && !optional) throw bad(`${name} is missing`);
  if (s.length > max) throw bad(`${name} is longer than ${max} characters`);
  return s;
};
const whole = (v: unknown, name: string, min: number, max: number, optional = false): number | null => {
  if (v === undefined || v === null || v === "") { if (optional) return null; throw bad(`${name} is missing`); }
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};

/** What's in the warehouse's database so far, for the Data tab */
export async function setupStatus(db: Db) {
  const [cfg, products, stock, people] = await Promise.all([
    db.query("SELECT key, updated_at, updated_by FROM settings WHERE key IN ('config', 'logos')"),
    db.query("SELECT count(*)::int AS n FROM products WHERE active"),
    db.query("SELECT count(*)::int AS n, coalesce(sum(jsonb_array_length(data)), 0)::int AS lines FROM entities WHERE kind = 'stock' AND data IS NOT NULL"),
    db.query("SELECT count(*)::int AS n FROM people WHERE status = 'active'"),
  ]);
  const by = new Map(cfg.rows.map(r => [r.key, r]));
  const when = (k: string) => (by.get(k) ? { at: new Date(by.get(k).updated_at).toISOString(), by: by.get(k).updated_by } : null);
  return { config: when("config"), logos: when("logos"), products: products.rows[0].n, stockLocations: stock.rows[0].n, stockLines: stock.rows[0].lines, people: people.rows[0].n };
}

/** The warehouse's settings (tenant config: layout, clients, labels…) and/or brand logos, as our team prepared them */
export async function saveSettings(db: Db, by: string, input: { config?: unknown; logos?: unknown }) {
  const writes: [string, unknown][] = [];
  if (input.config !== undefined) {
    const c = input.config;
    if (!isObj(c) || !isObj(c.layout) || !Array.isArray(c.clients) || !isObj(c.branding)) throw bad("That isn't a warehouse settings file (config.json): it needs layout, clients and branding");
    if (JSON.stringify(c).length > IMPORT_LIMITS.settingsBytes) throw bad("The settings file is too big");
    writes.push(["config", c]);
  }
  if (input.logos !== undefined) {
    const l = input.logos;
    if (!isObj(l) || Object.values(l).some(x => !isObj(x) || typeof x.src !== "string")) throw bad("That isn't a logos file (logos.json)");
    if (JSON.stringify(l).length > IMPORT_LIMITS.logosBytes) throw bad("The logos file is too big");
    writes.push(["logos", l]);
  }
  if (!writes.length) throw bad("Nothing to save");
  await db.tx(async q => {
    for (const [key, value] of writes) {
      await q.query("INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by", [key, JSON.stringify(value), by]);
      await q.query("INSERT INTO settings_history (key, value, changed_by) VALUES ($1, $2, $3)", [key, JSON.stringify(value), by]);
    }
  });
  return { saved: writes.map(w => w[0]) };
}

/** A stable id for a product that came without one (from the .xlsx template): its client and full description */
async function productId(client: string, item: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${client}\u0000${item.toLowerCase()}`)));
  return `p-${[...d.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Adds products (from products.json or the template); ones already there (same id) stay as they are */
export async function importProducts(db: Db, rows: unknown): Promise<{ added: number; skipped: number }> {
  if (!Array.isArray(rows) || !rows.length || rows.length > IMPORT_LIMITS.products) throw bad(`Send 1–${IMPORT_LIMITS.products} products`);
  const cfg = (await db.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
  const clients = new Set<string>((cfg?.clients ?? []).map((c: any) => String(c.id)));
  if (!clients.size) throw bad("Save the warehouse's settings first: products belong to its clients");
  const out: ProductRow[] = [];
  const ids = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const at = `Product ${i + 1}`;
    if (!isObj(r)) throw bad(`${at} isn't a product`);
    const client = text(r.client, `${at}: client`, 80);
    if (!clients.has(client)) throw bad(`${at}: "${client}" isn't one of this warehouse's clients (${[...clients].join(", ")})`);
    const name = text(r.name, `${at}: name`, PRODUCT_LIMITS.name);
    const item = text(r.item ?? name, `${at}: full description`, PRODUCT_LIMITS.item);
    const id = r.id ? text(r.id, `${at}: id`, 80) : await productId(client, item);
    if (ids.has(id)) throw bad(`${at} is in the list twice (${item})`);
    ids.add(id);
    out.push({
      id, client, name, item, code: text(r.code, `${at}: code`, PRODUCT_LIMITS.code, true),
      brand: text(r.brand, `${at}: brand`, 80, true), cat: text(r.cat, `${at}: category`, 80, true), size: text(r.size, `${at}: size`, 40, true),
      units: whole(r.units, `${at}: units per case`, 1, 100_000, true), perPallet: whole(r.perPallet, `${at}: cases per pallet`, 1, 100_000, true),
    });
  }
  const added = await addProducts(db, out);
  return { added, skipped: out.length - added };
}

export interface StockLineIn { location: string; productId: string; cases: number; lot?: string; bestBefore?: string; arrived?: string }

/**
 * The opening stock: what's in each slot on the day the warehouse starts with the WMS (from the 3-day count, or a
 * filled-in template). Each location's stock is replaced as a whole; locations that already hold stock are refused
 * unless `replace` is set. Logged in the movement log and the change log.
 */
export async function importStock(db: Db, who: { id: string; name: string }, input: { lines?: unknown; replace?: unknown }) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > IMPORT_LIMITS.stockLines) throw bad(`Send 1–${IMPORT_LIMITS.stockLines} stock lines`);
  const checked: StockLineIn[] = lines.map((r, i) => {
    const at = `Line ${i + 1}`;
    if (!isObj(r)) throw bad(`${at} isn't a stock line`);
    const bb = text(r.bestBefore, `${at}: best before`, 10, true);
    const arrived = text(r.arrived, `${at}: arrived`, 10, true);
    if (bb && !/^\d{4}-\d{2}(-\d{2})?$/.test(bb)) throw bad(`${at}: best before must be a month like 2027-04`);
    if (arrived && !/^\d{4}-\d{2}-\d{2}$/.test(arrived)) throw bad(`${at}: arrived must be a date like 2026-10-12`);
    return {
      location: text(r.location, `${at}: location`, 40), productId: text(r.productId, `${at}: product`, 80),
      cases: whole(r.cases, `${at}: cases`, 1, 100_000)!, lot: text(r.lot, `${at}: lot`, 60, true) || undefined,
      bestBefore: bb ? bb.slice(0, 7) : undefined, arrived: arrived || undefined,
    };
  });
  const productIds = [...new Set(checked.map(l => l.productId))];
  const known = new Set((await db.query("SELECT id FROM products WHERE active AND id = ANY($1)", [productIds])).rows.map(r => r.id));
  const unknown = productIds.filter(id => !known.has(id));
  if (unknown.length) throw bad(`Products not in this warehouse: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "…" : ""}`);

  const byLocation = new Map<string, StockLineIn[]>();
  for (const l of checked) byLocation.set(l.location, [...(byLocation.get(l.location) ?? []), l]);
  return db.tx(async q => {
    const keys = [...byLocation.keys()].map(l => `stock:${l}`);
    const full = (await q.query("SELECT key FROM entities WHERE key = ANY($1) AND data IS NOT NULL AND jsonb_array_length(data) > 0", [keys])).rows.map(r => String(r.key).slice(6));
    if (full.length && input.replace !== true) throw new ApiError(409, "conflict", `${full.length} location${full.length > 1 ? "s" : ""} already hold stock (${full.slice(0, 5).join(", ")}${full.length > 5 ? "…" : ""}). Choose "Replace what's there" to load over them.`, { locations: full });
    const at = new Date().toISOString();
    const stamp = Date.parse(at).toString(36);
    const changes: { key: string; data: unknown }[] = [];
    let n = 0;
    for (const [loc, ls] of byLocation) {
      changes.push({ key: `stock:${loc}`, data: ls.map(l => ({ productId: l.productId, cases: l.cases, ...(l.lot ? { lot: l.lot } : {}), ...(l.bestBefore ? { bestBefore: l.bestBefore } : {}), ...(l.arrived ? { arrived: l.arrived } : {}) })) });
      for (const l of ls) changes.push({ key: `movement:M-open-${stamp}-${++n}`, data: { id: `M-open-${stamp}-${n}`, at, by: who.name, type: "adjustment", location: loc, productId: l.productId, cases: l.cases, reason: "Opening stock (import)" } });
    }
    const pallets = checked.length;
    changes.push({ key: `audit:A-open-${stamp}`, data: { id: `A-open-${stamp}`, at, byId: who.id, by: who.name, area: "stock", action: `Loaded the opening stock: ${pallets} line${pallets > 1 ? "s" : ""} in ${byLocation.size} location${byLocation.size > 1 ? "s" : ""}${full.length ? ` (replaced ${full.length})` : ""}` } });
    await writeSystem(q, changes, who.name, "setup.importStock");
    return { locations: byLocation.size, lines: pallets, replaced: full.length };
  });
}
