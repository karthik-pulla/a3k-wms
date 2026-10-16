import { useIdentity } from "../auth/identity";
import { useStore } from "../store/store";
import { useSession } from "../session";
import type { Role } from "../store/types";

const ROLE_NAME: Record<Role, string> = { owner: "Owner", coordinator: "Coordinator", worker: "Worker" };

/**
 * Admin account only (for testing and debugging): use the app as any role (as yourself) or as any person.
 * Every change made while switched is logged under the admin, naming the role or person.
 */
export function RoleSwitch({ compact = false }: { compact?: boolean }) {
  const { account } = useIdentity();
  const { state } = useStore();
  const { settings, update } = useSession();
  if (!account.admin) return null;
  const value = settings.userId ? `user:${settings.userId}` : settings.testRole ? `role:${settings.testRole}` : "";
  const set = (v: string) => update(v.startsWith("user:") ? { userId: v.slice(5), testRole: "" } : v.startsWith("role:") ? { userId: "", testRole: v.slice(5) as Role } : { userId: "", testRole: "" });
  const people = state.chat.users.filter(u => u.id !== account.uid);
  return (
    <select className={compact ? "input role-switch" : "textin"} value={value} onChange={e => set(e.target.value)} aria-label="Use the app as (admin testing)" title="Admin only: use the app as another role or person">
      <option value="">{compact ? "Admin · owner" : `Yourself: ${account.name} (owner, admin)`}</option>
      <optgroup label="As yourself, with the role">
        {(["owner", "coordinator", "worker"] as Role[]).filter(r => r !== "owner").map(r => <option key={r} value={`role:${r}`}>{compact ? `Testing: ${ROLE_NAME[r]}` : `${ROLE_NAME[r]} (as yourself)`}</option>)}
      </optgroup>
      <optgroup label="As a person">
        {people.map(u => <option key={u.id} value={`user:${u.id}`}>{compact ? `As ${u.name} · ${ROLE_NAME[u.role]}` : `${u.name} · ${ROLE_NAME[u.role]}${u.clients ? ` · ${u.clients.join(" + ")} only` : ""}${u.sample ? " (sample)" : ""}`}</option>)}
      </optgroup>
    </select>
  );
}
