// The one place that decides who may see or do what; every screen, chip, map highlight and button goes through it.
//
// Roles (owner-defined, Oct 2026):
//  - Owner: sees and can change everything. Direct changes go through a review step with a reason; every change is in Logs.
//  - Coordinator: confirms in-bound quantities, oversees in-bounds, orders and inventory, assigns pallet tasks and packing,
//    prints labels, confirms orders before they leave, sends reports, sees the workers' pallet log.
//  - Worker: moves pallets only through tasks where the WMS gives the slot (dock → rack, rack → rack, picks to the
//    out-bound dock) and confirms each one; packs orders given to them; has the Work dashboard / forklift screen.
import { productById, type Client } from "../data/catalog";
import type { Role, StockLine, User } from "../store/types";

export type Action =
  | "view-stock"        // what's in a slot, product totals and locations
  | "confirm-inbound"   // confirm a pending delivery and assign slots
  | "decide-return"     // approve or reject return requests
  | "view-history"      // the permanent movement log
  | "view-last-online"  // exact "last online" times
  | "move-stock"        // move a pallet to another location (always with a reason)
  | "start-count"       // start a count ("counts happen when an owner decides")
  | "approve-count"     // apply count corrections to stock
  | "delete-count"      // delete a count and its entries
  | "approve-order"     // approve a drafted order (plans its picks)
  | "cancel-order"      // cancel an order (picked cases go back on their pallets)
  | "ship-order"        // confirm an order before it leaves (mark shipped)
  | "create-order"      // enter or read in an order
  | "assign-work"       // give pallet tasks and orders to pack to workers, create move tasks
  | "choose-slot"       // move a pallet to a slot of one's choosing (workers take the WMS's slot)
  | "adjust-stock"      // change what's in a slot directly (owners; reviewed, reason required, logged)
  | "print-labels"      // case labels for orders
  | "export"            // .xlsx reports: stock, inventory, counts, in-bounds, pick lists
  | "view-logs"         // the change log: owners everything, coordinators the pallet log
  | "view-all-logs"     // every change, not only pallet moves
  | "use-inbounds"      // the In-bounds and Out-bounds sections (workers get the Work dashboard instead)
  | "pack-orders";      // confirm picks on an order

export type LastOnlineVisibility = "owners-coordinators" | "owners" | "everyone";

const RANK: Record<Role, number> = { worker: 0, coordinator: 1, owner: 2 };
const atLeast = (u: User, r: Role) => RANK[u.role] >= RANK[r];

/** May this person see a client's stock? Brand scope applies to everyone; owners see all. */
export function canSeeClient(u: User, client: Client): boolean {
  return u.role === "owner" || !u.clients || u.clients.includes(client);
}

export function can(u: User, action: Action, opts: { client?: Client; lastOnline?: LastOnlineVisibility } = {}): boolean {
  if (opts.client && !canSeeClient(u, opts.client)) return false;
  switch (action) {
    case "view-stock": return true;
    case "confirm-inbound": return atLeast(u, "coordinator");
    case "decide-return": return u.role === "owner";
    case "view-history": return atLeast(u, "coordinator");
    case "move-stock": return true;
    case "start-count": return u.role === "owner";
    case "approve-count": return u.role === "owner";
    case "delete-count": return u.role === "owner";
    case "approve-order": return atLeast(u, "coordinator");
    case "cancel-order": return atLeast(u, "coordinator");
    case "ship-order": return atLeast(u, "coordinator");
    case "create-order": return atLeast(u, "coordinator");
    case "assign-work": return atLeast(u, "coordinator");
    case "choose-slot": return atLeast(u, "coordinator");
    case "adjust-stock": return u.role === "owner";
    case "print-labels": return atLeast(u, "coordinator");
    case "export": return atLeast(u, "coordinator");
    case "view-logs": return atLeast(u, "coordinator");
    case "view-all-logs": return u.role === "owner";
    case "use-inbounds": return atLeast(u, "coordinator");
    case "pack-orders": return true;
    case "view-last-online": {
      const v = opts.lastOnline ?? "owners-coordinators";
      return v === "everyone" || (v === "owners" ? u.role === "owner" : atLeast(u, "coordinator"));
    }
  }
}

/** Stock lines this person may see; lines of other clients are dropped (shown as "hidden"). */
export function visibleLines(u: User, lines: StockLine[]): { shown: StockLine[]; hidden: number } {
  const shown = lines.filter(l => { const p = productById(l.productId); return p ? canSeeClient(u, p.client) : false; });
  return { shown, hidden: lines.length - shown.length };
}

/** Owners (the admin account is one) approve account requests and manage accounts */
export const canManageAccounts = (u: User) => u.role === "owner";
