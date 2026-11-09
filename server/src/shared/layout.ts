// A warehouse's slots and location codes, worked out from its layout config. The only place codes are built or read:
// nothing else in the app should know that A3K writes "06B-08-L3-B1". No imports, so tests and the server run it too
// (the server checks that a layout change never strands stock). The app reaches it as app/src/tenant/layout.ts.

/** One kind of column: which levels it has (L1 is the bottom beam) and how many bays (pallets side by side) per level. */
export interface ColumnShape { levels: number[]; bays: number }

export interface RackConfig {
  /** As people say it: "6", "0", "D6", "1518". Numbers up to `codeFormat.rackDigits` digits are zero-padded in codes ("06") */
  id: string;
  /** Shown in place of "Rack 06", e.g. "Door 6", "Junction 15/18" */
  name?: string;
  /** Each letter is one side of the rack, e.g. "AB" */
  sides: string;
  columns: number;
  /** Column shape for every column (default: layout.defaultShape) */
  shape?: string;
  /** Columns with another shape, by column number, e.g. { "12": "top" } */
  columnShapes?: Record<string, string>;
  /** A small rack bridging two others (shown apart on maps) */
  junction?: boolean;
}

export interface AreaConfig { id: string; name: string }

export interface LayoutConfig {
  codeFormat: {
    /** Tokens: {face} (rack + side), {col}, {level}, {bay} */
    slot: string;
    /** A floor spot in front of a rack side. Tokens: {face}, {n} */
    floor: string;
    /** A spot in a named floor area; must start with {area}. The area's ID alone is also a valid location. Tokens: {area}, {n} */
    areaSpot: string;
    /** Rack numbers with at most this many digits are zero-padded to it ("6" → "06") */
    rackDigits: number;
    colDigits: number;
    spotDigits: number;
    /** Also read codes typed without the padding ("6B-8-L3-B1") */
    acceptUnpadded: boolean;
  };
  shapes: Record<string, ColumnShape>;
  defaultShape: string;
  /** In the order they're shown and walked */
  racks: RackConfig[];
  /** Floor areas with no racks (coolers, lanes, the receiving floor) */
  areas: AreaConfig[];
  /** Where delivered pallets wait before put-away (an area ID) */
  receivingArea: string;
}


export interface Face {
  id: string;
  rack: string;
  side: string;
  junction?: boolean;
  /** [column, [[level, bay], …]] */
  cols: [number, [number, number][]][];
}
export interface SlotMeta { code: string; face: string; rack: string; side: string; col: number; level: number; bay: number }
export type LocKind = "slot" | "floor" | "area";

const pad = (n: number | string, digits: number) => String(n).padStart(digits, "0");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alts = (ids: string[]) => [...ids].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escape).join("|");

/** Fills a code template: "{face}-{col}-L{level}-B{bay}" with { face: "06B", col: "08", … } */
const fill = (tpl: string, v: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));

/** A template as a regex source, each token a capture group. Returns the token names in group order. */
function compile(tpl: string, pats: Record<string, string>) {
  const names: string[] = [];
  const source = tpl.split(/(\{\w+\})/).map(part => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m) return escape(part);
    if (!(m[1] in pats)) throw new Error(`Unknown token ${part} in location code format "${tpl}"`);
    names.push(m[1]);
    return `(${pats[m[1]]})`;
  }).join("");
  return { source, names };
}

export function buildLayout(cfg: LayoutConfig) {
  const f = cfg.codeFormat;
  const rackId = (id: string) => (/^\d+$/.test(id) && id.length <= f.rackDigits ? pad(id, f.rackDigits) : id);
  const shapeOf = (name: string) => {
    const s = cfg.shapes[name];
    if (!s) throw new Error(`Unknown column shape "${name}"`);
    return s;
  };

  // ---------- Rack sides, slots and areas ----------
  const faces: Face[] = [];
  const rackNames = new Map<string, string>();
  const aliases = new Map<string, string>(); // upper-case spelling → face ID, incl. unpadded ("6B" → "06B")
  for (const r of cfg.racks) {
    const rack = rackId(r.id);
    rackNames.set(rack, r.name ?? `Rack ${rack}`);
    for (const side of r.sides) {
      const cols: Face["cols"] = [];
      for (let c = 1; c <= r.columns; c++) {
        const s = shapeOf(r.columnShapes?.[String(c)] ?? r.shape ?? cfg.defaultShape);
        cols.push([c, s.levels.flatMap(l => Array.from({ length: s.bays }, (_, b) => [l, b + 1] as [number, number]))]);
      }
      const id = `${rack}${side}`;
      faces.push({ id, rack, side, ...(r.junction ? { junction: true } : {}), cols });
      aliases.set(id.toUpperCase(), id);
      if (f.acceptUnpadded && rack !== r.id) aliases.set(`${r.id}${side}`.toUpperCase(), id);
    }
  }
  const faceIds = new Set(faces.map(x => x.id));
  const areas: AreaConfig[] = cfg.areas;
  const areaIds = new Map(areas.map(a => [a.id.toUpperCase(), a.id]));

  const slotCode = (face: string, col: number, level: number, bay: number) => fill(f.slot, { face, col: pad(col, f.colDigits), level, bay });
  const slots: SlotMeta[] = faces.flatMap(x => x.cols.flatMap(([col, ls]) => ls.map(([level, bay]) => (
    { code: slotCode(x.id, col, level, bay), face: x.id, rack: x.rack, side: x.side, col, level, bay }))));
  const slotByCode = new Map(slots.map(s => [s.code, s]));

  // ---------- Floor spots and area spots ----------
  /** Spot n on the floor of a rack side, or in a named area */
  const spotCode = (group: string, n: number) =>
    faceIds.has(group) ? fill(f.floor, { face: group, n: pad(n, f.spotDigits) }) : fill(f.areaSpot, { area: group, n: pad(n, f.spotDigits) });
  if (!f.areaSpot.startsWith("{area}")) throw new Error("The area spot format must start with {area}");
  const floorRe = compile(f.floor, { face: alts([...faceIds]), n: "\\d+" });
  const exactFloor = new RegExp(`^${floorRe.source}$`);
  const areaRest = compile(f.areaSpot.slice("{area}".length), { n: "\\d+" });
  const exactArea = new RegExp(`^(${alts([...areaIds.values()])})(?:${areaRest.source})?$`);
  /** The rack side and spot number of a floor spot, or null if it isn't one */
  const parseFloor = (code: string) => {
    const m = exactFloor.exec(code);
    return m ? { face: m[1 + floorRe.names.indexOf("face")], n: Number(m[1 + floorRe.names.indexOf("n")]) } : null;
  };
  const floorFace = (code: string) => parseFloor(code)?.face ?? null;
  const areaOf = (code: string) => { const m = exactArea.exec(code); return m ? m[1] : null; };
  /** The rack side or area of a floor or area spot, and its number */
  const parseSpot = (code: string): { group: string; n: number } | null => {
    const f = parseFloor(code);
    if (f) return { group: f.face, n: f.n };
    const m = exactArea.exec(code), n = m?.[2 + areaRest.names.indexOf("n")];
    return m && n !== undefined ? { group: m[1], n: Number(n) } : null;
  };

  const kind = (code: string): LocKind => (slotByCode.has(code) ? "slot" : floorFace(code) ? "floor" : "area");
  /** The rack side (slot or floor spot) or area a location belongs to */
  const groupOf = (code: string) => slotByCode.get(code)?.face ?? floorFace(code) ?? areaOf(code) ?? code;

  // ---------- Reading codes people type ----------
  // Lenient: any case, unpadded numbers and rack numbers. The result is always the saved (padded) form, and only if it exists.
  const facePat = alts([...aliases.keys()]);
  const slotT = compile(f.slot, { face: facePat, col: `\\d{1,${f.colDigits}}`, level: "\\d{1,2}", bay: "\\d{1,2}" });
  const floorT = compile(f.floor, { face: facePat, n: `\\d{1,${f.spotDigits}}` });
  const areaT = compile(f.areaSpot.slice("{area}".length), { n: `\\d{1,${f.spotDigits}}` });
  const source = `\\b(?:${slotT.source})\\b|\\b(?:${floorT.source})\\b|\\b(${alts([...areaIds.values()])})(?:${areaT.source})?\\b`;
  const one = new RegExp(`^(?:${source})$`, "i");
  const groups = (m: RegExpExecArray, names: string[], from: number) => Object.fromEntries(names.map((n, i) => [n, m[from + i]]));

  /** The saved form of a location code, or null if it isn't a real slot, floor spot or area. */
  function normalize(raw: string): string | null {
    const m = one.exec(raw.trim());
    if (!m) return null;
    const s = 1, fl = s + slotT.names.length, ar = fl + floorT.names.length;
    if (m[s] !== undefined) {
      const g = groups(m, slotT.names, s);
      const code = slotCode(aliases.get(g.face.toUpperCase())!, Number(g.col), Number(g.level), Number(g.bay));
      return slotByCode.has(code) ? code : null;
    }
    if (m[fl] !== undefined) {
      const g = groups(m, floorT.names, fl);
      return spotCode(aliases.get(g.face.toUpperCase())!, Number(g.n));
    }
    const area = areaIds.get(m[ar].toUpperCase())!;
    const g = groups(m, areaT.names, ar + 1);
    return g.n !== undefined ? spotCode(area, Number(g.n)) : area;
  }

  // ---------- Columns and racks (what the QR codes on the racks hold) ----------
  // A column's address is the slot format up to the column: "{face}-{col}" → "06B-02"
  const colTpl = f.slot.startsWith("{face}") && f.slot.includes("{col}") ? f.slot.slice(0, f.slot.indexOf("{col}") + "{col}".length) : "{face}-{col}";
  const columnCode = (face: string, col: number) => fill(colTpl, { face, col: pad(col, f.colDigits) });
  const colT = compile(colTpl, { face: facePat, col: `\\d{1,${f.colDigits}}` });
  const oneCol = new RegExp(`^${colT.source}$`, "i");
  /** The rack side and column of a column address ("06B-02", "6b-2"), or null if that column doesn't exist */
  function parseColumn(raw: string): { face: string; col: number } | null {
    const m = oneCol.exec(raw.trim());
    if (!m) return null;
    const g = groups(m, colT.names, 1);
    const face = faces.find(x => x.id === aliases.get(g.face.toUpperCase()));
    const col = Number(g.col);
    return face && face.cols.some(([c]) => c === col) ? { face: face.id, col } : null;
  }
  /** A rack's id as saved ("6" → "06", "d6" → "D6"), or null if there's no such rack */
  const parseRack = (raw: string) => { const id = rackId(raw.trim().toUpperCase()); return rackNames.has(id) ? id : null; };

  /** Every valid location code in a text, with its position and saved form. */
  function find(text: string): { start: number; end: number; code: string }[] {
    const out: { start: number; end: number; code: string }[] = [];
    const re = new RegExp(source, "gi");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const code = normalize(m[0]);
      if (code) out.push({ start: m.index, end: m.index + m[0].length, code });
    }
    return out;
  }

  /** Levels of a rack side, top first (how racks are drawn) */
  const levelsOf = (face: Face) => [...new Set(face.cols.flatMap(c => c[1].map(([l]) => l)))].sort((a, b) => b - a);
  /** Every level in the warehouse, top first: racks are drawn with all of them, missing ones left blank */
  const levels = [...new Set(slots.map(s => s.level))].sort((a, b) => b - a);

  return {
    faces, areas, slots, levels, slotCode, spotCode, parseFloor, parseSpot, floorFace, groupOf, kind, normalize, find, levelsOf, columnCode, parseColumn, parseRack,
    colLabel: (col: number) => pad(col, f.colDigits),
    slotMeta: (code: string) => slotByCode.get(code),
    rackName: (rack: string) => rackNames.get(rack) ?? `Rack ${rack}`,
    isFace: (id: string) => faceIds.has(id),
    receivingArea: cfg.receivingArea,
  };
}
export type Layout = ReturnType<typeof buildLayout>;

// ---------- Checking a layout (the layout editor and the server: a change never strands stock) ----------
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const RACK_ID = /^[A-Za-z0-9]{1,6}$/, AREA_ID = /^[A-Z0-9][A-Z0-9-]{0,23}$/;

/**
 * What's wrong with a layout (empty = fine): anything the app couldn't draw, names used twice, and locations that hold
 * stock or are promised to an open task but would no longer exist. Removing a rack, side, column, level or bay that
 * holds stock would make that stock vanish from every screen, so it's refused: move the stock first.
 */
export function layoutProblems(layout: unknown, held: string[] = []): string[] {
  if (!isObj(layout)) return ["The layout is missing"];
  const l = layout as Partial<LayoutConfig>;
  const out: string[] = [];
  if (!isObj(l.codeFormat)) { if (held.length) out.push("The layout has no slot code format, but the warehouse holds stock"); return out; }
  const shapes = isObj(l.shapes) ? l.shapes : {};
  for (const [name, s] of Object.entries(shapes)) {
    if (!/^[A-Za-z0-9 _-]{1,30}$/.test(name)) out.push(`Column type "${name}": letters, digits, spaces, - and _ only`);
    if (!isObj(s) || !Array.isArray(s.levels) || !s.levels.length || s.levels.some((x: unknown) => !Number.isInteger(x) || (x as number) < 1 || (x as number) > 20) || new Set(s.levels).size !== s.levels.length)
      out.push(`Column type "${name}": levels are different whole numbers from 1 to 20`);
    if (!isObj(s) || !Number.isInteger(s.bays) || s.bays < 1 || s.bays > 9) out.push(`Column type "${name}": 1 to 9 bays`);
  }
  if (!l.defaultShape || !(l.defaultShape in shapes)) out.push("Choose the usual column type");
  const racks = Array.isArray(l.racks) ? l.racks : [];
  const ids = new Set<string>();
  for (const r of racks) {
    const at = `Rack ${isObj(r) ? r.id : "?"}`;
    if (!isObj(r) || typeof r.id !== "string" || !RACK_ID.test(r.id)) { out.push(`${at}: its number or name is 1–6 letters or digits`); continue; }
    const key = /^\d+$/.test(r.id) ? String(Number(r.id)) : r.id.toUpperCase();
    if (ids.has(key)) out.push(`${at} is listed twice`);
    ids.add(key);
    if (typeof r.sides !== "string" || !/^[A-Z]{1,6}$/.test(r.sides) || new Set(r.sides).size !== r.sides.length) out.push(`${at}: sides are different capital letters, e.g. AB`);
    if (!Number.isInteger(r.columns) || r.columns < 1 || r.columns > 99) out.push(`${at}: 1 to 99 columns`);
    if (r.name !== undefined && (typeof r.name !== "string" || r.name.length > 40)) out.push(`${at}: the name is up to 40 characters`);
    if (r.shape !== undefined && !(r.shape in shapes)) out.push(`${at}: unknown column type "${r.shape}"`);
    for (const [col, s] of Object.entries(isObj(r.columnShapes) ? r.columnShapes : {})) {
      if (!/^\d+$/.test(col) || Number(col) < 1 || Number(col) > (r.columns ?? 0)) out.push(`${at}: column ${col} doesn't exist`);
      if (!(String(s) in shapes)) out.push(`${at}, column ${col}: unknown column type "${s}"`);
    }
  }
  const areas = Array.isArray(l.areas) ? l.areas : [];
  const areaIds = new Set<string>();
  for (const a of areas) {
    if (!isObj(a) || typeof a.id !== "string" || !AREA_ID.test(a.id)) { out.push(`Floor area "${isObj(a) ? a.id : "?"}": capital letters, digits and - (up to 24)`); continue; }
    if (areaIds.has(a.id)) out.push(`Floor area ${a.id} is listed twice`);
    areaIds.add(a.id);
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 40) out.push(`Floor area ${a.id}: a name of up to 40 characters`);
  }
  if (!l.receivingArea || !areaIds.has(l.receivingArea)) out.push("Choose the floor area where deliveries wait (receiving)");
  if (out.length) return out;
  let L: ReturnType<typeof buildLayout>;
  try { L = buildLayout(l as LayoutConfig); } catch (e) { return [e instanceof Error ? e.message : "The layout can't be read"]; }
  if (new Set(L.faces.map(f => f.id)).size !== L.faces.length) out.push("Two racks make the same rack side codes");
  if (new Set(L.slots.map(s => s.code)).size !== L.slots.length) out.push("Two slots would have the same code");
  const gone = held.filter(code => L.normalize(code) !== code);
  if (gone.length) out.push(`${gone.length} location${gone.length > 1 ? "s" : ""} with stock or an open task would no longer exist (${gone.slice(0, 6).join(", ")}${gone.length > 6 ? "…" : ""}): move it first`);
  return out;
}
