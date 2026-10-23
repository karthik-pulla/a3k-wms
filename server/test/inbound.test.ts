// Order emails (src/ops/inbound.ts, src/ops/inbound-worker.ts): which warehouse an email is for, what's kept of
// it, trusted senders, and an email delivered twice.
import test from "node:test";
import assert from "node:assert/strict";
import { deliverMail, readMail, tenantsFor, trusted } from "../src/ops/inbound.ts";
import { readNotice } from "../src/ops/inbound-worker.ts";
import { freshDb } from "./pg.ts";

const pdf = (n: number) => Buffer.from(`%PDF-1.4\n${"x".repeat(n)}\n%%EOF`).toString("base64").replace(/(.{76})/g, "$1\r\n");
const EMAIL = [
  "From: Patel Brothers Orders <orders@patelbros.example>",
  "To: orders@a3kimports.example",
  "Subject: PO 4471 for Tuesday",
  "Message-ID: <po4471@patelbros.example>",
  "Date: Mon, 19 Oct 2026 14:02:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please send 10 cases of 1073 by Tuesday.",
  "--b1",
  'Content-Type: application/pdf; name="PO-4471.pdf"',
  'Content-Disposition: attachment; filename="PO-4471.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  pdf(200),
  "--b1",
  'Content-Type: application/pdf; name="catalog.pdf"',
  'Content-Disposition: attachment; filename="catalog.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  pdf(1_100_000),
  "--b1",
  'Content-Type: image/png; name="logo.png"',
  'Content-Disposition: attachment; filename="logo.png"',
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--b1--",
  "",
].join("\r\n");
const raw = new TextEncoder().encode(EMAIL);

test("the warehouse comes from the address SES delivered to, not the To line (forwarded mail keeps the old one)", () => {
  assert.deepEqual(tenantsFor(["a3k@orders.wms.example", "Someone <bravo@ORDERS.wms.example>", "x@other.example", "../evil@orders.wms.example"], "orders.wms.example"), ["a3k", "bravo"]);
  assert.deepEqual(tenantsFor(["orders@a3kimports.example"], "orders.wms.example"), []);
});

test("an email keeps its text and small PDFs; big PDFs and other files are noted, not kept", async () => {
  const m = await readMail(raw, "2026-10-19T14:02:05.000Z");
  assert.equal(m.from, "Patel Brothers Orders <orders@patelbros.example>");
  assert.equal(m.subject, "PO 4471 for Tuesday");
  assert.match(m.body, /^Please send 10 cases of 1073 by Tuesday\./);
  assert.match(m.body, /catalog\.pdf is 1\.1 MB, too big to keep/);
  assert.match(m.body, /logo\.png isn't a PDF/);
  assert.deepEqual(m.attachments.map(a => [a.name, a.text]), [["PO-4471.pdf", ""]]);
  assert.ok(Buffer.from(m.attachments[0].pdf!, "base64").toString().startsWith("%PDF-1.4"));
  // The same email (same Message-ID) always gets the same id
  assert.equal((await readMail(raw, "2026-10-20T00:00:00.000Z")).id, m.id);
});

test("trusted senders: an address, or everyone at a domain; no list means everyone", () => {
  assert.equal(trusted("Orders <orders@patelbros.example>", ["@patelbros.example"]), true);
  assert.equal(trusted("orders@patelbros.example", ["buyer@patelbros.example"]), false);
  assert.equal(trusted("anyone@x.example", undefined), true);
});

test("an email is delivered once into the inbox, and from someone untrusted it arrives as ignored", async () => {
  const { db } = await freshDb("tenant");
  const m = await readMail(raw, "2026-10-19T14:02:05.000Z");
  assert.equal(await db.tx(q => deliverMail(q, m, ["@patelbros.example"])), "added");
  assert.equal(await db.tx(q => deliverMail(q, m, ["@patelbros.example"])), "duplicate");
  const row = (await db.query("SELECT data FROM entities WHERE key = $1", [`inbox:${m.id}`])).rows[0].data;
  assert.equal(row.status, "new");
  const other = { ...m, id: "mail-other" };
  await db.tx(q => deliverMail(q, other, ["@balaji.example"]));
  const ignored = (await db.query("SELECT data FROM entities WHERE key = 'inbox:mail-other'")).rows[0].data;
  assert.equal(ignored.status, "ignored");
  assert.match(ignored.body, /^\(Not on this warehouse's list of trusted senders/);
  // A sender the owners routed to a client (Manage warehouse → Clients) is trusted as well
  await db.tx(q => q.query("INSERT INTO entities (key, kind, data, version, seq, created_seq, updated_by) VALUES ('setting:warehouse', 'setting', $1, 1, 1, 1, 'test')", [JSON.stringify({ routes: [{ id: "R1", match: "@patelbros.example", client: "Sunfield", kind: "order" }] })]));
  await db.tx(q => deliverMail(q, { ...m, id: "mail-routed" }, ["@balaji.example"]));
  assert.equal((await db.query("SELECT data FROM entities WHERE key = 'inbox:mail-routed'")).rows[0].data.status, "new");
});

test("the queue notice: where SES kept the email and who it was sent to, wrapped by SNS or not", () => {
  const notice = { notificationType: "Received", mail: { timestamp: "2026-10-19T14:02:05.000Z", destination: ["a3k@orders.wms.example"] }, receipt: { recipients: ["a3k@orders.wms.example"], action: { type: "S3", bucketName: "files", objectKey: "inbound/abc" } } };
  const want = { bucket: "files", key: "inbound/abc", recipients: ["a3k@orders.wms.example"], at: "2026-10-19T14:02:05.000Z" };
  assert.deepEqual(readNotice(JSON.stringify(notice)), want);
  assert.deepEqual(readNotice(JSON.stringify({ Type: "Notification", Message: JSON.stringify(notice) })), want);
  assert.equal(readNotice("not json"), null);
  assert.equal(readNotice(JSON.stringify({ notificationType: "Bounce" })), null);
});
