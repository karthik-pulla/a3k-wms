import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { SyncEngine } from "../sync/engine";
import { sampleState, withOutbound, withSampleDates, withSampleWork } from "./sample";
import type { Announcement, AuditEntry, Conversation, CountEntry, CountSession, InboxMail, Message, Movement, PickStrategy, Presence, ReturnOutcome, ReturnRequest, Shipment, State, StockLine, StoreOrder, Task, User, WarehouseSettings, WorkTeam } from "./types";
import { RECEIVING, isOpen, taskId } from "./tasks";
import { CLIENTS, applyProductEdits, productById } from "../data/catalog";
import type { ProductText } from "../../../server/src/shared/products.ts";
import { describe } from "./audit";
import { canSeeClient } from "../auth/permissions";
import { planOrder, putBack, statusOf, takeFrom } from "../outbound/plan";
import { sampleChat } from "../chat/sampleChat";
import type { PalletPlan } from "./putaway";

// Saved (encrypted) on this device until the server exists. "Reset sample data" in Settings starts over.

type Action =
  | { type: "saveShipment"; shipment: Shipment }
  | { type: "receive"; id: string; by: string; condition: "ok" | "damaged" }
  | { type: "putaway"; id: string; by: string; plan: PalletPlan[] }
  | { type: "submitReturn"; request: ReturnRequest }
  | { type: "decideReturn"; id: string; by: string; approve: boolean; outcome?: ReturnOutcome; note: string }
  | { type: "reset" }
  /** A product's code, name and full description (the id stays). before = what the editor saw, for the log. */
  | { type: "product/edit"; id: string; before: ProductText; after: ProductText; reason: string }
  // Inventory
  | { type: "move"; from: string; to: string; by: string; reason: string }
  | { type: "count/start"; session: CountSession }
  | { type: "count/set"; id: string; changes: { code: string; entry: CountEntry | null }[] }
  | { type: "count/status"; id: string; status: CountSession["status"]; by: string }
  /** Removes the count and what was entered in it. Corrections already applied stay in stock and the history. */
  | { type: "count/delete"; id: string }
  // Out-bounds
  | { type: "order/save"; order: StoreOrder }
  | { type: "order/approve"; id: string; by: string; strategy: PickStrategy }
  /** Plan the not-yet-picked part again (stock changed, or a different strategy) */
  | { type: "order/plan"; id: string; strategy: PickStrategy }
  | { type: "order/pick"; id: string; key: string; cases: number; by: string; note?: string }
  | { type: "order/unpick"; id: string; key: string; by: string }
  | { type: "order/ship"; id: string; by: string }
  /** Cancelling puts any picked cases back on their pallets */
  | { type: "order/cancel"; id: string; by: string; reason: string }
  | { type: "order/delete"; id: string }
  | { type: "inbox/add"; mail: InboxMail }
  | { type: "inbox/status"; id: string; status: InboxMail["status"]; orderId?: string; shipmentId?: string }
  /** The signed-in account as a person in the app (Messages, history): added or updated, and given the team channel and the threads of clients they may see */
  | { type: "account/user"; user: User }
  // Roles: guarded owner edits, pallet tasks, packing assignments
  | { type: "stock/adjust"; location: string; lines: StockLine[]; by: string; reason: string }
  /** Scanned a slot's QR code and counted it: new case counts for lines already there (0 removes one). Products can't be added here. */
  | { type: "stock/scan-adjust"; location: string; changes: { line: StockLine; cases: number }[]; by: string; reason: string }
  | { type: "task/create"; task: Task }
  /** To a worker, to a team (any of its members may take it), or back to anyone */
  | { type: "task/assign"; id: string; assignee?: string; team?: string }
  | { type: "task/start"; id: string; byId: string }
  | { type: "task/blocked"; id: string; to: string }
  | { type: "task/cancel"; id: string; by: string; reason: string }
  | { type: "task/done"; id: string; by: string }
  | { type: "order/assign"; id: string; assignee?: string }
  /** Owner decision: apply the counted stock to these locations, or keep the system stock */
  | { type: "count/decide"; id: string; by: string; apply: string[]; keep: string[]; note: string }
  // Manage warehouse: the warehouse's own settings, announcements on the home screens, and work teams
  | { type: "warehouse/settings"; patch: Partial<WarehouseSettings>; by: string }
  | { type: "notice/post"; notice: Announcement }
  | { type: "notice/remove"; id: string }
  | { type: "team/save"; team: WorkTeam }
  | { type: "team/delete"; id: string }
  // Messages (only the chat data layer dispatches these)
  | { type: "chat/add"; message: Message }
  | { type: "chat/status"; ids: string[]; status: Message["status"] }
  | { type: "chat/read"; userId: string; conversationId: string; at: string }
  | { type: "chat/presence"; userId: string; patch: Partial<Presence> }
  | { type: "chat/conversation"; conversation: Conversation }
  | { type: "chat/rename"; userId: string; name: string }
  | { type: "chat/escalated"; ids: string[]; at: string };

// The time a change was made: from the action (so a change saved later, after being offline, keeps its real time,
// and every device working it out again gets the same answer), else now
let clock: string | undefined;
const now = () => clock ?? new Date().toISOString();

function reducer(state: State, a: Action): State {
  const log = (m: Omit<Movement, "id" | "at">[]): Movement[] =>
    [...m.map((x, i) => ({ ...x, id: `M${state.movements.length + i + 1}`, at: now() })), ...state.movements];
  switch (a.type) {
    case "saveShipment": {
      const exists = state.shipments.some(s => s.id === a.shipment.id);
      return { ...state, shipments: exists ? state.shipments.map(s => (s.id === a.shipment.id ? a.shipment : s)) : [a.shipment, ...state.shipments] };
    }
    case "receive":
      return {
        ...state,
        shipments: state.shipments.map(s => (s.id === a.id ? { ...s, status: "pending", receivedAt: now(), receivedBy: a.by, condition: a.condition } : s)),
        movements: log([{ by: a.by, type: "receive", shipmentId: a.id, reason: a.condition === "damaged" ? "Arrived with damage" : "Arrived" }]),
      };
    case "putaway": {
      // Confirming gives each pallet a task to its slot; stock is added when a worker confirms it's in the slot
      const s = state.shipments.find(x => x.id === a.id);
      if (!s) return state;
      const tasks: Task[] = a.plan.map((p, i) => {
        const meta = (productId: string) => s.lines.find(l => l.productId === productId && l.pallet === p.pallet);
        return {
          id: `${taskId()}${i}`, kind: "putaway", status: "open", from: RECEIVING, to: p.slot, shipmentId: s.id, pallet: p.pallet, reason: p.reason,
          lines: p.lines.map(l => ({ ...l, lot: meta(l.productId)?.lot, bestBefore: meta(l.productId)?.bestBefore, shipmentId: s.id })),
          createdBy: a.by, createdAt: now(),
        };
      });
      return {
        ...state,
        tasks: [...tasks, ...state.tasks],
        shipments: state.shipments.map(x => (x.id === a.id
          ? { ...x, status: "putaway", confirmedAt: now(), confirmedBy: a.by, putaway: a.plan.map(p => ({ pallet: p.pallet, slot: p.slot, reason: p.reason })) }
          : x)),
      };
    }
    case "stock/adjust": {
      const before = state.stock[a.location] ?? [];
      const stock = { ...state.stock };
      if (a.lines.length) stock[a.location] = a.lines; else delete stock[a.location];
      const ids = new Set([...before, ...a.lines].map(l => l.productId));
      const moves = [...ids].map(id => ({ id, d: a.lines.filter(l => l.productId === id).reduce((x, l) => x + l.cases, 0) - before.filter(l => l.productId === id).reduce((x, l) => x + l.cases, 0) }))
        .filter(x => x.d !== 0).map(x => ({ by: a.by, type: "adjustment" as const, location: a.location, productId: x.id, cases: x.d, reason: a.reason }));
      return { ...state, stock, movements: log(moves) };
    }
    case "stock/scan-adjust": {
      // Lines are matched by what they are (product, lot, best-before, delivery), so a change made offline still finds them
      const same = (x: StockLine, y: StockLine) => x.productId === y.productId && (x.lot ?? "") === (y.lot ?? "") && (x.bestBefore ?? "") === (y.bestBefore ?? "") && (x.shipmentId ?? "") === (y.shipmentId ?? "");
      const before = state.stock[a.location] ?? [];
      const moves: Omit<Movement, "id" | "at">[] = [];
      // Each change applies to one line: two identical lines (same product, lot, date) take one change each
      const used = new Set<number>();
      const next = before.flatMap(l => {
        const ci = a.changes.findIndex((ch, i) => !used.has(i) && same(ch.line, l));
        if (ci >= 0) used.add(ci);
        const c = ci >= 0 ? a.changes[ci] : undefined;
        if (!c || c.cases === l.cases || c.cases < 0 || !Number.isInteger(c.cases)) return [l];
        moves.push({ by: a.by, type: "adjustment", location: a.location, productId: l.productId, cases: c.cases - l.cases, reason: `Slot QR: ${a.reason}` });
        return c.cases ? [{ ...l, cases: c.cases }] : [];
      });
      if (!moves.length) return state;
      const stock = { ...state.stock };
      if (next.length) stock[a.location] = next; else delete stock[a.location];
      return { ...state, stock, movements: log(moves) };
    }
    case "task/create":
      return { ...state, tasks: [a.task, ...state.tasks] };
    case "task/assign":
      return { ...state, tasks: state.tasks.map(t => (t.id === a.id ? { ...t, assignee: a.assignee, team: a.team } : t)) };
    case "task/start":
      return { ...state, tasks: state.tasks.map(t => (t.id === a.id && t.status === "open" ? { ...t, status: "doing", startedAt: now(), assignee: t.assignee ?? a.byId } : t)) };
    case "task/blocked":
      return { ...state, tasks: state.tasks.map(t => (t.id === a.id ? { ...t, to: a.to, blocked: [...(t.blocked ?? []), t.to] } : t)) };
    case "task/cancel":
      return { ...state, tasks: state.tasks.map(t => (t.id === a.id && isOpen(t) ? { ...t, status: "cancelled", doneBy: a.by, doneAt: now(), reason: [t.reason, `Cancelled: ${a.reason}`].filter(Boolean).join(" · ") } : t)) };
    case "task/done": {
      const t = state.tasks.find(x => x.id === a.id);
      if (!t || !isOpen(t)) return state;
      const stock = { ...state.stock };
      if (t.kind === "move") {
        // Take away one line per line moved: a floor spot may hold two identical pallets, and only one of them went
        const taken = new Set<number>();
        const left = (stock[t.from] ?? []).filter(l => {
          const i = t.lines.findIndex((m, n) => !taken.has(n) && m.productId === l.productId && m.lot === l.lot && (m.bestBefore ?? "") === (l.bestBefore ?? ""));
          if (i < 0) return true;
          taken.add(i);
          return false;
        });
        if (left.length) stock[t.from] = left; else delete stock[t.from];
      }
      stock[t.to] = [...(stock[t.to] ?? []), ...t.lines];
      const tasks = state.tasks.map(x => (x.id === a.id ? { ...x, status: "done" as const, doneBy: a.by, doneAt: now() } : x));
      // A delivery is stored once every one of its pallets is in its slot
      const shipments = t.shipmentId && !tasks.some(x => x.shipmentId === t.shipmentId && isOpen(x))
        ? state.shipments.map(s => (s.id === t.shipmentId ? { ...s, status: "stored" as const } : s)) : state.shipments;
      return {
        ...state, stock, tasks, shipments,
        movements: log(t.lines.map(l => ({ by: a.by, type: t.kind === "move" ? "move" as const : "putaway" as const, from: t.from, shipmentId: t.shipmentId, location: t.to, productId: l.productId, cases: l.cases, reason: t.reason }))),
      };
    }
    case "order/assign":
      return { ...state, orders: state.orders.map(o => (o.id === a.id ? { ...o, assignee: a.assignee } : o)) };
    case "warehouse/settings":
      return { ...state, settings: { ...state.settings, ...a.patch, updatedBy: a.by, updatedAt: now() } };
    case "notice/post": {
      const list = state.notices ?? [];
      return { ...state, notices: list.some(n => n.id === a.notice.id) ? list.map(n => (n.id === a.notice.id ? a.notice : n)) : [a.notice, ...list] };
    }
    case "notice/remove":
      return { ...state, notices: (state.notices ?? []).filter(n => n.id !== a.id) };
    case "team/save": {
      const list = state.teams ?? [];
      return { ...state, teams: list.some(t => t.id === a.team.id) ? list.map(t => (t.id === a.team.id ? a.team : t)) : [a.team, ...list] };
    }
    case "team/delete":
      // Open tasks given to the team go back to everyone
      return { ...state, teams: (state.teams ?? []).filter(t => t.id !== a.id), tasks: state.tasks.map(t => (t.team === a.id && isOpen(t) ? { ...t, team: undefined } : t)) };
    case "submitReturn":
      return { ...state, returns: [a.request, ...state.returns], seq: state.seq + 1 };
    case "decideReturn": {
      const r = state.returns.find(x => x.id === a.id);
      if (!r) return state;
      const decided: ReturnRequest = { ...r, status: a.approve ? "approved" : "rejected", outcome: a.approve ? a.outcome : undefined, decidedAt: now(), decidedBy: a.by, decisionNote: a.note };
      // Goods going back into stock become a pending in-bound, so they get a slot through the normal confirmation
      const order = state.orders.find(o => o.id === r.orderId);
      const restock: Shipment[] = a.approve && a.outcome === "restock" ? [{
        id: `return-${r.id.toLowerCase()}`, client: order?.client ?? productById(r.items.find(i => i.productId)?.productId ?? "")?.client ?? CLIENTS[0], number: r.id, supplier: `Return from ${r.store}`, ref: r.orderId,
        expected: now().slice(0, 10), status: "pending", receivedAt: now(), receivedBy: a.by, condition: "ok", returnId: r.id,
        lines: r.items.filter(i => i.productId && i.cases > 0).map((i, n) => ({ key: `${r.id}-${n}`, productId: i.productId, cases: i.cases, pallet: 1, lot: "", bestBefore: "" })),
      }] : [];
      return {
        ...state,
        returns: state.returns.map(x => (x.id === a.id ? decided : x)),
        shipments: [...restock, ...state.shipments],
        movements: log([{ by: a.by, type: a.approve ? "return-approved" : "return-rejected", reason: `${r.id}: ${a.approve ? a.outcome : "rejected"}${a.note ? ` (${a.note})` : ""}` }]),
      };
    }
    case "reset":
      // The change log survives a reset (it's never edited or cleared), and so do product edits (they're the warehouse's, not sample data)
      return withSampleWork({ ...sampleState(), tasks: [], audit: state.audit ?? [], productEdits: state.productEdits, settings: state.settings });
    case "product/edit":
      if (!productById(a.id)) return state;
      return { ...state, productEdits: { ...(state.productEdits ?? {}), [a.id]: a.after } };
    case "move": {
      const lines = state.stock[a.from];
      if (!lines?.length || a.from === a.to) return state;
      const stock = { ...state.stock, [a.to]: [...(state.stock[a.to] ?? []), ...lines] };
      delete stock[a.from];
      return { ...state, stock, movements: log(lines.map(l => ({ by: a.by, type: "move" as const, from: a.from, location: a.to, productId: l.productId, cases: l.cases, reason: a.reason }))) };
    }
    case "count/start":
      return { ...state, counts: [a.session, ...state.counts] };
    case "count/set":
      return { ...state, counts: state.counts.map(c => {
        if (c.id !== a.id || c.status === "closed") return c;
        const entries = { ...c.entries };
        for (const ch of a.changes) { if (ch.entry) entries[ch.code] = ch.entry; else delete entries[ch.code]; }
        return { ...c, entries };
      }) };
    case "order/save": {
      const exists = state.orders.some(o => o.id === a.order.id);
      return { ...state, orders: exists ? state.orders.map(o => (o.id === a.order.id ? a.order : o)) : [a.order, ...state.orders] };
    }
    case "order/approve":
    case "order/plan": {
      const o = state.orders.find(x => x.id === a.id);
      if (!o) return state;
      const plan = planOrder(state, o, a.strategy);
      const next: StoreOrder = { ...o, strategy: a.strategy, picks: plan.picks, short: plan.short,
        ...(a.type === "order/approve" ? { status: "approved" as const, approvedBy: a.by, approvedAt: now() } : {}) };
      return { ...state, orders: state.orders.map(x => (x.id === a.id ? next : x)) };
    }
    case "order/pick": {
      const o = state.orders.find(x => x.id === a.id);
      const p = o?.picks?.find(x => x.key === a.key);
      if (!o || !p || p.picked) return state;
      const { lines, taken } = takeFrom(state.stock[p.location] ?? [], p.productId, a.cases, state, p.location);
      const got = taken.reduce((x, l) => x + l.cases, 0);
      const stock = { ...state.stock };
      if (lines.length) stock[p.location] = lines; else delete stock[p.location];
      let picks = o.picks!.map(x => (x.key === a.key ? { ...x, picked: { cases: got, by: a.by, at: now(), note: a.note, taken } } : x));
      let short = o.short;
      const after: State = { ...state, stock, orders: state.orders.map(x => (x.id === a.id ? { ...o, picks } : x)) };
      // Fewer cases than planned on that pallet: plan the rest from the next pallets (oldest first)
      // (the picker found that pallet short, so it's skipped for this order and flagged for a recount)
      let avoid = o.avoid;
      if (got < p.cases) { avoid = [...new Set([...(o.avoid ?? []), `${p.location}|${p.productId}`])]; const plan = planOrder(after, { ...o, picks, avoid }); picks = plan.picks; short = plan.short; }
      const status = picks.every(x => x.picked) ? "picked" as const : "picking" as const;
      return {
        ...after,
        orders: after.orders.map(x => (x.id === a.id ? { ...o, picks, short, avoid, status } : x)),
        movements: log([{ by: a.by, type: "pick", orderId: o.id, location: p.location, productId: p.productId, cases: got, reason: `${o.id} · ${o.store}${a.note ? ` (${a.note})` : ""}` }]),
      };
    }
    case "order/unpick": {
      const o = state.orders.find(x => x.id === a.id);
      const p = o?.picks?.find(x => x.key === a.key);
      if (!o || !p?.picked) return state;
      const stock = { ...state.stock, [p.location]: putBack(state.stock[p.location] ?? [], p.picked.taken) };
      const avoid = (o.avoid ?? []).filter(k => k !== `${p.location}|${p.productId}`);
      const undone = { ...o, avoid, picks: o.picks!.map(x => (x.key === a.key ? { ...x, picked: undefined } : x)) };
      // Plan the open part of the order again, so nothing is planned twice
      const plan = planOrder({ ...state, stock }, { ...undone, picks: undone.picks.filter(x => x.picked) });
      return {
        ...state, stock,
        orders: state.orders.map(x => (x.id === a.id ? { ...undone, picks: plan.picks, short: plan.short, status: plan.picks.some(x => x.picked) ? "picking" as const : "approved" as const } : x)),
        movements: log([{ by: a.by, type: "pick-undo", orderId: o.id, location: p.location, productId: p.productId, cases: p.picked.cases, reason: `Put back for ${o.id}` }]),
      };
    }
    case "order/ship":
      return { ...state, orders: state.orders.map(o => (o.id === a.id ? { ...o, status: "shipped" as const, shippedAt: now(), shippedBy: a.by } : o)) };
    case "order/cancel": {
      const o = state.orders.find(x => x.id === a.id);
      if (!o) return state;
      const stock = { ...state.stock };
      const moves: Omit<Movement, "id" | "at">[] = [];
      for (const p of o.picks ?? []) if (p.picked) {
        stock[p.location] = putBack(stock[p.location] ?? [], p.picked.taken);
        moves.push({ by: a.by, type: "pick-undo", orderId: o.id, location: p.location, productId: p.productId, cases: p.picked.cases, reason: `${o.id} cancelled: ${a.reason}` });
      }
      const picks = (o.picks ?? []).map(p => ({ ...p, picked: undefined }));
      return { ...state, stock, movements: log(moves), orders: state.orders.map(x => (x.id === a.id ? { ...o, picks, status: "cancelled" as const, cancelledAt: now(), cancelledBy: a.by, notes: [o.notes, `Cancelled: ${a.reason}`].filter(Boolean).join("\n") } : x)) };
    }
    case "order/delete":
      return { ...state, orders: state.orders.filter(o => !(o.id === a.id && statusOf(o) === "draft")) };
    case "account/user": {
      const u = a.user;
      const users = state.chat.users.some(x => x.id === u.id) ? state.chat.users.map(x => (x.id === u.id ? { ...x, ...u } : x)) : [...state.chat.users, u];
      const sees = (c: Conversation) => {
        if (c.kind === "channel") return c.id === "team" || (c.shift === "am" && u.groups.includes("shift-am")) || (c.shift === "pm" && u.groups.includes("shift-pm"));
        if (c.kind === "dm" || c.kind === "group") return false;
        const rec = c.link?.type === "order" ? state.orders.find(o => o.id === c.link!.id) : state.shipments.find(x => x.id === c.link?.id);
        return !!rec && canSeeClient(u, rec.client);
      };
      const conversations = state.chat.conversations.map(c => (sees(c) && !c.members.includes(u.id) ? { ...c, members: [...c.members, u.id] } : !sees(c) && c.kind !== "dm" && c.kind !== "group" && c.members.includes(u.id) ? { ...c, members: c.members.filter(m => m !== u.id) } : c));
      const presence = state.chat.presence[u.id] ? state.chat.presence : { ...state.chat.presence, [u.id]: { userId: u.id, state: "online" as const, lastSeenAt: now() } };
      return { ...state, chat: { ...state.chat, users, conversations, presence } };
    }
    case "inbox/add":
      return { ...state, inbox: [a.mail, ...state.inbox] };
    case "inbox/status":
      return { ...state, inbox: state.inbox.map(m => (m.id === a.id ? { ...m, status: a.status, orderId: a.orderId ?? m.orderId, shipmentId: a.shipmentId ?? m.shipmentId } : m)) };
    case "count/delete":
      return { ...state, counts: state.counts.filter(c => c.id !== a.id) };
    case "count/status":
      return { ...state, counts: state.counts.map(c => (c.id === a.id ? { ...c, status: a.status, ...(a.status === "closed" ? { closedAt: now(), closedBy: a.by } : {}) } : c)) };
    case "count/decide": {
      const c = state.counts.find(x => x.id === a.id);
      if (!c) return state;
      const stock = { ...state.stock };
      const moves: Omit<Movement, "id" | "at">[] = [];
      const reason = `Count "${c.name}"${a.note ? `: ${a.note}` : ""}`;
      for (const code of a.apply) {
        const e = c.entries[code];
        if (!e) continue;
        const before = stock[code] ?? [];
        // Keep lot, best-before and delivery of lines whose product is still there
        const next: StockLine[] = e.lines.map(l => { const old = before.find(b => b.productId === l.productId); return { ...old, productId: l.productId, cases: l.cases }; });
        const ids = new Set([...before.map(l => l.productId), ...next.map(l => l.productId)]);
        for (const id of ids) {
          const was = before.filter(l => l.productId === id).reduce((x, l) => x + l.cases, 0);
          const is = next.filter(l => l.productId === id).reduce((x, l) => x + l.cases, 0);
          if (was !== is) moves.push({ by: a.by, type: "count-correction", location: code, productId: id, cases: is - was, reason });
        }
        if (next.length) stock[code] = next; else delete stock[code];
      }
      const decided = { ...c.decided };
      for (const code of a.apply) decided[code] = "applied";
      for (const code of a.keep) decided[code] = "kept";
      return { ...state, stock, movements: log(moves), counts: state.counts.map(x => (x.id === a.id ? { ...x, decided } : x)) };
    }
    case "chat/add":
      return { ...state, chat: { ...state.chat, seq: state.chat.seq + 1, messages: [...state.chat.messages, a.message] } };
    case "chat/status": {
      const ids = new Set(a.ids);
      return { ...state, chat: { ...state.chat, messages: state.chat.messages.map(m => (ids.has(m.id) ? { ...m, status: a.status } : m)) } };
    }
    case "chat/read": {
      const mine = state.chat.reads[a.userId] ?? {};
      if ((mine[a.conversationId] ?? "") >= a.at) return state;
      return { ...state, chat: { ...state.chat, reads: { ...state.chat.reads, [a.userId]: { ...mine, [a.conversationId]: a.at } } } };
    }
    case "chat/presence": {
      const cur = state.chat.presence[a.userId] ?? { userId: a.userId, state: "offline", lastSeenAt: now() };
      if (Object.entries(a.patch).every(([k, v]) => JSON.stringify(cur[k as keyof Presence]) === JSON.stringify(v))) return state;
      return { ...state, chat: { ...state.chat, presence: { ...state.chat.presence, [a.userId]: { ...cur, ...a.patch } } } };
    }
    case "chat/conversation": {
      const exists = state.chat.conversations.some(c => c.id === a.conversation.id);
      return { ...state, chat: { ...state.chat, conversations: exists ? state.chat.conversations.map(c => (c.id === a.conversation.id ? a.conversation : c)) : [...state.chat.conversations, a.conversation] } };
    }
    case "chat/rename":
      return { ...state, chat: { ...state.chat, users: state.chat.users.map(u => (u.id === a.userId ? { ...u, name: a.name } : u)) } };
    case "chat/escalated": {
      const ids = new Set(a.ids);
      return { ...state, chat: { ...state.chat, messages: state.chat.messages.map(m => (ids.has(m.id) ? { ...m, escalatedAt: a.at } : m)) } };
    }
  }
}

/** Brings data saved by an older version of the app up to date */
/** Before roles were renamed (Oct 2026): "supervisor" became "coordinator" */
function renameRoles(s: State): State {
  const raw = JSON.stringify(s.chat);
  if (!raw.includes("supervisor")) return s;
  return { ...s, chat: JSON.parse(raw.replace(/"supervisors"/g, '"coordinators"').replace(/"supervisor"/g, '"coordinator"').replace(/@supervisors/g, "@coordinators")) };
}

export function migrate(input: State | null): State {
  if (!input || input.version !== 1) return withRoles(sampleState());
  const s = renameRoles(input);
  // Saved before Messages existed: add the sample chat
  const withChat = s.chat ? s : { ...s, chat: sampleChat(s) };
  // Saved before Inventory existed: no counts yet, and the sample sheet stock gets its sample dates
  const withCounts = withChat.counts ? withChat : { ...withChat, counts: [], stock: withSampleDates(withChat.stock) };
  // Saved before Out-bounds existed: orders get their status, due dates and picking plans; the inbox gets its sample mail
  const withOut = withCounts.inbox ? withCounts : withOutbound(withCounts);
  return withRoles(withOut);
}

/** Added with roles (Oct 2026): the change log and pallet tasks */
function withRoles(s: State): State {
  const withLog = { ...s, audit: s.audit ?? [] };
  return s.tasks ? withLog : withSampleWork({ ...withLog, tasks: [] });
}

/** Who's making changes (the signed-in account), added to every action so the change log can say who did it */
export interface Actor { id: string; name: string }
/** An action as dispatched: who, and when it was made */
export type Logged = Action & { actor?: Actor; at?: string };
export type { Action as StoreAction };

/**
 * Every change is applied, then recorded in the change log with who and when. Pure for a given action (its `at`
 * stands in for the clock), so the server sync (app/src/sync/) can work a change out again on newer data.
 */
export function root(state: State, a: Logged, opts: { keepAllLog?: boolean } = {}): State {
  clock = a.at;
  try {
    const next = reducer(state, a);
    if (next === state || !a.actor) return next;
    const d = describe(state, a, next);
    if (!d) return next;
    const at = now();
    const entry: AuditEntry = { id: `A${(state.audit?.length ?? 0) + 1}-${Date.parse(at).toString(36)}`, at, byId: a.actor.id, by: a.actor.name, ...d };
    const audit = [entry, ...(next.audit ?? [])];
    // On this device the log is capped; on the server it's never cut (and never shrinks)
    return { ...next, audit: opts.keepAllLog ? audit : audit.slice(0, 20000) };
  } finally { clock = undefined; }
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void; setActor: (a: Actor) => void } | null>(null);

/**
 * App data. It comes from the encrypted vault once someone signs in, and every change is handed back to be
 * encrypted and saved (see auth/AuthGate); nothing is written to the browser unencrypted.
 */
export function StoreProvider({ initial, onChange, children }: { initial: State | null; onChange: (s: State) => void; children: ReactNode }) {
  const [state, raw] = useReducer((s: State, a: Logged) => root(s, a), initial, migrate);
  // Before anything below renders, so every screen reads the edited codes and names
  applyProductEdits(state.productEdits);
  const actor = useRef<Actor | undefined>(undefined);
  const dispatch = useCallback((a: Action) => raw({ ...a, actor: actor.current, at: new Date().toISOString() }), []);
  const setActor = useCallback((a: Actor) => { actor.current = a; }, []);
  useEffect(() => { onChange(state); }, [state, onChange]);
  const value = useMemo(() => ({ state, dispatch, setActor }), [state, dispatch, setActor]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The same store, kept in step with the server by a SyncEngine (app/src/sync/engine.ts) instead of the vault */
export function SyncStoreProvider({ engine, children }: { engine: SyncEngine; children: ReactNode }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  applyProductEdits(state.productEdits);
  const actor = useRef<Actor | undefined>(undefined);
  const dispatch = useCallback((a: Action) => engine.dispatch({ ...a, actor: actor.current, at: new Date().toISOString() }), [engine]);
  const setActor = useCallback((a: Actor) => { actor.current = a; }, []);
  const value = useMemo(() => ({ state, dispatch, setActor }), [state, dispatch, setActor]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The app's logic as the sync engine needs it: the whole change log kept (the server never shortens it) */
export const syncReduce = (s: State, a: Logged) => root(s, a, { keepAllLog: true });

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}

export const shipmentTitle = (s: Shipment) => `${s.client} ${s.number}`;
export const totalCases = (s: Shipment) => s.lines.reduce((a, l) => a + (l.cases || 0), 0);
export const palletCount = (s: Shipment) => new Set(s.lines.filter(l => l.productId).map(l => l.pallet)).size;
