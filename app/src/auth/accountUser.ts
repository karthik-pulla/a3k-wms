import type { GroupId, Role, User } from "../store/types";
import type { Account } from "./vault";

/** An account as a person in the app (Messages, history, permissions) */
export function accountUser(a: Pick<Account, "uid" | "name" | "role" | "clients">): User {
  return { id: a.uid, name: a.name, role: a.role, groups: groupsFor(a.role), ...(a.clients?.length ? { clients: a.clients } : {}) };
}
export const groupsFor = (role: Role): GroupId[] => (role === "owner" ? ["owners"] : role === "coordinator" ? ["coordinators"] : []);
