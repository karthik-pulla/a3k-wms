// The change log ("Logs"): one line per change, saying what was done. Who and when are added by the store.
// Messages aren't logged (they're conversation, not data, and direct messages stay private).
import { productById } from "../data/catalog";
import type { AuditEntry, State } from "./types";
import { productChanges } from "../../../server/src/shared/products.ts";

type Described = Pick<AuditEntry, "area" | "action" | "pallet">;
const pn = (id?: string | null) => { const p = id ? productById(id) : undefined; return p ? `${p.code} ${p.name}` : "a product"; };
const cs = (n: number) => `${n} case${n === 1 ? "" : "s"}`;
const lines = (ls: { productId: string | null; cases: number }[]) => ls.map(l => `${pn(l.productId)} × ${l.cases}`).join(", ") || "nothing";

/** What an action did, in words; null for actions that don't change data (or that changed nothing) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function describe(before: State, a: any, after: State): Described | null {
  const ship = (id: string) => before.shipments.find(s => s.id === id) ?? after.shipments.find(s => s.id === id);
  const title = (id: string) => { const s = ship(id); return s ? `${s.client} ${s.number}` : id; };
  const task = (id: string) => after.tasks.find(t => t.id === id) ?? before.tasks.find(t => t.id === id);
  const person = (id?: string) => (id ? after.chat.users.find(u => u.id === id)?.name ?? id : "any worker");
  switch (a.type) {
    case "saveShipment": return { area: "inbound", action: `${before.shipments.some(s => s.id === a.shipment.id) ? "Edited" : "Added"} delivery ${a.shipment.client} ${a.shipment.number}: ${lines(a.shipment.lines)}` };
    case "receive": return { area: "inbound", action: `Marked ${title(a.id)} arrived${a.condition === "damaged" ? " with damage" : ""}` };
    case "putaway": return { area: "inbound", action: `Confirmed ${title(a.id)} and assigned slots: ${a.plan.map((p: { pallet: number; slot: string }) => `P${p.pallet} → ${p.slot}`).join(", ")}` };
    case "submitReturn": return { area: "inbound", action: `Requested return ${a.request.id} from ${a.request.store}: ${lines(a.request.items)} (${a.request.reason})` };
    case "decideReturn": return { area: "inbound", action: `${a.approve ? `Approved return ${a.id} (${a.outcome})` : `Rejected return ${a.id}`}${a.note ? `: ${a.note}` : ""}` };
    case "reset": return { area: "data", action: "Reset the sample data" };
    case "product/edit": { const c = productChanges(a.before, a.after); return c ? { area: "products", action: `Edited product ${a.before.code || "(no code)"} ${a.before.name}: ${c}. Reason: ${a.reason}` } : null; }
    case "move": return { area: "stock", pallet: true, action: `Moved the pallet on ${a.from} to ${a.to} (${lines(before.stock[a.from] ?? [])}). Reason: ${a.reason}` };
    case "stock/adjust": return { area: "stock", action: `Changed ${a.location} from ${lines(before.stock[a.location] ?? [])} to ${lines(a.lines)}. Reason: ${a.reason}` };
    case "count/start": return { area: "count", action: `Started count "${a.session.name}"${a.session.blind ? " (blind)" : ""}` };
    case "count/set": return { area: "count", action: a.changes.map((c: { code: string; entry: { lines: { productId: string; cases: number }[]; empty?: boolean } | null }) => `${c.code}: ${c.entry ? (c.entry.empty ? "empty" : lines(c.entry.lines)) : "cleared"}`).join("; ").replace(/^/, `Counted (${before.counts.find(x => x.id === a.id)?.name ?? "count"}) `) };
    case "count/status": return { area: "count", action: `${a.status === "review" ? "Finished counting" : a.status === "closed" ? "Closed" : "Reopened"} "${before.counts.find(x => x.id === a.id)?.name}"` };
    case "count/decide": return { area: "count", action: `${a.apply.length ? `Applied ${a.apply.length} count correction${a.apply.length > 1 ? "s" : ""} (${a.apply.join(", ")})` : ""}${a.apply.length && a.keep.length ? "; " : ""}${a.keep.length ? `kept system stock for ${a.keep.join(", ")}` : ""}${a.note ? `: ${a.note}` : ""}` };
    case "count/delete": return { area: "count", action: `Deleted count "${before.counts.find(x => x.id === a.id)?.name}"` };
    case "order/save": return { area: "outbound", action: `${before.orders.some(o => o.id === a.order.id) ? "Edited" : "Created"} ${a.order.id} for ${a.order.store}: ${lines(a.order.lines)}` };
    case "order/approve": return { area: "outbound", action: `Approved ${a.id}; picks planned (${a.strategy === "fifo" ? "strictly oldest first" : "oldest first, open pallets first"})` };
    case "order/plan": return { area: "outbound", action: `Re-planned the picks for ${a.id}` };
    case "order/assign": return { area: "outbound", action: `Gave ${a.id} to ${person(a.assignee)} to pack` };
    case "order/pick": { const p = before.orders.find(o => o.id === a.id)?.picks?.find(x => x.key === a.key); return { area: "outbound", pallet: true, action: `Picked ${cs(a.cases)} of ${pn(p?.productId)} from ${p?.location} for ${a.id}${a.note ? ` (${a.note})` : ""}` }; }
    case "order/unpick": { const p = before.orders.find(o => o.id === a.id)?.picks?.find(x => x.key === a.key); return { area: "outbound", pallet: true, action: `Put ${cs(p?.picked?.cases ?? 0)} of ${pn(p?.productId)} back on ${p?.location} (${a.id})` }; }
    case "order/ship": return { area: "outbound", action: `Confirmed ${a.id} and marked it shipped` };
    case "order/cancel": return { area: "outbound", action: `Cancelled ${a.id}: ${a.reason}` };
    case "order/delete": return { area: "outbound", action: `Deleted the draft ${a.id}` };
    case "inbox/status": return a.status === "ignored" ? { area: "outbound", action: `Ignored the email "${before.inbox.find(m => m.id === a.id)?.subject}"` } : null;
    case "task/create": return { area: "task", pallet: true, action: `Created a task: ${a.task.kind === "move" ? "move" : "put away"} ${lines(a.task.lines)} from ${a.task.from} to ${a.task.to}${a.task.assignee ? ` (given to ${person(a.task.assignee)})` : ""}${a.task.reason ? `. Reason: ${a.task.reason}` : ""}` };
    case "task/assign": { const t = task(a.id); return { area: "task", action: `Gave the task ${t?.from} → ${t?.to} to ${person(a.assignee)}` }; }
    case "task/start": { const t = task(a.id); return { area: "task", pallet: true, action: `Started: ${t?.kind === "move" ? "move" : "put away"} ${t?.from} → ${t?.to}` }; }
    case "task/done": { const t = task(a.id); return { area: "task", pallet: true, action: `Confirmed the pallet is in ${t?.to} (${t?.kind === "putaway" ? `put away from ${t?.from}` : `moved from ${t?.from}`}): ${lines(t?.lines ?? [])}` }; }
    case "task/blocked": { const t = task(a.id); return { area: "task", pallet: true, action: `Reported ${before.tasks.find(x => x.id === a.id)?.to} blocked; the WMS gave ${t?.to} instead` }; }
    case "task/cancel": { const t = task(a.id); return { area: "task", action: `Cancelled the task ${t?.from} → ${t?.to}: ${a.reason}` }; }
    default: return null;
  }
}
