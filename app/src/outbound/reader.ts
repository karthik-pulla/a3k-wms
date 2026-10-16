// Reads an order from a PDF or an email: product codes (or names), cases, store, due date and PO number.
// Everything it finds becomes a DRAFT that a person checks and approves; lines it can't read are listed, not guessed.
import { PRODUCTS, productsVersion, searchProducts, type Client, type Product } from "../data/catalog";

export interface ReadLine { productId: string; cases: number; raw: string; how: "code" | "name" }
export interface ReadOrder { lines: ReadLine[]; unread: string[]; store?: string; client?: Client; due?: string; ref?: string }

/** Text of a PDF, line by line (pdf.js, bundled; loaded only when a PDF is opened). Scanned PDFs have no text. */
export async function pdfText(file: File): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Group the text pieces into lines by their height on the page, then left to right
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3, x = it.transform[4];
      rows.set(y, [...(rows.get(y) ?? []), { x, s: it.str }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map(p => p.s).join("   ").replace(/\s{4,}/g, "   "));
  }
  return { text: out.join("\n"), pages: doc.numPages };
}

// Products by code, made again after a product is edited
let byCode: Map<string, Product[]> | null = null, byCodeVersion = -1;
function codes() {
  if (byCode && byCodeVersion === productsVersion()) return byCode;
  byCode = new Map();
  for (const p of PRODUCTS) { const k = p.code.toLowerCase(); if (k) byCode.set(k, [...(byCode.get(k) ?? []), p]); }
  byCodeVersion = productsVersion();
  return byCode;
}
const SIZE = /^\d+(\.\d+)?(lbs?|lb|kg|g|gms?|oz|ml|l)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function findDue(text: string): string | undefined {
  const t = text.toLowerCase();
  let m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  m = t.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`));
  if (m) { const d = new Date(); const mo = MONTHS.indexOf(m[1]); const y = mo < d.getMonth() - 1 ? d.getFullYear() + 1 : d.getFullYear(); return `${y}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const day = DAYS.findIndex(d => t.includes(d));
  if (day >= 0) { const d = new Date(); const add = ((day - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add); return ymd(d); }
  if (/\btomorrow\b/.test(t)) { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); }
  return undefined;
}

/** Reads order lines and details from text. knownStores lets it recognise the store. */
export function readOrder(text: string, knownStores: string[] = [], clientHint?: Client): ReadOrder {
  const found: ReadLine[] = [], unread: string[] = [];
  const candidates: { raw: string; products: Product[]; cases: number | null; how: "code" | "name" }[] = [];
  for (const raw of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const tokens = raw.replace(/[,;|]/g, " ").split(/\s+/);
    let products: Product[] = [], codeTok = -1;
    tokens.forEach((t, i) => { const k = t.replace(/^[#(]+|[):.]+$/g, "").toLowerCase(); if (!products.length && codes().has(k) && !/^\d{1,2}$/.test(k)) { products = codes().get(k)!; codeTok = i; } });
    // Cases: "24 cases", "qty 24", "x 24", else the last plain number that isn't the code, a size (10lb) or a pack (x4)
    let cases: number | null = null;
    const m = raw.match(/(\d+)\s*(?:cs|cases?|ctns?|cartons?|boxes)\b/i) ?? raw.match(/\b(?:qty|quantity)\s*[:=]?\s*(\d+)/i);
    if (m) cases = Number(m[1]);
    else {
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i].replace(/[^\w.]/g, "");
        if (i === codeTok || !/^\d+$/.test(t) || SIZE.test(tokens[i]) || /x\d+$/i.test(tokens[i]) || /^[x*]/i.test(tokens[i]) || SIZE.test(t + (tokens[i + 1] ?? ""))) continue;
        cases = Number(t); break;
      }
    }
    let how: "code" | "name" = "code";
    if (!products.length && cases !== null) {
      // No code: try the product name, accepting it only if most of its words are in the line
      const words = raw.replace(/\d+(\.\d+)?\s*(lbs?|kg|g|gms|oz|ml)?/gi, " ").replace(/[^\w\s]/g, " ")
        .replace(/\b(lbs?|kg|gms?|oz|ml|x|cs|cases?|ctns?|cartons?|boxes|qty|quantity|pcs|units?)\b/gi, " ").replace(/\s+/g, " ").trim();
      const best = words.length > 3 ? searchProducts(words.split(/\s+/).slice(0, 4).join(" "), clientHint, 1)[0] : undefined;
      if (best) {
        const nameWords = best.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const hit = nameWords.filter(w => raw.toLowerCase().includes(w)).length;
        if (hit >= Math.min(2, nameWords.length) && hit / nameWords.length >= 0.6) { products = [best]; how = "name"; }
      }
    }
    if (products.length && cases && cases > 0 && cases < 10000) candidates.push({ raw, products, cases, how });
    else if (/\d/.test(raw) && /[a-z]{3,}/i.test(raw) && !/(po|p\.o\.|order|invoice|phone|tel|fax|date|deliver|ship|total|page)\b/i.test(raw)) unread.push(raw);
  }
  // The client most lines point to decides between products that share a code
  const votes = new Map<Client, number>();
  for (const c of candidates) for (const p of c.products) votes.set(p.client, (votes.get(p.client) ?? 0) + 1 / c.products.length);
  const client = clientHint ?? [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const c of candidates) {
    const p = c.products.find(x => x.client === client) ?? c.products[0];
    found.push({ productId: p.id, cases: c.cases!, raw: c.raw, how: c.how });
  }
  const lower = text.toLowerCase();
  const store = knownStores.find(s => lower.includes(s.toLowerCase()))
    ?? knownStores.find(s => { const w = s.toLowerCase().split(/[\s–-]+/).filter(x => x.length > 3); return w.length > 0 && w.every(x => lower.includes(x)); });
  const ref = text.match(/\b(?:PO|P\.O\.)\s*(?:#|No\.?|Number)?\s*[:-]?\s*([A-Z0-9][A-Z0-9-]{2,})/i)?.[1];
  return { lines: found, unread, store, client, due: findDue(text), ref };
}
