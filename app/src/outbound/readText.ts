// Reading an order out of text (a PDF's text, an email): product codes (or names), cases, store, dates and numbers.
// Pure: the warehouse's products are passed in, so this runs in tests too (tests/order-reader.test.js). reader.ts
// wraps it with the warehouse's own product list. Everything it finds becomes a DRAFT that a person checks and
// approves; lines it can't read are listed, not guessed, and a value it isn't sure of is left empty.
//
// Shapes it knows (besides plain email lines like "24 cases 1073"):
// - A brand's sales order / packing slip: header labels with their values on a line below (DATE, SALES ORDER #, PO #,
//   SHIP TO), then a table whose rows take two lines: a line number and the full item text ending in the code
//   (`Rice:Brand:10LBS*4:1053`), then the description, weight and quantity written with decimals (`55.00`). The header
//   repeats on every page.

export interface ProductLike { id: string; client: string; code: string; name: string }
export interface Catalog<P extends ProductLike = ProductLike> {
  products: readonly P[];
  /** Products matching a few words (the app's search), best first */
  search: (query: string, client: string | undefined, limit: number) => P[];
  /** Goes up when products change, for the code cache */
  version?: number;
}

export interface ReadLine { productId: string; cases: number; raw: string; how: "code" | "name" }
export interface ReadOrder {
  lines: ReadLine[];
  unread: string[];
  store?: string;
  client?: string;
  /** When the order is due, only if the text says so */
  due?: string;
  /** The order's own date (a sales order's DATE), YYYY-MM-DD */
  date?: string;
  /** The store's PO number */
  ref?: string;
  /** The brand's sales order number */
  salesOrder?: string;
}

// ---------- Codes ----------
const cache = new WeakMap<object, { version: number; byCode: Map<string, ProductLike[]> }>();
function codesOf(c: Catalog): Map<string, ProductLike[]> {
  const v = c.version ?? 0, hit = cache.get(c.products);
  if (hit && hit.version === v) return hit.byCode;
  const byCode = new Map<string, ProductLike[]>();
  for (const p of c.products) { const k = p.code.toLowerCase(); if (k) byCode.set(k, [...(byCode.get(k) ?? []), p]); }
  cache.set(c.products, { version: v, byCode });
  return byCode;
}

/** Full item text: words joined by colons (`Rice:Brand:10LBS*4:1053`) */
const ITEM = /^[^\s:]+(?::[^\s:]*)+$/;
const isItem = (t: string) => ITEM.test(t) && /[a-z]/i.test(t) && !/\/\/|@/.test(t) && t.split(":").filter(Boolean).length >= 2;
const SIZE = /^\d+(\.\d+)?(lbs?|lb|kg|g|gms?|oz|ml|l|ltr)$/i;
/** A whole number, also written with zero decimals (`55.00`) */
const WHOLE = /^\d+(\.0+)?$/;

// ---------- Dates ----------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DATE = /^(?:(20\d{2})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}))$/;
/** A written date (2026-11-03 or 11/3/2026, month first as in the US) as YYYY-MM-DD */
function isoDate(s: string): string | undefined {
  const m = s.trim().match(DATE);
  if (!m) return undefined;
  const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6].length === 2 ? `20${m[6]}` : m[6], m[4], m[5]];
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return undefined;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** A due date written in free text (emails): a date, "Nov 12", a weekday or "tomorrow" */
function freeDue(text: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  let m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  m = t.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`));
  if (m) { const mo = MONTHS.indexOf(m[1]); const y = mo < now.getMonth() - 1 ? now.getFullYear() + 1 : now.getFullYear(); return `${y}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const day = DAYS.findIndex(d => t.includes(d));
  if (day >= 0) { const d = new Date(now); const add = ((day - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add); return ymd(d); }
  if (/\btomorrow\b/.test(t)) { const d = new Date(now); d.setDate(d.getDate() + 1); return ymd(d); }
  return undefined;
}

// ---------- Labelled values (a header label with its value beside it or on a line below, in the same column) ----------
/** The pieces of a line: a PDF's text comes with three or more spaces between columns */
const pieces = (line: string) => line.split(/\s{3,}|\t+/).map(s => s.trim()).filter(Boolean);
const LABELS = {
  salesOrder: /^(?:sales\s*order|s\.\s?o\.|so)(?![a-z])\s*(?:#|no\.?|number)?\s*:?\s*/i,
  po: /^(?:purchase\s*order|p\.\s?o\.|po)(?![a-z])\s*(?:#|no\.?|number)?\s*:?\s*/i,
  date: /^(?:order\s*|so\s*|sales\s*order\s*)?date(?![a-z])\s*:?\s*/i,
  due: /^(?:due(?:\s*date)?|deliver(?:y)?\s*(?:date|by)|need(?:ed)?\s*by|required\s*(?:by|date)|ship\s*date)(?![a-z])\s*:?\s*/i,
  shipTo: /^ship\s*to(?![a-z])\s*:?\s*/i,
};
const NUMBER = (s: string) => /^[A-Z0-9][A-Z0-9-]{0,24}$/i.test(s) && /\d/.test(s);
const NAME = (s: string) => /[a-z]{2}/i.test(s) && s.length <= 60 && !Object.values(LABELS).some(l => l.test(s));

/**
 * The value of a label: in the same piece ("PO #: 4471"), or on one of the next `ahead` lines in the label's column,
 * counted from the left or from the right (a column with an empty cell moves the others). Only a value that looks
 * right is taken; otherwise nothing.
 */
function labelled(lines: readonly string[], label: RegExp, ok: (s: string) => boolean, ahead: number): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const ps = pieces(lines[i]);
    for (let j = 0; j < ps.length; j++) {
      const m = ps[j].match(label);
      if (!m) continue;
      const rest = ps[j].slice(m[0].length).trim();
      if (rest) { if (ok(rest)) return rest; continue; }
      for (let k = 1; k <= ahead && i + k < lines.length; k++) {
        const below = pieces(lines[i + k]);
        for (const v of [below[j], below[below.length - (ps.length - j)]]) if (v !== undefined && ok(v)) return v;
      }
    }
  }
  return undefined;
}

/** Reads order lines and details from text. knownStores lets it recognise a store it has seen before. */
export function readOrderText<P extends ProductLike>(text: string, catalog: Catalog<P>, knownStores: string[] = [], clientHint?: string, now = new Date()): ReadOrder {
  const byCode = codesOf(catalog);
  const all = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // A table header ("# DESCRIPTION … QTY") marks a structured document: only lines in its table can be "unread", and
  // a header repeated on the next page (the same lines as before the first table) is skipped
  const isHead = (l: string) => /\b(description|item|product)s?\b/i.test(l) && /\b(qty|quantity|cases|ordered)\b/i.test(l) && !/\d/.test(l.replace(/#/g, ""));
  const firstHead = all.findIndex(isHead);
  const preamble = new Set(firstHead > 0 ? all.slice(0, firstHead) : []);
  let inTable = firstHead < 0;

  // Rows: a line holding only a line number and the item text, joined with the line after it (description, quantity)
  const itemOnly = (l: string) => { const t = l.split(/\s+/); const rest = t.filter((x, i) => !isItem(x) && !(i === 0 && /^\d{1,3}$/.test(x))); return t.some(isItem) && !rest.some(x => /\d/.test(x)); };
  const rows: { raw: string; table: boolean }[] = [];
  for (let i = 0; i < all.length; i++) {
    const l = all[i];
    if (isHead(l)) { inTable = true; continue; }
    if (preamble.has(l)) inTable = false;
    const next = all[i + 1];
    if (itemOnly(l) && next !== undefined && !isHead(next) && !itemOnly(next) && !next.split(/\s+/).some(isItem) && /\d/.test(next)) {
      rows.push({ raw: `${l}   ${next}`, table: inTable });
      i++;
    } else rows.push({ raw: l, table: inTable });
  }

  const unread: string[] = [];
  const candidates: { raw: string; products: P[]; cases: number; how: "code" | "name" }[] = [];
  for (const { raw, table } of rows) {
    const tokens = raw.replace(/[,;|]/g, " ").split(/\s+/);
    let products: P[] = [], codeTok = -1;
    tokens.forEach((t, i) => {
      if (products.length) return;
      const k = t.replace(/^[#(]+|[):.]+$/g, "").toLowerCase();
      if (byCode.has(k) && !/^\d{1,2}$/.test(k)) { products = byCode.get(k)! as P[]; codeTok = i; return; }
      // The code inside full item text: the last part that is a code (the item's own wording may differ from the list's)
      if (isItem(t)) {
        const parts = t.toLowerCase().split(":").filter(Boolean);
        for (let p = parts.length - 1; p >= 0; p--) if (/\d/.test(parts[p]) && !/^\d{1,2}$/.test(parts[p]) && byCode.has(parts[p])) { products = byCode.get(parts[p])! as P[]; codeTok = i; return; }
      }
    });
    // A line number before the item text is never the quantity
    const lineNo = /^\d{1,3}$/.test(tokens[0] ?? "") && tokens.length > 1 && isItem(tokens[1]) ? 0 : -1;
    // Cases: "24 cases", "qty 24", "x 24", else the last whole number that isn't the code, a size (10lb), a pack (x4) or the line number
    let cases: number | null = null;
    const m = raw.match(/(\d+)\s*(?:cs|cases?|ctns?|cartons?|boxes)\b/i) ?? raw.match(/\b(?:qty|quantity)\s*[:=]?\s*(\d+)/i);
    if (m) cases = Number(m[1]);
    else {
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i].replace(/[^\w.]/g, "").replace(/\.$/, "");
        // A fractional number at the end (2.50) is a quantity that can't be cases: stop rather than take the weight before it
        if (i !== codeTok && i !== lineNo && /^\d+\.\d+$/.test(t) && !WHOLE.test(t)) break;
        if (i === codeTok || i === lineNo || !WHOLE.test(t) || SIZE.test(tokens[i]) || /x\d+$/i.test(tokens[i]) || /^[x*]/i.test(tokens[i]) || SIZE.test(t + (tokens[i + 1] ?? ""))) continue;
        cases = parseInt(t, 10); break;
      }
    }
    let how: "code" | "name" = "code";
    if (!products.length && cases !== null) {
      // No code: try the product name, accepting it only if most of its words are in the line
      const words = raw.replace(/\d+(\.\d+)?\s*(lbs?|kg|g|gms|oz|ml)?/gi, " ").replace(/[^\w\s]/g, " ")
        .replace(/\b(lbs?|kg|gms?|oz|ml|x|cs|cases?|ctns?|cartons?|boxes|qty|quantity|pcs|units?)\b/gi, " ").replace(/\s+/g, " ").trim();
      const best = words.length > 3 ? catalog.search(words.split(/\s+/).slice(0, 4).join(" "), clientHint, 1)[0] : undefined;
      if (best) {
        const nameWords = best.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const hit = nameWords.filter(w => raw.toLowerCase().includes(w)).length;
        if (hit >= Math.min(2, nameWords.length) && hit / nameWords.length >= 0.6) { products = [best]; how = "name"; }
      }
    }
    if (products.length && cases && cases > 0 && cases < 10000) candidates.push({ raw, products, cases, how });
    else if (table && /\d/.test(raw) && /[a-z]{3,}/i.test(raw) && !/(po|p\.o\.|order|invoice|phone|tel|fax|date|deliver|ship|total|page)\b/i.test(raw) && !unread.includes(raw)) unread.push(raw);
  }

  // The client most lines point to decides between products that share a code
  const votes = new Map<string, number>();
  for (const c of candidates) for (const p of c.products) votes.set(p.client, (votes.get(p.client) ?? 0) + 1 / c.products.length);
  const client = clientHint ?? [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  const lines = candidates.map(c => {
    const p = c.products.find(x => x.client === client) ?? c.products[0];
    return { productId: p.id, cases: c.cases, raw: c.raw, how: c.how };
  });

  // Header details
  const head = firstHead > 0 ? all.slice(0, firstHead) : all;
  const salesOrder = labelled(head, LABELS.salesOrder, NUMBER, 3);
  const dateRaw = labelled(head, LABELS.date, s => !!isoDate(s), 3);
  const dueRaw = labelled(head, LABELS.due, s => !!isoDate(s), 3);
  // A structured document's due date is only a labelled one; free text (an email) may say it any way
  const due = dueRaw ? isoDate(dueRaw) : firstHead < 0 ? freeDue(text, now) : undefined;
  const ref = labelled(head, LABELS.po, NUMBER, 3)
    ?? text.match(/\b(?:PO|P\.O\.)[ \t]{0,2}(?:#|No\.?|Number)?[ \t]{0,2}[:-]?[ \t]{0,2}([A-Z0-9-]*\d[A-Z0-9-]*)\b/i)?.[1];
  const shipTo = labelled(head, LABELS.shipTo, NAME, 1);
  const lower = text.toLowerCase();
  const known = (name: string) => knownStores.find(s => s.toLowerCase() === name.toLowerCase());
  const store = (shipTo && (known(shipTo) ?? shipTo))
    ?? knownStores.find(s => lower.includes(s.toLowerCase()))
    ?? knownStores.find(s => { const w = s.toLowerCase().split(/[\s–-]+/).filter(x => x.length > 3); return w.length > 0 && w.every(x => lower.includes(x)); });
  return { lines, unread, store, client, due, date: dateRaw ? isoDate(dateRaw) : undefined, ref: ref && ref.length >= 3 ? ref : undefined, salesOrder };
}
