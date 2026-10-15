import type { OrderSource, OrderStatus, StoreOrder } from "../store/types";
import { statusOf } from "./plan";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "To approve", approved: "Ready to pick", picking: "Picking", picked: "Picked, ready to ship", shipped: "Shipped", cancelled: "Cancelled",
};
export const SOURCE_LABEL: Record<OrderSource, string> = { app: "Entered in the app", pdf: "PDF upload", email: "Email", portal: "Client portal" };

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export type DueTone = "overdue" | "today" | "soon" | "later" | "none";
/** Due-date urgency for orders still to ship */
export function dueTone(o: StoreOrder): DueTone {
  if (!o.due) return "none";
  if (["shipped", "cancelled"].includes(statusOf(o))) return "later";
  if (o.due < today()) return "overdue";
  if (o.due === today()) return "today";
  if (o.due <= addDays(2)) return "soon";
  return "later";
}
export function dueText(o: StoreOrder): string {
  if (!o.due) return "no due date";
  const s = statusOf(o);
  const d = new Date(`${o.due}T12:00:00`);
  const fmt = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (s === "shipped") return `shipped · was due ${fmt}`;
  if (o.due === today()) return "due today";
  if (o.due === addDays(1)) return "due tomorrow";
  if (o.due < today()) return `overdue · was due ${fmt}`;
  return `due ${fmt}`;
}
export const isActive = (o: StoreOrder) => !["shipped", "cancelled"].includes(statusOf(o));
