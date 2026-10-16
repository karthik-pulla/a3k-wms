// Connections to tenant databases, always through RDS Proxy (docs/multi-tenant-design.md, "Connections and RDS Proxy").
//
// One small pool per tenant database, because a connection belongs to one database for its whole life and must never
// serve another tenant. All pools in this server task share one budget: the most connections the task can ever hold
// is pools × perTenantMax, and that stays under `budget`. When a new tenant needs a pool and the budget is full, the
// least recently used pool with nothing in flight is closed. If every pool is busy, the request waits a little and
// then gets BusyError (the API answers 503 "try again"), so load can't pile up connections.
//
// Nothing here may pin a proxy connection: no session SET, temp tables, LISTEN/NOTIFY, advisory locks or named
// prepared statements. Per-tenant limits (statement_timeout and so on) are set on the tenant's role instead.

/** Where a tenant's database is, as the platform database records it */
export interface TenantDb {
  id: string;
  dbName: string;
  dbUser: string;
  /** The RDS Proxy endpoint this tenant uses */
  dbHost: string;
  dbPort: number;
}

/** What this module needs from a pg.Pool (so tests can use a fake) */
export interface PoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  /** One connection for a transaction (RDS Proxy keeps it for the transaction only, then shares it again) */
  connect(): Promise<{ query(text: string, values?: unknown[]): Promise<{ rows: any[] }>; release(err?: Error | boolean): void }>;
  end(): Promise<void>;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export type PoolFactory = (db: TenantDb, opts: { max: number; idleMs: number }) => PoolLike;

export interface BudgetOptions {
  /** Most connections one tenant's pool may open in this task */
  perTenantMax: number;
  /** Most connections all tenant pools together may open in this task */
  budget: number;
  /** A connection idle this long is closed */
  idleMs: number;
  /** How long a request waits for room in the budget before BusyError */
  waitMs: number;
}

export const DEFAULT_BUDGET: BudgetOptions = { perTenantMax: 3, budget: 30, idleMs: 10_000, waitMs: 2_000 };

export class BusyError extends Error {
  constructor() { super("Every database connection this server may use is busy"); this.name = "BusyError"; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class TenantPools {
  // Map order is use order: the first entry is the least recently used
  private readonly pools = new Map<string, PoolLike>();
  private readonly opts: BudgetOptions;
  private readonly make: PoolFactory;

  constructor(make: PoolFactory, opts: Partial<BudgetOptions> = {}) {
    this.make = make;
    this.opts = { ...DEFAULT_BUDGET, ...opts };
    if (this.opts.perTenantMax < 1 || this.opts.budget < this.opts.perTenantMax) throw new Error("The connection budget must fit at least one tenant pool");
  }

  /** Most tenant pools this task keeps open at once */
  get maxPools(): number { return Math.floor(this.opts.budget / this.opts.perTenantMax); }
  get openPools(): number { return this.pools.size; }

  /** Runs one statement in the tenant's own database */
  async query(db: TenantDb, text: string, values?: unknown[]): Promise<{ rows: any[] }> {
    const pool = await this.poolFor(db);
    return pool.query(text, values);
  }

  private async poolFor(db: TenantDb): Promise<PoolLike> {
    const hit = this.pools.get(db.id);
    if (hit) { this.pools.delete(db.id); this.pools.set(db.id, hit); return hit; }
    const deadline = Date.now() + this.opts.waitMs;
    while (this.pools.size >= this.maxPools) {
      const idle = [...this.pools].find(([, p]) => p.totalCount === p.idleCount && p.waitingCount === 0);
      if (idle) { this.pools.delete(idle[0]); void idle[1].end().catch(() => {}); continue; }
      if (Date.now() >= deadline) throw new BusyError();
      await sleep(25);
      // Another request may have opened this tenant's pool while we waited
      const now = this.pools.get(db.id);
      if (now) return now;
    }
    const opened = this.pools.get(db.id);
    if (opened) return opened;
    const pool = this.make(db, { max: this.opts.perTenantMax, idleMs: this.opts.idleMs });
    this.pools.set(db.id, pool);
    return pool;
  }

  /** Runs fn as one transaction on one connection of the tenant's pool */
  async tx<T>(db: TenantDb, fn: (q: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> }) => Promise<T>): Promise<T> {
    const pool = await this.poolFor(db);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      c.release();
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      c.release(true);
      throw e;
    }
  }

  /** Closes one tenant's pool (e.g. the tenant was suspended or moved) */
  async close(id: string): Promise<void> {
    const p = this.pools.get(id);
    this.pools.delete(id);
    await p?.end();
  }

  async closeAll(): Promise<void> {
    const all = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(all.map(p => p.end()));
  }
}
