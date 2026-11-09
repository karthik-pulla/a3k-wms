// Setting a warehouse up (onboarding, docs/multi-tenant-design.md section 8): its settings and logos as our team
// prepared them, its products, and its opening stock. Owners do it from the Team page (Data), usually with our
// team on site. Stock goes in through the same sync as every other change (core/sync.ts), so every device gets it.
import type { Db, Sql } from "./db.ts";
import { ApiError, bad } from "./errors.ts";
import { addProducts, type ProductRow } from "./products.ts";
import { writeSystem } from "./sync.ts";
import { PRODUCT_LIMITS } from "../shared/products.ts";
import { buildLayout, layoutProblems, type LayoutConfig } from "../shared/layout.ts";

export const IMPORT_LIMITS = { products: 20_000, stockLines: 20_000, settingsBytes: 2_000_000, logosBytes: 6_000_000 } as const;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
/** A value as text with its keys sorted (the database keeps JSON keys in its own order) */
const same = (v: unknown): string => JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
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
  const c = (await db.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
  const extra = await db.query(`SELECT
      (SELECT count(*)::int FROM people WHERE status = 'invited') AS invited,
      (SELECT count(*)::int FROM entities WHERE kind = 'count' AND data IS NOT NULL AND data->>'status' = 'closed') AS counts,
      (SELECT count(*)::int FROM entities WHERE kind = 'order' AND data IS NOT NULL AND data->>'status' = 'shipped') AS shipped`).catch(() => ({ rows: [{ invited: 0, counts: 0, shipped: 0 }] }));
  const x = extra.rows[0];
  return {
    config: when("config"), logos: when("logos"), products: products.rows[0].n, stockLocations: stock.rows[0].n, stockLines: stock.rows[0].lines, people: people.rows[0].n,
    racks: Array.isArray(c?.layout?.racks) ? c.layout.racks.length : 0, clients: Array.isArray(c?.clients) ? c.clients.length : 0,
    invited: x.invited, closedCounts: x.counts, shippedOrders: x.shipped, setup: await setupState(db),
  };
}

/**
 * The warehouse's settings (tenant config: layout, clients, labels…) and/or brand logos, as our team prepared them,
 * or as an owner changed them in Manage warehouse (name, racks). Once set, the slot code format is the Lattice
 * team's to change (setCodeFormat), never an owner's: every saved location depends on it.
 */
export async function saveSettings(db: Db, by: string, input: { config?: unknown; logos?: unknown; reason?: unknown }): Promise<{ saved: string[]; layoutChanged: boolean; reason?: string }> {
  const writes: [string, unknown][] = [];
  let layoutChanged = false, reason: string | undefined;
  if (input.config !== undefined) {
    const c = input.config;
    if (!isObj(c) || !isObj(c.layout) || !Array.isArray(c.clients) || !isObj(c.branding)) throw bad("That isn't a warehouse settings file (config.json): it needs layout, clients and branding");
    if (JSON.stringify(c).length > IMPORT_LIMITS.settingsBytes) throw bad("The settings file is too big");
    const cur = (await db.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
    if (cur?.layout?.codeFormat && same(cur.layout.codeFormat) !== same(c.layout.codeFormat))
      throw new ApiError(403, "forbidden", "The slot code format is set by the Lattice team. Ask them to change it (Manage warehouse → Racks).");
    layoutChanged = same(cur?.layout ?? null) !== same(c.layout);
    if (layoutChanged) {
      // A layout that can be read, and that still has every location holding stock or promised to an open task
      const held = await heldLocations(db);
      const problems = layoutProblems(c.layout, held);
      if (problems.length) throw new ApiError(409, "conflict", problems.slice(0, 8).join("; ") + (problems.length > 8 ? "; …" : ""), { problems });
      // Once the warehouse is live, a change to racks people rely on needs a reason (security log); the first racks don't
      if (Array.isArray(cur?.layout?.racks) && cur.layout.racks.length && (await setupState(db)).mode === "live") {
        reason = typeof input.reason === "string" ? input.reason.trim().replace(/\s+/g, " ") : "";
        if (reason.length < 3 || reason.length > 300) throw bad("Say why the racks changed (3–300 characters)");
      }
    }
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
  return { saved: writes.map(w => w[0]), layoutChanged, ...(reason ? { reason } : {}) };
}

// ---------- Layout checks (the same rules as the app's layout editor: shared/layout.ts) ----------
/** Every location that holds stock or that an open task comes from or goes to */
export async function heldLocations(db: Sql): Promise<string[]> {
  const [stock, tasks] = await Promise.all([
    db.query("SELECT substr(key, 7) AS loc FROM entities WHERE kind = 'stock' AND data IS NOT NULL AND jsonb_array_length(data) > 0"),
    db.query("SELECT data->>'from' AS f, data->>'to' AS t FROM entities WHERE kind = 'task' AND data IS NOT NULL AND data->>'status' IN ('open', 'doing')"),
  ]);
  return [...new Set([...stock.rows.map(r => String(r.loc)), ...tasks.rows.flatMap(r => [r.f, r.t]).filter(Boolean).map(String)])];
}

// ---------- Setup mode (docs/multi-tenant-design.md section 8) ----------
// A new warehouse starts in setup mode: practice deliveries, orders and stock are fine and can be cleared; going
// live ends it for good. A warehouse with no setup record (made before this existed) is live.
export interface SetupState { mode: "setup" | "live"; since?: string; liveAt?: string; liveBy?: string; ticks?: Record<string, { at: string; by: string }> }
/** The setup record a new warehouse starts with (ops/createTenant.ts and the preview) */
export const startSetup = (at: string): SetupState => ({ mode: "setup", since: at });
export async function setupState(db: Sql): Promise<SetupState> {
  const v = (await db.query("SELECT value FROM settings WHERE key = 'setup'")).rows[0]?.value;
  return isObj(v) && (v.mode === "setup" || v.mode === "live") ? (v as SetupState) : { mode: "live" };
}
async function writeSetup(q: Sql, s: SetupState, by: string) {
  await q.query("INSERT INTO settings (key, value, updated_by) VALUES ('setup', $1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by", [JSON.stringify(s), by]);
  await q.query("INSERT INTO settings_history (key, value, changed_by) VALUES ('setup', $1, $2)", [JSON.stringify(s), by]);
}
/** Steps on the setup page that people tick themselves (the rest are worked out from the data) */
export const SETUP_TICKS = ["survey", "labels", "training"] as const;
export async function tickSetup(db: Db, by: string, step: unknown, done: unknown): Promise<SetupState> {
  if (typeof step !== "string" || !(SETUP_TICKS as readonly string[]).includes(step)) throw bad("Unknown setup step");
  return db.tx(async q => {
    const s = await setupState(q);
    if (s.mode !== "setup") throw new ApiError(409, "conflict", "This warehouse is already live");
    const ticks = { ...(s.ticks ?? {}) };
    if (done === true) ticks[step] = { at: new Date().toISOString(), by }; else delete ticks[step];
    const next = { ...s, ticks };
    await writeSetup(q, next, by);
    return next;
  });
}

/** Practice data: everything people did while learning, as opposed to the warehouse's settings, products and people */
const PRACTICE: readonly string[] = ["order", "shipment", "task", "return", "count", "countentry", "inbox"];

/**
 * Setup mode only: starts the practice over. Stock, deliveries, orders, tasks, returns and counts go; settings,
 * products, people and messages stay. The stock history and change log are permanent, so they say what was cleared.
 */
export async function clearPractice(db: Db, who: { id: string; name: string }): Promise<{ cleared: number; stockLocations: number }> {
  return db.tx(async q => {
    if ((await setupState(q)).mode !== "setup") throw new ApiError(409, "conflict", "Practice data can only be cleared before the warehouse goes live");
    const { rows } = await q.query("SELECT key, kind, data FROM entities WHERE data IS NOT NULL AND (kind = ANY($1) OR kind = 'stock')", [[...PRACTICE]]);
    const at = new Date().toISOString(), stamp = Date.parse(at).toString(36);
    const changes: { key: string; data: unknown }[] = rows.map(r => ({ key: String(r.key), data: null }));
    let n = 0, locations = 0;
    for (const r of rows) {
      if (r.kind !== "stock" || !Array.isArray(r.data) || !r.data.length) continue;
      locations++;
      for (const l of r.data) changes.push({ key: `movement:M-practice-${stamp}-${++n}`, data: { id: `M-practice-${stamp}-${n}`, at, by: who.name, type: "adjustment", location: String(r.key).slice(6), productId: l.productId, cases: l.cases, reason: "Practice data cleared before go-live (removed)" } });
    }
    changes.push({ key: `audit:A-practice-${stamp}`, data: { id: `A-practice-${stamp}`, at, byId: who.id, by: who.name, area: "data", action: `Cleared the practice data: ${rows.length} record${rows.length === 1 ? "" : "s"}, stock on ${locations} location${locations === 1 ? "" : "s"}` } });
    await writeSystem(q, changes, who.name, "setup.clearPractice");
    return { cleared: rows.length, stockLocations: locations };
  });
}

/**
 * Ends setup mode for good. With `clearActivity`, practice orders, deliveries, tasks, returns and the inbox go; the
 * stock stays (it should be the approved go-live count) and so do counts. Needs racks and products first.
 */
export async function goLive(db: Db, who: { id: string; name: string }, input: { clearActivity?: unknown }): Promise<{ live: SetupState; cleared: number }> {
  return db.tx(async q => {
    const s = await setupState(q);
    if (s.mode !== "setup") throw new ApiError(409, "conflict", "This warehouse is already live");
    const cfg = (await q.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
    if (!Array.isArray(cfg?.layout?.racks) || !cfg.layout.racks.length) throw bad("Add the racks first (Manage warehouse → Racks)");
    if (!(await q.query("SELECT 1 FROM products WHERE active LIMIT 1")).rows.length) throw bad("Load the products first");
    const at = new Date().toISOString(), stamp = Date.parse(at).toString(36);
    const changes: { key: string; data: unknown }[] = [];
    let cleared = 0;
    if (input.clearActivity === true) {
      const kinds = PRACTICE.filter(k => k !== "count" && k !== "countentry");
      const { rows } = await q.query("SELECT key FROM entities WHERE data IS NOT NULL AND kind = ANY($1)", [kinds]);
      for (const r of rows) changes.push({ key: String(r.key), data: null });
      cleared = rows.length;
    }
    changes.push({ key: `audit:A-live-${stamp}`, data: { id: `A-live-${stamp}`, at, byId: who.id, by: who.name, area: "data", action: `Went live${cleared ? `, clearing ${cleared} practice record${cleared === 1 ? "" : "s"} (orders, deliveries, tasks, returns)` : ""}` } });
    await writeSystem(q, changes, who.name, "setup.goLive");
    const live: SetupState = { ...s, mode: "live", liveAt: at, liveBy: who.name };
    await writeSetup(q, live, who.name);
    return { live, cleared };
  });
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
  // Every location must be one the warehouse has (a typo would put stock where no screen shows it)
  const cfg = (await db.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
  if (!isObj(cfg?.layout?.codeFormat)) throw bad("Save the warehouse's racks first: stock goes into its slots");
  let L: ReturnType<typeof buildLayout>;
  try { L = buildLayout(cfg.layout as LayoutConfig); } catch { throw bad("The warehouse's racks can't be read: fix them first"); }
  const wrong = [...new Set(checked.map(l => l.location))].filter(loc => L.normalize(loc) !== loc);
  if (wrong.length) throw bad(`Locations this warehouse doesn't have: ${wrong.slice(0, 10).join(", ")}${wrong.length > 10 ? "…" : ""}`);
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

/** Problems with a slot code format (empty = fine): every token it needs, short codes, sensible padding */
export function codeFormatProblems(f: unknown): string[] {
  if (!isObj(f)) return ["A code format is missing"];
  const out: string[] = [];
  const tpl = (k: string, tokens: string[]) => {
    const v = f[k];
    if (typeof v !== "string" || !v || v.length > 60) { out.push(`${k}: a pattern of up to 60 characters`); return; }
    for (const t of tokens) if (!v.includes(`{${t}}`)) out.push(`${k}: needs {${t}}`);
    if (/[^A-Za-z0-9{}\-_.\/ ]/.test(v)) out.push(`${k}: letters, digits, - _ . / and the {tokens} only`);
  };
  tpl("slot", ["face", "col", "level", "bay"]);
  tpl("floor", ["face", "n"]);
  tpl("areaSpot", ["area", "n"]);
  if (typeof f.areaSpot === "string" && !f.areaSpot.startsWith("{area}")) out.push("areaSpot: must start with {area}");
  for (const k of ["rackDigits", "colDigits", "spotDigits"]) if (!Number.isInteger(f[k]) || f[k] < 1 || f[k] > 4) out.push(`${k}: a whole number from 1 to 4`);
  if (typeof f.acceptUnpadded !== "boolean") out.push("acceptUnpadded: yes or no");
  return out;
}

/**
 * The Lattice team sets a warehouse's slot code format (from the ops console). Only before any stock is saved:
 * after that every location, task, order and message names slots by their codes, and changing them is a data move.
 */
export async function setCodeFormat(db: Db, by: string, format: unknown): Promise<{ codeFormat: unknown }> {
  const problems = codeFormatProblems(format);
  if (problems.length) throw bad(problems.join("; "));
  return db.tx(async q => {
    const cur = (await q.query("SELECT value FROM settings WHERE key = 'config' FOR UPDATE")).rows[0]?.value;
    if (!isObj(cur) || !isObj(cur.layout)) throw bad("This warehouse has no settings yet; load its config.json first");
    const stock = (await q.query("SELECT count(*)::int AS n FROM entities WHERE kind = 'stock' AND data IS NOT NULL")).rows[0].n;
    if (stock > 0) throw new ApiError(409, "conflict", `This warehouse already has stock on ${stock} locations under the current codes. Changing the format then is a data move: plan it with engineering.`);
    const next = { ...cur, layout: { ...cur.layout, codeFormat: format } };
    await q.query("UPDATE settings SET value = $1, updated_at = now(), updated_by = $2 WHERE key = 'config'", [JSON.stringify(next), by]);
    await q.query("INSERT INTO settings_history (key, value, changed_by) VALUES ('config', $1, $2)", [JSON.stringify(next), by]);
    return { codeFormat: format };
  });
}

/** The current slot code format and whether it can still change (no stock yet) */
export async function codeFormatStatus(db: Db): Promise<{ codeFormat: unknown; stockLocations: number }> {
  const [cfg, stock] = await Promise.all([
    db.query("SELECT value FROM settings WHERE key = 'config'"),
    db.query("SELECT count(*)::int AS n FROM entities WHERE kind = 'stock' AND data IS NOT NULL"),
  ]);
  return { codeFormat: cfg.rows[0]?.value?.layout?.codeFormat ?? null, stockLocations: stock.rows[0].n };
}
