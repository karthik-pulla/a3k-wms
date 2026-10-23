import { t } from "../../i18n";
import { useState } from "react";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../../components/Toast";
import { CLIENTS, clientConfig } from "../../data/catalog";
import { tenant } from "../../tenant";
import { mailRoute, routeProblems } from "../../outbound/routing";
import { newId } from "../../store/warehouse";
import type { Contact, MailRoute } from "../../store/types";
import { useIdentity } from "../../auth/identity";
import { LinkPanel, useAction, useApiData } from "../warehouse/useApi";
import type { ClientLoginView, LinkResult } from "../../../../server/src/shared/api.ts";

/** Clients and carriers: who the warehouse deals with, their portal logins, and which client each email to the order inbox comes from */
export function ClientsTab() {
  return <div className="stack"><PortalLogins /><Routing /><Contacts /></div>;
}

/** Where clients sign in: <this address>/portal on the server (portal.html beside this page in the preview) */
const portalAddress = () => (import.meta.env.VITE_WMS_BACKEND === "preview" ? new URL("./portal.html", location.href).href.split("#")[0] : `${location.origin}/portal`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

/**
 * The client portal: each client's own logins, for placing orders and announcing deliveries. Orders arrive as drafts
 * in Out-bounds, delivery notices as expected deliveries in In-bounds. Owners only; needs the server.
 */
function PortalLogins() {
  const { kind, me: serverMe } = useIdentity();
  const allowed = kind === "server" && !!serverMe?.can["manage-people"];
  const logins = useApiData<ClientLoginView[]>(allowed ? "clientLogins.list" : null);
  const act = useAction();
  const toast = useToast();
  const [name, setName] = useState(""), [username, setUsername] = useState(""), [email, setEmail] = useState(""), [client, setClient] = useState(CLIENTS[0] ?? "");
  const [link, setLink] = useState<(LinkResult & { who: string; kind: "invite" | "reset" }) | null>(null);
  const [busy, setBusy] = useState(false);
  if (kind !== "server") return (
    <section className="panel glass">
      <h2 className="plain-h">Client portal</h2>
      <p className="muted small">With the server, each client gets its own logins to a page where they place orders and tell you about deliveries on their way. Until then, clients email the order inbox (rules below).</p>
    </section>
  );
  if (!allowed) return null;
  const userOk = /^[a-z0-9][a-z0-9._-]{1,39}$/.test(username.trim().toLowerCase());
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ok = name.trim().length >= 2 && userOk && emailOk && !!client;
  const run = async (method: string, input: Record<string, unknown>, done?: (v: any) => void) => {
    setBusy(true);
    const r = await act<any>(method, input);
    setBusy(false);
    if (!r.ok) { if (r.error !== "Cancelled") toast(r.error); return; }
    done?.(r.value);
    void logins.reload();
  };
  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    void run("clientLogins.invite", { name: name.trim(), username: username.trim().toLowerCase(), email: email.trim() || null, client }, v => {
      setLink({ link: v.link, emailed: v.emailed, who: name.trim(), kind: "invite" });
      setName(""); setUsername(""); setEmail("");
    });
  };
  const address = portalAddress();
  return (
    <section className="panel glass">
      <h2 className="plain-h">Client portal</h2>
      <p className="muted small">Clients sign in at <a className="link" href={address} target="_blank" rel="noreferrer" translate="no">{address}</a> with their own login (a password and a code from their phone) to place orders and announce deliveries. Their orders arrive as drafts in Out-bounds → Orders for approval; delivery notices as expected deliveries in In-bounds → Incoming. A login sees only its own client's products and what its client sent, never stock or anything else here.</p>
      {link && <LinkPanel link={link.link} emailed={link.emailed} who={link.who} kind={link.kind} onClose={() => setLink(null)} />}
      {logins.error && <p className="note warn">{logins.error}</p>}
      <div className="table-wrap">
        <table className="lines">
          <thead><tr><th>Login</th><th>Client</th><th>Status</th><th>Last sign-in</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {(logins.data ?? []).map(l => (
              <tr key={l.id} className={l.status === "disabled" ? "off" : undefined}>
                <td><b translate="no">{l.name}</b><small className="muted block" translate="no">@{l.username}{l.email ? ` · ${l.email}` : ""}</small></td>
                <td translate="no">{l.clientName}</td>
                <td>{l.status === "disabled" ? <span className="status off">Login off</span> : l.status === "invited" ? <span className="status wait">Invited{l.linkPending ? " · link waiting" : " · link expired"}</span> : l.linkPending === "reset" ? <span className="status wait">Reset · link waiting</span> : <span className="status ok">Active</span>}</td>
                <td className="muted">{when(l.lastSignInAt)}</td>
                <td><span className="btns">
                  {l.status === "disabled"
                    ? <button className="btn small" disabled={busy} onClick={() => void run("clientLogins.enable", { id: l.id }, v => { if (v.link) setLink({ link: v.link, emailed: v.emailed, who: l.name, kind: "invite" }); })}>Turn on</button>
                    : <>
                      <button className="btn small" disabled={busy} onClick={() => { if (window.confirm(t(`Reset ${l.name}'s sign-in? Their password and phone stop working at once, and they get a new link.`))) void run("clientLogins.resetAccess", { id: l.id }, v => setLink({ link: v.link, emailed: v.emailed, who: l.name, kind: l.status === "invited" ? "invite" : "reset" })); }}>{l.status === "invited" ? "New link" : "Reset sign-in"}</button>
                      <button className="btn small" disabled={busy} onClick={() => { if (window.confirm(t(`Turn off ${l.name}'s login? They're signed out at once.`))) void run("clientLogins.disable", { id: l.id }); }}>Turn off</button>
                    </>}
                </span></td>
              </tr>
            ))}
            {logins.data && !logins.data.length && <tr><td colSpan={5} className="empty-row">No client logins yet.</td></tr>}
            {!logins.data && !logins.error && <tr><td colSpan={5} className="empty-row" role="status">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="route-form portal-login-form" onSubmit={invite}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" aria-label="Full name" autoComplete="off" />
        <input className={`input${username && !userOk ? " invalid" : ""}`} value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoCapitalize="none" spellCheck={false} autoComplete="off" />
        <input className={`input${!emailOk ? " invalid" : ""}`} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (for the link)" aria-label="Email" autoComplete="off" />
        <select className="input" value={client} onChange={e => setClient(e.target.value)} aria-label="Client">{CLIENTS.map(c => <option key={c} value={c}>{clientConfig(c)?.name ?? c}</option>)}</select>
        <button className="btn primary" disabled={!ok || busy}>Make a login</button>
      </form>
      <p className="muted small">They get a link (by email, or copy it) to choose a password and connect an authenticator app. Making, resetting and turning off logins asks for your password again.</p>
    </section>
  );
}

function Routing() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const routes = state.settings?.routes ?? [];
  const [match, setMatch] = useState(""), [client, setClient] = useState(CLIENTS[0] ?? ""), [kind, setKind] = useState<MailRoute["kind"]>("order"), [note, setNote] = useState("");
  const [test, setTest] = useState("");
  const save = (next: MailRoute[]) => dispatch({ type: "warehouse/settings", patch: { routes: next }, by: me.name });
  const problems = match ? routeProblems({ match, client }) : [];
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!match.trim() || problems.length) return;
    if (routes.some(r => r.match.trim().toLowerCase() === match.trim().toLowerCase() && r.kind === kind)) { toast("There's already a rule for that sender."); return; }
    save([...routes, { id: newId("R"), match: match.trim().toLowerCase(), client, kind, note: note.trim() || undefined }]);
    setMatch(""); setNote("");
    toast("Rule added. New emails from that sender are sorted by it.");
  };
  const tested = test.trim() ? mailRoute(state.settings, { from: test, subject: "", body: "" }) : null;
  return (
    <section className="panel glass">
      <h2 className="plain-h">Email routing</h2>
      <p className="muted small">Clients and stores email <b translate="no">{tenant().config.orders.inbox}</b>. These rules say which client an email is for and whether it's an order (it becomes a draft in Out-bounds → Inbox) or a delivery notice (it becomes an expected delivery in In-bounds). Emails no rule matches are read as orders unless they look like a delivery notice.</p>
      <div className="table-wrap">
        <table className="lines">
          <thead><tr><th>From</th><th>Client</th><th>Sends</th><th>Note</th><th aria-label="Remove" /></tr></thead>
          <tbody>
            {routes.map(r => (
              <tr key={r.id}><td className="mono" translate="no">{r.match}</td><td translate="no">{clientConfig(r.client)?.name ?? r.client}</td><td>{r.kind === "order" ? "Orders" : "Delivery notices"}</td><td className="muted small" translate="no">{r.note}</td>
                <td><button className="mini" onClick={() => save(routes.filter(x => x.id !== r.id))} aria-label={`Remove the rule for ${r.match}`}>×</button></td></tr>
            ))}
            {!routes.length && <tr><td colSpan={5} className="empty-row">No rules yet: every email is read as an order and its client comes from the products in it.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="route-form" onSubmit={add}>
        <input className={`input${problems.length ? " invalid" : ""}`} value={match} onChange={e => setMatch(e.target.value)} placeholder="buyer@store.com or @store.com" aria-label="Sender address or domain" />
        <select className="input" value={client} onChange={e => setClient(e.target.value)} aria-label="Client">{CLIENTS.map(c => <option key={c} value={c}>{clientConfig(c)?.name ?? c}</option>)}</select>
        <select className="input" value={kind} onChange={e => setKind(e.target.value as MailRoute["kind"])} aria-label="Sends"><option value="order">Orders</option><option value="inbound">Delivery notices</option></select>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
        <button className="btn primary" disabled={!match.trim() || problems.length > 0}>Add rule</button>
      </form>
      {problems.length > 0 && <p className="small warn">{problems.join(". ")}.</p>}
      <label className="field small">Try a sender
        <input className="input" value={test} onChange={e => setTest(e.target.value)} placeholder="e.g. Orders <orders@store.com>" />
        {tested && <span className="muted">{tested.rule ? `${tested.kind === "order" ? "An order" : "A delivery notice"} for ${clientConfig(tested.client!)?.name ?? tested.client} (rule ${tested.rule.match})` : "No rule: read as an order, client from its products"}</span>}
      </label>
    </section>
  );
}

const BLANK: Omit<Contact, "id"> = { kind: "client", name: "", client: "", email: "", phone: "", notes: "" };

function Contacts() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const contacts = state.settings?.contacts ?? [];
  const [edit, setEdit] = useState<Contact | null>(null);
  const [show, setShow] = useState<"all" | "client" | "carrier">("all");
  const save = (next: Contact[]) => dispatch({ type: "warehouse/settings", patch: { contacts: next }, by: me.name });
  const list = contacts.filter(c => show === "all" || c.kind === show).sort((a, b) => a.kind.localeCompare(b.kind) || (a.client ?? "").localeCompare(b.client ?? "") || a.name.localeCompare(b.name));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit || !edit.name.trim()) return;
    const c: Contact = { ...edit, name: edit.name.trim(), email: edit.email?.trim() || undefined, phone: edit.phone?.trim() || undefined, notes: edit.notes?.trim() || undefined, client: edit.kind === "client" ? edit.client || undefined : undefined };
    save(contacts.some(x => x.id === c.id) ? contacts.map(x => (x.id === c.id ? c : x)) : [...contacts, c]);
    setEdit(null);
    toast("Contact saved.");
  };
  return (
    <section className="panel glass">
      <div className="panel-foot">
        <div><h2 className="plain-h">Clients and carriers</h2><p className="muted small">People you deal with: clients' buyers and offices, and trucking companies. Email or call them from here.</p></div>
        <button className="btn small primary" onClick={() => setEdit({ id: newId("C"), ...BLANK, client: CLIENTS[0] })}>+ Add a contact</button>
      </div>
      <div className="chip-wrap">{(["all", "client", "carrier"] as const).map(k => <button key={k} className={`chip-btn${show === k ? " on" : ""}`} onClick={() => setShow(k)}>{{ all: "Everyone", client: "Clients", carrier: "Carriers" }[k]} · {contacts.filter(c => k === "all" || c.kind === k).length}</button>)}</div>
      {edit && (
        <form className="facts contact-form" onSubmit={submit}>
          <div className="fact"><span>Kind</span><div className="segment" role="group" aria-label="Kind">{(["client", "carrier"] as const).map(k => <button key={k} type="button" aria-pressed={edit.kind === k} onClick={() => setEdit({ ...edit, kind: k })}>{k === "client" ? "Client" : "Carrier"}</button>)}</div></div>
          <label className="fact"><span>Name</span><input className="input" autoFocus value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder={edit.kind === "client" ? "e.g. Priya (buyer)" : "e.g. Fastline Trucking"} /></label>
          {edit.kind === "client" && <label className="fact"><span>Client</span><select className="input" value={edit.client} onChange={e => setEdit({ ...edit, client: e.target.value })}>{CLIENTS.map(c => <option key={c} value={c}>{clientConfig(c)?.name ?? c}</option>)}</select></label>}
          <label className="fact"><span>Email</span><input className="input" type="email" value={edit.email ?? ""} onChange={e => setEdit({ ...edit, email: e.target.value })} /></label>
          <label className="fact"><span>Phone</span><input className="input" type="tel" value={edit.phone ?? ""} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="fact"><span>Notes</span><input className="input" value={edit.notes ?? ""} onChange={e => setEdit({ ...edit, notes: e.target.value })} placeholder="e.g. dock hours, account number" /></label>
          <div className="btns"><button className="btn primary" disabled={!edit.name.trim()}>Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      <ul className="contact-list">
        {list.map(c => (
          <li key={c.id} className="row glass">
            <span className="row-title" translate="no">{c.name}<span className="tag">{c.kind === "client" ? clientConfig(c.client ?? "")?.name ?? c.client ?? "Client" : "Carrier"}</span></span>
            <span className="row-sub" translate="no">{[c.email, c.phone, c.notes].filter(Boolean).join(" · ")}</span>
            <span className="btns">
              {c.email && <a className="btn small" href={`mailto:${c.email}`}>Email</a>}
              {c.phone && <a className="btn small" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>Call</a>}
              <button className="btn small" onClick={() => setEdit(c)}>Edit</button>
              <button className="btn small" onClick={() => { if (window.confirm(t(`Remove ${c.name}?`))) save(contacts.filter(x => x.id !== c.id)); }}>Remove</button>
            </span>
          </li>
        ))}
        {!list.length && <li className="muted small">No contacts yet.</li>}
      </ul>
    </section>
  );
}
