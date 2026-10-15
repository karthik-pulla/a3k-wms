import { AREAS, FACES, PRODUCTS, SLOTS, isFloor, productById, slotMeta, type Product } from "../data/catalog";
import { canSeeClient } from "../auth/permissions";
import { arrivalDate, expiryTone, type ExpiryTone } from "../chat/selectors";
import type { State, StockLine, User } from "../store/types";

export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
/** Brand as shown (a few products have no brand in the sheets) */
export const brandOf = (p: Product) => p.brand || p.client;

export type LocKind = "slot" | "floor" | "area";
export const locKind = (code: string): LocKind => (!isFloor(code) ? "slot" : code.includes("-FLOOR-") ? "floor" : "area");
/** The rack side (or area) a location belongs to */
export const groupOf = (code: string) => slotMeta(code)?.face ?? code.replace(/-FLOOR-P\d+$/, "").replace(/-P\d+$/, "");

// Rack sides in walking order, used to sort locations: by side, then column, level, bay; floor after its side
const FACE_ORDER = new Map([...FACES.map(f => f.id), ...AREAS.map(a => a.id)].map((id, i) => [id, i]));
export function locationOrder(code: string): number[] {
  const m = slotMeta(code);
  if (m) return [FACE_ORDER.get(m.face) ?? 999, 0, m.col, m.level, m.bay];
  const g = groupOf(code);
  const n = Number(code.match(/-P(\d+)$/)?.[1] ?? 0);
  return [FACE_ORDER.get(g) ?? 999, 1, n, 0, 0];
}
export const byLocation = (a: string, b: string) => {
  const x = locationOrder(a), y = locationOrder(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return natural(a, b);
};

export interface StockRow {
  code: string;
  kind: LocKind;
  group: string;
  line: StockLine | null;
  product?: Product;
  /** Another client's stock: shown only as "hidden" */
  hidden: boolean;
  mixed: boolean;
  partial: boolean;
  tone: ExpiryTone;
  arrival?: string;
}

const partialOf = (l: StockLine, p?: Product) => !!p?.perPallet && l.cases < p.perPallet;

/** One row per stock line the viewer may see (other clients' lines become one "hidden" row), plus empty slots if asked. */
export function stockRows(state: State, me: User, opts: { empties?: boolean } = {}): StockRow[] {
  const out: StockRow[] = [];
  for (const [code, lines] of Object.entries(state.stock)) {
    if (!lines.length) continue;
    const kind = locKind(code), group = groupOf(code);
    let hiddenCount = 0;
    for (const line of lines) {
      const p = productById(line.productId);
      if (!p || !canSeeClient(me, p.client)) { hiddenCount++; continue; }
      out.push({ code, kind, group, line, product: p, hidden: false, mixed: lines.length > 1, partial: partialOf(line, p), tone: expiryTone(line.bestBefore), arrival: arrivalDate(state, code, line) });
    }
    if (hiddenCount) out.push({ code, kind, group, line: null, hidden: true, mixed: lines.length > 1, partial: false, tone: "ok" });
  }
  if (opts.empties) for (const s of SLOTS) if (!state.stock[s.code]?.length) out.push({ code: s.code, kind: "slot", group: s.face, line: null, hidden: false, mixed: false, partial: false, tone: "ok" });
  return out;
}

export interface ProductSummary {
  product: Product;
  cases: number;
  /** Locations holding it (a mixed pallet counts once) */
  locations: number;
  partial: number;
  /** Earliest best-before (YYYY-MM) */
  earliestBB?: string;
  oldestArrival?: string;
  worst: ExpiryTone;
  expiredCases: number;
}

const TONE_RANK: Record<ExpiryTone, number> = { ok: 0, warn: 1, expired: 2 };

/** Totals per product the viewer may see (products with no stock included, with zeros). */
export function productSummaries(state: State, me: User): ProductSummary[] {
  const map = new Map<string, ProductSummary & { locs: Set<string> }>();
  for (const p of PRODUCTS) if (canSeeClient(me, p.client)) map.set(p.id, { product: p, cases: 0, locations: 0, partial: 0, worst: "ok", expiredCases: 0, locs: new Set() });
  for (const [code, lines] of Object.entries(state.stock)) {
    for (const l of lines) {
      const s = map.get(l.productId);
      if (!s) continue;
      s.cases += l.cases;
      s.locs.add(code);
      if (partialOf(l, s.product)) s.partial++;
      if (l.bestBefore && (!s.earliestBB || l.bestBefore < s.earliestBB)) s.earliestBB = l.bestBefore;
      const a = arrivalDate(state, code, l);
      if (!s.oldestArrival || a < s.oldestArrival) s.oldestArrival = a;
      const t = expiryTone(l.bestBefore);
      if (TONE_RANK[t] > TONE_RANK[s.worst]) s.worst = t;
      if (t === "expired") s.expiredCases += l.cases;
    }
  }
  return [...map.values()].map(({ locs, ...s }) => ({ ...s, locations: locs.size }));
}

// ---------- Search and sort ----------
export type ProductSort = "auto" | "name" | "name-desc" | "code" | "cases" | "cases-asc" | "locations" | "expiry" | "arrival";
export const PRODUCT_SORTS: [ProductSort, string][] = [
  ["auto", "Automatic (A–Z, or by code when you type a number)"], ["name", "Name A–Z"], ["name-desc", "Name Z–A"], ["code", "Code (numeric)"],
  ["cases", "Most cases"], ["cases-asc", "Fewest cases"], ["locations", "Most locations"], ["expiry", "Earliest best-before"], ["arrival", "Oldest stock first"],
];

/** Does the text look like a code (starts with a digit, or letters followed by digits like M001 / O166)? */
export const looksLikeCode = (q: string) => /^\s*(\d|[a-z]{1,4}\d)/i.test(q);

export function matchesProduct(p: Product, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${p.code} ${p.name} ${p.size} ${brandOf(p)} ${p.client} ${p.cat} ${p.item ?? ""}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

export function sortProducts(list: ProductSummary[], sort: ProductSort, q: string): ProductSummary[] {
  const byName = (a: ProductSummary, b: ProductSummary) => natural(a.product.name, b.product.name) || natural(a.product.size, b.product.size) || natural(a.product.code, b.product.code);
  const byCode = (a: ProductSummary, b: ProductSummary) => natural(a.product.code, b.product.code) || byName(a, b);
  const s = sort === "auto" ? (looksLikeCode(q) ? "code" : "name") : sort;
  const qq = q.trim().toLowerCase();
  // An exact code typed always comes first
  const exact = (x: ProductSummary) => (qq && x.product.code.toLowerCase() === qq ? 0 : 1);
  const cmp: Record<Exclude<ProductSort, "auto">, (a: ProductSummary, b: ProductSummary) => number> = {
    name: byName, "name-desc": (a, b) => byName(b, a), code: byCode,
    cases: (a, b) => b.cases - a.cases || byName(a, b), "cases-asc": (a, b) => a.cases - b.cases || byName(a, b),
    locations: (a, b) => b.locations - a.locations || byName(a, b),
    expiry: (a, b) => (a.earliestBB ?? "9999").localeCompare(b.earliestBB ?? "9999") || byName(a, b),
    arrival: (a, b) => (a.oldestArrival ?? "9999").localeCompare(b.oldestArrival ?? "9999") || byName(a, b),
  };
  return [...list].sort((a, b) => exact(a) - exact(b) || cmp[s](a, b));
}

/** Brands the viewer may see, with their client, product count and stock. */
export function brandList(summaries: ProductSummary[]) {
  const m = new Map<string, { brand: string; client: string; products: number; cases: number }>();
  for (const s of summaries) {
    const b = brandOf(s.product);
    const e = m.get(b) ?? { brand: b, client: s.product.client, products: 0, cases: 0 };
    e.products++; e.cases += s.cases;
    m.set(b, e);
  }
  return [...m.values()].sort((a, b) => b.cases - a.cases || natural(a.brand, b.brand));
}

export const fmtMonth = (ym?: string) => (ym ? new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");
export const fmtDay = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
export const today = () => new Date().toISOString().slice(0, 10);
