// Office changes on the server (src/core/sync-checks.ts): deliveries, counts, orders and returns. Each change must be
// what its action does in the app (store/store.tsx), so nobody with an office switch makes stock appear: a confirmed
// delivery's tasks hold only what the delivery says, office changes never invent picked cases, and cancelling puts
// back exactly what was taken. The "real" pushes below are what the app sends for that action.
import test from "node:test";
import assert from "node:assert/strict";
import { accept, browser, fails, ownerSignedIn } from "./warehouse.ts";
import { writeSystem } from "../src/core/sync.ts";

let n = 0;
const AT = "2026-10-16T12:00:00.000Z";
type Piece = { key: string; base?: number; data: unknown };
const change = (type: string, changes: Piece[]) =>
  ({ clientId: "device-checks-0001", clientSeq: ++n, type, at: AT, changes: changes.map(c => ({ base: 0, ...c })) });
const L1 = { productId: "S1", cases: 40, lot: "L1", bestBefore: "2027-06-01" };
const audit = (id: string) => ({ key: `audit:${id}`, data: { id, at: AT, byId: "x", by: "x", area: "stock", action: "test" } });

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
  const as = (b: { call: (m: string, i?: Record<string, unknown>) => Promise<any> }) => ({
    push: (type: string, changes: Piece[]) => b.call("sync.push", change(type, changes)),
    refused: (type: string, changes: Piece[]) => fails(b.call("sync.push", change(type, changes)), "forbidden"),
  });
  /** Data already in the warehouse (an import), each piece at version 1 */
  const seed = (pieces: Record<string, unknown>) => w.db.tx((q: any) => writeSystem(q, Object.entries(pieces).map(([key, data]) => ({ key, data })), "Import", "test data"));
  const stockOf = async (code: string) => (await w.db.query("SELECT data FROM entities WHERE key = $1", [`stock:${code}`])).rows[0]?.data ?? null;
  return { ...w, omar: { ...omar, ...as(omar.b) }, leo: { ...leo, ...as(leo.b) }, own: as(w.owner), seed, stockOf };
}

test("a confirmed delivery's put-away tasks hold only what the delivery says is on each pallet", async () => {
  const w = await team();
  const S = { id: "S-1", client: "Sunfield", number: "1031", supplier: "Sunfield Foods", ref: "MSCU-1", expected: "2026-10-16", status: "incoming",
    lines: [{ key: "a", productId: "S1", cases: 40, pallet: 1, lot: "L1", bestBefore: "2027-06" }, { key: "b", productId: "S2", cases: 10, pallet: 2, lot: "L2", bestBefore: "2027-07", damaged: 2 }] };
  await w.seed({ "shipment:S-1": S });
  // Skipping straight to confirmed, or "arriving" with different lines
  await w.leo.refused("saveShipment", [{ key: "shipment:S-1", base: 1, data: { ...S, status: "putaway", putaway: [{ pallet: 1, slot: "05A-01-L1-B1" }] } }]);
  await w.leo.refused("receive", [{ key: "shipment:S-1", base: 1, data: { ...S, status: "pending", receivedAt: AT, receivedBy: "Leo", condition: "ok", lines: [{ ...S.lines[0], cases: 4000 }] } }]);
  const arrived = { ...S, status: "pending", receivedAt: AT, receivedBy: "Leo", condition: "ok" };
  assert.equal((await w.leo.push("receive", [{ key: "shipment:S-1", base: 1, data: arrived }, { key: "movement:M1", data: { id: "M1", at: AT, by: "Leo", type: "receive", shipmentId: "S-1", reason: "Arrived" } }, audit("A1")])).ok, true);
  // Counting what's really on pallet 1 while it's pending is fine
  const counted = { ...arrived, lines: [{ ...S.lines[0], cases: 38 }, S.lines[1]] };
  assert.equal((await w.leo.push("saveShipment", [{ key: "shipment:S-1", base: 2, data: counted }])).ok, true);
  const plan = [{ pallet: 1, slot: "05A-01-L1-B1" }, { pallet: 2, slot: "06A-01-L1-B1" }];
  const confirmed = { ...counted, status: "putaway", confirmedAt: AT, confirmedBy: "Leo", putaway: plan };
  const task = (pallet: number, to: string, lines: unknown[]) => ({ key: `task:T${pallet}`, data: { id: `T${pallet}`, kind: "putaway", status: "open", from: "RECV-FLOOR", to, shipmentId: "S-1", pallet, lines, createdBy: "Leo", createdAt: AT } });
  const p1 = { productId: "S1", cases: 38, lot: "L1", bestBefore: "2027-06", shipmentId: "S-1" };
  const p2 = { productId: "S2", cases: 8, lot: "L2", bestBefore: "2027-07", shipmentId: "S-1" };
  const confirm = (tasks: Piece[], ship = confirmed) => [{ key: "shipment:S-1", base: 3, data: ship }, ...tasks];
  // More cases than on the pallet, a product it doesn't have, the damaged cases too, a pallet that isn't in the delivery, or a task to another slot
  await w.leo.refused("putaway", confirm([task(1, "05A-01-L1-B1", [{ ...p1, cases: 400 }]), task(2, "06A-01-L1-B1", [p2])]));
  await w.leo.refused("putaway", confirm([task(1, "05A-01-L1-B1", [p1, { ...p1, productId: "S9" }]), task(2, "06A-01-L1-B1", [p2])]));
  await w.leo.refused("putaway", confirm([task(1, "05A-01-L1-B1", [p1]), task(2, "06A-01-L1-B1", [{ ...p2, cases: 10 }])]));
  await w.leo.refused("putaway", confirm([task(1, "05A-01-L1-B1", [p1]), task(2, "06A-01-L1-B1", [p2]), task(3, "07A-01-L1-B1", [p1])], { ...confirmed, putaway: [...plan, { pallet: 3, slot: "07A-01-L1-B1" }] }));
  await w.leo.refused("putaway", confirm([task(1, "09A-01-L1-B1", [p1]), task(2, "06A-01-L1-B1", [p2])]));
  // What the app sends: one task per pallet, damaged cases left out; a worker then puts pallet 1 away
  assert.equal((await w.leo.push("putaway", [...confirm([task(1, "05A-01-L1-B1", [p1]), task(2, "06A-01-L1-B1", [p2])]), audit("A2")])).ok, true);
  await w.leo.refused("putaway", [{ key: "shipment:S-1", base: 4, data: confirmed }, task(3, "07A-01-L1-B1", [p1])]);
  const done = await w.omar.push("task/done", [{ key: "task:T1", base: 1, data: { ...task(1, "05A-01-L1-B1", [p1]).data, status: "done", doneBy: "Omar", doneAt: AT } }, { key: "stock:05A-01-L1-B1", data: [p1] }]);
  assert.equal(done.ok, true);
  assert.deepEqual(await w.stockOf("05A-01-L1-B1"), [p1]);
});

test("counts: anyone counting fills in and sends a count for review; only people who start counts reopen or close it", async () => {
  const w = await team();
  const C = { id: "count-1", name: "Rack 1", scope: ["01A"], blind: false, status: "open", startedBy: "Maya", startedAt: AT };
  await w.omar.refused("count/start", [{ key: "count:count-1", data: C }]);
  await w.own.refused("count/start", [{ key: "count:count-1", data: { ...C, status: "closed" } }]);
  assert.equal((await w.own.push("count/start", [{ key: "count:count-1", data: C }, audit("A1")])).ok, true);
  const entry = { lines: [{ productId: "S1", cases: 40 }], by: "Omar", at: AT };
  assert.equal((await w.omar.push("count/set", [{ key: "countentry:count-1:01A-01-L1-B1", data: entry }])).ok, true);
  await w.omar.refused("count/set", [{ key: "countentry:count-9:01A-01-L1-B1", data: entry }]);
  await w.omar.refused("count/set", [{ key: "countentry:count-1:01A-01-L1-B2", data: { lines: "lots" } }]);
  // A worker finishing their part (this used to be refused: it needed "Start counts")
  assert.equal((await w.omar.push("count/status", [{ key: "count:count-1", base: 1, data: { ...C, status: "review" } }])).ok, true);
  await w.omar.refused("count/status", [{ key: "count:count-1", base: 2, data: { ...C, status: "closed", closedAt: AT, closedBy: "Omar" } }]);
  await w.omar.refused("count/status", [{ key: "count:count-1", base: 2, data: { ...C, status: "open", scope: ["01A", "02A"] } }]);
  assert.equal((await w.own.push("count/status", [{ key: "count:count-1", base: 2, data: { ...C, status: "closed", closedAt: AT, closedBy: "Maya" } }])).ok, true);
  await w.omar.refused("count/set", [{ key: "countentry:count-1:01A-01-L1-B2", data: entry }]);
});

test("office order changes never invent picked cases; cancelling puts back exactly what was taken", async () => {
  const w = await team();
  const pick = { key: "k1", productId: "S1", location: "01A-01-L1-B1", cases: 10, onPallet: 40, lot: "L1", bestBefore: "2027-06-01", arrival: "2026-10-01", openPallet: false };
  const taken = [{ ...L1, cases: 10 }];
  const PO = { id: "PO-7", store: "Patel Brothers", client: "Sunfield", date: "2026-10-16", lines: [{ productId: "S1", cases: 20 }], status: "picking", strategy: "fifo-open-first",
    picks: [{ ...pick, picked: { cases: 10, by: "Omar", at: AT, taken } }, { ...pick, key: "k2", location: "02A-01-L1-B1" }], short: {} };
  const draft = { id: "PO-8", store: "Balaji", client: "Sunfield", date: "2026-10-16", lines: [{ productId: "S1", cases: 5 }], status: "draft" };
  await w.seed({ "stock:01A-01-L1-B1": [{ ...L1, cases: 30 }], "order:PO-7": PO, "order:PO-8": draft });
  // A saved or re-planned order that claims cases were taken (cancelling would then put them "back"), or plans too much
  const fake = { cases: 10, by: "Leo", at: AT, taken: [{ ...L1, cases: 10, location: "02A" }] };
  await w.leo.refused("order/save", [{ key: "order:PO-8", base: 1, data: { ...draft, picks: [{ ...pick, picked: fake }] } }]);
  await w.leo.refused("order/save", [{ key: "order:PO-7", base: 1, data: { ...PO, picks: [PO.picks[0], { ...PO.picks[1], picked: fake }] } }]);
  await w.leo.refused("order/plan", [{ key: "order:PO-7", base: 1, data: { ...PO, picks: [PO.picks[0], { ...PO.picks[1], cases: 1000 }] } }]);
  await w.leo.refused("order/approve", [{ key: "order:PO-8", base: 1, data: { ...draft, status: "approved", lines: [{ productId: "S1", cases: 500 }], picks: [] } }]);
  // Cancelling that puts back 100 cases, or leaves a pick confirmed, or ships with other changes
  const cancelled = { ...PO, status: "cancelled", cancelledAt: AT, cancelledBy: "Leo", notes: "Cancelled: store called", picks: PO.picks.map(({ picked: _p, ...p }) => p) };
  const back = { key: "movement:M1", data: { id: "M1", at: AT, by: "Leo", type: "pick-undo", orderId: "PO-7", location: "01A-01-L1-B1", productId: "S1", cases: 10, reason: "PO-7 cancelled: store called" } };
  await w.leo.refused("order/cancel", [{ key: "order:PO-7", base: 1, data: cancelled }, { key: "stock:01A-01-L1-B1", base: 1, data: [{ ...L1, cases: 130 }] }]);
  await w.leo.refused("order/cancel", [{ key: "order:PO-7", base: 1, data: { ...cancelled, picks: PO.picks } }, { key: "stock:01A-01-L1-B1", base: 1, data: [L1] }]);
  await w.leo.refused("order/cancel", [{ key: "order:PO-7", base: 1, data: cancelled }]);
  await w.leo.refused("order/ship", [{ key: "order:PO-7", base: 1, data: { ...PO, status: "shipped", shippedAt: AT, shippedBy: "Leo", lines: [{ productId: "S1", cases: 2 }] } }]);
  await w.leo.refused("order/delete", [{ key: "order:PO-7", base: 1, data: null }]);
  // What the app sends
  assert.equal((await w.leo.push("order/cancel", [{ key: "order:PO-7", base: 1, data: cancelled }, { key: "stock:01A-01-L1-B1", base: 1, data: [L1] }, back, audit("A1")])).ok, true);
  assert.deepEqual(await w.stockOf("01A-01-L1-B1"), [L1]);
  // Once cancelled, it stays cancelled: cancelling again would put the cases back twice
  await w.leo.refused("order/cancel", [{ key: "order:PO-7", base: 2, data: cancelled }, { key: "stock:01A-01-L1-B1", base: 2, data: [{ ...L1, cases: 50 }] }]);
  assert.equal((await w.leo.push("order/assign", [{ key: "order:PO-8", base: 1, data: { ...draft, assignee: w.omar.id } }])).ok, true);
  assert.equal((await w.leo.push("order/delete", [{ key: "order:PO-8", base: 2, data: null }])).ok, true);
});

test("a new return waits for an owner's decision", async () => {
  const w = await team();
  const R = { id: "R-1", orderId: "PO-7", store: "Patel Brothers", items: [{ key: "a", productId: "S1", cases: 2 }], photos: [], reason: "Damaged", notes: "", status: "pending", createdAt: AT, createdBy: "Leo" };
  await w.leo.refused("submitReturn", [{ key: "return:R-1", data: { ...R, status: "approved", outcome: "restock", decidedAt: AT, decidedBy: "Leo" } }]);
  assert.equal((await w.leo.push("submitReturn", [{ key: "return:R-1", data: R }, { key: "meta:seq", data: { value: 1 } }])).ok, true);
});
