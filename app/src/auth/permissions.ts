// The one place that decides who may see or do what; every screen, chip, map highlight and button goes through it.
//
// Roles (owner-defined, Oct 2026):
//  - Owner: sees and can change everything. Direct changes go through a review step with a reason; every change is in Logs.
//  - Coordinator: confirms in-bound quantities, oversees in-bounds, orders and inventory, assigns pallet tasks and packing,
//    prints labels, confirms orders before they leave, sends reports, sees the workers' pallet log.
//  - Worker: moves pallets only through tasks where the WMS gives the slot (dock → rack, rack → rack, picks to the
//    out-bound dock) and confirms each one; packs orders given to them; has the Work dashboard / forklift screen.
import { productById, type Client } from "../data/catalog";
import type { StockLine, User } from "../store/types";
import { allows, type Action } from "../../../server/src/shared/permissions.ts";

// The switches and their defaults live in server/src/shared/permissions.ts, shared with the server that enforces them
export type { Action };
export type LastOnlineVisibility = "owners-coordinators" | "owners" | "everyone";

/** May this person see a client's stock? Brand scope applies to everyone; owners see all. */
export function canSeeClient(u: User, client: Client): boolean {
  return u.role === "owner" || !u.clients || u.clients.includes(client);
}

export function can(u: User, action: Action | "view-last-online", opts: { client?: Client; lastOnline?: LastOnlineVisibility } = {}): boolean {
  if (opts.client && !canSeeClient(u, opts.client)) return false;
  // Exact "last online" times follow a warehouse setting, not a role switch
  if (action === "view-last-online") {
    const v = opts.lastOnline ?? "owners-coordinators";
    return v === "everyone" || (v === "owners" ? u.role === "owner" : u.role !== "worker");
  }
  return allows(u.role, u.perms, action);
}

/** Stock lines this person may see; lines of other clients are dropped (shown as "hidden"). */
export function visibleLines(u: User, lines: StockLine[]): { shown: StockLine[]; hidden: number } {
  const shown = lines.filter(l => { const p = productById(l.productId); return p ? canSeeClient(u, p.client) : false; });
  return { shown, hidden: lines.length - shown.length };
}

/** Owners (the admin account is one) approve account requests and manage accounts */
export const canManageAccounts = (u: User) => can(u, "manage-people");
