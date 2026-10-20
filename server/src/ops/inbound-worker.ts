// The API's background loop for order emails (core/inbound.ts): SES keeps each email in the files bucket and puts its
// notice (with the recipients it saw) on a queue; this takes notices off the queue, reads the email, and delivers it
// to each warehouse it was sent to. A notice it can't handle goes back on the queue and, after a few tries, to the
// queue's dead-letter queue (infra/lib/data-stack.ts). Only on AWS (src/main.ts starts it when the queue is set).
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Db } from "../core/db.ts";
import { deliverMail, readMail, tenantsFor } from "../core/inbound.ts";
import type { TenantPools } from "../db/pools.ts";
import { rowToTenant } from "../tenancy.ts";

/** What SES put on the queue: where it kept the email, and who it was really sent to (not just the To line) */
export function readNotice(body: string): { bucket: string; key: string; recipients: string[]; at: string } | null {
  let n: any;
  try { n = JSON.parse(body); } catch { return null; }
  // Through SNS without raw delivery the notice is wrapped once more
  if (typeof n?.Message === "string") { try { n = JSON.parse(n.Message); } catch { return null; } }
  const a = n?.receipt?.action;
  if (n?.notificationType !== "Received" || a?.type !== "S3" || !a.bucketName || !a.objectKey) return null;
  return { bucket: a.bucketName, key: a.objectKey, recipients: n.receipt.recipients ?? n.mail?.destination ?? [], at: n.mail?.timestamp ?? new Date().toISOString() };
}

export function startInboundWorker(o: { region: string; queueUrl: string; ordersDomain: string; platform: Db; pools: TenantPools }) {
  const sqs = new SQSClient({ region: o.region }), s3 = new S3Client({ region: o.region });
  let stopped = false;
  const log = (x: Record<string, unknown>) => console.log(JSON.stringify({ area: "order-inbox", ...x }));
  const handle = async (body: string) => {
    const n = readNotice(body);
    if (!n) { log({ ok: false, skipped: "not an email notice" }); return true; }
    const ids = tenantsFor(n.recipients, o.ordersDomain);
    if (!ids.length) { log({ ok: false, skipped: "no warehouse address among the recipients", recipients: n.recipients.length }); }
    else {
      const obj = await s3.send(new GetObjectCommand({ Bucket: n.bucket, Key: n.key }));
      const raw = new Uint8Array(await obj.Body!.transformToByteArray());
      const mail = await readMail(raw, n.at);
      const { rows } = await o.platform.query("SELECT id, name, status, db_name, db_user, db_host, db_port FROM tenants WHERE id = ANY($1) AND status IN ('setup', 'active', 'leaving')", [ids]);
      for (const r of rows) {
        const t = rowToTenant(r);
        const result = await o.pools.tx(t, async q => {
          const cfg = (await q.query("SELECT value FROM settings WHERE key = 'config'")).rows[0]?.value;
          return deliverMail(q, mail, cfg?.orders?.trustedSenders);
        });
        log({ ok: true, tenant: t.id, mail: mail.id, result, pdfs: mail.attachments.length });
      }
    }
    // The email itself isn't kept once it's in the inboxes
    await s3.send(new DeleteObjectCommand({ Bucket: n.bucket, Key: n.key })).catch(() => {});
    return true;
  };
  (async () => {
    while (!stopped) {
      try {
        const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: o.queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 20, VisibilityTimeout: 120 }));
        for (const m of r.Messages ?? []) {
          try { if (await handle(m.Body ?? "")) await sqs.send(new DeleteMessageCommand({ QueueUrl: o.queueUrl, ReceiptHandle: m.ReceiptHandle! })); }
          catch (e) { log({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
        }
      } catch (e) {
        log({ ok: false, error: e instanceof Error ? e.message : String(e) });
        await new Promise(r => setTimeout(r, 10_000));
      }
    }
  })();
  return { stop: () => { stopped = true; } };
}
