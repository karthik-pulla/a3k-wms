// Fixes for bugs found in the simulated test run of 3 Nov 2026 (docs/test-reports/2026-11-03-simulated-run.md).
// The server's refusals for B1 (over-picking), B3 (another delivery's put-away plan) and B4 (count corrections
// without a reason) are tested in server/test/; these are the shared pieces the app uses.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { selfFrom } = await import(path.join(ROOT, "app/src/auth/accountUser.ts"));
const { countReason, countNote } = await import(path.join(ROOT, "server/src/shared/counts.ts"));

test("B2: the signed-in person's switches come from their account, never from the people list", () => {
  // The people list (Messages) knows names and groups; it has no switches
  const rec = { id: "p1", name: "Demo Coordinator", role: "coordinator", roleName: "Coordinator", groups: ["coordinators", "shift-am"] };
  // The server's account: the coordinator role with "Edit products" turned on
  const own = { id: "p1", name: "Demo Coordinator", role: "coordinator", groups: ["coordinators"], perms: { "edit-products": true } };
  const me = selfFrom(rec, own);
  assert.deepEqual(me.perms, { "edit-products": true });
  assert.equal(me.role, "coordinator");
  // A switch turned off again, a role or client change: the account wins, and the old values don't linger
  const off = selfFrom({ ...rec, perms: { "edit-products": true }, clients: ["Sunfield"] }, { ...own, perms: undefined, role: "worker", groups: [] });
  assert.equal(off.perms, undefined);
  assert.equal(off.clients, undefined);
  assert.equal(off.role, "worker");
  // Groups that come with a role follow the role; the person's other groups (a shift) stay
  assert.deepEqual(off.groups, ["shift-am"]);
  // A name changed in Messages stays
  assert.equal(selfFrom({ ...rec, name: "Coord Nina" }, own).name, "Coord Nina");
});

test("B4: a count correction's history line carries the owner's reason", () => {
  assert.equal(countReason("Rack 6", "  recount confirmed "), 'Count "Rack 6": recount confirmed');
  assert.equal(countNote("Rack 6", countReason("Rack 6", "recount confirmed")), "recount confirmed");
  // What the app used to write (no reason), only spaces, another count's name, or not text at all
  assert.equal(countNote("Rack 6", 'Count "Rack 6"'), "");
  assert.equal(countNote("Rack 6", 'Count "Rack 6":   '), "");
  assert.equal(countNote("Rack 6", 'Count "Rack 7": fine'), "");
  assert.equal(countNote("Rack 6", undefined), "");
});
