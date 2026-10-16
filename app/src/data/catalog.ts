// Products and rack layout of the warehouse this app is serving (tenant/index.ts loads them before any screen).
// Location codes are built and read only through the layout (tenant/layout.ts), never by hand.
import { tenant } from "../tenant";
import type { Client, Product } from "../tenant/types";
import type { Face, SlotMeta } from "../tenant/layout";
import type { ProductText } from "../../../server/src/shared/products.ts";

export type { Client, Product, Face, SlotMeta };

const T = tenant();
const L = T.layout;

export const CLIENTS: Client[] = T.config.clients.map(c => c.id);
export const clientConfig = (id: Client) => T.config.clients.find(c => c.id === id);

export const PRODUCTS = T.products;
export const FACES = L.faces;
export const AREAS = L.areas;

const BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));
export const productById = (id: string) => BY_ID.get(id);
export const findProduct = (client: Client, code: string) => PRODUCTS.find(p => p.client === client && p.code === code);

export const productLabel = (p: Product) => `${p.name}${p.size ? ` ${p.size}` : ""}${p.units ? ` × ${p.units}` : ""}`;

const hayOf = (p: Product) => `${p.code} ${p.name} ${p.brand} ${p.cat} ${p.size} ${p.client}`.toLowerCase();
const hay = new Map(PRODUCTS.map(p => [p.id, hayOf(p)]));

// ---------- Edited products ----------
// An edit changes a product's code, name and full description (never its id). Edits are saved with the app data
// (the store's productEdits; on the server also in the warehouse's database) and applied here, in place, so every
// screen, search and the order reader see the new text. `productsVersion` goes up with each change, for caches.
let version = 0;
let applied: Record<string, ProductText> | undefined;
export const productsVersion = () => version;
export function applyProductEdits(edits: Record<string, ProductText> | undefined) {
  if (!edits || edits === applied) return;
  applied = edits;
  let changed = false;
  for (const [id, e] of Object.entries(edits)) {
    const p = BY_ID.get(id);
    if (!p || (p.code === e.code && p.name === e.name && (p.item ?? "") === e.item)) continue;
    p.code = e.code; p.name = e.name; p.item = e.item;
    hay.set(id, hayOf(p));
    changed = true;
  }
  if (changed) version++;
}
/** A product's editable text as it is now */
export const productText = (p: Product): ProductText => ({ code: p.code, name: p.name, item: p.item ?? "" });

/** Products matching every word typed. Exact code, then code prefix, then name prefix come first; the shipment's client next. */
export function searchProducts(query: string, client?: string, limit = 8): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: [number, Product][] = [];
  for (const p of PRODUCTS) {
    if (!words.every(w => hay.get(p.id)!.includes(w))) continue;
    const code = p.code.toLowerCase(), name = p.name.toLowerCase();
    let s = code === q ? 0 : code.startsWith(q) ? 1 : name.startsWith(q) ? 2 : name.split(/\s+/).some(w => w.startsWith(words[0])) ? 3 : 4;
    if (client && p.client !== client) s += 5;
    if (/DONOTUSE|CROSSDOCK/i.test(p.item ?? "")) s += 3; // old or special codes sink below the normal product
    scored.push([s, p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name) || a[1].code.localeCompare(b[1].code, undefined, { numeric: true }));
  return scored.slice(0, limit).map(x => x[1]);
}

// ---------- Locations ----------
export const SLOTS: SlotMeta[] = L.slots;
export const slotMeta = L.slotMeta;
/** The code of a slot: rack side, column, level (1 = bottom beam), bay */
export const slotCode = L.slotCode;
/** Spot n on the floor of a rack side, or in a named area */
export const spotCode = L.spotCode;
/** The rack side or area of a floor or area spot, and its number */
export const parseSpot = L.parseSpot;
export const isFloor = (code: string) => !L.slotMeta(code);
/** "slot", "floor" (a rack side's floor) or "area" */
export const locKind = L.kind;
/** The rack side a slot or floor spot belongs to (an area's spots: the area) */
export const groupOf = L.groupOf;
export const faceOf = (code: string) => L.slotMeta(code)?.face ?? L.floorFace(code) ?? code;
/** Levels of a rack side, top first */
export const levelsOf = L.levelsOf;
/** Every level in the warehouse, top first (racks are drawn with all of them) */
export const LEVELS = L.levels;
/** A column number as it's written in codes ("08") */
export const colLabel = L.colLabel;
/** The saved form of a location code someone typed, or null if it isn't a real slot, floor spot or area */
export const normalizeLocation = L.normalize;
/** Every valid location code in a text */
export const findLocations = L.find;
/** Example codes for placeholders, in the warehouse's own format */
export const EXAMPLE_SLOT = SLOTS[Math.floor(SLOTS.length / 2)]?.code ?? "";
export const EXAMPLE_FLOOR = FACES.length ? spotCode(FACES[Math.floor(FACES.length / 2)].id, 1) : "";
/** Where delivered pallets wait before put-away */
export const RECEIVING = L.receivingArea;

export function describeLocation(code: string): string {
  const m = L.slotMeta(code);
  if (m) return `${rackName(m.rack)}, side ${m.side} · column ${m.col} · level ${m.level} · bay ${m.bay}`;
  const f = L.parseFloor(code);
  if (f) return `Floor of ${f.face} · spot ${f.n}`;
  return AREAS.find(a => code.startsWith(a.id))?.name ?? code;
}
export const rackName = L.rackName;
