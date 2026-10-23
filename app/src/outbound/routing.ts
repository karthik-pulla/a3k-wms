// Email routing (Manage warehouse → Clients): which client an email to the order inbox is from, and whether it's an
// order or a delivery notice (ASN). Rules match a sender address exactly, or everyone at "@domain"; an exact address
// wins over a domain. Emails no rule matches are read as orders unless they look like a delivery notice.
import type { InboxMail, MailRoute, WarehouseSettings } from "../store/types";

/** The bare address of "Name <a@b.com>" */
export const senderOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

export function routeFor(settings: WarehouseSettings | undefined, from: string): MailRoute | undefined {
  const a = senderOf(from);
  const rules = settings?.routes ?? [];
  return rules.find(r => r.match.trim().toLowerCase() === a)
    ?? rules.filter(r => r.match.trim().startsWith("@") && a.endsWith(r.match.trim().toLowerCase())).sort((x, y) => y.match.length - x.match.length)[0];
}

// Words that only come up in a delivery notice ("container" or "inbound" appear in orders too, so they don't count alone)
const NOTICE = /\b(asn|advance ship(ping)? notice|delivery notice|shipping notice|bill of lading|bol\s*(no|#|number)?\s*[:#]?\s*\w*\d|container\s*(no|#|number)?\s*[:#]?\s*[A-Z]{4}\s?\d{6,7}|(arriving|arrives|eta)\b.{0,40}\b(container|truck|delivery|shipment))/i;

/** Order or delivery notice, and the client if a rule says */
export function mailRoute(settings: WarehouseSettings | undefined, m: Pick<InboxMail, "from" | "subject" | "body">): { kind: "order" | "inbound"; client?: string; rule?: MailRoute } {
  const rule = routeFor(settings, m.from);
  if (rule) return { kind: rule.kind, client: rule.client, rule };
  return { kind: NOTICE.test(`${m.subject}\n${m.body.slice(0, 2000)}`) ? "inbound" : "order" };
}

/** Problems with a rule (empty = fine) */
export function routeProblems(r: Pick<MailRoute, "match" | "client">): string[] {
  const m = r.match.trim();
  const out: string[] = [];
  if (!/^(@[a-z0-9.-]+\.[a-z]{2,}|[^\s@<>]+@[a-z0-9.-]+\.[a-z]{2,})$/i.test(m)) out.push("An address (buyer@store.com) or everyone at a domain (@store.com)");
  if (!r.client) out.push("A client");
  return out;
}
