// Case labels as a PDF, drawn exactly like the Order Label Maker: US Letter, 10 labels of 3 × 2 in (2 across, 5 down),
// left margin 30.1625 mm, top 6.35 mm, 3.175 mm gaps (measured from the label sheet and confirmed by a print).
// Print at Actual size (100%). jsPDF is bundled and loaded only when labels are made.
import logos from "../data/generated/labelLogos.json";
import type { jsPDF } from "jspdf";

export const SHEET = { w: 215.9, h: 279.4, left: 30.1625, top: 6.35, lw: 76.2, lh: 50.8, gap: 3.175, cols: 2, rows: 5 };

type Logo = { src: string; w: number; h: number };
export type BrandKey = "deccan" | "milletbank" | "other";
export const BRANDS: Record<BrandKey, { name: string; logo: Logo | null; color: [number, number, number]; footer: string }> = {
  milletbank: { name: "Millet Bank", logo: (logos as Record<string, Logo>).milletbank, color: [75, 93, 39], footer: "" },
  deccan: { name: "Deccan", logo: (logos as Record<string, Logo>).deccan, color: [155, 28, 35], footer: "Product of India\nDistributed By: Deccan Foods, USA" },
  other: { name: "No logo", logo: null, color: [61, 79, 99], footer: "" },
};
/** Which logo a product's labels get: by brand (Deccan, Millet Bank), otherwise none */
export const brandKeyFor = (brand: string): BrandKey => (/^deccan$/i.test(brand) ? "deccan" : /millet bank/i.test(brand) ? "milletbank" : "other");

export interface LabelLine { key: string; productId: string | null; name: string; size: string; units: string; labels: number; group: string; code: string; brand: BrandKey; bestBefore?: string }
export interface LabelOptions {
  unitsMode: "print" | "blank";
  showGroup: boolean;
  showCode: boolean;
  /** off: none; stock: each line's best-before (from the pallet it's picked from); custom: the same text on every label */
  bbMode: "off" | "stock" | "custom";
  bbText: string;
  footers: Partial<Record<BrandKey, string>>;
  nudge: { x: number; y: number };
  /** First label position on the first sheet (1–10), for part-used sheets */
  start: number;
}
export const DEFAULT_OPTIONS: LabelOptions = { unitsMode: "print", showGroup: true, showCode: false, bbMode: "stock", bbText: "", footers: {}, nudge: { x: 0, y: 0 }, start: 1 };

const PT = 0.3528; // mm per point
const footerFor = (o: LabelOptions, b: BrandKey) => o.footers[b] ?? BRANDS[b].footer;
const bbLabel = (ym?: string) => (ym && /^\d{4}-\d{2}/.test(ym) ? new Date(`${ym.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase() : ym ?? "");

function slotXY(i: number, o: LabelOptions) {
  const c = i % SHEET.cols, r = Math.floor(i / SHEET.cols) % SHEET.rows;
  return { x: SHEET.left + o.nudge.x + c * (SHEET.lw + SHEET.gap), y: SHEET.top + o.nudge.y + r * (SHEET.lh + SHEET.gap) };
}

type Seg = string | { blank: number };
type Row = { img: Logo; h: number; w: number } | { segs: Seg[]; pt: number; bold: boolean; color?: [number, number, number]; h: number };

// Lay out one label's rows, shrinking everything until it fits inside the label
function layout(doc: jsPDF, l: LabelLine, o: LabelOptions) {
  const b = BRANDS[l.brand], maxW = SHEET.lw - 9, maxH = SHEET.lh - 6.5;
  const units = parseInt(l.units) || 0, size = (l.size || "").trim().toUpperCase();
  const printUnits = o.unitsMode === "print" && units > 0;
  const pack = size ? (printUnits ? `${size} × ${units}` : size) : (printUnits ? `${units} UNITS` : "");
  let last: { rows: Row[]; total: number; gap: number } | null = null;
  for (let step = 0; step <= 12; step++) {
    const s = 1 - step * 0.04, rows: Row[] = [];
    const text = (segs: Seg[], pt: number, bold: boolean, color?: [number, number, number]) => rows.push({ segs, pt: pt * s, bold, color, h: pt * s * PT * 1.18 });
    if (b.logo) { const h = 11.5 * s; rows.push({ img: b.logo, h, w: h * b.logo.w / b.logo.h }); }
    if (o.showGroup && l.group) text([l.group.toUpperCase()], 7, true, b.color);
    doc.setFont("helvetica", "bold");
    let namePt = 12.5, nameLines: string[] = [];
    for (; namePt >= 9; namePt -= 0.5) { doc.setFontSize(namePt * s); nameLines = doc.splitTextToSize((l.name || "").toUpperCase(), maxW); if (nameLines.length <= 2) break; }
    nameLines.slice(0, 3).forEach(n => text([n], namePt, true));
    if (pack) text([pack], 14, true);
    if (o.unitsMode === "blank") text(["Units per case: ", { blank: 18 * s }], 9, false);
    else if (printUnits) text([`${units} units per case`], 9, false);
    const meta: Seg[] = [];
    const bb = o.bbMode === "custom" ? o.bbText.trim().toUpperCase() : o.bbMode === "stock" ? bbLabel(l.bestBefore) : "";
    if (o.bbMode !== "off") { meta.push("BEST BEFORE: "); meta.push(bb || { blank: 16 * s }); }
    if (o.showCode && l.code) { if (meta.length) meta.push("    "); meta.push(`ITEM CODE: ${l.code}`); }
    if (meta.length) text(meta, 8, false);
    for (const f of footerFor(o, l.brand).split("\n").map(x => x.trim()).filter(Boolean)) text([f], 8, false);
    const gap = 1.05 * s, total = rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1);
    last = { rows, total, gap };
    if (total <= maxH) return last;
  }
  return last!; // smallest size tried, even if still tight
}

function drawLabel(doc: jsPDF, l: LabelLine, o: LabelOptions, x: number, y: number) {
  const { rows, total, gap } = layout(doc, l, o);
  const cx = x + SHEET.lw / 2;
  let cy = y + (SHEET.lh - total) / 2;
  for (const r of rows) {
    if ("img" in r) doc.addImage(r.img.src, "PNG", cx - r.w / 2, cy, r.w, r.h, `${l.brand}-logo`, "FAST");
    else {
      doc.setFont("helvetica", r.bold ? "bold" : "normal"); doc.setFontSize(r.pt);
      doc.setTextColor(...(r.color ?? [20, 20, 20])); doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.25);
      const widths = r.segs.map(sg => (typeof sg === "string" ? doc.getTextWidth(sg) : sg.blank));
      let sx = cx - widths.reduce((a, w) => a + w, 0) / 2;
      r.segs.forEach((sg, i) => {
        if (typeof sg === "string") doc.text(sg, sx, cy, { baseline: "top" });
        else doc.line(sx, cy + r.h * 0.8, sx + sg.blank, cy + r.h * 0.8);
        sx += widths[i];
      });
    }
    cy += r.h + gap;
  }
}

/** One label per case: each line repeated `labels` times */
export const labelCount = (lines: LabelLine[]) => lines.reduce((a, l) => a + Math.min(500, Math.max(0, l.labels || 0)), 0);
export const sheetCount = (lines: LabelLine[], start: number) => Math.ceil((labelCount(lines) + start - 1) / 10);

export async function buildLabelsPdf(lines: LabelLine[], o: LabelOptions, title: string): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  doc.setProperties({ title });
  let slot = o.start - 1, first = true;
  for (const l of lines) for (let i = 0; i < Math.min(500, Math.max(0, l.labels || 0)); i++) {
    if (!first && slot % 10 === 0) doc.addPage("letter", "portrait");
    first = false;
    const { x, y } = slotXY(slot % 10, o);
    drawLabel(doc, l, o, x, y);
    slot++;
  }
  return doc;
}

/** A plain-paper page with the 10 label outlines, to check the printer lines up with the sheet */
export async function buildAlignmentPdf(o: LabelOptions): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  doc.setProperties({ title: "Label alignment test" });
  doc.setLineDashPattern([1.5, 1.5], 0); doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
  for (let i = 0; i < 10; i++) {
    const { x, y } = slotXY(i, o);
    doc.rect(x, y, SHEET.lw, SHEET.lh);
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(150, 150, 150);
    doc.text(String(i + 1), x + SHEET.lw / 2, y + SHEET.lh / 2 - 2, { align: "center", baseline: "middle" });
    if (i === 0) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(["Print on plain paper at Actual size (100%).", "Hold against a label sheet: each box should sit on a label."], x + SHEET.lw / 2, y + SHEET.lh / 2 + 6, { align: "center", baseline: "top" }); }
  }
  return doc;
}

/** Renders a PDF's pages to images for the on-screen preview (what you see is what prints) */
export async function pdfPreview(data: ArrayBuffer, maxPages = 4): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    out.push(canvas.toDataURL("image/png"));
  }
  return out;
}
