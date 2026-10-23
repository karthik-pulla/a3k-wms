// What a device's change may do, action by action (called from push in ./sync.ts, which says why these are shape
// checks rather than the app's own logic run again). Each check compares the pieces as they're saved (before) with
// what the device sent (after), so a person allowed one kind of change can't send another under its name: a
// worker's "move" can't write stock out of nothing, a slot correction can't add products, and a finished task or a
// pick takes exactly what it says off one place. Plain functions: no Node imports, no session settings.
import { forbidden } from "./errors.ts";
import { allows, type BaseRole, type Permissions } from "../shared/permissions.ts";
import { idOf, kindOf, type Change, type Kind } from "../shared/sync.ts";

export interface CheckWho { personId: string | null; base: BaseRole; perms: Permissions; clients: string[] | null }

interface Piece { key: string; kind: Kind; id: string; before: any; after: any }
interface Ctx {
  who: CheckWho;
  pieces: Piece[];
  of: (kind: Kind) => Piece[];
  /** Saved pieces that aren't in the change (e.g. the stock a new task's pallet is on) */
  load: (keys: string[]) => Promise<Map<string, any>>;
}

const no = (m: string) => forbidden(m);

/** The same JSON whatever the key order (the database keeps object keys in its own order) */
const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter(k => (v as any)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
};
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const without = (o: any, ...keys: string[]) => { const out = { ...o }; for (const k of keys) delete out[k]; return out; };
/** Only these fields differ between two versions of a piece */
const onlyChanged = (a: any, b: any, fields: string[]) => same(without(a, ...fields), without(b, ...fields));

const isLine = (l: any) => !!l && typeof l === "object" && !Array.isArray(l) && typeof l.productId === "string" && l.productId.length > 0 && Number.isFinite(l.cases) && l.cases >= 0;
/** A slot's lines as a device sent them: a list of products and cases, or nothing */
function linesOf(v: unknown, where: string): any[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isLine)) throw no(`The stock on ${where} isn't a list of products and cases`);
  return v;
}
/** A slot's lines as they're saved (whatever an import wrote there; never refused for its shape) */
const savedLines = (v: unknown): any[] => (Array.isArray(v) ? v : []);
/** Each line of `part` taken once from `whole`, exactly as it is there (multiset) */
function within(part: any[], whole: any[]): boolean {
  const left = whole.map(canon);
  for (const l of part) { const i = left.indexOf(canon(l)); if (i < 0) return false; left.splice(i, 1); }
  return true;
}

/** Stock pieces: by location */
const stockAt = (c: Ctx) => new Map(c.of("stock").map(p => [p.id, p]));
/** The stock change must be exactly these locations going from what's saved to what's expected (unchanged ones not sent) */
function expectStock(c: Ctx, expected: Map<string, any[]>, saved: (loc: string) => any[]) {
  const sent = stockAt(c);
  for (const loc of sent.keys()) if (!expected.has(loc)) throw no(`This change can't touch the stock on ${loc}`);
  for (const [loc, lines] of expected) {
    const p = sent.get(loc);
    const changes = !same(lines, saved(loc));
    if (!changes) { if (p && !same(linesOf(p.after, loc), saved(loc))) throw no(`This change can't touch the stock on ${loc}`); continue; }
    if (!p || !same(linesOf(p.after, loc), lines)) throw no(`The stock on ${loc} doesn't match this change`);
  }
}

/** Movement log lines: only these types, about these locations */
function movementsAre(c: Ctx, types: string[], locations: string[]) {
  for (const p of c.of("movement")) {
    const m = p.after;
    if (!m || !types.includes(m.type) || !locations.includes(m.location) || (m.type === "move" && m.from !== undefined && !locations.includes(m.from)))
      throw no("The movement log doesn't match this change");
  }
}

function onlyKinds(c: Ctx, kinds: Kind[]) {
  for (const p of c.pieces) if (!kinds.includes(p.kind)) throw no(`This change can't touch ${p.kind}`);
}

function one(c: Ctx, kind: Kind, what: string): Piece {
  const list = c.of(kind);
  if (list.length !== 1) throw no(`This change is about one ${what}`);
  return list[0];
}

// ---------- Moving a pallet straight away (no task) ----------
function move(c: Ctx) {
  onlyKinds(c, ["stock", "movement", "audit"]);
  const stock = c.of("stock");
  const from = stock.find(p => savedLines(p.before).length && !linesOf(p.after, p.id).length);
  const to = stock.find(p => p !== from);
  if (stock.length !== 2 || !from || !to) throw no("A move empties one location and fills another");
  if (savedLines(to.before).length) throw no(`${to.id} isn't empty`);
  if (!same(linesOf(to.after, to.id), savedLines(from.before))) throw no(`A move takes the whole pallet on ${from.id} to ${to.id}, as it is`);
  movementsAre(c, ["move"], [from.id, to.id]);
}

// ---------- Correcting a slot after scanning its QR code ----------
function scanAdjust(c: Ctx) {
  onlyKinds(c, ["stock", "movement", "audit"]);
  const p = one(c, "stock", "slot");
  const before = savedLines(p.before), after = linesOf(p.after, p.id);
  if (!before.length) throw no(`${p.id} is empty: nothing to correct`);
  // The same lines in the same order, some removed, the rest with only their case count changed
  let i = 0;
  for (const l of after) {
    while (i < before.length && !onlyChanged(before[i], l, ["cases"])) i++;
    if (i === before.length) throw no(`A slot correction only changes case counts of what's already on ${p.id}`);
    if (l.cases !== before[i].cases && (!Number.isInteger(l.cases) || l.cases < 1)) throw no("New case counts are whole numbers");
    i++;
  }
  movementsAre(c, ["adjustment"], [p.id]);
}

// ---------- Pallet tasks ----------
const OPEN = ["open", "doing"];
function task(c: Ctx, isNew = false): Piece {
  const p = one(c, "task", "task");
  if (isNew ? p.before : !p.before) throw no(isNew ? "That task already exists" : "That task doesn't exist");
  if (!p.after || p.after.id !== p.id) throw no("A task needs its id");
  return p;
}
const givesWork = (c: Ctx) => allows(c.who.base, c.who.perms, "assign-work");

async function taskCreate(c: Ctx) {
  onlyKinds(c, ["task", "audit"]);
  const t = task(c, true).after;
  // Put-away tasks come only from confirming a delivery
  if (t.kind !== "move" || t.status !== "open" || t.startedAt || t.doneBy || t.doneAt || t.blocked) throw no("A new task is an open move");
  if (typeof t.from !== "string" || typeof t.to !== "string" || !t.from || !t.to || t.from === t.to) throw no("A move goes from one place to another");
  if (!givesWork(c) && ((t.assignee && t.assignee !== c.who.personId) || t.team)) throw no("Only people who give out work can give a task to someone else");
  const lines = linesOf(t.lines, t.from);
  const on = savedLines((await c.load([`stock:${t.from}`])).get(`stock:${t.from}`));
  if (!lines.length || !within(lines, on)) throw no(`The task's pallet isn't what's on ${t.from}`);
}

function taskAssign(c: Ctx) {
  onlyKinds(c, ["task", "audit"]);
  const p = task(c);
  if (!onlyChanged(p.before, p.after, ["assignee", "team"])) throw no("Giving out a task changes only who has it");
}

function taskStart(c: Ctx) {
  onlyKinds(c, ["task", "audit"]);
  const { before: b, after: a } = task(c);
  if (b.status !== "open" || a.status !== "doing" || !onlyChanged(b, a, ["status", "startedAt", "assignee"])) throw no("Starting a task changes only its status");
  if (a.assignee !== b.assignee && (b.assignee || a.assignee !== c.who.personId)) throw no("Starting a task gives it to you, not someone else");
}

function taskBlocked(c: Ctx) {
  onlyKinds(c, ["task", "audit"]);
  const { before: b, after: a } = task(c);
  if (!OPEN.includes(b.status) || !onlyChanged(b, a, ["to", "blocked"])) throw no("A blocked slot changes only where the task goes");
  if (typeof a.to !== "string" || !a.to || a.to === b.to || a.to === b.from || !same(a.blocked, [...(b.blocked ?? []), b.to])) throw no("A blocked slot sends the task to another place");
}

function taskCancel(c: Ctx) {
  onlyKinds(c, ["task", "audit"]);
  const { before: b, after: a } = task(c);
  if (!OPEN.includes(b.status) || a.status !== "cancelled" || !onlyChanged(b, a, ["status", "doneBy", "doneAt", "reason"])) throw no("Cancelling a task changes only its status");
}

/** Done: the pallet as the saved task describes it leaves `from` (moves) and arrives on `to`, nothing else */
async function taskDone(c: Ctx) {
  onlyKinds(c, ["task", "stock", "shipment", "movement", "audit"]);
  const { before: t, after: a } = task(c);
  if (!OPEN.includes(t.status) || a.status !== "done" || !onlyChanged(t, a, ["status", "doneBy", "doneAt"])) throw no("Finishing a task changes only its status");
  const lines = linesOf(t.lines, t.to);
  const locs = t.kind === "move" ? [t.from, t.to] : [t.to];
  const sent = stockAt(c);
  const missing = locs.filter(l => !sent.has(l));
  const loaded = missing.length ? await c.load(missing.map(l => `stock:${l}`)) : new Map();
  const saved = (loc: string) => savedLines(sent.has(loc) ? sent.get(loc)!.before : loaded.get(`stock:${loc}`));
  const expected = new Map<string, any[]>();
  if (t.kind === "move") {
    // As the app does it: one line taken per line moved (a floor spot may hold two identical pallets)
    const taken = new Set<number>(), removed: any[] = [];
    const left = saved(t.from).filter(l => {
      const i = lines.findIndex((m, n) => !taken.has(n) && m.productId === l.productId && m.lot === l.lot && (m.bestBefore ?? "") === (l.bestBefore ?? ""));
      if (i < 0) return true;
      taken.add(i);
      removed.push(l);
      return false;
    });
    // The pallet must still be there as the task says, or cases would appear or vanish
    if (removed.length !== lines.length || !within(removed, lines)) throw no(`The pallet on ${t.from} changed since the task was made: cancel it and make a new one`);
    expected.set(t.from, left);
  }
  expected.set(t.to, [...(expected.get(t.to) ?? saved(t.to)), ...lines]);
  expectStock(c, expected, saved);
  // The delivery the pallet came from may become "stored"; nothing else about it changes
  for (const s of c.of("shipment")) if (s.id !== t.shipmentId || !s.before || !s.after || s.after.status !== "stored" || !onlyChanged(s.before, s.after, ["status"])) throw no("Finishing a task changes only its own delivery's status");
  movementsAre(c, [t.kind === "move" ? "move" : "putaway"], locs);
}

// ---------- Picking an order ----------
function order(c: Ctx): Piece {
  const p = one(c, "order", "order");
  const o = p.before;
  if (!o || !p.after || p.after.id !== p.id) throw no("That order doesn't exist");
  if (!["approved", "picking", "picked"].includes(o.status)) throw no("That order isn't being picked");
  if (c.who.clients && !c.who.clients.includes(o.client)) throw no("That order is for a client you don't see");
  // Workers pack only the orders given to them
  if (!givesWork(c) && o.assignee !== c.who.personId) throw no("That order isn't given to you to pack");
  if (!onlyChanged(o, p.after, ["picks", "short", "avoid", "status"])) throw no("Picking changes only the order's picks");
  if (!Array.isArray(p.after.picks)) throw no("An order being picked has its picks");
  return p;
}
const pickedKeys = (picks: any[] | undefined) => new Map((picks ?? []).filter(x => x.picked).map(x => [x.key, x]));

/** What's still planned can't ask for more than the order still needs (planning moves no stock, but reserves it) */
function planFits(o: any) {
  const want = new Map<string, number>();
  for (const l of o.lines ?? []) want.set(l.productId, (want.get(l.productId) ?? 0) + l.cases);
  const planned = new Map<string, number>();
  for (const p of o.picks) {
    if (!want.has(p.productId) || typeof p.location !== "string" || !Number.isInteger(p.cases) || p.cases < 0) throw no("A pick must be for a product on the order");
    // Taking more than planned leaves the rest of the plan as it was (the app only plans again after a short pick)
    if (p.picked) want.set(p.productId, want.get(p.productId)! - Math.min(p.picked.cases, p.cases));
    else planned.set(p.productId, (planned.get(p.productId) ?? 0) + p.cases);
  }
  for (const [id, n] of planned) if (n > Math.max(0, want.get(id)!)) throw no("The plan asks for more than the order needs");
  // As the app sets it: picked once every pick is done (picking just after an undo), approved again when none is
  const done = o.picks.filter((p: any) => p.picked).length;
  const ok = !done ? ["approved", "picking"] : done === o.picks.length ? ["picked", "picking"] : ["picking"];
  if (!ok.includes(o.status)) throw no("The order's status doesn't match its picks");
}
/** Every pick done before is still there, unchanged, except `except` */
function keepsPicked(before: any[], after: any[], except: string) {
  const now = pickedKeys(after);
  for (const [k, p] of pickedKeys(before)) if (k !== except && !same(now.get(k), p)) throw no("Picks already confirmed can't change");
}

function orderPick(c: Ctx) {
  onlyKinds(c, ["order", "stock", "movement", "audit"]);
  const { before: o, after: a } = order(c);
  const was = pickedKeys(o.picks), now = pickedKeys(a.picks);
  const fresh = [...now.keys()].filter(k => !was.has(k));
  if (fresh.length !== 1) throw no("A pick confirms one pallet");
  const bp = (o.picks ?? []).find((x: any) => x.key === fresh[0]);
  const ap = now.get(fresh[0]);
  if (!bp || !onlyChanged(bp, ap, ["picked"])) throw no("A pick confirms one of the order's planned pallets");
  keepsPicked(o.picks, a.picks, bp.key);
  if (now.size !== was.size + 1) throw no("Picks already confirmed can't change");
  planFits(a);
  const picked = ap.picked;
  if (!picked || !Number.isInteger(picked.cases) || picked.cases < 0 || !Array.isArray(picked.taken)) throw no("A pick says how many cases were taken");
  const taken = linesOf(picked.taken, bp.location);
  if (taken.some(l => l.productId !== bp.productId) || taken.reduce((n, l) => n + l.cases, 0) !== picked.cases) throw no("A pick takes only that product, as many cases as it says");
  // The slot afterwards: its lines in order, those of the product reduced or gone, and what went is what was taken
  const loc = bp.location;
  const sent = stockAt(c).get(loc);
  for (const p of c.of("stock")) if (p.id !== loc) throw no(`This pick can't touch the stock on ${p.id}`);
  const before = savedLines(sent?.before);
  const after = sent ? linesOf(sent.after, loc) : before;
  if (!sent && picked.cases) throw no(`The stock on ${loc} doesn't match this pick`);
  const went = new Map<string, number>();
  let j = 0;
  for (const l of before) {
    const n = after[j];
    if (n && same(n, l)) { j++; continue; }
    if (!isLine(l)) throw no(`The stock on ${loc} doesn't match this pick`);
    if (l.productId !== bp.productId) throw no(`The stock on ${loc} doesn't match this pick`);
    const kept = n && onlyChanged(n, l, ["cases"]) && n.cases < l.cases ? n.cases : 0;
    if (kept) j++;
    const id = canon(without(l, "cases"));
    went.set(id, (went.get(id) ?? 0) + l.cases - kept);
  }
  if (j !== after.length) throw no(`The stock on ${loc} doesn't match this pick`);
  const said = new Map<string, number>();
  for (const l of taken) { const id = canon(without(l, "cases")); said.set(id, (said.get(id) ?? 0) + l.cases); }
  if (!same(Object.fromEntries(went), Object.fromEntries(said))) throw no(`The stock on ${loc} doesn't match this pick`);
  movementsAre(c, ["pick"], [loc]);
}

/** Puts picked cases back (undo), merging with a matching line when there is one: as the app does (outbound/plan.ts) */
function putBack(lines: any[], taken: any[]): any[] {
  const next = lines.map(l => ({ ...l }));
  for (const t of taken) {
    const match = next.find(l => l.productId === t.productId && l.lot === t.lot && l.bestBefore === t.bestBefore && l.shipmentId === t.shipmentId);
    if (match) match.cases += t.cases; else next.push({ ...t });
  }
  return next;
}

/** Undo: one confirmed pick's cases go back on its pallet, exactly as they were taken */
async function orderUnpick(c: Ctx) {
  onlyKinds(c, ["order", "stock", "movement", "audit"]);
  const { before: o, after: a } = order(c);
  const was = pickedKeys(o.picks), now = pickedKeys(a.picks);
  const gone = [...was.keys()].filter(k => !now.has(k));
  if (gone.length !== 1 || [...now.keys()].some(k => !was.has(k))) throw no("Undoing a pick puts back one pallet's cases");
  const bp = was.get(gone[0]);
  keepsPicked(o.picks, a.picks, bp.key);
  planFits(a);
  const loc = bp.location;
  const sent = stockAt(c).get(loc);
  const before = savedLines(sent ? sent.before : (await c.load([`stock:${loc}`])).get(`stock:${loc}`));
  expectStock(c, new Map([[loc, putBack(before, savedLines(bp.picked.taken))]]), () => before);
  movementsAre(c, ["pick-undo"], [loc]);
}

/** The actions checked piece by piece. The others rely on their switch and kinds (ACTION_RULES) for now. */
const CHECKS: Record<string, (c: Ctx) => void | Promise<void>> = {
  move,
  "stock/scan-adjust": scanAdjust,
  "task/create": taskCreate,
  "task/assign": taskAssign,
  "task/start": taskStart,
  "task/blocked": taskBlocked,
  "task/cancel": taskCancel,
  "task/done": taskDone,
  "order/pick": orderPick,
  "order/unpick": orderUnpick,
};
export const CHECKED_ACTIONS = Object.keys(CHECKS);

/** Refuses a change whose pieces aren't what its action does. `saved` = each piece as it's saved now (null = none). */
export async function checkAction(type: string, who: CheckWho, changes: Change[], saved: (key: string) => unknown, load: Ctx["load"]): Promise<void> {
  const pieces: Piece[] = changes.map(ch => ({ key: ch.key, kind: kindOf(ch.key)!, id: idOf(ch.key), before: saved(ch.key) ?? null, after: ch.data ?? null }));
  // One change, one line in the change log (the app's own `root` adds exactly one)
  if (pieces.filter(p => p.kind === "audit").length > 1) throw no("A change has one line in the change log");
  const check = CHECKS[type];
  if (!check) return;
  await check({ who, pieces, of: kind => pieces.filter(p => p.kind === kind), load });
}
