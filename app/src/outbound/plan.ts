// Which pallets an order is picked from.
//
// The warehouse's rule (Manage warehouse → Picking; an order may use another): FIFO, stock that arrived first goes
// out first (arrival = the delivery's arrival date; SAMPLE sheet stock has a made-up one); FEFO, the earliest
// best-before first; LIFO, the newest arrival first. Expired stock is never planned. With "-open-first" (the
// default), pallets already opened (partial) are used up before a full pallet is opened, so a pallet is taken from
// order after order until it's empty; without it the rule alone decides.
import { productById } from "../data/catalog";
import { arrivalDate, expiryTone } from "../chat/selectors";
import { byLocation } from "../inventory/selectors";
import type { PickLine, PickRule, PickStrategy, State, StockLine, StoreOrder } from "../store/types";

export const ACTIVE: StoreOrder["status"][] = ["approved", "picking"];

export const ruleOf = (s: PickStrategy): PickRule => s.replace("-open-first", "") as PickRule;
export const opensFirst = (s: PickStrategy) => s.endsWith("-open-first");
/** The warehouse's own rule, for new orders */
export const defaultStrategy = (state: Pick<State, "settings">): PickStrategy =>
  `${state.settings?.pickRule ?? "fifo"}${state.settings?.openFirst === false ? "" : "-open-first"}` as PickStrategy;
export const RULE_NAMES: Record<PickRule, string> = { fifo: "Oldest stock first (FIFO)", fefo: "Earliest best-before first (FEFO)", lifo: "Newest stock first (LIFO)" };
export const strategyName = (s: PickStrategy) => `${RULE_NAMES[ruleOf(s)]}${opensFirst(s) ? ", open pallets first" : ""}`;
export const statusOf = (o: StoreOrder) => o.status ?? "draft";

/** Cases other active orders have planned but not yet picked, per location and product */
export function reservations(state: State, exceptOrderId?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of state.orders) {
    if (o.id === exceptOrderId || !ACTIVE.includes(statusOf(o))) continue;
    for (const p of o.picks ?? []) if (!p.picked) m.set(`${p.location}|${p.productId}`, (m.get(`${p.location}|${p.productId}`) ?? 0) + p.cases);
  }
  return m;
}

export interface Candidate { location: string; productId: string; available: number; lot?: string; bestBefore?: string; arrival: string; open: boolean; fullSize: number }

/** Every pallet holding a product with cases free to pick, in the order they'd be used. */
export function candidates(state: State, productId: string, strategy: PickStrategy, reserved: Map<string, number>): Candidate[] {
  const p = productById(productId);
  const holding: [string, StockLine[]][] = [];
  for (const [code, lines] of Object.entries(state.stock)) {
    const mine = lines.filter(l => l.productId === productId && l.cases > 0 && expiryTone(l.bestBefore) !== "expired");
    if (mine.length) holding.push([code, mine]);
  }
  // Full pallet size: from the product list, else the biggest pallet of it in stock
  const fullSize = p?.perPallet ?? Math.max(0, ...holding.map(([, ls]) => ls.reduce((a, l) => a + l.cases, 0)));
  const out: Candidate[] = [];
  for (const [code, lines] of holding) {
    const total = lines.reduce((a, l) => a + l.cases, 0);
    const available = total - (reserved.get(`${code}|${productId}`) ?? 0);
    if (available <= 0) continue;
    const oldest = [...lines].sort((a, b) => arrivalDate(state, code, a).localeCompare(arrivalDate(state, code, b)))[0];
    out.push({ location: code, productId, available, lot: oldest.lot, bestBefore: oldest.bestBefore, arrival: arrivalDate(state, code, oldest), open: !!fullSize && available < fullSize, fullSize });
  }
  const rule = ruleOf(strategy);
  // FEFO: no best-before goes last; ties (and LIFO's) fall back to arrival, then walking order
  const byRule = (a: Candidate, b: Candidate) =>
    (rule === "fefo" ? (a.bestBefore || "9999").localeCompare(b.bestBefore || "9999") : 0)
    || (rule === "lifo" ? b.arrival.localeCompare(a.arrival) : a.arrival.localeCompare(b.arrival))
    || byLocation(a.location, b.location);
  return out.sort(opensFirst(strategy) ? (a, b) => Number(b.open) - Number(a.open) || byRule(a, b) : (a, b) => byRule(a, b) || Number(b.open) - Number(a.open));
}

/**
 * Plans (or re-plans) an order. Picks already done stay as they are; the rest of each line is planned again from
 * the stock that isn't expired or reserved by other active orders. Anything that can't be planned is "short".
 */
export function planOrder(state: State, order: StoreOrder, strategy: PickStrategy = order.strategy ?? defaultStrategy(state)): { picks: PickLine[]; short: Record<string, number> } {
  const reserved = reservations(state, order.id);
  const done = (order.picks ?? []).filter(p => p.picked);
  const picks: PickLine[] = [...done];
  const short: Record<string, number> = {};
  let n = 0;
  const wanted = new Map<string, number>();
  for (const l of order.lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.cases);
  for (const [productId, cases] of wanted) {
    let left = cases - done.filter(p => p.productId === productId).reduce((a, p) => a + (p.picked?.cases ?? 0), 0);
    const avoid = new Set(order.avoid ?? []);
    for (const c of candidates(state, productId, strategy, reserved)) {
      if (left <= 0) break;
      if (avoid.has(`${c.location}|${productId}`)) continue;
      const take = Math.min(left, c.available);
      picks.push({ key: `${order.id}-${productId}-${c.location}-${Date.now().toString(36)}-${n++}`, productId, location: c.location, cases: take, onPallet: c.available, lot: c.lot, bestBefore: c.bestBefore, arrival: c.arrival, openPallet: c.open });
      left -= take;
    }
    if (left > 0) short[productId] = left;
  }
  return { picks, short };
}

/** Walking order for the pick list: by location (rack side, column, level), so pickers don't zig-zag */
export const pickRoute = (picks: PickLine[]) => [...picks].sort((a, b) => byLocation(a.location, b.location) || a.arrival.localeCompare(b.arrival));

/** Takes cases of a product off a location, oldest stock first. Returns the new lines and what was taken. */
export function takeFrom(lines: StockLine[], productId: string, cases: number, state: State, location: string): { lines: StockLine[]; taken: StockLine[] } {
  let left = cases;
  const order = lines.map((l, i) => ({ l, i })).filter(x => x.l.productId === productId)
    .sort((a, b) => arrivalDate(state, location, a.l).localeCompare(arrivalDate(state, location, b.l)));
  const next = lines.map(l => ({ ...l }));
  const taken: StockLine[] = [];
  for (const { i } of order) {
    if (left <= 0) break;
    const t = Math.min(left, next[i].cases);
    taken.push({ ...next[i], cases: t });
    next[i].cases -= t;
    left -= t;
  }
  return { lines: next.filter(l => l.cases > 0), taken };
}

/** Puts picked cases back (undo), merging with a matching line when there is one */
export function putBack(lines: StockLine[], taken: StockLine[]): StockLine[] {
  const next = lines.map(l => ({ ...l }));
  for (const t of taken) {
    const same = next.find(l => l.productId === t.productId && l.lot === t.lot && l.bestBefore === t.bestBefore && l.shipmentId === t.shipmentId);
    if (same) same.cases += t.cases; else next.push({ ...t });
  }
  return next;
}

export const orderCases = (o: StoreOrder) => o.lines.reduce((a, l) => a + l.cases, 0);
export const pickedCases = (o: StoreOrder) => (o.picks ?? []).reduce((a, p) => a + (p.picked?.cases ?? 0), 0);
export const nextOrderId = (orders: StoreOrder[]) => `Order ${Math.max(0, ...orders.map(o => Number(o.id.match(/(\d+)$/)?.[1] ?? 0))) + 1}`;
