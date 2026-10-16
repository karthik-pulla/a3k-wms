// Roles and switches, shared by the server (which enforces them) and the app (which shows and hides things).
// No imports, so both can use it as it is.
//
// Every warehouse has three built-in roles. Owners may change what Coordinators and Workers can do (the switches),
// and make their own roles with a name ("Night lead", "Receiving clerk"): a base role (which home screen and Messages
// group it gets) plus the same switches. A few powers belong to owners only and can't be switched on for anyone else,
// so nobody can give themselves more (docs/multi-tenant-design.md, section 4, `roles`).

export type BaseRole = "owner" | "coordinator" | "worker";

export type Action =
  | "view-stock" | "confirm-inbound" | "decide-return" | "view-history" | "move-stock" | "start-count" | "approve-count"
  | "delete-count" | "approve-order" | "cancel-order" | "ship-order" | "create-order" | "assign-work" | "choose-slot"
  | "adjust-stock" | "print-labels" | "export" | "view-logs" | "view-all-logs" | "use-inbounds" | "pack-orders"
  | "manage-people" | "manage-settings" | "manage-support" | "view-security-log";

export type Permissions = Partial<Record<Action, boolean>>;

export interface Switch {
  id: Action;
  label: string;
  help: string;
  group: "Inventory" | "In-bounds" | "Out-bounds" | "Counts" | "Work" | "Logs and reports" | "Warehouse";
  /** Owners always have it; no other role can */
  ownerOnly?: boolean;
  /** Which base roles have it unless an owner changes it */
  defaultFor: BaseRole[];
}

const ALL: BaseRole[] = ["owner", "coordinator", "worker"];
const OFFICE: BaseRole[] = ["owner", "coordinator"];
const OWNER: BaseRole[] = ["owner"];

export const SWITCHES: Switch[] = [
  { id: "view-stock", group: "Inventory", label: "See stock", help: "What's in each slot, product totals and locations", defaultFor: ALL },
  { id: "move-stock", group: "Inventory", label: "Move pallets", help: "Move a pallet to another location, always with a reason", defaultFor: ALL },
  { id: "choose-slot", group: "Inventory", label: "Choose the slot", help: "Pick any empty slot instead of the one the WMS gives", defaultFor: OFFICE },
  { id: "adjust-stock", group: "Inventory", label: "Change stock directly", help: "Edit what's in a slot (reviewed, with a reason, logged)", defaultFor: OWNER, ownerOnly: true },
  { id: "use-inbounds", group: "In-bounds", label: "Use In-bounds and Out-bounds", help: "The office sections (workers get the Work screen instead)", defaultFor: OFFICE },
  { id: "confirm-inbound", group: "In-bounds", label: "Confirm deliveries", help: "Check received pallets and send them to put-away", defaultFor: OFFICE },
  { id: "decide-return", group: "In-bounds", label: "Decide returns", help: "Approve or reject returned goods", defaultFor: OWNER, ownerOnly: true },
  { id: "create-order", group: "Out-bounds", label: "Enter orders", help: "Type in, read from a PDF or from email", defaultFor: OFFICE },
  { id: "approve-order", group: "Out-bounds", label: "Approve orders", help: "Approve a draft and plan its picks", defaultFor: OFFICE },
  { id: "cancel-order", group: "Out-bounds", label: "Cancel orders", help: "Picked cases go back on their pallets", defaultFor: OFFICE },
  { id: "ship-order", group: "Out-bounds", label: "Ship orders", help: "Confirm an order before it leaves", defaultFor: OFFICE },
  { id: "print-labels", group: "Out-bounds", label: "Print labels", help: "Case labels for orders", defaultFor: OFFICE },
  { id: "pack-orders", group: "Work", label: "Pack orders", help: "Confirm picks on orders given to them", defaultFor: ALL },
  { id: "assign-work", group: "Work", label: "Give out work", help: "Give pallet tasks and orders to pack to workers", defaultFor: OFFICE },
  { id: "start-count", group: "Counts", label: "Start counts", help: "Start a count of the warehouse or chosen racks", defaultFor: OWNER },
  { id: "approve-count", group: "Counts", label: "Apply count corrections", help: "Change stock to what was counted", defaultFor: OWNER, ownerOnly: true },
  { id: "delete-count", group: "Counts", label: "Delete counts", help: "Delete a count and what was entered", defaultFor: OWNER, ownerOnly: true },
  { id: "view-history", group: "Logs and reports", label: "See stock history", help: "The permanent movement log of each slot", defaultFor: OFFICE },
  { id: "view-logs", group: "Logs and reports", label: "See the pallet log", help: "Put-aways, moves and picks", defaultFor: OFFICE },
  { id: "view-all-logs", group: "Logs and reports", label: "See every change", help: "The full change log, not only pallet moves", defaultFor: OWNER },
  { id: "export", group: "Logs and reports", label: "Download reports", help: ".xlsx stock, inventory, count and pick lists", defaultFor: OFFICE },
  { id: "manage-people", group: "Warehouse", label: "Manage people and roles", help: "Invite, change and turn off accounts; edit roles", defaultFor: OWNER, ownerOnly: true },
  { id: "manage-settings", group: "Warehouse", label: "Change warehouse settings", help: "Name, languages, labels, order inbox, expiry warnings", defaultFor: OWNER, ownerOnly: true },
  { id: "manage-support", group: "Warehouse", label: "Allow support access", help: "Let the WMS team look in, for a limited time", defaultFor: OWNER, ownerOnly: true },
  { id: "view-security-log", group: "Warehouse", label: "See the security log", help: "Sign-ins, account changes and support access", defaultFor: OWNER, ownerOnly: true },
];

export const SWITCH_BY_ID = new Map(SWITCHES.map(s => [s.id, s]));
export const BASE_ROLES: { id: BaseRole; name: string; about: string }[] = [
  { id: "owner", name: "Owner", about: "Everything, including people, settings and direct stock changes (always reviewed and logged)" },
  { id: "coordinator", name: "Coordinator", about: "Runs the floor and the office: deliveries, orders, labels, work for the team" },
  { id: "worker", name: "Worker", about: "Moves pallets with the slot the WMS gives, packs orders given to them" },
];

/** A role as the warehouse stores it */
export interface RoleDef {
  id: string;
  name: string;
  base: BaseRole;
  /** Built-in roles can be changed (switches) but not renamed or deleted */
  builtIn: boolean;
  /** Only the switches that differ from the base role's defaults */
  permissions: Permissions;
}

export const builtInRoles = (): RoleDef[] => BASE_ROLES.map(b => ({ id: b.id, name: b.name, base: b.id, builtIn: true, permissions: {} }));

/** Whether a role allows an action: owner-only powers only for owners; otherwise the switch, or the base default */
export function allows(base: BaseRole, permissions: Permissions | undefined, action: Action): boolean {
  const sw = SWITCH_BY_ID.get(action);
  if (!sw) return false;
  if (sw.ownerOnly) return base === "owner";
  if (base === "owner") return true;
  return permissions?.[action] ?? sw.defaultFor.includes(base);
}

/** Every switch's value for a role (what the settings page shows) */
export function effective(base: BaseRole, permissions: Permissions | undefined): Record<Action, boolean> {
  return Object.fromEntries(SWITCHES.map(s => [s.id, allows(base, permissions, s.id)])) as Record<Action, boolean>;
}

/** Keeps only real switches that differ from the base default; owner-only and owner roles can't be changed */
export function cleanPermissions(base: BaseRole, permissions: Permissions): Permissions {
  if (base === "owner") return {};
  const out: Permissions = {};
  for (const [k, v] of Object.entries(permissions)) {
    const sw = SWITCH_BY_ID.get(k as Action);
    if (!sw || sw.ownerOnly || typeof v !== "boolean") continue;
    if (v !== sw.defaultFor.includes(base)) out[sw.id] = v;
  }
  return out;
}

/** Problems with a role someone wants to save (empty = fine) */
export function roleProblems(r: { name: string; base: string; permissions: Record<string, unknown> }): string[] {
  const out: string[] = [];
  const name = r.name.trim();
  if (name.length < 2 || name.length > 40) out.push("A name of 2–40 characters");
  if (!BASE_ROLES.some(b => b.id === r.base)) out.push("A base role: Owner, Coordinator or Worker");
  for (const [k, v] of Object.entries(r.permissions)) {
    const sw = SWITCH_BY_ID.get(k as Action);
    if (!sw) out.push(`No switch called ${k}`);
    else if (sw.ownerOnly && v === true && r.base !== "owner") out.push(`"${sw.label}" belongs to owners only`);
  }
  return out;
}
