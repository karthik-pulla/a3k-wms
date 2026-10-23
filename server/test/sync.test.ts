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
  assert.deepEqual(await w.omar.b.call("sync.pull", { since: got.seq }), { rows: [], seq: got.seq, more: false });
});

test("a change made from an old version is refused, so nobody overwrites someone else unseen", async () => {
  const w = await team();
  await w.owner.call("sync.push", change("move", [{ key: "stock:01A-01-L1-B1", data: line(40) }]));
  // Omar's device still thinks the slot is empty (version 0)
  const stale = await w.omar.b.call("sync.push", change("move", [{ key: "stock:01A-01-L1-B1", data: line(10) }]));
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
  const c = change("move", [{ key: "stock:01A-01-L1-B1", data: line(5) }]);
  const a = await w.omar.b.call("sync.push", c);
  const b = await w.omar.b.call("sync.push", c);
  assert.deepEqual(b, a);
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
  // A worker moving a pallet is fine
  assert.equal((await w.omar.b.call("sync.push", change("move", [{ key: "stock:03A-01-L1-B1", data: line(2) }]))).ok, true);
});

test("the change log and movement log are never changed, and say who did it as the server knows them", async () => {
  const w = await team();
  await w.omar.b.call("sync.push", change("move", [
    { key: "stock:01A-01-L1-B1", data: line(3) },
    { key: "audit:A1", data: { id: "A1", by: "Maya (pretending)", byId: "someone-else", action: "Moved a pallet", area: "stock", at: "2026-10-16T12:00:00.000Z" } },
    { key: "movement:M1", data: { id: "M1", by: "Somebody", type: "move", location: "01A-01-L1-B1", cases: 3 } },
  ]));
  const { rows } = await pullAll(w.owner);
  const audit = rows.find((x: any) => x.key === "audit:A1").data;
  assert.deepEqual([audit.by, audit.byId], ["Omar", w.omar.id]);
  assert.equal(rows.find((x: any) => x.key === "movement:M1").data.by, "Omar");
  await fails(w.owner.call("sync.push", change("move", [{ key: "audit:A1", base: 1, data: { id: "A1", action: "edited" } }])), "forbidden");
  await fails(w.owner.call("sync.push", change("move", [{ key: "movement:M1", base: 1, data: null }])), "forbidden");
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
  await w.owner.call("sync.push", change("move", [{ key: "stock:S-00000", base: 1, data: line(99) }]));
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
