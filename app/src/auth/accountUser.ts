import type { GroupId, Role, User } from "../store/types";
import type { Account } from "./vault";

/** An account as a person in the app (Messages, history, permissions) */
export function accountUser(a: Pick<Account, "uid" | "name" | "role" | "clients">): User {
  return { id: a.uid, name: a.name, role: a.role, groups: groupsFor(a.role), ...(a.clients?.length ? { clients: a.clients } : {}) };
}
export const groupsFor = (role: Role): GroupId[] => (role === "owner" ? ["owners"] : role === "coordinator" ? ["coordinators"] : []);

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "?";
