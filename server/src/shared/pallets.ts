// How a quantity of cases sits on pallets. Shared by the app (Pending → "Split into pallets") and the server (the client
// portal's delivery notices), so both make pallets the warehouse's way: as many full pallets as the cases fill, then one
// partial pallet with the rest. Partial pallets are kept to a minimum (owners' rule), and only a pallet holding fewer
// cases than the product's full-pallet size counts as partial.

/** Cases on each pallet: full pallets of `perPallet`, then one partial pallet with what's left (the inbound report's QUOTIENT and MOD) */
export function palletSizes(cases: number, perPallet: number): number[] {
  const total = Math.max(0, Math.floor(cases)), per = Math.floor(perPallet);
  if (!total) return [];
  if (!(per > 0)) return [total];
  const out = Array<number>(Math.floor(total / per)).fill(per);
  if (total % per) out.push(total % per);
  return out;
}

/**
 * Cases over the number of pallets someone says they're on (a delivery notice). When that number is exactly what full
 * pallets of the product's size need, the pallets are full with one partial last; otherwise (the size isn't known or
 * the pallets are packed differently) the cases are shared out evenly.
 */
export function spreadOverPallets(cases: number, pallets: number, perPallet?: number | null): number[] {
  const n = Math.max(1, Math.floor(pallets));
  if (perPallet && perPallet > 0) {
    const sizes = palletSizes(cases, perPallet);
    if (sizes.length === n) return sizes;
  }
  const each = Math.floor(cases / n), extra = cases % n;
  return Array.from({ length: n }, (_, p) => each + (p < extra ? 1 : 0));
}

/** Cases on a full pallet from cases per layer × layers (TI × HI), when both are given; otherwise null */
export const tiHi = (ti: number, hi: number): number | null => (ti > 0 && hi > 0 ? Math.floor(ti) * Math.floor(hi) : null);

// ---------- A delivery's lines (one line per product per pallet; lines with the same pallet number are one mixed pallet) ----------
export interface PalletLine { key: string; productId: string | null; cases: number; pallet: number; lot: string; bestBefore: string; damaged?: number }

/** One product with one lot and best-before, on pallets of its own (mixed pallets aren't split) */
export interface PalletGroup { key: string; productId: string; lot: string; bestBefore: string; cases: number; damaged: number; pallets: number }

const groupKey = (l: PalletLine) => `${l.productId}|${l.lot}|${l.bestBefore}`;
const singles = (lines: readonly PalletLine[]) => {
  const per = new Map<number, number>();
  for (const l of lines) per.set(l.pallet, (per.get(l.pallet) ?? 0) + 1);
  return (l: PalletLine) => !!l.productId && per.get(l.pallet) === 1;
};

/** The product groups "Split into pallets" can work on, in the order they first appear */
export function palletGroups(lines: readonly PalletLine[]): PalletGroup[] {
  const alone = singles(lines), out = new Map<string, PalletGroup>();
  for (const l of lines) {
    if (!alone(l)) continue;
    const k = groupKey(l), g = out.get(k) ?? { key: k, productId: l.productId!, lot: l.lot, bestBefore: l.bestBefore, cases: 0, damaged: 0, pallets: 0 };
    g.cases += Number(l.cases) || 0; g.damaged += l.damaged ?? 0; g.pallets += 1;
    out.set(k, g);
  }
  return [...out.values()];
}

/**
 * Each chosen group's pallets put back together and made again as full pallets of `perPallet[group]` plus one partial
 * pallet (palletSizes). Damaged cases go on the last pallets. Mixed pallets and groups without a size stay as they are.
 * Pallets are then numbered 1, 2, 3… in the order they appear.
 */
export function splitIntoPallets<L extends PalletLine>(lines: readonly L[], perPallet: Record<string, number>): L[] {
  const alone = singles(lines), groups = new Map(palletGroups(lines).map(g => [g.key, g]));
  const out: { line: L; tag: string }[] = [], done = new Set<string>();
  for (const l of lines) {
    const k = alone(l) ? groupKey(l) : "", per = k ? perPallet[k] : 0;
    if (!k || !(per > 0) || !groups.get(k)!.cases) { out.push({ line: l, tag: `old:${l.pallet}` }); continue; }
    if (done.has(k)) continue;
    done.add(k);
    const g = groups.get(k)!, sizes = palletSizes(g.cases, per);
    // Damaged cases from the last pallet backwards
    let hurt = g.damaged;
    const damaged = sizes.map(() => 0);
    for (let i = sizes.length - 1; i >= 0 && hurt > 0; i--) { damaged[i] = Math.min(sizes[i], hurt); hurt -= damaged[i]; }
    sizes.forEach((cases, i) => {
      const { damaged: _d, ...rest } = l;
      out.push({ line: { ...rest, key: `${l.key}-${i + 1}`, cases, ...(damaged[i] ? { damaged: damaged[i] } : {}) } as L, tag: `new:${k}:${i}` });
    });
  }
  const numbers = new Map<string, number>();
  for (const o of out) if (!numbers.has(o.tag)) numbers.set(o.tag, numbers.size + 1);
  return out.map(o => ({ ...o.line, pallet: numbers.get(o.tag)! }));
}
