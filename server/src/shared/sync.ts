// Keeping a warehouse's stock, orders, tasks and messages on the server (docs/multi-tenant-design.md, "Data on the
// server"). Shared by the app and the server; no imports, so both can use it as it is.
//
// The data is stored piece by piece ("entities"): one per slot's stock, delivery, order, task, count, counted slot,
// message and so on, each with a version number. A device changes data by running the app's own logic on the
// confirmed data, then sending the pieces that changed with the versions it started from. The server checks who
// may make that kind of change, refuses it if any piece changed in the meantime (the device then runs it again on
// the newer data), and gives every saved change a number in order, so devices catch up with "everything after N".

/** A key is "<kind>:<id>", e.g. "stock:06B-08-L3-B1", "order:PO-1042", "msg:m12-lq3x" */
export type Kind =
  | "shipment" | "stock" | "return" | "movement" | "order" | "meta" | "count" | "countentry" | "inbox" | "task" | "audit"
  | "conv" | "msg" | "read" | "presence" | "product" | "setting" | "notice" | "team";

export const KINDS: readonly Kind[] = ["shipment", "stock", "return", "movement", "order", "meta", "count", "countentry", "inbox", "task", "audit", "conv", "msg", "read", "presence", "product", "setting", "notice", "team"];
export const kindOf = (key: string): Kind | null => { const k = key.slice(0, key.indexOf(":")) as Kind; return KINDS.includes(k) ? k : null; };
export const idOf = (key: string) => key.slice(key.indexOf(":") + 1);

/** Never changed or removed once written: the change log and the stock movement log */
export const APPEND_ONLY: readonly Kind[] = ["audit", "movement"];
/** Written only by the server (product edits go through products.update) */
export const SERVER_ONLY: readonly Kind[] = ["product"];

/** One changed piece: data null = removed. base = the version the device started from (0 = didn't exist). */
export interface Change { key: string; base: number; data: unknown }
export interface PushInput { clientId: string; clientSeq: number; type: string; at: string; changes: Change[] }
export type PushResult =
  | { ok: true; seq: number; versions: Record<string, number> }
  | { ok: false; reason: "conflict"; keys: string[] };

/** A piece as the server sends it: v = version, s = number of its last change, c = number of the change that made it */
export interface SyncRow { key: string; v: number; s: number; c: number; data: unknown }
export interface PullResult { rows: SyncRow[]; seq: number; more: boolean }

/** A catch-up page (rowsPerPull) is always bigger than one change (changesPerPush), so a page never splits a change */
export const SYNC_LIMITS = { changesPerPush: 2000, bytesPerChange: 1_500_000, rowsPerPull: 5000 } as const;

const STOCK: Kind[] = ["shipment", "stock", "return", "movement", "order", "meta", "count", "countentry", "inbox", "task", "audit"];

/**
 * Which app actions may be sent, the switch each needs (null = anyone signed in), and which kinds of piece each
 * may change. Actions not listed are never sent: "local" ones only change what this device shows.
 */
export const ACTION_RULES: Record<string, { can: string | null; kinds: Kind[] } | "local" | "refused"> = {
  saveShipment: { can: "use-inbounds", kinds: STOCK },
  receive: { can: "use-inbounds", kinds: STOCK },
  putaway: { can: "confirm-inbound", kinds: STOCK },
  submitReturn: { can: "use-inbounds", kinds: STOCK },
  decideReturn: { can: "decide-return", kinds: STOCK },
  move: { can: "move-stock", kinds: STOCK },
  "stock/adjust": { can: "adjust-stock", kinds: STOCK },
  "count/start": { can: "start-count", kinds: STOCK },
  "count/set": { can: "view-stock", kinds: STOCK },
  "count/status": { can: "start-count", kinds: STOCK },
  "count/delete": { can: "delete-count", kinds: STOCK },
  "count/decide": { can: "approve-count", kinds: STOCK },
  "order/save": { can: "create-order", kinds: STOCK },
  "order/approve": { can: "approve-order", kinds: STOCK },
  "order/plan": { can: "approve-order", kinds: STOCK },
  "order/pick": { can: "pack-orders", kinds: STOCK },
  "order/unpick": { can: "pack-orders", kinds: STOCK },
  "order/ship": { can: "ship-order", kinds: STOCK },
  "order/cancel": { can: "cancel-order", kinds: STOCK },
  "order/delete": { can: "create-order", kinds: STOCK },
  "order/assign": { can: "assign-work", kinds: STOCK },
  "inbox/add": { can: "create-order", kinds: STOCK },
  "inbox/status": { can: "create-order", kinds: STOCK },
  "task/create": { can: "move-stock", kinds: STOCK },
  "task/assign": { can: "assign-work", kinds: STOCK },
  "task/start": { can: "move-stock", kinds: STOCK },
  "task/blocked": { can: "move-stock", kinds: STOCK },
  "task/cancel": { can: "move-stock", kinds: STOCK },
  "task/done": { can: "move-stock", kinds: STOCK },
  // Manage warehouse: the picking rule, email routing and contacts; announcements; work teams (owners and coordinators)
  "warehouse/settings": { can: "manage-settings", kinds: ["setting", "audit"] },
  "notice/post": { can: "manage-settings", kinds: ["notice", "audit"] },
  "notice/remove": { can: "manage-settings", kinds: ["notice", "audit"] },
  "team/save": { can: "assign-work", kinds: ["team", "audit"] },
  "team/delete": { can: "assign-work", kinds: ["team", "task", "audit"] },
  // Joining the channels and threads one may see (checked: only one's own membership changes)
  "account/user": { can: null, kinds: ["conv", "presence"] },
  "chat/add": { can: null, kinds: ["msg", "read"] },
  "chat/read": { can: null, kinds: ["read"] },
  "chat/presence": { can: null, kinds: ["presence"] },
  "chat/conversation": { can: null, kinds: ["conv"] },
  // Names come from the people list; message delivery ticks and urgent texts are the server's job
  "chat/rename": "local",
  "chat/status": "local",
  "chat/escalated": "local",
  // Product edits go through products.update; "Reset sample data" is for the device-only app
  "product/edit": "local",
  reset: "refused",
};
