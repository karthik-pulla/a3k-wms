// The connection budget: however many tenants are busy, one server task never holds more than its budget.
import test from "node:test";
import assert from "node:assert/strict";
import { BusyError, TenantPools, type PoolLike, type TenantDb } from "../src/db/pools.ts";

/** A fake pool: `busy` connections in use until released */
class FakePool implements PoolLike {
  busy = 0; ended = false; readonly max: number; readonly db: TenantDb;
  release: (() => void)[] = [];
  constructor(db: TenantDb, max: number) { this.db = db; this.max = max; }
  get totalCount() { return this.busy; }
  get idleCount() { return 0; }
  get waitingCount() { return 0; }
  async query(text: string) {
    this.busy++;
    if (text === "hold") await new Promise<void>(r => this.release.push(r));
    this.busy--;
    return { rows: [{ db: this.db.dbName }] };
  }
  async end() { this.ended = true; }
  async connect() { return { query: (t: string) => this.query(t), release: () => {} }; }
}

const tenant = (n: number): TenantDb => ({ id: `t${n}`, dbName: `t_t${n}`, dbUser: `t_t${n}`, dbHost: "proxy", dbPort: 5432 });

function setup(opts = {}) {
  const made: FakePool[] = [];
  const pools = new TenantPools((db, o) => { const p = new FakePool(db, o.max); made.push(p); return p; }, { perTenantMax: 3, budget: 9, waitMs: 100, ...opts });
  return { pools, made };
}

test("each tenant gets its own pool, and a query runs in that tenant's database", async () => {
  const { pools, made } = setup();
  assert.deepEqual((await pools.query(tenant(1), "x")).rows, [{ db: "t_t1" }]);
  assert.deepEqual((await pools.query(tenant(2), "x")).rows, [{ db: "t_t2" }]);
  await pools.query(tenant(1), "x");
  assert.equal(made.length, 2);
  assert.ok(made.every(p => p.max === 3));
});

test("the budget caps open pools; the least recently used idle pool is closed to make room", async () => {
  const { pools, made } = setup();
  assert.equal(pools.maxPools, 3);
  for (const n of [1, 2, 3]) await pools.query(tenant(n), "x");
  await pools.query(tenant(1), "x"); // tenant 1 used again: tenant 2 is now the oldest
  await pools.query(tenant(4), "x");
  assert.equal(pools.openPools, 3);
  assert.equal(made.find(p => p.db.id === "t2")!.ended, true);
  assert.equal(made.find(p => p.db.id === "t1")!.ended, false);
});

test("with every pool busy, a new tenant waits, then gets BusyError instead of opening more connections", async () => {
  const { pools, made } = setup();
  const held = [1, 2, 3].map(n => pools.query(tenant(n), "hold"));
  await new Promise(r => setImmediate(r));
  await assert.rejects(pools.query(tenant(4), "x"), BusyError);
  assert.equal(made.length, 3, "no fourth pool was opened");
  made.forEach(p => p.release.forEach(r => r()));
  await Promise.all(held);
});

test("a request that waits gets the room as soon as a pool goes idle", async () => {
  const { pools, made } = setup({ waitMs: 1_000 });
  const held = [1, 2, 3].map(n => pools.query(tenant(n), "hold"));
  await new Promise(r => setImmediate(r));
  const waiting = pools.query(tenant(4), "x");
  setTimeout(() => made[0].release.forEach(r => r()), 50);
  assert.deepEqual((await waiting).rows, [{ db: "t_t4" }]);
  made.forEach(p => p.release.forEach(r => r()));
  await Promise.all(held);
});

test("a budget too small for one pool is refused", () => {
  assert.throws(() => new TenantPools(() => { throw new Error(); }, { perTenantMax: 5, budget: 3 }));
});

test("connections ever held stay under the budget with many tenants at once", async () => {
  const { pools, made } = setup({ perTenantMax: 3, budget: 30, waitMs: 2_000 });
  let peak = 0;
  const tick = setInterval(() => { peak = Math.max(peak, made.filter(p => !p.ended).length * 3); }, 1);
  await Promise.all(Array.from({ length: 200 }, (_, i) => pools.query(tenant(i % 50), "x")));
  clearInterval(tick);
  assert.ok(peak <= 30, `peak ${peak}`);
  assert.ok(pools.openPools <= 10);
});
