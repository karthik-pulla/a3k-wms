// Stock, orders, tasks and messages on the server (src/core/sync.ts): who may save what, versions and conflicts,
// a change sent twice, private conversations, the logs, and catching up in pages.
import test from "node:test";
import assert from "node:assert/strict";
import { accept, browser, fails, ownerSignedIn } from "./warehouse.ts";
import { writeSystem } from "../src/core/sync.ts";
import { addProducts } from "../src/core/products.ts";

let n = 0;
const DEVICE = "device-test-0001";
const change = (type: string, changes: { key: string; base?: number; data: unknown }[], clientSeq = ++n) =>
  ({ clientId: DEVICE, clientSeq, type, at: "2026-10-16T12:00:00.000Z", changes: changes.map(c => ({ base: 0, ...c })) });
const line = (cases: number) => [{ productId: "S1", cases }];
/** Stock already in the warehouse (an import), each slot at version 1 */
const seed = (w: { db: any }, stock: Record<string, unknown>) => w.db.tx((q: any) => writeSystem(q, Object.entries(stock).map(([code, data]) => ({ key: code.includes(":") ? code : `stock:${code}`, data })), "Import", "test stock"));

async function team() {
  const w = await ownerSignedIn();
  const join = async (name: string, username: string, roleId: string) => {
    const r = await w.owner.call("people.invite", { name, username, roleId });
    const b = browser(w.ctx);
    const { me } = await accept(b, r.link);
    return { b, id: me.person.id as string };
  };
  const omar = await join("Omar", "omar", "worker");
  const leo = await join("Leo", "leo", "coordinator");
  return { ...w, ownerId: w.ownerMe.person.id as string, omar, leo };
}
const pullAll = async (b: { call: (m: string, i?: Record<string, unknown>) => Promise<any> }, since = 0) => {
  const rows: any[] = [];
  let cur = since;
  for (;;) { const r = await b.call("sync.pull", { since: cur }); rows.push(...r.rows); cur = r.seq; if (!r.more) return { rows, seq: cur }; }
};

test("a saved change reaches everyone's next catch-up, with versions and change numbers", async () => {
  const w = await team();
  const start = await w.omar.b.call("sync.pull", { since: 0 });
  assert.deepEqual(start.rows.map((r: any) => r.key), ["conv:team"], "a new warehouse has its team channel");
  const r = await w.owner.call("sync.push", change("stock/adjust", [{ key: "stock:01A-01-L1-B1", data: line(40) }]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.versions, { "stock:01A-01-L1-B1": 1 });
  const got = await w.omar.b.call("sync.pull", { since: start.seq });
  assert.deepEqual(got.rows.map((x: any) => [x.key, x.v, x.data]), [["stock:01A-01-L1-B1", 1, line(40)]]);
  assert.equal(got.seq, r.seq);
  // Nothing new: an empty answer at the same number
  assert.deepEqual(await w.omar.b.call("sync.pull", { since: got.seq }), { rows: [], seq: got.seq, more: false, copy: got.copy });
});

test("a change made from an old version is refused, so nobody overwrites someone else unseen", async () => {
  const w = await team();
  await w.owner.call("sync.push", change("stock/adjust", [{ key: "stock:01A-01-L1-B1", data: line(40) }]));
  // Omar's device still thinks the slot is empty (version 0)
  const stale = await w.omar.b.call("sync.push", change("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", data: line(10) }]));
  assert.deepEqual(stale, { ok: false, reason: "conflict", keys: ["stock:01A-01-L1-B1"] });
  // After catching up it starts from version 1
  const fresh = await w.omar.b.call("sync.push", change("move", [{ key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:02A-01-L1-B1", data: line(40) }]));
  assert.equal(fresh.ok, true);
  const all = await pullAll(w.leo.b);
  const slot = all.rows.find((x: any) => x.key === "stock:01A-01-L1-B1");
  assert.deepEqual([slot.v, slot.data], [2, null], "a removed piece stays as a marker so devices drop it");
});

test("a change sent twice (the answer got lost) is saved once", async () => {
  const w = await team();
  await seed(w, { "01A-01-L1-B1": line(9) });
  const c = change("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", base: 1, data: line(5) }]);
  const a = await w.omar.b.call("sync.push", c);
  const b = await w.omar.b.call("sync.push", c);
  // Marked as saved before, so the device doesn't take its older number for a restore
  assert.deepEqual(b, { ...a, again: true });
  const { rows } = await w.db.query("SELECT count(*)::int AS n FROM sync_log WHERE client_id = $1", [DEVICE]);
  assert.equal(rows[0].n, 1);
  // The same change number from another person is never taken for theirs
  await fails(w.leo.b.call("sync.push", c), "bad-request");
});

test("each kind of change needs its switch, and may touch only its own kinds of data", async () => {
  const w = await team();
  await fails(w.omar.b.call("sync.push", change("stock/adjust", [{ key: "stock:01A-01-L1-B1", data: line(1) }])), "forbidden");
  await fails(w.omar.b.call("sync.push", change("order/approve", [{ key: "order:PO-1", data: { id: "PO-1" } }])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("decideReturn", [{ key: "return:R-1", data: { id: "R-1" } }])), "forbidden");
  await fails(w.owner.call("sync.push", change("reset", [{ key: "stock:x", data: [] }])), "forbidden");
  await fails(w.owner.call("sync.push", change("chat/status", [{ key: "msg:m1", data: {} }])), "bad-request");
  await fails(w.owner.call("sync.push", change("move", [{ key: "product:S1", data: { code: "X" } }])), "forbidden");
  await fails(w.owner.call("sync.push", change("move", [{ key: "msg:m1", data: { id: "m1" } }])), "forbidden");
  await fails(w.owner.call("sync.push", change("move", [{ key: "nonsense:1", data: {} }])), "bad-request");
  await fails(w.owner.call("sync.push", change("move", [])), "bad-request");
  // Only the kinds that action changes in the app: counting, a new task or an order's draft never write stock
  await fails(w.omar.b.call("sync.push", change("count/set", [{ key: "stock:01A-01-L1-B1", data: line(1) }])), "forbidden");
  await fails(w.omar.b.call("sync.push", change("task/create", [{ key: "stock:01A-01-L1-B1", data: line(1) }])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("order/save", [{ key: "stock:01A-01-L1-B1", data: line(1) }])), "forbidden");
  // A worker moving a pallet is fine
  await seed(w, { "03A-01-L1-B1": line(2) });
  assert.equal((await w.omar.b.call("sync.push", change("move", [{ key: "stock:03A-01-L1-B1", base: 1, data: null }, { key: "stock:03A-01-L1-B2", data: line(2) }]))).ok, true);
});

test("the change log and movement log are never changed, and say who did it as the server knows them", async () => {
  const w = await team();
  await seed(w, { "02A-01-L1-B1": line(3) });
  const saved = await w.omar.b.call("sync.push", change("move", [
    { key: "stock:02A-01-L1-B1", base: 1, data: null },
    { key: "stock:01A-01-L1-B1", data: line(3) },
    { key: "audit:A1", data: { id: "A1", by: "Maya (pretending)", byId: "someone-else", action: "Moved a pallet", area: "stock", at: "2026-10-16T12:00:00.000Z" } },
    { key: "movement:M1", data: { id: "M1", by: "Somebody", type: "move", from: "02A-01-L1-B1", location: "01A-01-L1-B1", productId: "S1", cases: 3 } },
  ]));
  assert.equal(saved.ok, true);
  const { rows } = await pullAll(w.owner);
  const audit = rows.find((x: any) => x.key === "audit:A1").data;
  assert.deepEqual([audit.by, audit.byId], ["Omar", w.omar.id]);
  assert.equal(rows.find((x: any) => x.key === "movement:M1").data.by, "Omar");
  await fails(w.owner.call("sync.push", change("stock/adjust", [{ key: "audit:A1", base: 1, data: { id: "A1", action: "edited" } }])), "forbidden");
  await fails(w.owner.call("sync.push", change("stock/adjust", [{ key: "movement:M1", base: 1, data: null }])), "forbidden");
});

// A worker may move pallets, correct a scanned slot, do pallet tasks and pick orders. Each is checked against what
// that action does (src/core/sync-checks.ts), so none of them writes stock the way an owner's direct change does.
// The "real" pushes below are what the app's own logic (store/store.tsx) sends for that action.
const AT = "2026-10-16T12:00:00.000Z";
const L1 = { productId: "S1", cases: 40, lot: "L1", bestBefore: "2027-06-01" };
const stockOf = async (b: any, code: string) => (await pullAll(b)).rows.find((x: any) => x.key === `stock:${code}`)?.data ?? null;
const audit = (id: string, action: string) => ({ key: `audit:${id}`, data: { id, at: AT, byId: "x", by: "x", area: "stock", action } });

test("a worker can't write stock under the name of a move or a slot correction; real ones save", async () => {
  const w = await team();
  await seed(w, { "01A-01-L1-B1": [L1], "01A-01-L1-B2": [{ productId: "S2", cases: 6 }] });
  const push = (type: string, changes: { key: string; base?: number; data: unknown }[]) => w.omar.b.call("sync.push", change(type, changes));
  const refused = (type: string, changes: { key: string; base?: number; data: unknown }[]) => fails(push(type, changes), "forbidden");
  // A "move" that makes 500 cases out of nothing, or changes what's on the pallet on the way, or lands on a full slot
  await refused("move", [{ key: "stock:05A-01-L1-B1", data: line(500) }]);
  await refused("move", [{ key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:02A-01-L1-B1", data: [{ ...L1, cases: 400 }] }]);
  await refused("move", [{ key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:01A-01-L1-B2", base: 1, data: [{ productId: "S2", cases: 6 }, L1] }]);
  await refused("move", [{ key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:02A-01-L1-B1", data: [L1] }, { key: "stock:01A-01-L1-B2", base: 1, data: null }]);
  // A slot correction that adds a product, changes a lot, touches a second slot, or logs a movement somewhere else
  await refused("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", base: 1, data: [L1, { productId: "S9", cases: 100 }] }]);
  await refused("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, lot: "L2" }] }]);
  await refused("stock/scan-adjust", [{ key: "stock:05A-01-L1-B1", data: line(5) }]);
  await refused("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 39 }] }, { key: "stock:01A-01-L1-B2", base: 1, data: [{ productId: "S2", cases: 60 }] }]);
  await refused("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 39 }] }, { key: "movement:M9", data: { id: "M9", type: "adjustment", location: "09A-01-L1-B1", cases: 50 } }]);
  await refused("stock/scan-adjust", [{ key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 39 }] }, audit("A1", "one"), audit("A2", "two")]);
  // What the app sends: a correction (40 → 36, products stay) and a move of the whole pallet to an empty slot
  const fixed = await push("stock/scan-adjust", [
    { key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 36 }] },
    { key: "movement:M1", data: { id: "M1", at: AT, by: "Omar", type: "adjustment", location: "01A-01-L1-B1", productId: "S1", cases: -4, reason: "Slot QR: counted" } },
    audit("A1", "Corrected 01A-01-L1-B1 after scanning its QR code"),
  ]);
  assert.equal(fixed.ok, true);
  const moved = await push("move", [
    { key: "stock:01A-01-L1-B1", base: 2, data: null },
    { key: "stock:03A-01-L1-B1", data: [{ ...L1, cases: 36 }] },
    { key: "movement:M2", data: { id: "M2", at: AT, by: "Omar", type: "move", from: "01A-01-L1-B1", location: "03A-01-L1-B1", productId: "S1", cases: 36, reason: "Blocking the aisle" } },
    audit("A2", "Moved the pallet on 01A-01-L1-B1 to 03A-01-L1-B1"),
  ]);
  assert.equal(moved.ok, true);
  assert.deepEqual(await stockOf(w.owner, "03A-01-L1-B1"), [{ ...L1, cases: 36 }]);
  assert.equal(await stockOf(w.owner, "01A-01-L1-B1"), null);
  assert.equal(await stockOf(w.owner, "05A-01-L1-B1"), null, "nothing crafted was saved");
});

test("pallet tasks: stock moves only as the saved task says, from where the pallet really is", async () => {
  const w = await team();
  await seed(w, { "01A-01-L1-B1": [L1], "01A-01-L1-B2": [{ productId: "S2", cases: 6 }] });
  const push = (type: string, changes: { key: string; base?: number; data: unknown }[]) => w.omar.b.call("sync.push", change(type, changes));
  const refused = (type: string, changes: { key: string; base?: number; data: unknown }[]) => fails(push(type, changes), "forbidden");
  const T1 = { id: "T1", kind: "move", status: "open", from: "01A-01-L1-B1", to: "04A-01-L1-B1", lines: [L1], reason: "Make room", assignee: w.omar.id, createdBy: "Omar", createdAt: AT };
  // A put-away task (stock from nowhere), a pallet that isn't on the slot, or a task given to someone else
  await refused("task/create", [{ key: "task:T0", data: { ...T1, id: "T0", kind: "putaway", from: "RECEIVING", lines: line(1000) } }]);
  await refused("task/create", [{ key: "task:T0", data: { ...T1, id: "T0", lines: [{ ...L1, cases: 400 }] } }]);
  await refused("task/create", [{ key: "task:T0", data: { ...T1, id: "T0", assignee: w.leo.id } }]);
  assert.equal((await push("task/create", [{ key: "task:T1", data: T1 }, audit("A1", "Created a task")])).ok, true);
  // Starting changes only the status; a "start" that rewrites the pallet is refused
  await refused("task/start", [{ key: "task:T1", base: 1, data: { ...T1, status: "doing", startedAt: AT, lines: [{ ...L1, cases: 400 }] } }]);
  const doing = { ...T1, status: "doing", startedAt: AT };
  assert.equal((await push("task/start", [{ key: "task:T1", base: 1, data: doing }])).ok, true);
  const blocked = { ...doing, to: "05A-01-L1-B1", blocked: ["04A-01-L1-B1"] };
  assert.equal((await push("task/blocked", [{ key: "task:T1", base: 2, data: blocked }])).ok, true);
  const done = { ...blocked, status: "done", doneBy: "Omar", doneAt: AT };
  const mv = { key: "movement:M1", data: { id: "M1", at: AT, by: "Omar", type: "move", from: "01A-01-L1-B1", location: "05A-01-L1-B1", productId: "S1", cases: 40, reason: "Make room" } };
  // Done, but more cases arrive than left, the pallet stays where it was too, or another slot changes on the way
  await refused("task/done", [{ key: "task:T1", base: 3, data: done }, { key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:05A-01-L1-B1", data: [{ ...L1, cases: 400 }] }]);
  await refused("task/done", [{ key: "task:T1", base: 3, data: done }, { key: "stock:05A-01-L1-B1", data: [L1] }]);
  await refused("task/done", [{ key: "task:T1", base: 3, data: done }, { key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:05A-01-L1-B1", data: [L1] }, { key: "stock:01A-01-L1-B2", base: 1, data: null }]);
  assert.equal((await push("task/done", [{ key: "task:T1", base: 3, data: done }, { key: "stock:01A-01-L1-B1", base: 1, data: null }, { key: "stock:05A-01-L1-B1", data: [L1] }, mv, audit("A2", "Confirmed the pallet is in 05A-01-L1-B1")])).ok, true);
  assert.deepEqual(await stockOf(w.owner, "05A-01-L1-B1"), [L1]);
  // Finished once only
  await refused("task/done", [{ key: "task:T1", base: 4, data: done }, { key: "stock:05A-01-L1-B1", base: 1, data: null }, { key: "stock:06A-01-L1-B1", data: [L1] }]);
  // The pallet changed after the task was made (4 of its 6 cases left): finishing would make 2 cases out of nothing
  const T2 = { ...T1, id: "T2", from: "01A-01-L1-B2", to: "06A-01-L1-B1", lines: [{ productId: "S2", cases: 6 }] };
  assert.equal((await push("task/create", [{ key: "task:T2", data: T2 }])).ok, true);
  assert.equal((await push("stock/scan-adjust", [{ key: "stock:01A-01-L1-B2", base: 1, data: [{ productId: "S2", cases: 4 }] }])).ok, true);
  await refused("task/done", [{ key: "task:T2", base: 1, data: { ...T2, status: "done", doneBy: "Omar", doneAt: AT } }, { key: "stock:01A-01-L1-B2", base: 2, data: null }, { key: "stock:06A-01-L1-B1", data: [{ productId: "S2", cases: 6 }] }]);
  // Cancelling changes only the status
  assert.equal((await push("task/cancel", [{ key: "task:T2", base: 1, data: { ...T2, status: "cancelled", doneBy: "Omar", doneAt: AT, reason: "Make room · Cancelled: pallet changed" } }])).ok, true);
});

test("a pick takes exactly what it says off its pallet, and workers pick only orders given to them", async () => {
  const w = await team();
  const pick = { key: "k1", productId: "S1", location: "01A-01-L1-B1", cases: 10, onPallet: 40, lot: "L1", bestBefore: "2027-06-01", arrival: "2026-10-01", openPallet: false };
  const PO = { id: "PO-7", store: "Patel Brothers", client: "Sunfield", date: "2026-10-16", lines: [{ productId: "S1", cases: 10 }], status: "approved", assignee: w.omar.id, strategy: "fifo-open-first", picks: [pick], short: {} };
  await seed(w, { "01A-01-L1-B1": [L1], "order:PO-7": PO, "order:PO-8": { ...PO, id: "PO-8", assignee: w.leo.id } });
  const push = (type: string, changes: { key: string; base?: number; data: unknown }[]) => w.omar.b.call("sync.push", change(type, changes));
  const refused = (type: string, changes: { key: string; base?: number; data: unknown }[]) => fails(push(type, changes), "forbidden");
  const taken = [{ ...L1, cases: 10 }];
  const picked = { ...PO, status: "picked", picks: [{ ...pick, picked: { cases: 10, by: "Omar", at: AT, taken } }] };
  const mv = { key: "movement:M1", data: { id: "M1", at: AT, by: "Omar", type: "pick", orderId: "PO-7", location: "01A-01-L1-B1", productId: "S1", cases: 10, reason: "PO-7 · Patel Brothers" } };
  // Picked, but the pallet keeps its cases, loses all 40, or another slot changes too
  await refused("order/pick", [{ key: "order:PO-7", base: 1, data: picked }]);
  await refused("order/pick", [{ key: "order:PO-7", base: 1, data: picked }, { key: "stock:01A-01-L1-B1", base: 1, data: null }]);
  await refused("order/pick", [{ key: "order:PO-7", base: 1, data: picked }, { key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 30 }] }, { key: "stock:02A-01-L1-B1", data: line(500) }]);
  // Someone else's order, or a short pick that plans far more than the order needs
  await refused("order/pick", [{ key: "order:PO-8", base: 1, data: { ...picked, id: "PO-8", assignee: w.leo.id } }, { key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 30 }] }]);
  const short = { ...PO, status: "picking", avoid: ["01A-01-L1-B1|S1"], picks: [{ ...pick, picked: { cases: 4, by: "Omar", at: AT, note: "short", taken: [{ ...L1, cases: 4 }] } }, { ...pick, key: "k2", location: "02A-01-L1-B1", cases: 1000 }] };
  await refused("order/pick", [{ key: "order:PO-7", base: 1, data: short }, { key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 36 }] }]);
  // What the app sends for the real pick
  assert.equal((await push("order/pick", [{ key: "order:PO-7", base: 1, data: picked }, { key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 30 }] }, mv, audit("A1", "Picked 10 cases")])).ok, true);
  assert.deepEqual(await stockOf(w.owner, "01A-01-L1-B1"), [{ ...L1, cases: 30 }]);
  // Undo: the cases go back exactly as they were taken, not 100 of them
  const undone = { ...PO, avoid: [], picks: [{ ...pick, key: "k3", onPallet: 40 }] };
  await refused("order/unpick", [{ key: "order:PO-7", base: 2, data: undone }, { key: "stock:01A-01-L1-B1", base: 2, data: [{ ...L1, cases: 130 }] }]);
  const back = { key: "movement:M2", data: { id: "M2", at: AT, by: "Omar", type: "pick-undo", orderId: "PO-7", location: "01A-01-L1-B1", productId: "S1", cases: 10, reason: "Put back for PO-7" } };
  assert.equal((await push("order/unpick", [{ key: "order:PO-7", base: 2, data: undone }, { key: "stock:01A-01-L1-B1", base: 2, data: [L1] }, back])).ok, true);
  assert.deepEqual(await stockOf(w.owner, "01A-01-L1-B1"), [L1]);
  // Taking more than planned (the app allows it) leaves the rest of the plan as it is
  const two = { ...undone, lines: [{ productId: "S1", cases: 20 }], picks: [undone.picks[0], { ...pick, key: "k4", location: "02A-01-L1-B1", cases: 10 }] };
  await seed(w, { "order:PO-9": { ...two, id: "PO-9" } });
  const over = { ...two, id: "PO-9", status: "picking", picks: [{ ...two.picks[0], picked: { cases: 12, by: "Omar", at: AT, taken: [{ ...L1, cases: 12 }] } }, two.picks[1]] };
  assert.equal((await push("order/pick", [{ key: "order:PO-9", base: 1, data: over }, { key: "stock:01A-01-L1-B1", base: 3, data: [{ ...L1, cases: 28 }] }])).ok, true);
});

test("direct messages reach only their members; channels reach everyone", async () => {
  const w = await team();
  const dm = { id: "dm-1", kind: "dm", title: "", members: [w.ownerId, w.omar.id], createdAt: "2026-10-16T12:00:00.000Z" };
  assert.equal((await w.owner.call("sync.push", change("chat/conversation", [{ key: "conv:dm-1", data: dm }]))).ok, true);
  const msg = (id: string, conv: string, author: string) => ({ key: `msg:${id}`, data: { id, conversationId: conv, authorId: author, text: `secret ${id}`, refs: [], photos: [], createdAt: "2026-10-16T12:00:00.000Z", status: "sent" } });
  await w.owner.call("sync.push", change("chat/add", [msg("m1", "dm-1", w.ownerId), { key: `read:${w.ownerId}:dm-1`, data: { at: "2026-10-16T12:00:00.000Z" } }]));
  await w.leo.b.call("sync.push", change("chat/add", [msg("m2", "team", w.leo.id)]));
  const keys = async (b: any) => (await pullAll(b)).rows.map((x: any) => x.key).sort();
  assert.deepEqual(await keys(w.omar.b), ["conv:dm-1", "conv:team", "msg:m1", "msg:m2", `read:${w.ownerId}:dm-1`]);
  assert.deepEqual(await keys(w.leo.b), ["conv:team", "msg:m2"], "Leo isn't in the direct conversation");
  // Nobody writes as someone else, into a conversation they're not in, or adds other people
  await fails(w.leo.b.call("sync.push", change("chat/add", [msg("m3", "team", w.omar.id)])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("chat/add", [msg("m4", "dm-1", w.leo.id)])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("chat/conversation", [{ key: "conv:dm-1", base: 1, data: { ...dm, members: [...dm.members, w.leo.id] } }])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("chat/read", [{ key: `read:${w.omar.id}:team`, data: { at: "x" } }])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("chat/presence", [{ key: `presence:${w.omar.id}`, data: { state: "online" } }])), "forbidden");
  await fails(w.omar.b.call("sync.push", change("chat/add", [{ key: "msg:m1", base: 1, data: { ...msg("m1", "dm-1", w.ownerId).data, text: "edited" } }])), "forbidden");
  // Joining a thread yourself is fine; only owners add channels
  const thread = { id: "order-po-1", kind: "order", title: "PO-1", members: [w.ownerId], createdAt: "2026-10-16T12:00:00.000Z" };
  await w.owner.call("sync.push", change("chat/conversation", [{ key: "conv:order-po-1", data: thread }]));
  assert.equal((await w.leo.b.call("sync.push", change("account/user", [{ key: "conv:order-po-1", base: 1, data: { ...thread, members: [w.ownerId, w.leo.id] } }]))).ok, true);
  // A thread about a client someone doesn't see stays closed to them
  const r = await w.owner.call("people.invite", { name: "Tess", username: "tess", roleId: "worker", clients: ["Lotus"] });
  const tess = browser(w.ctx);
  const { me: tessMe } = await accept(tess, r.link, "Quiet-Harbour-Lamp-881");
  await w.owner.call("sync.push", change("order/save", [{ key: "order:PO-2", data: { id: "PO-2", client: "Sunfield" } }]));
  const sunThread = { id: "order-po-2", kind: "order", title: "PO-2", link: { type: "order", id: "PO-2" }, members: [w.ownerId], createdAt: "2026-10-16T12:00:00.000Z" };
  await w.owner.call("sync.push", change("chat/conversation", [{ key: "conv:order-po-2", data: sunThread }]));
  await fails(tess.call("sync.push", change("account/user", [{ key: "conv:order-po-2", base: 1, data: { ...sunThread, members: [w.ownerId, tessMe.person.id] } }])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("chat/conversation", [{ key: "conv:night", data: { id: "night", kind: "channel", title: "night", members: [], createdAt: "x" } }])), "forbidden");
});

test("group chats: anyone starts one; its creator renames it, adds and removes people and deletes it", async () => {
  const w = await team();
  const msg = (id: string, conv: string, author: string) => ({ key: `msg:${id}`, data: { id, conversationId: conv, authorId: author, text: id, refs: [], photos: [], createdAt: "2026-10-16T12:00:00.000Z", status: "sent" } });
  const g = { id: "g-1", kind: "group", title: "Night crew", members: [w.omar.id, w.leo.id], createdBy: w.omar.id, createdAt: "2026-10-16T12:00:00.000Z" };
  // Started by someone else in their name, or by someone not in it: refused
  await fails(w.leo.b.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", data: g }])), "forbidden");
  assert.equal((await w.omar.b.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", data: g }]))).ok, true);
  await w.leo.b.call("sync.push", change("chat/add", [msg("gm1", "g-1", w.leo.id)]));
  const keys = async (b: any) => (await pullAll(b)).rows.map((x: any) => x.key).sort();
  assert.deepEqual(await keys(w.owner), ["conv:team"], "the owner isn't in it");
  // Only the creator renames it or adds people; anyone in it may leave
  await fails(w.leo.b.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", base: 1, data: { ...g, title: "Leo's" } }])), "forbidden");
  await fails(w.owner.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", base: 1, data: { ...g, members: [...g.members, w.ownerId] } }])), "forbidden");
  const g2 = { ...g, title: "Night shift", members: [w.omar.id, w.ownerId] };
  assert.equal((await w.omar.b.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", base: 1, data: g2 }]))).ok, true);
  // Leo was taken out: his device still gets that change (so it learns), then nothing more
  const leoRows = (await pullAll(w.leo.b)).rows;
  assert.deepEqual(leoRows.find((x: any) => x.key === "conv:g-1").data.members, [w.omar.id, w.ownerId]);
  await fails(w.leo.b.call("sync.push", change("chat/add", [msg("gm2", "g-1", w.leo.id)])), "forbidden");
  assert.deepEqual(await keys(w.owner), ["conv:g-1", "conv:team"]);
  await fails(w.omar.b.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", base: 2, data: { ...g2, createdBy: w.ownerId } }])), "forbidden");
  // Deleted: nobody writes in it any more
  assert.equal((await w.omar.b.call("sync.push", change("chat/conversation", [{ key: "conv:g-1", base: 2, data: { ...g2, deletedAt: "2026-10-16T13:00:00.000Z" } }]))).ok, true);
  await fails(w.owner.call("sync.push", change("chat/add", [msg("gm3", "g-1", w.ownerId)])), "forbidden");
});

test("warehouse settings and announcements are the owners'; work teams also the coordinators'", async () => {
  const w = await team();
  const settings = { key: "setting:warehouse", data: { pickRule: "fefo", openFirst: true } };
  await fails(w.leo.b.call("sync.push", change("warehouse/settings", [settings])), "forbidden");
  assert.equal((await w.owner.call("sync.push", change("warehouse/settings", [settings]))).ok, true);
  const notice = { key: "notice:N1", data: { id: "N1", text: "Dock 2 closed Friday", by: "Owner", at: "2026-10-16T12:00:00.000Z" } };
  await fails(w.leo.b.call("sync.push", change("notice/post", [notice])), "forbidden");
  assert.equal((await w.owner.call("sync.push", change("notice/post", [notice]))).ok, true);
  const t = { key: "team:T1", data: { id: "T1", name: "Reach trucks", members: [w.omar.id], createdBy: "Leo", createdAt: "2026-10-16T12:00:00.000Z" } };
  await fails(w.omar.b.call("sync.push", change("team/save", [t])), "forbidden");
  assert.equal((await w.leo.b.call("sync.push", change("team/save", [t]))).ok, true);
  // Each change touches only its own kinds
  await fails(w.owner.call("sync.push", change("notice/post", [{ key: "stock:01A-01-L1-B1", data: line(1) }])), "forbidden");
  await fails(w.leo.b.call("sync.push", change("team/save", [{ key: "setting:warehouse", base: 1, data: {} }])), "forbidden");
  const got = (await pullAll(w.omar.b)).rows.map((x: any) => x.key).sort();
  assert.deepEqual(got, ["conv:team", "notice:N1", "setting:warehouse", "team:T1"], "everyone in the warehouse gets them");
});

test("catching up comes in pages that never split a change, and every piece arrives once", async () => {
  const w = await team();
  const many = Array.from({ length: 4500 }, (_, i) => ({ key: `stock:S-${String(i).padStart(5, "0")}`, data: line(i + 1) }));
  await w.db.tx(q => writeSystem(q, many, "Import", "test import"));
  await w.owner.call("sync.push", change("stock/adjust", [{ key: "stock:S-00000", base: 1, data: line(99) }]));
  let pages = 0, cur = 0;
  const seen = new Map<string, any>();
  for (;;) {
    const r = await w.omar.b.call("sync.pull", { since: cur });
    pages++;
    for (const row of r.rows) seen.set(row.key, row);
    assert.ok(r.seq >= cur);
    cur = r.seq;
    if (!r.more) break;
  }
  assert.ok(pages >= 1);
  assert.equal([...seen.keys()].filter(k => k.startsWith("stock:S-")).length, 4500);
  assert.deepEqual(seen.get("stock:S-00000").data, line(99));
});

test("a product edit reaches every device through the catch-up", async () => {
  const w = await team();
  await addProducts(w.db, [{ id: "S1", client: "Sunfield", code: "1108", name: "Janthikalu", item: "Snacks:1108:Janthikalu" }]);
  await w.owner.call("products.update", { id: "S1", code: "1108B", name: "Janthikalu", item: "Snacks:1108B:Janthikalu", reason: "New code from the brand" });
  const { rows } = await pullAll(w.omar.b);
  assert.deepEqual(rows.find((x: any) => x.key === "product:S1").data, { code: "1108B", name: "Janthikalu", item: "Snacks:1108B:Janthikalu" });
});

test("each person gets a device key, and a new one after signing out everywhere", async () => {
  const w = await team();
  const k1 = (await w.omar.b.call("auth.me")).cacheKey;
  assert.match(k1, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await w.omar.b.call("auth.me")).cacheKey, k1);
  await w.omar.b.call("auth.signOutEverywhere");
  const again = browser(w.ctx);
  // Signing in again needs the code; simpler: the owner resets Omar, who joins again
  const r = await w.owner.call("people.resetAccess", { id: w.omar.id });
  await accept(again, r.link, "Another-Long-Pass-77");
  const k2 = (await again.call("auth.me")).cacheKey;
  assert.ok(k2 && k2 !== k1);
});

test("the people list names everyone active, without emails", async () => {
  const w = await team();
  const list = await w.omar.b.call("people.directory");
  assert.deepEqual(list.map((p: any) => [p.name, p.role]), [["Leo", "coordinator"], ["Maya", "owner"], ["Omar", "worker"]]);
  assert.equal("email" in list[0], false);
});

test("a device ahead of the server (a backup was swapped in) is told to start over", async () => {
  const w = await team();
  const before = await seed(w, { "01A-01-L1-B1": line(5) });
  await w.owner.call("sync.push", change("stock/adjust", [{ key: "stock:02A-01-L1-B1", data: line(7) }]));
  const ahead = await pullAll(w.omar.b);
  const first = await w.omar.b.call("sync.pull", { since: 0 });
  assert.ok(first.copy, "names the copy of the database that answered");
  // The backup was made at `before`: what came later is gone and the number is back there
  await w.db.tx(async (q: any) => {
    await q.query("DELETE FROM entities WHERE created_seq > $1", [before]);
    await q.query("DELETE FROM sync_log WHERE seq > $1", [before]);
    await q.query("UPDATE sync_state SET seq = $1 WHERE id = 1", [before]);
  });
  assert.deepEqual(await w.omar.b.call("sync.pull", { since: ahead.seq }), { rows: [], seq: before, more: false, copy: first.copy, reset: true });
  // From the start it catches up as usual
  const again = await w.omar.b.call("sync.pull", { since: 0 });
  assert.equal(again.reset, undefined);
  assert.equal(again.seq, before);
  assert.deepEqual(again.rows.map((r: any) => r.key).sort(), ["conv:team", "stock:01A-01-L1-B1"]);
});
