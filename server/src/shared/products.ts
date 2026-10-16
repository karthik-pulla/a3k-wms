// Editing a product's code, name and full description (the item text), shared by the app and the server.
// No imports, so both can use it as it is. The id never changes: stock, orders and messages point at it.

export interface ProductText { code: string; name: string; item: string }

export const PRODUCT_LIMITS = { code: 30, name: 120, item: 200, reason: 300 } as const;

/** Trimmed, with runs of spaces made one */
export const cleanProductText = (t: ProductText): ProductText => ({
  code: t.code.trim().replace(/\s+/g, " "),
  name: t.name.trim().replace(/\s+/g, " "),
  item: t.item.trim().replace(/\s+/g, " "),
});

/** Problems with an edit someone wants to save (empty = fine) */
export function productEditProblems(t: ProductText, reason: string): string[] {
  const c = cleanProductText(t);
  const out: string[] = [];
  // eslint-disable-next-line no-control-regex
  const bad = /[\u0000-\u001f\u007f]/;
  if (!c.code || c.code.length > PRODUCT_LIMITS.code) out.push(`A code of 1–${PRODUCT_LIMITS.code} characters`);
  if (!c.name || c.name.length > PRODUCT_LIMITS.name) out.push(`A name of 1–${PRODUCT_LIMITS.name} characters`);
  if (!c.item || c.item.length > PRODUCT_LIMITS.item) out.push(`A full description of 1–${PRODUCT_LIMITS.item} characters`);
  if ([c.code, c.name, c.item].some(v => bad.test(v))) out.push("No hidden control characters");
  const r = reason.trim();
  if (r.length < 4 || r.length > PRODUCT_LIMITS.reason) out.push(`A reason of 4–${PRODUCT_LIMITS.reason} characters`);
  return out;
}

/** "code 1108 → 1108B; name …" for logs; empty when nothing changed */
export function productChanges(before: ProductText, after: ProductText): string {
  const parts: string[] = [];
  if (before.code !== after.code) parts.push(`code ${before.code || "(none)"} → ${after.code}`);
  if (before.name !== after.name) parts.push(`name "${before.name}" → "${after.name}"`);
  if (before.item !== after.item) parts.push(`full description "${before.item}" → "${after.item}"`);
  return parts.join("; ");
}

/**
 * When the code changes, the full description usually holds it as one ":"-separated part
 * ("Anaganaga:170gms*24:1108:Janthikalu"): that part follows the new code. Otherwise the description stays.
 */
export function itemWithCode(item: string, oldCode: string, newCode: string): string {
  if (!oldCode || oldCode === newCode) return item;
  const parts = item.split(":");
  const i = parts.findIndex(p => p.trim() === oldCode);
  if (i < 0) return item;
  parts[i] = newCode;
  return parts.join(":");
}
