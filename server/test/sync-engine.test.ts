// The app's sync engine (app/src/sync/engine.ts) against the real warehouse API on PGlite: two people on two
// devices, changing the same slot at once, working offline, reloading, and changes the server refuses.
// The app's own logic is stood in for by a tiny one (adding cases to a slot), so this is about the syncing.
import test from "node:test";
import assert from "node:assert/strict";
import { accept, browser, ownerSignedIn } from "./warehouse.ts";
import { SyncEngine, type SyncAction, type SyncStorage } from "../../app/src/sync/engine.ts";
import type { State } from "../../app/src/store/types.ts";

const BASE = {
  version: 1, shipments: [], stock: {}, returns: [], movements: [], orders: [], seq: 0, counts: [], inbox: [], tasks: [], audit: [],
  chat: { users: [], conversations: [], messages: [], reads: {}, presence: {}, seq: 0 },
} as unknown as State;

/** "move" adds cases to a slot (anyone may move pallets); "stock/adjust" sets them (owners only) */
function reduce(s: State, a: SyncAction): State {
  const code = a.code as string;
  const now = s.stock[code]?.[0]?.cases ?? 0;
  if (a.type === "move") return { ...s, stock: { ...s.stock, [code]: [{ productId: "S1", cases: now + (a.add as number) }] } };
  if (a.type === "stock/adjust") return { ...s, stock: { ...s.stock, [code]: [{ productId: "S1", cases: a.cases as number }] } };
  return s;
}
const cases = (e: SyncEngine, code = "01A-01-L1-B1") => e.getState().stock[code]?.[0]?.cases ?? 0;

/** Timers that never fire on their own: the test decides when to catch up */
const still = { setTimeout: (() => 0) as unknown as typeof setTimeout, clearTimeout: (() => {}) as typeof clearTimeout };
const memory = (): SyncStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, get: async k => map.get(k), set: async (k, v) => { map.set(k, v); }, del: async k => { map.delete(k); } };
};
/** Lets the engine finish what it started (sending, catching up) */
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
/** Waits (up to 10 s) for something the engine does in the background, e.g. sending what was waiting: the whole test
 * suite runs at once, so a fixed number of turns isn't always enough */
const until = async (ok: () => boolean) => { const end = Date.now() + 10_000; while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); };

async function two() {
  const w = await ownerSignedIn();
  const r = await w.owner.call("people.invite", { name: "Omar", username: "omar", roleId: "worker" });
  const omarB = browser(w.ctx);
  await accept(omarB, r.link);
  const make = (b: ReturnType<typeof browser>, device: string, storage = memory(), cacheKey: string | null = "k".repeat(43)) => {
    const notices: string[] = [];
    const e = new SyncEngine({
      call: (m, i) => b.call(m, i), reduce, base: BASE, storage, storageKey: `bravo:${device}`, cacheKey, deviceId: `device-${device}-0001`, timers: still,
      onRefused: m => notices.push(m),
    });
    return { e, notices, storage };
  };
  return { ...w, omarB, make };
}

test("a change on one device reaches the other with its next catch-up", async () => {
  const t = await two();
  const owner = t.make(t.owner, "owner"), omar = t.make(t.omarB, "omar");
  await owner.e.open(); await omar.e.open();
  owner.e.dispatch({ type: "stock/adjust", code: "01A-01-L1-B1", cases: 40 });
  assert.equal(cases(owner.e), 40, "shown at once on the device that made it");
  await settle();
  assert.equal(owner.e.getStatus().state, "saved");
  await omar.e.pullNow();
  assert.equal(cases(omar.e), 40);
});

test("two people adding to the same slot at once: neither change is lost", async () => {
  const t = await two();
  const owner = t.make(t.owner, "owner"), omar = t.make(t.omarB, "omar");
  await owner.e.open(); await omar.e.open();
  owner.e.dispatch({ type: "stock/adjust", code: "01A-01-L1-B1", cases: 40 });
  await settle();
  await omar.e.pullNow();
  // Omar adds 5 while his connection is down; meanwhile the owner's device adds 10
  omar.e.setOnline(false);
  omar.e.dispatch({ type: "move", code: "01A-01-L1-B1", add: 5 });
  assert.equal(omar.e.getStatus().state, "offline");
  assert.equal(omar.e.getStatus().waiting, 1);
  assert.equal(cases(omar.e), 45, "his own change shows while it waits");
  owner.e.dispatch({ type: "move", code: "01A-01-L1-B1", add: 10 });
  await settle();
  // Back online: his change meets newer data, is worked out again on it, and saved
  omar.e.setOnline(true);
  await settle();
  assert.equal(omar.e.getStatus().waiting, 0);
  assert.equal(cases(omar.e), 55);
  await owner.e.pullNow();
  assert.equal(cases(owner.e), 55, "40 + 10 + 5 on both devices");
});

test("changes made offline survive a reload and are saved once the connection is back", async () => {
  const t = await two();
  const storage = memory();
  const first = t.make(t.omarB, "omar", storage);
  await first.e.open();
  first.e.setOnline(false);
  first.e.dispatch({ type: "move", code: "02A-01-L1-B1", add: 3 });
  first.e.dispatch({ type: "move", code: "02A-01-L1-B1", add: 4 });
  await settle();
  await first.e.flush();
  first.e.stop();
  // What's kept on the device is encrypted
  assert.ok(![...storage.map.values()].some(v => v.includes("02A-01-L1-B1")));
  // The page is opened again
  const again = t.make(t.omarB, "omar", storage);
  await again.e.open();
  await settle();
  await until(() => again.e.getStatus().waiting === 0 && cases(again.e, "02A-01-L1-B1") === 7);
  assert.equal(again.e.getStatus().waiting, 0);
  assert.equal(cases(again.e, "02A-01-L1-B1"), 7);
  const owner = t.make(t.owner, "owner");
  await owner.e.open();
  assert.equal(cases(owner.e, "02A-01-L1-B1"), 7);
  // Sent once each, even though the first page might have sent them already
  assert.equal((await t.db.query("SELECT count(*)::int AS n FROM sync_log WHERE action = 'move'")).rows[0].n, 2);
});

test("two pages with the same device id never mix up their changes", async () => {
  const t = await two();
  const owner = t.make(t.owner, "same"), omar = t.make(t.omarB, "same");
  await owner.e.open(); await omar.e.open();
  omar.e.dispatch({ type: "move", code: "01A-01-L1-B1", add: 1 });
  await settle();
  owner.e.dispatch({ type: "move", code: "02A-01-L1-B1", add: 2 });
  await settle();
  await owner.e.pullNow(); await omar.e.pullNow();
  assert.equal(cases(omar.e, "02A-01-L1-B1"), 2, "the owner's change was saved, not taken for Omar's first one");
  assert.equal(cases(owner.e, "01A-01-L1-B1"), 1);
});

test("a change the server refuses is dropped, the person is told, and the screen goes back", async () => {
  const t = await two();
  const omar = t.make(t.omarB, "omar");
  await omar.e.open();
  omar.e.dispatch({ type: "stock/adjust", code: "01A-01-L1-B1", cases: 999 });
  await settle();
  assert.equal(cases(omar.e), 0);
  assert.equal(omar.e.getStatus().waiting, 0);
  assert.match(omar.notices[0], /^Not saved: /);
});

test("what's kept on a device can't be opened with another key (after signing out everywhere)", async () => {
  const t = await two();
  const storage = memory();
  const a = t.make(t.owner, "owner", storage, "a".repeat(43));
  await a.e.open();
  a.e.dispatch({ type: "stock/adjust", code: "01A-01-L1-B1", cases: 12 });
  await settle();
  await a.e.pullNow();
  await a.e.flush();
  assert.ok(storage.map.has("bravo:owner:data"));
  a.e.stop();
  const b = t.make(t.owner, "owner", storage, "b".repeat(43));
  await b.e.open();
  // Starts again from the server instead
  assert.equal(cases(b.e), 12);
});

test("support sessions keep nothing on the device", async () => {
  const t = await two();
  const storage = memory();
  const e = t.make(t.owner, "owner", storage, null);
  await e.e.open();
  e.e.dispatch({ type: "stock/adjust", code: "01A-01-L1-B1", cases: 1 });
  await settle();
  assert.equal(storage.map.size, 0);
});
