// Count corrections: the reason an owner gives is part of each correction's line in the stock history, and both the
// app (store/store.tsx, count/decide) and the server's check (core/sync-checks.ts) read it the same way.

/** The history reason of a count correction: the count's name and the owner's reason */
export const countReason = (count: string, note: string) => `Count "${count}": ${note.trim()}`;

/** The owner's reason inside a count correction's history reason ("" when there is none) */
export function countNote(count: string, reason: unknown): string {
  const head = `Count "${count}": `;
  return typeof reason === "string" && reason.startsWith(head) ? reason.slice(head.length).trim() : "";
}
