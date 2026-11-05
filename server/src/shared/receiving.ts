// What a delivery said was coming against what arrived. When a delivery is marked arrived, the cases announced for each
// product are kept apart (`announced` on the delivery) and never change again; Pending then edits only what was
// received. Shared by the app (the Pending screen, the store) and the server's checks (src/core/sync-checks.ts).

export interface Announced { productId: string; cases: number }
interface LineLike { productId: string | null; cases: number; damaged?: number }

/** Cases per product over all of a delivery's lines, in the order the products first appear */
export function casesByProduct(lines: readonly LineLike[]): Announced[] {
  const sum = new Map<string, number>();
  for (const l of lines) if (l.productId) sum.set(l.productId, (sum.get(l.productId) ?? 0) + (Number(l.cases) || 0));
  return [...sum].map(([productId, cases]) => ({ productId, cases }));
}

export interface Difference { productId: string; announced: number; received: number; damaged: number }

/** Every product whose received cases differ from what was announced (a product that wasn't announced counts from 0) */
export function receivingDifferences(announced: readonly Announced[] | undefined, lines: readonly LineLike[]): Difference[] {
  if (!announced) return [];
  const got = new Map(casesByProduct(lines).map(x => [x.productId, x.cases]));
  const damaged = new Map<string, number>();
  for (const l of lines) if (l.productId) damaged.set(l.productId, (damaged.get(l.productId) ?? 0) + (l.damaged ?? 0));
  const ids = [...new Set([...announced.map(a => a.productId), ...got.keys()])];
  return ids
    .map(id => ({ productId: id, announced: announced.find(a => a.productId === id)?.cases ?? 0, received: got.get(id) ?? 0, damaged: damaged.get(id) ?? 0 }))
    .filter(d => d.announced !== d.received);
}
