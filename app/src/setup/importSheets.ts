// The setup template (.xlsx) and reading it back: a warehouse's products and its opening stock, as filled in on a
// site visit. Pure functions: the warehouse's clients, products and location codes are passed in (so this runs in
// tests too). Problems are listed by row, in plain words; nothing is imported until every row is fine.
import type { Sheet } from "../utils/xlsx.ts";
import { excelDate, type ReadSheet } from "../utils/xlsxRead.ts";

export interface ProductIn { client: string; brand: string; code: string; name: string; cat: string; size: string; units: string; perPallet: string; item: string }
export interface StockIn { location: string; productId: string; cases: number; lot?: string; bestBefore?: string; arrived?: string }
export interface KnownProduct { id: string; client: string; code: string; name: string; item: string | null }
export interface Problem { sheet: string; row: number; text: string }

export const PRODUCT_COLUMNS = ["Client", "Brand", "Code", "Name", "Category", "Size", "Units per case", "Cases per pallet", "Full description"] as const;
export const STOCK_COLUMNS = ["Location", "Product", "Client", "Cases", "Lot", "Best before", "Arrived"] as const;

/** The template to fill in: products, opening stock, and how to fill them in */
export function templateSheets(opts: { clients: string[]; exampleSlot: string; exampleFloor: string }): Sheet[] {
  const client = opts.clients[0] ?? "Client";
  return [
    {
      name: "Products", header: [...PRODUCT_COLUMNS], widths: [14, 14, 10, 30, 14, 10, 10, 10, 44],
      rows: [[client, client, "1073", "Surti Kolam Rice", "Rice", "10 LBS", 4, 60, `Rice:${client}:10LBS*4:1073:SurtiKolam`]],
    },
    {
      name: "Opening stock", header: [...STOCK_COLUMNS], widths: [18, 44, 14, 8, 12, 12, 12],
      rows: [
        [opts.exampleSlot, `Rice:${client}:10LBS*4:1073:SurtiKolam`, client, 40, "L2209", "2027-04", "2026-09-27"],
        [opts.exampleFloor, "1073", client, 12, "", "", ""],
      ],
    },
    {
      name: "How to fill this in", header: ["Column", "What goes in it"], widths: [20, 100],
      rows: [
        ["Products", "One row per product. Replace the example row."],
        ["Client", `Who owns the stock: one of ${opts.clients.join(", ") || "this warehouse's clients (set up first)"}.`],
        ["Code", "The short code people use (e.g. 1073). Two products may share one (a BOGO pack); the full description tells them apart."],
        ["Full description", "The product's full item text, as on the stock sheets and labels. Must be different for every product of a client."],
        ["Units per case / Cases per pallet", "Whole numbers; leave empty if you don't know yet."],
        ["Opening stock", "One row per product on each pallet: a mixed pallet is several rows with the same location."],
        ["Location", `A slot like ${opts.exampleSlot} or a floor spot like ${opts.exampleFloor}, in this warehouse's own codes.`],
        ["Product", "The full description (best) or the code. A code that more than one product uses needs the full description."],
        ["Cases", "How many cases of that product are there."],
        ["Best before / Arrived", "Best before as a month (2027-04); arrived as a date (2026-09-27). Arrived decides which stock is picked first; empty = the day of the import."],
      ],
    },
  ];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Column positions by header name (any case and spacing); rows before the header are skipped */
function columns(sheet: ReadSheet, names: readonly string[]): { at: Map<string, number>; start: number } | null {
  for (let i = 0; i < Math.min(sheet.rows.length, 10); i++) {
    const row = sheet.rows[i].map(norm);
    const at = new Map<string, number>();
    for (const n of names) { const j = row.indexOf(norm(n)); if (j >= 0) at.set(n, j); }
    if (at.size >= 2) return { at, start: i + 1 };
  }
  return null;
}
const find = (sheets: ReadSheet[], words: string[]) => sheets.find(s => words.some(w => norm(s.name).includes(w)));

/** The products sheet as rows to import, or what's wrong with it */
export function readProducts(sheets: ReadSheet[], clients: string[]): { products: ProductIn[]; problems: Problem[] } {
  const sheet = find(sheets, ["product"]);
  if (!sheet) return { products: [], problems: [] };
  const cols = columns(sheet, PRODUCT_COLUMNS);
  if (!cols) return { products: [], problems: [{ sheet: sheet.name, row: 1, text: `No header row: the columns should be ${PRODUCT_COLUMNS.join(", ")}` }] };
  const get = (r: string[], c: string) => (cols.at.has(c) ? r[cols.at.get(c)!] ?? "" : "").trim();
  const products: ProductIn[] = [], problems: Problem[] = [];
  const seen = new Map<string, number>();
  const clientOf = new Map(clients.map(c => [c.toLowerCase(), c]));
  sheet.rows.slice(cols.start).forEach((r, i) => {
    const row = cols.start + i + 1;
    if (!r.some(Boolean)) return;
    const p: ProductIn = { client: get(r, "Client"), brand: get(r, "Brand"), code: get(r, "Code"), name: get(r, "Name"), cat: get(r, "Category"), size: get(r, "Size"), units: get(r, "Units per case"), perPallet: get(r, "Cases per pallet"), item: get(r, "Full description") };
    const bad = (text: string) => problems.push({ sheet: sheet.name, row, text });
    const client = clientOf.get(p.client.toLowerCase());
    if (!p.client) bad("No client");
    else if (!client) bad(`"${p.client}" isn't one of this warehouse's clients (${clients.join(", ")})`);
    else p.client = client;
    if (!p.name) bad("No name");
    p.item ||= p.name;
    for (const [c, v] of [["Units per case", p.units], ["Cases per pallet", p.perPallet]] as const) if (v && !/^\d+$/.test(v)) bad(`${c} must be a whole number (it's "${v}")`);
    const key = `${p.client}\u0000${p.item.toLowerCase()}`;
    if (seen.has(key)) bad(`Same full description as row ${seen.get(key)}: "${p.item}"`);
    else seen.set(key, row);
    products.push(p);
  });
  return { products, problems };
}

/**
 * The opening stock sheet as lines to load. `normalize` turns a typed location into this warehouse's code (or null);
 * products are matched by full description, then by code (within the client if one is given).
 */
export function readStock(sheets: ReadSheet[], ctx: { products: KnownProduct[]; normalize: (code: string) => string | null; today: string }): { lines: StockIn[]; problems: Problem[] } {
  const sheet = find(sheets, ["stock", "opening", "count"]);
  if (!sheet) return { lines: [], problems: [] };
  const cols = columns(sheet, STOCK_COLUMNS);
  if (!cols) return { lines: [], problems: [{ sheet: sheet.name, row: 1, text: `No header row: the columns should be ${STOCK_COLUMNS.join(", ")}` }] };
  const get = (r: string[], c: string) => (cols.at.has(c) ? r[cols.at.get(c)!] ?? "" : "").trim();
  const byItem = new Map<string, KnownProduct[]>(), byCode = new Map<string, KnownProduct[]>();
  for (const p of ctx.products) {
    if (p.item) byItem.set(p.item.toLowerCase(), [...(byItem.get(p.item.toLowerCase()) ?? []), p]);
    if (p.code) byCode.set(p.code.toLowerCase(), [...(byCode.get(p.code.toLowerCase()) ?? []), p]);
  }
  const lines: StockIn[] = [], problems: Problem[] = [];
  sheet.rows.slice(cols.start).forEach((r, i) => {
    const row = cols.start + i + 1;
    if (!r.some(Boolean)) return;
    const bad = (text: string) => problems.push({ sheet: sheet.name, row, text });
    const typed = get(r, "Location"), location = typed ? ctx.normalize(typed) : null;
    if (!typed) bad("No location"); else if (!location) bad(`"${typed}" isn't a slot, floor spot or area of this warehouse`);
    const what = get(r, "Product"), client = get(r, "Client").toLowerCase();
    const within = (list: KnownProduct[] = []) => (client ? list.filter(p => p.client.toLowerCase() === client) : list);
    const hits = within(byItem.get(what.toLowerCase())).length ? within(byItem.get(what.toLowerCase())) : within(byCode.get(what.toLowerCase()));
    if (!what) bad("No product");
    else if (!hits.length) bad(`No product "${what}"${client ? ` for ${get(r, "Client")}` : ""}`);
    else if (hits.length > 1) bad(`"${what}" is the code of ${hits.length} products: write the full description instead`);
    const casesText = get(r, "Cases"), cases = Number(casesText);
    if (!/^\d+$/.test(casesText) || cases < 1) bad(`Cases must be a whole number above 0 (it's "${casesText}")`);
    const bbRaw = excelDate(get(r, "Best before")), arrivedRaw = excelDate(get(r, "Arrived"));
    const bb = /^\d{4}-\d{2}(-\d{2})?$/.test(bbRaw) ? bbRaw.slice(0, 7) : /^\d{1,2}\/\d{4}$/.test(bbRaw) ? `${bbRaw.split("/")[1]}-${bbRaw.split("/")[0].padStart(2, "0")}` : "";
    if (bbRaw && !bb) bad(`Best before must be a month like 2027-04 (it's "${bbRaw}")`);
    if (arrivedRaw && !/^\d{4}-\d{2}-\d{2}$/.test(arrivedRaw)) bad(`Arrived must be a date like 2026-09-27 (it's "${arrivedRaw}")`);
    if (location && hits.length === 1 && cases >= 1) lines.push({
      location, productId: hits[0].id, cases, ...(get(r, "Lot") ? { lot: get(r, "Lot") } : {}), ...(bb ? { bestBefore: bb } : {}),
      arrived: /^\d{4}-\d{2}-\d{2}$/.test(arrivedRaw) ? arrivedRaw : ctx.today,
    });
  });
  return { lines, problems };
}
