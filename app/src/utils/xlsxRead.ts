// Reads the sheets of an .xlsx file as rows of text (for imports), without a spreadsheet library or any outside
// request. An .xlsx is a zip of XML files; the browser's own DecompressionStream unpacks them. Reads what Excel,
// Numbers, Google Sheets and this app (utils/xlsx.ts) write: shared and inline strings, numbers, true/false.
// Dates come out as Excel's day numbers; excelDate() turns one into YYYY-MM-DD.

export interface ReadSheet { name: string; rows: string[][] }

const dec = new TextDecoder();

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip, by name (only the ones asked for are unpacked) */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const b = new Uint8Array(buf), v = new DataView(buf);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("This isn't an .xlsx file (or it's damaged).");
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("This .xlsx file is damaged.");
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error("This .xlsx file uses a kind of packing the WMS can't read. Save it again from Excel.");
    out.set(name, dec.decode(method === 8 ? await inflate(raw) : raw));
  }
  return out;
}

const entity = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]);
/** All the text of the <t> pieces inside (rich text has several) */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => entity(m[1])).join("");
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Every sheet in the workbook, in order, as rows of text (empty cells are "") */
export async function readXlsx(buf: ArrayBuffer): Promise<ReadSheet[]> {
  const files = await unzip(buf, n => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wb = files.get("xl/workbook.xml");
  if (!wb) throw new Error("This isn't an .xlsx workbook.");
  const rels = new Map([...(files.get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], "Id") ?? "", (attr(m[0], "Target") ?? "").replace(/^\/?xl\//, "")]));
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => {
    const name = entity(attr(m[0], "name") ?? "Sheet");
    const target = rels.get(attr(m[0], "r:id") ?? "") ?? "";
    const xml = files.get(`xl/${target}`) ?? "";
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const at = Number(attr(r[1] ?? r[3] ?? "", "r") ?? rows.length + 1) - 1;
      const cells: string[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r"), type = attr(c[1], "t"), body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? texts(body) : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v !== undefined ? entity(v) : "";
        cells[ref ? colIndex(ref) : cells.length] = value;
      }
      rows[at] = Array.from(cells, x => (x ?? "").trim());
    }
    return { name, rows: Array.from(rows, x => x ?? []) };
  });
}

/** An Excel day number (1900 date system) as YYYY-MM-DD; text that already looks like a date stays as it is */
export function excelDate(v: string): string {
  if (!/^\d+(\.\d+)?$/.test(v) || Number(v) < 20_000 || Number(v) > 80_000) return v;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 864e5).toISOString().slice(0, 10);
}
