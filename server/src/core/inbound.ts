// Order emails (docs/multi-tenant-design.md, "Order email"): each warehouse has an address <id>@orders.<domain>
// (A3K's orders@a3kimports.com forwards to a3k@orders.<domain>). Amazon SES receives the mail, keeps it in the
// files bucket and puts a note on a queue; the API picks it up (src/main.ts), reads it here, and puts it in the
// warehouse's order inbox through the sync, so every device sees it as a new email to turn into a draft order.
import PostalMime from "postal-mime";
import type { Sql } from "./db.ts";
import { writeSystem } from "./sync.ts";

export const INBOUND_LIMITS = { bodyChars: 100_000, pdfBytes: 1_000_000, attachments: 10 } as const;

/** The warehouses an email was sent to: the <id> of every <id>@orders.<domain> among the recipients SES saw */
export function tenantsFor(recipients: string[], ordersDomain: string): string[] {
  const suffix = `@${ordersDomain.toLowerCase()}`;
  const ids = recipients.map(r => r.trim().toLowerCase().replace(/^.*<|>$/g, "")).filter(r => r.endsWith(suffix)).map(r => r.slice(0, -suffix.length));
  return [...new Set(ids.filter(id => /^[a-z][a-z0-9-]{1,30}$/.test(id)))];
}

/** Is the sender on the warehouse's list (an address, or "@domain.com" for everyone there)? No list = everyone is. */
export function trusted(from: string, list: string[] | undefined): boolean {
  if (!list?.length) return true;
  const addr = from.toLowerCase().match(/[^\s<]+@[^\s>]+/)?.[0] ?? "";
  return list.some(t => { const x = t.trim().toLowerCase(); return x.startsWith("@") ? addr.endsWith(x) : addr === x; });
}

export interface InboxMailData {
  id: string; from: string; subject: string; receivedAt: string; body: string;
  attachments: { name: string; text: string; pdf?: string }[];
  status: "new" | "ignored";
}

const strip = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
const bytesOf = (c: ArrayBuffer | Uint8Array | string) => (typeof c === "string" ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c));
const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** An email as the order inbox keeps it: text (or the HTML as text), and PDFs kept for the app to read */
export async function readMail(raw: Uint8Array, receivedAt: string): Promise<InboxMailData> {
  const m = await PostalMime.parse(raw);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", m.messageId ? new TextEncoder().encode(m.messageId) : new Uint8Array(raw)));
  const notes: string[] = [];
  const attachments: InboxMailData["attachments"] = [];
  for (const a of m.attachments) {
    if (a.related || a.disposition === "inline" && !/pdf/i.test(a.mimeType)) continue;
    const name = (a.filename ?? "attachment").slice(0, 120);
    const pdf = /pdf/i.test(a.mimeType) || /\.pdf$/i.test(name);
    const bytes = bytesOf(a.content);
    if (!pdf) { notes.push(`(Attachment ${name} isn't a PDF, so it wasn't kept.)`); continue; }
    if (bytes.length > INBOUND_LIMITS.pdfBytes) { notes.push(`(Attachment ${name} is ${(bytes.length / 1e6).toFixed(1)} MB, too big to keep: ask for it by another way.)`); continue; }
    if (attachments.length >= INBOUND_LIMITS.attachments) { notes.push(`(More than ${INBOUND_LIMITS.attachments} PDFs: ${name} wasn't kept.)`); continue; }
    attachments.push({ name, text: "", pdf: b64(bytes) });
  }
  const text = (m.text?.trim() || (m.html ? strip(m.html) : "")).slice(0, INBOUND_LIMITS.bodyChars);
  const from = m.from ? (m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address ?? "") : "";
  return {
    id: `mail-${[...digest.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("")}`,
    from: from || "(unknown sender)", subject: (m.subject ?? "(no subject)").slice(0, 300), receivedAt,
    body: [text, ...notes].filter(Boolean).join("\n\n"), attachments, status: "new",
  };
}

/** Puts an email in a warehouse's inbox, once (the same email again changes nothing); untrusted senders arrive ignored */
export async function deliverMail(q: Sql, mail: InboxMailData, trustedSenders: string[] | undefined): Promise<"added" | "duplicate"> {
  const key = `inbox:${mail.id}`;
  if ((await q.query("SELECT 1 FROM entities WHERE key = $1", [key])).rows.length) return "duplicate";
  const data = trusted(mail.from, trustedSenders) ? mail : { ...mail, status: "ignored" as const, body: `(Not on this warehouse's list of trusted senders, so it arrived as ignored.)\n\n${mail.body}` };
  await writeSystem(q, [{ key, data }], "Order inbox", "inbound email");
  return "added";
}
