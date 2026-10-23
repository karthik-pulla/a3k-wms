// Email routing (app/src/outbound/routing.ts): which client an inbox email is for, and order vs delivery notice.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { mailRoute, routeFor, routeProblems } = await import(path.join(ROOT, "app/src/outbound/routing.ts"));
const settings = { routes: [
  { id: "R1", match: "@sunfield.example", client: "Sunfield", kind: "inbound" },
  { id: "R2", match: "buyer@sunfield.example", client: "Sunfield", kind: "order" },
] };

test("an exact address wins over its domain; other senders match nothing", () => {
  assert.equal(routeFor(settings, "Buyer <BUYER@sunfield.example>").id, "R2");
  assert.equal(routeFor(settings, "logistics@sunfield.example").id, "R1");
  assert.equal(routeFor(settings, "x@notsunfield.example"), undefined);
});

test("without a rule, only real delivery-notice wording makes a notice", () => {
  const kind = (subject, body = "") => mailRoute(undefined, { from: "a@b.example", subject, body }).kind;
  assert.equal(kind("ASN: container MSKU 4829103 arriving Monday"), "inbound");
  assert.equal(kind("Advance shipping notice"), "inbound");
  assert.equal(kind("Shipment", "Container MSKU 4829103, BOL 88213"), "inbound");
  assert.equal(kind("PO 4471", "Please ship by Tuesday, container-friendly pallets, inbound dock 2"), "order");
  assert.equal(kind("Order for Thursday", "1073 x 10 cases"), "order");
});

test("a rule needs an address or @domain and a client", () => {
  assert.deepEqual(routeProblems({ match: "@store.com", client: "Sunfield" }), []);
  assert.equal(routeProblems({ match: "store", client: "" }).length, 2);
});
