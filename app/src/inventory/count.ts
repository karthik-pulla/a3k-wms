import { AREAS, FACES, productById, slotMeta } from "../data/catalog";
import type { CountEntry, CountSession, StockLine } from "../store/types";

export interface NavCell { code: string; x: number }
export interface NavRow { id: string; group: string; cells: NavCell[] }

const pad = (n: number) => String(n).padStart(2, "0");
export const floorBase = (group: string) => (FACES.some(f => f.id === group) ? `${group}-FLOOR` : group);
export const floorCode = (group: string, n: number) => `${floorBase(group)}-P${pad(n)}`;

/** How many floor spots to show for a rack side or area: one more than the highest in use, at least 3. */
export function floorSpots(group: string, stock: Record<string, StockLine[]>, entries: Record<string, CountEntry>): number {
  const base = `${floorBase(group)}-P`;
  let hi = 0;
  for (const code of [...Object.keys(stock), ...Object.keys(entries)]) if (code.startsWith(base)) hi = Math.max(hi, Number(code.slice(base.length)) || 0);
  return Math.max(3, hi + 1);
}

/** Rows in screen order (level 4 down to level 1, then the floor), for arrow-key movement like the count page. */
export function buildRows(scope: string[], stock: Record<string, StockLine[]>, entries: Record<string, CountEntry>): NavRow[] {
  const rows: NavRow[] = [];
  for (const f of FACES) {
    if (!scope.includes(f.id)) continue;
    let x0 = 0;
    const starts = f.cols.map(c => { const s = x0; x0 += Math.max(...c[1].map(v => v[1])) + 0.6; return s; });
    for (const lv of [4, 3, 2, 1]) {
      const cells: NavCell[] = [];
      f.cols.forEach((c, ci) => { for (const [l, b] of c[1]) if (l === lv) cells.push({ code: `${f.id}-${pad(c[0])}-L${l}-B${b}`, x: starts[ci] + b - 1 }); });
      if (cells.length) rows.push({ id: `${f.id}-L${lv}`, group: f.id, cells: cells.sort((a, b) => a.x - b.x) });
    }
    const n = floorSpots(f.id, stock, entries);
    rows.push({ id: `${f.id}-FLOOR`, group: f.id, cells: Array.from({ length: n }, (_, i) => ({ code: floorCode(f.id, i + 1), x: i * 1.6 })) });
  }
  for (const a of AREAS) {
    if (!scope.includes(a.id)) continue;
    const n = floorSpots(a.id, stock, entries);
    rows.push({ id: a.id, group: a.id, cells: Array.from({ length: n }, (_, i) => ({ code: floorCode(a.id, i + 1), x: i * 1.6 })) });
  }
  return rows;
}

export function navIndex(rows: NavRow[]) {
  const rowOf = new Map<string, number>(), xOf = new Map<string, number>();
  rows.forEach((r, i) => r.cells.forEach(c => { rowOf.set(c.code, i); xOf.set(c.code, c.x); }));
  return { rowOf, xOf };
}

export type Dir = "left" | "right" | "up" | "down" | "home" | "end";
export function nextCode(rows: NavRow[], idx: ReturnType<typeof navIndex>, code: string, dir: Dir): string | null {
  const r = idx.rowOf.get(code);
  if (r === undefined) return null;
  const row = rows[r].cells, i = row.findIndex(c => c.code === code), x = row[i].x;
  if (dir === "left") return i > 0 ? row[i - 1].code : null;
  if (dir === "right") return i < row.length - 1 ? row[i + 1].code : null;
  if (dir === "home") return row[0].code;
  if (dir === "end") return row[row.length - 1].code;
  const rr = rows[r + (dir === "up" ? -1 : 1)];
  return rr ? rr.cells.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best), rr.cells[0]).code : null;
}

/** The block of cells between two corners, on one rack side */
export function rangeBetween(rows: NavRow[], idx: ReturnType<typeof navIndex>, a: string, b: string): string[] {
  const ra = idx.rowOf.get(a), rb = idx.rowOf.get(b);
  if (ra === undefined || rb === undefined || rows[ra].group !== rows[rb].group) return [];
  const x0 = Math.min(idx.xOf.get(a)!, idx.xOf.get(b)!) - 0.01, x1 = Math.max(idx.xOf.get(a)!, idx.xOf.get(b)!) + 0.01;
  const out: string[] = [];
  for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) for (const c of rows[r].cells) if (c.x >= x0 && c.x <= x1) out.push(c.code);
  return out;
}

/** Every location a count covers (slots plus the floor spots in use), for progress. */
export function scopeTotal(scope: string[]): number {
  let n = 0;
  for (const f of FACES) if (scope.includes(f.id)) n += f.cols.reduce((a, c) => a + c[1].length, 0);
  return n;
}

const tally = (lines: { productId: string; cases: number }[]) => {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.cases);
  return m;
};

export interface Diff { code: string; expected: StockLine[]; counted: CountEntry; changes: { productId: string; was: number; is: number }[] }

/** Counted locations whose products or cases differ from the system stock. */
export function differences(session: CountSession, stock: Record<string, StockLine[]>): { diffs: Diff[]; matched: string[] } {
  const diffs: Diff[] = [], matched: string[] = [];
  for (const [code, e] of Object.entries(session.entries)) {
    const expected = stock[code] ?? [];
    const was = tally(expected), is = tally(e.lines);
    const changes = [...new Set([...was.keys(), ...is.keys()])].map(id => ({ productId: id, was: was.get(id) ?? 0, is: is.get(id) ?? 0 })).filter(c => c.was !== c.is);
    if (changes.length) diffs.push({ code, expected, counted: e, changes }); else matched.push(code);
  }
  return { diffs, matched };
}

export const linesMatch = (expected: StockLine[], e: CountEntry | undefined) => {
  if (!e) return null;
  const a = tally(expected), b = tally(e.lines);
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

export const isRackSlot = (code: string) => !!slotMeta(code);
export const productCode = (id: string) => productById(id)?.code ?? "?";
