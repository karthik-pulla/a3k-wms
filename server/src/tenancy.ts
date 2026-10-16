// Which tenant a request is for: always from the address it was sent to (the Host header), looked up in the
// platform database. Never from anything else the browser sends (body, query string, X-Forwarded-Host, other headers).
import type { TenantDb } from "./db/pools.ts";

export type TenantStatus = "setup" | "active" | "leaving" | "suspended" | "deleted";
export interface Tenant extends TenantDb { name: string; status: TenantStatus }

/** Tenants that may use the app: being set up, live, or leaving (they can still export) */
const SERVES: TenantStatus[] = ["setup", "active", "leaving"];

/** "A3K.Example.com:443" → "a3k.example.com"; null if it isn't a plain host name */
export function normalizeHost(raw: string | undefined): string | null {
  if (!raw) return null;
  let h = raw.trim().toLowerCase();
  if (h.startsWith("[")) return null; // IP literals never name a tenant
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h) && h.length <= 253 ? h : null;
}

type Lookup = (host: string) => Promise<Tenant | null>;

/** Host → tenant, cached for a minute (unknown hosts for 10 s) so most requests don't touch the platform database */
export class TenantDirectory {
  private readonly cache = new Map<string, { tenant: Tenant | null; until: number }>();
  private readonly lookup: Lookup;
  private readonly ttlMs: number;
  private readonly missTtlMs: number;
  private readonly now: () => number;

  constructor(lookup: Lookup, opts: { ttlMs?: number; missTtlMs?: number; now?: () => number } = {}) {
    this.lookup = lookup;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.missTtlMs = opts.missTtlMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  async resolve(rawHost: string | undefined): Promise<Tenant | null> {
    const host = normalizeHost(rawHost);
    if (!host) return null;
    const hit = this.cache.get(host);
    if (hit && hit.until > this.now()) return hit.tenant;
    const found = await this.lookup(host);
    const tenant = found && SERVES.includes(found.status) ? found : null;
    this.cache.set(host, { tenant, until: this.now() + (tenant ? this.ttlMs : this.missTtlMs) });
    if (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value!); // a flood of made-up hosts can't grow it forever
    return tenant;
  }

  /** Forget what's cached (after a tenant is suspended, moved or given a new address) */
  forget(): void { this.cache.clear(); }
}

/** The platform database query behind the directory */
export const TENANT_BY_HOST_SQL = `
  SELECT t.id, t.name, t.status, t.db_name, t.db_user, t.db_host, t.db_port
    FROM domains d JOIN tenants t ON t.id = d.tenant_id
   WHERE d.host = $1`;

export function rowToTenant(r: Record<string, any>): Tenant {
  return { id: r.id, name: r.name, status: r.status, dbName: r.db_name, dbUser: r.db_user, dbHost: r.db_host, dbPort: Number(r.db_port) };
}
