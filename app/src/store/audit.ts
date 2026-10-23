// The change log ("Logs"): one line per change, saying what was done. Who and when are added by the store.
// Messages aren't logged (they're conversation, not data, and direct messages stay private).
import { productById } from "../data/catalog";
import type { AuditEntry, State } from "./types";
import { strategyName } from "../outbound/plan";
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
  const team = (id?: string) => (id ? `the ${(after.teams ?? []).find(t => t.id === id)?.name ?? (before.teams ?? []).find(t => t.id === id)?.name ?? id} team` : "");
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
    case "order/approve": return { area: "outbound", action: `Approved ${a.id}; picks planned (${strategyName(a.strategy).toLowerCase()})` };
    case "order/plan": return { area: "outbound", action: `Re-planned the picks for ${a.id} (${strategyName(a.strategy).toLowerCase()})` };
    case "order/assign": return { area: "outbound", action: `Gave ${a.id} to ${person(a.assignee)} to pack` };
    case "order/pick": { const p = before.orders.find(o => o.id === a.id)?.picks?.find(x => x.key === a.key); return { area: "outbound", pallet: true, action: `Picked ${cs(a.cases)} of ${pn(p?.productId)} from ${p?.location} for ${a.id}${a.note ? ` (${a.note})` : ""}` }; }
    case "order/unpick": { const p = before.orders.find(o => o.id === a.id)?.picks?.find(x => x.key === a.key); return { area: "outbound", pallet: true, action: `Put ${cs(p?.picked?.cases ?? 0)} of ${pn(p?.productId)} back on ${p?.location} (${a.id})` }; }
    case "order/ship": return { area: "outbound", action: `Confirmed ${a.id} and marked it shipped` };
    case "order/cancel": return { area: "outbound", action: `Cancelled ${a.id}: ${a.reason}` };
    case "order/delete": return { area: "outbound", action: `Deleted the draft ${a.id}` };
    case "inbox/status": return a.status === "ignored" ? { area: "outbound", action: `Ignored the email "${before.inbox.find(m => m.id === a.id)?.subject}"` } : null;
    case "task/create": return { area: "task", pallet: true, action: `Created a task: ${a.task.kind === "move" ? "move" : "put away"} ${lines(a.task.lines)} from ${a.task.from} to ${a.task.to}${a.task.palletNote ? ` (pallet: ${a.task.palletNote})` : ""}${a.task.assignee ? ` (given to ${person(a.task.assignee)})` : a.task.team ? ` (given to ${team(a.task.team)})` : ""}${a.task.reason ? `. Reason: ${a.task.reason}` : ""}` };
    case "task/assign": { const t = task(a.id); return { area: "task", action: `Gave the task ${t?.from} → ${t?.to} to ${a.assignee || !a.team ? person(a.assignee) : team(a.team)}` }; }
    case "task/start": { const t = task(a.id); return { area: "task", pallet: true, action: `Started: ${t?.kind === "move" ? "move" : "put away"} ${t?.from} → ${t?.to}` }; }
    case "task/done": { const t = task(a.id); return { area: "task", pallet: true, action: `Confirmed the pallet is in ${t?.to} (${t?.kind === "putaway" ? `put away from ${t?.from}` : `moved from ${t?.from}`}): ${lines(t?.lines ?? [])}` }; }
    case "task/blocked": { const t = task(a.id); return { area: "task", pallet: true, action: `Reported ${before.tasks.find(x => x.id === a.id)?.to} blocked; the WMS gave ${t?.to} instead` }; }
    case "task/cancel": { const t = task(a.id); return { area: "task", action: `Cancelled the task ${t?.from} → ${t?.to}: ${a.reason}` }; }
    case "warehouse/settings": return { area: "settings", action: `Changed the warehouse settings: ${settingWords(a.patch)}` };
    case "notice/post": return { area: "settings", action: `${(before.notices ?? []).some(n => n.id === a.notice.id) ? "Edited" : "Posted"} the announcement "${a.notice.text.slice(0, 120)}"${a.notice.until ? ` (until ${a.notice.until})` : ""}` };
    case "notice/remove": return { area: "settings", action: `Took down the announcement "${(before.notices ?? []).find(n => n.id === a.id)?.text.slice(0, 120) ?? a.id}"` };
    case "team/save": return { area: "task", action: `${(before.teams ?? []).some(t => t.id === a.team.id) ? "Changed" : "Made"} the work team ${a.team.name}: ${a.team.members.map((m: string) => person(m)).join(", ") || "nobody yet"}` };
    case "team/delete": return { area: "task", action: `Removed the work team ${(before.teams ?? []).find(t => t.id === a.id)?.name ?? a.id}` };
    default: return null;
  }
}

/** A settings change in words, for the log */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function settingWords(p: any): string {
  const out: string[] = [];
  if ("name" in p) out.push(`name "${p.name ?? ""}"`);
  if ("pickRule" in p || "openFirst" in p) out.push(`picking rule ${[p.pickRule?.toUpperCase(), p.openFirst === false ? "without finishing open pallets first" : p.openFirst ? "open pallets first" : ""].filter(Boolean).join(", ")}`);
  if ("routes" in p) out.push(`email routing (${(p.routes ?? []).length} rule${(p.routes ?? []).length === 1 ? "" : "s"})`);
  if ("contacts" in p) out.push(`contacts (${(p.contacts ?? []).length})`);
  return out.join("; ") || "nothing";
}
