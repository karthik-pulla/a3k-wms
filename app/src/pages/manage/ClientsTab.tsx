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

/** Clients and carriers: who the warehouse deals with, and which client each email to the order inbox comes from */
export function ClientsTab() {
  return <div className="stack"><Routing /><Contacts /></div>;
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
