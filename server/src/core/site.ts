// The product's public page (app/landing.html at <domain>): "Book a visit" requests, and the console's list of them.
// No accounts, no cookies; requests are limited per address (src/app.ts) and a hidden field catches simple bots.
import type { Db } from "./db.ts";
import { bad, str } from "./errors.ts";
import type { Mailer } from "./mail.ts";

export const VISIT_STATUSES = ["new", "contacted", "booked", "closed"] as const;
export interface VisitView { id: number; createdAt: string; name: string; company: string; email: string; phone: string; location: string; size: string; message: string; when: string; status: (typeof VISIT_STATUSES)[number]; notes: string; updatedBy: string | null }

/** A visit request from the public page. `website` is the hidden field: a person never fills it in. */
export async function requestVisit(db: Db, i: Record<string, unknown>, o: { ip?: string; mailer: Mailer; notifyTo?: string; productName: string }): Promise<{ ok: true }> {
  if (typeof i.website === "string" && i.website.trim()) return { ok: true }; // a bot: looks accepted, nothing is kept
  const email = str(i.email, "Email", { max: 200 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("That email address doesn't look right");
  const v = {
    name: str(i.name, "Your name", { min: 2, max: 120 }), company: str(i.company, "Warehouse or company", { min: 2, max: 160 }), email,
    phone: str(i.phone, "Phone", { max: 40, optional: true }), location: str(i.location, "Where the warehouse is", { max: 160, optional: true }),
    size: str(i.size, "Size", { max: 80, optional: true }), message: str(i.message, "Message", { max: 3000, optional: true }), when: str(i.when, "When suits", { max: 200, optional: true }),
  };
  const { rows } = await db.query(
    "INSERT INTO visit_requests (name, company, email, phone, location, size, message, when_text, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    [v.name, v.company, v.email, v.phone, v.location, v.size, v.message, v.when, o.ip ?? null]);
  if (o.notifyTo) await o.mailer.send({
    to: o.notifyTo, subject: `${o.productName}: visit request from ${v.company}`,
    text: [`${v.name} (${v.company}) asked for a visit (request ${rows[0].id}).`, "", `Email: ${v.email}`, `Phone: ${v.phone || "—"}`, `Where: ${v.location || "—"}`, `Size: ${v.size || "—"}`, `When suits: ${v.when || "—"}`, "", v.message || "(no message)", "", "It's in the console under Visits."].join("\n"),
  }).catch(() => false);
  return { ok: true };
}

export async function listVisits(db: Db): Promise<VisitView[]> {
  const { rows } = await db.query("SELECT * FROM visit_requests ORDER BY (status IN ('new', 'contacted')) DESC, created_at DESC LIMIT 500");
  return rows.map(r => ({ id: Number(r.id), createdAt: new Date(r.created_at).toISOString(), name: r.name, company: r.company, email: r.email, phone: r.phone, location: r.location, size: r.size, message: r.message, when: r.when_text, status: r.status, notes: r.notes, updatedBy: r.updated_by }));
}

export async function updateVisit(db: Db, by: string, i: Record<string, unknown>): Promise<VisitView> {
  const id = Number(i.id);
  if (!Number.isInteger(id) || id < 1) throw bad("Which request?");
  const status = str(i.status, "Status", { max: 20 });
  if (!(VISIT_STATUSES as readonly string[]).includes(status)) throw bad(`Status must be one of ${VISIT_STATUSES.join(", ")}`);
  const notes = str(i.notes, "Notes", { max: 3000, optional: true });
  const { rows } = await db.query("UPDATE visit_requests SET status = $2, notes = $3, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING id", [id, status, notes, by]);
  if (!rows[0]) throw bad("No such request");
  return (await listVisits(db)).find(v => v.id === id)!;
}
