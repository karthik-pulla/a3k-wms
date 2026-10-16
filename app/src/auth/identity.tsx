// Who's signed in, however they signed in: on this device (the encrypted vault, auth/AuthGate.tsx) or with the
// server (two-step sign-in, server/ServerRoot.tsx). Screens read this, never the sign-in itself.
import { createContext, useContext } from "react";
import type { GroupId, Role, User } from "../store/types";
import type { Permissions } from "../../../server/src/shared/permissions.ts";
import type { Me } from "../../../server/src/shared/api.ts";

export interface IdentityAccount {
  uid: string;
  name: string;
  username: string;
  /** The base role (Owner, Coordinator, Worker) */
  role: Role;
  /** A role the warehouse made, e.g. "Night lead" */
  roleName?: string;
  /** Switches that differ from the base role */
  perms?: Permissions;
  clients?: string[];
  groups?: GroupId[];
  /** The device-only admin account: may test the app as other roles and people */
  admin?: boolean;
  /** Still has the first password: should change it */
  mustChange?: boolean;
}

export interface Identity {
  kind: "device" | "server";
  account: IdentityAccount;
  signOut: (why?: string) => Promise<void>;
  /** Sign-ins and account changes, for Logs (on the server they're in Warehouse settings → Security log) */
  securityLog: { at: string; who?: string; kind: string; detail?: string }[];
  /** Server sign-in only: everything the server said about this person */
  me?: Me;
}

export const IdentityContext = createContext<Identity | null>(null);
export function useIdentity(): Identity {
  const i = useContext(IdentityContext);
  if (!i) throw new Error("useIdentity outside a sign-in");
  return i;
}

const groupsFor = (role: Role): GroupId[] => (role === "owner" ? ["owners"] : role === "coordinator" ? ["coordinators"] : []);

/** The signed-in account as a person in the app (Messages, history, permissions) */
export function identityUser(a: IdentityAccount): User {
  return {
    id: a.uid, name: a.name, role: a.role, groups: [...new Set([...groupsFor(a.role), ...(a.groups ?? [])])],
    ...(a.clients?.length ? { clients: a.clients } : {}), ...(a.roleName ? { roleName: a.roleName } : {}), ...(a.perms && Object.keys(a.perms).length ? { perms: a.perms } : {}),
  };
}

/** What the server says about the signed-in person, as an identity account */
export function serverAccount(me: Me): IdentityAccount {
  const p = me.person;
  return { uid: p.id, name: p.name, username: p.username, role: p.base, roleName: p.roleId === p.base ? undefined : p.roleName, perms: me.perms, clients: p.clients ?? undefined, groups: p.groups };
}
