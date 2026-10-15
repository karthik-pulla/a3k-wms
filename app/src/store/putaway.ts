import { SLOTS, productById, slotMeta, spotCode, type SlotMeta } from "../data/catalog";
import type { Shipment, StockLine } from "./types";

export interface PalletPlan {
  pallet: number;
  lines: { productId: string; cases: number }[];
  slot: string;
  why: string;
  /** Set when a person chose a different slot than suggested */
  reason?: string;
}

/** Pallets in a shipment: lines sharing a pallet number are one (mixed) pallet. */
export function palletsOf(s: Shipment) {
  const map = new Map<number, { productId: string; cases: number }[]>();
  for (const l of s.lines) {
    if (!l.productId || l.cases - (l.damaged ?? 0) <= 0) continue;
    const list = map.get(l.pallet) ?? [];
    list.push({ productId: l.productId, cases: l.cases - (l.damaged ?? 0) });
    map.set(l.pallet, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([pallet, lines]) => ({ pallet, lines }));
}

export const isEmptySlot = (stock: Record<string, StockLine[]>, code: string) => !(stock[code]?.length);

/**
 * Suggest one empty slot per pallet. In order of preference:
 * 1. next to the same product (same column, then nearer columns, then the other side of the rack),
 * 2. next to the same brand, 3. next to the same client's stock, 4. the first empty slot anywhere.
 * Lower levels before higher. With no empty slot left, the floor of the rack where most of that product sits.
 */
export function suggestPutaway(stock: Record<string, StockLine[]>, s: Shipment): PalletPlan[] {
  const taken = new Set<string>();
  const empties = SLOTS.filter(sl => isEmptySlot(stock, sl.code));
  const holders = (test: (productId: string) => boolean) => {
    const out: SlotMeta[] = [];
    for (const [code, lines] of Object.entries(stock)) {
      const m = slotMeta(code);
      if (m && lines.some(l => test(l.productId))) out.push(m);
    }
    return out;
  };
  const distance = (sl: SlotMeta, homes: SlotMeta[]) => Math.min(...homes.map(h =>
    (h.rack === sl.rack ? 0 : 1000) + Math.abs(h.col - sl.col) + (h.face === sl.face ? 0 : 0.5)));

  return palletsOf(s).map(({ pallet, lines }) => {
    const main = [...lines].sort((a, b) => b.cases - a.cases)[0];
    const p = productById(main.productId)!;
    const tiers: [string, SlotMeta[]][] = [
      [`Next to ${p.name}`, holders(id => id === p.id)],
      [`${p.brand} area`, holders(id => productById(id)?.brand === p.brand)],
      [`${p.client} area`, holders(id => productById(id)?.client === p.client)],
    ];
    const free = empties.filter(sl => !taken.has(sl.code));
    for (const [label, homes] of tiers) {
      if (!homes.length || !free.length) continue;
      const best = free
        .map(sl => ({ sl, d: distance(sl, homes) }))
        .sort((a, b) => a.d - b.d || a.sl.level - b.sl.level || a.sl.col - b.sl.col || a.sl.bay - b.sl.bay)[0];
      if (best.d < 1000) {
        taken.add(best.sl.code);
        return { pallet, lines, slot: best.sl.code, why: `${label} in ${best.sl.face}` };
      }
    }
    if (free.length) {
      const sl = [...free].sort((a, b) => a.level - b.level)[0];
      taken.add(sl.code);
      return { pallet, lines, slot: sl.code, why: "First empty slot" };
    }
    // No empty slot: the floor of the rack side holding most of this product
    const homes = holders(id => id === p.id);
    const counts = new Map<string, number>();
    for (const h of homes) counts.set(h.face, (counts.get(h.face) ?? 0) + 1);
    const face = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SLOTS[0].face;
    let n = 1;
    while (stock[spotCode(face, n)]?.length || taken.has(spotCode(face, n))) n++;
    const code = spotCode(face, n);
    taken.add(code);
    return { pallet, lines, slot: code, why: "No empty slot: rack floor" };
  });
}
