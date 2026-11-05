// Reads an order from a PDF or an email: product codes (or names), cases, store, dates and numbers (readText.ts),
// with this warehouse's own product list. Everything it finds becomes a DRAFT that a person checks and approves.
import { PRODUCTS, productsVersion, searchProducts, type Client } from "../data/catalog";
import { readOrderText, type ReadOrder } from "./readText";

export type { ReadLine, ReadOrder } from "./readText";

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

/** Reads order lines and details from text. knownStores lets it recognise a store it has seen before. */
export function readOrder(text: string, knownStores: string[] = [], clientHint?: Client): ReadOrder {
  return readOrderText(text, { products: PRODUCTS, search: searchProducts, version: productsVersion() }, knownStores, clientHint);
}
