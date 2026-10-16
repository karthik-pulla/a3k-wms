// What the warehouse API and the ops console API send back, shared by the server and the app. No imports besides types.
import type { Action, BaseRole, Permissions } from "./permissions.ts";

export interface TenantPublic { id: string; name: string; appTitle: string; mark: string; languages: { default: "en" | "es"; enabled: ("en" | "es")[] } }

export interface Me {
  person: { id: string; name: string; username: string; email: string | null; roleId: string; roleName: string; base: BaseRole; clients: string[] | null; groups: string[] };
  /** Overrides of the base role (what the app's can() needs) */
  perms: Permissions;
  /** Every switch, worked out */
  can: Record<Action, boolean>;
  /** Set when this is the WMS team looking in through a support grant */
  support: { operator: string; canChange: boolean; endsAt: string } | null;
  /** Support access open right now (every owner sees a banner) */
  supportActive: { operator: string; endsAt: string; emergency: boolean }[];
  tenant: TenantPublic;
}

export interface PersonView {
  id: string; name: string; username: string; email: string | null;
  roleId: string; roleName: string; base: BaseRole;
  clients: string[] | null; groups: string[];
  status: "invited" | "active" | "disabled";
  /** An invite or reset link is waiting to be used */
  linkPending: "invite" | "reset" | null;
  lastSignInAt: string | null; createdAt: string;
}

export interface RoleView { id: string; name: string; base: BaseRole; builtIn: boolean; permissions: Permissions; can: Record<Action, boolean>; people: number }

export interface RequestView { id: string; name: string; username: string; email: string | null; note: string; createdAt: string }

export interface LogView { at: string; actor: string; action: string; target: string | null; detail: Record<string, unknown>; ip: string | null }

export interface GrantView {
  id: string; operator: string; reason: string; ticket: string | null; canChange: boolean; emergency: boolean; minutes: number;
  status: "requested" | "active" | "ended" | "refused"; requestedAt: string; startsAt: string | null; endsAt: string | null; decidedBy: string | null;
}

/** A link was made: show it so it can be copied, and say whether it was emailed */
export interface LinkResult { link: string; emailed: boolean }

export interface InviteInfo { kind: "invite" | "reset"; name: string; username: string; step: "password" | "authenticator"; expiresAt: string; warehouse: TenantPublic }

/** Every API answer that went wrong */
export interface ApiErrorBody { error: string; code: string; info?: Record<string, unknown> }

// ---------- Ops console ----------
export interface OperatorMe { id: string; name: string; username: string; email: string }

export interface TenantSummary {
  id: string; name: string; status: "setup" | "active" | "leaving" | "suspended" | "deleted";
  hosts: string[]; createdAt: string; schemaVersion: string | null;
  lastMigration: { ok: boolean; at: string; failedFile: string | null; error: string | null } | null;
  /** Read from the warehouse's own database: counts only, never its stock or messages */
  people: { active: number; invited: number; owners: number } | null;
  lastSignInAt: string | null;
  supportActive: number;
  errors24h: number;
  /** Setup checklist steps done (section 8 of the design) */
  onboarding: string[];
  /** Couldn't reach its database */
  unreachable?: boolean;
}

export const ONBOARDING_STEPS: { id: string; label: string }[] = [
  { id: "contract", label: "Contract signed, onboarding access approved" },
  { id: "survey", label: "Site survey done, map signed off by the owner" },
  { id: "products", label: "Products imported" },
  { id: "people", label: "Owner signed in; staff invited" },
  { id: "labels", label: "Label sheet printed and aligned" },
  { id: "count", label: "Opening count approved by the owner" },
  { id: "live", label: "First real order shipped; setup mode ended" },
];
