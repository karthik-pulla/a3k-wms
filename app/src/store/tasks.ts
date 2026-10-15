// Pallet tasks: the WMS picks the slot, a worker moves the pallet and confirms it's there.
import { FACES, RECEIVING, SLOTS, faceOf, slotMeta, spotCode } from "../data/catalog";
import type { State, StockLine, Task } from "./types";

export { RECEIVING };
export const OPEN: Task["status"][] = ["open", "doing"];
export const isOpen = (t: Task) => OPEN.includes(t.status);

/** Stock as the planners must see it: slots promised to open tasks count as taken */
export function occupied(state: State, exceptTask?: string): Record<string, StockLine[]> {
  const out = { ...state.stock };
  for (const t of state.tasks ?? []) if (isOpen(t) && t.id !== exceptTask && !out[t.to]?.length) out[t.to] = [{ productId: "__reserved__", cases: 0 }];
  return out;
}

/** The nearest free slot to a location (same rack side first, nearest column, lower levels first), else that side's floor */
export function nextSlot(state: State, near: string, avoid: string[] = [], exceptTask?: string): string {
  const stock = occupied(state, exceptTask);
  const m = slotMeta(near);
  const face = faceOf(near);
  const free = (code: string) => !stock[code]?.length && !avoid.includes(code) && code !== near;
  const sameFace = SLOTS.filter(s => s.face === face && free(s.code)).sort((a, b) => Math.abs(a.col - (m?.col ?? 0)) - Math.abs(b.col - (m?.col ?? 0)) || a.level - b.level || a.bay - b.bay);
  if (sameFace.length) return sameFace[0].code;
  const anywhere = SLOTS.find(s => free(s.code));
  if (anywhere && !FACES.some(f => f.id === face)) return anywhere.code;
  for (let n = 1; n < 100; n++) { const c = spotCode(face, n); if (free(c)) return c; }
  return anywhere?.code ?? spotCode(face, 99);
}

export const taskLabel = (t: Task) => (t.kind === "putaway" ? "Put away" : "Move");
let seq = 0;
export const taskId = () => `T${Date.now().toString(36)}${(++seq).toString(36)}`;
