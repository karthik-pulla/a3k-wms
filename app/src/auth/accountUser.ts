import type { GroupId, Role, User } from "../store/types";
import type { Account } from "./vault";

/** An account as a person in the app (Messages, history, permissions) */
export function accountUser(a: Pick<Account, "uid" | "name" | "role" | "clients">): User {
  return { id: a.uid, name: a.name, role: a.role, groups: groupsFor(a.role), ...(a.clients?.length ? { clients: a.clients } : {}) };
}
export const groupsFor = (role: Role): GroupId[] => (role === "owner" ? ["owners"] : role === "coordinator" ? ["coordinators"] : []);

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "?";

/**
 * The signed-in person as the screens see them: the people list's record (its name, which Messages may change) with
 * the account's role, switches, clients and groups. The account is the authority on what a person may do: the
 * people list carries no switches, so it must never stand in for them (a coordinator given "Edit products" would
 * otherwise never see it).
 */
export function selfFrom(rec: User, own: User): User {
  // Groups that come with a role follow the account's role; others (shifts, receiving) the account or the list may add
  const roleGroups: GroupId[] = ["owners", "coordinators"];
  const groups = [...new Set([...own.groups, ...rec.groups.filter(g => !roleGroups.includes(g))])];
  const out: User = { ...rec, role: own.role, groups };
  for (const k of ["clients", "roleName", "perms"] as const) {
    if (own[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = own[k]; else delete out[k];
  }
  return out;
}
