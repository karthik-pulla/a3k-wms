// Warehouse settings for owners (signed in with the server): everyone who works here, their roles and what each role
// may do, account requests, support access for the WMS team, and the security log. All of it lives in the
// warehouse's own database, so every device sees the same.
import { useMemo, useState } from "react";
import { SubTabs } from "../../components/SubTabs";
import { useSession } from "../../session";
import { useIdentity } from "../../auth/identity";
import { can } from "../../auth/permissions";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { initials } from "../../auth/accountUser";
import { tenant } from "../../tenant";
import { BASE_ROLES, SWITCHES, effective, type Action, type BaseRole, type Permissions } from "../../../../server/src/shared/permissions.ts";
import type { GrantView, LinkResult, LogView, PersonView, RequestView, RoleView } from "../../../../server/src/shared/api.ts";
import { ConfirmProvider, LinkPanel, useAction, useApiData } from "./useApi";

const when = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const BASE_NAME: Record<BaseRole, string> = { owner: "Owner", coordinator: "Coordinator", worker: "Worker" };

export function WarehousePage({ parts }: { parts: string[] }) {
  const { me } = useSession();
  const { kind, me: serverMe } = useIdentity();
  const [tab = "people"] = parts;
  const requests = useApiData<RequestView[]>("requests.list");
  const support = useApiData<GrantView[]>("support.list");
  if (kind !== "server") return <main className="section"><div className="panel glass"><p>People and roles are managed on the server. On this device, use Account.</p><a className="link" href="#/account">Account ›</a></div></main>;
  if (!can(me, "manage-people") || !serverMe?.can["manage-people"]) return <main className="section"><div className="panel glass"><p>Only owners manage people, roles and access.</p></div></main>;
  const waiting = (support.data ?? []).filter(g => g.status === "requested" || g.status === "active").length;
  return (
    <ConfirmProvider>
      <main className="section warehouse">
        <header className="section-head">
          <h1>Team</h1>
          <p className="crumb">{tenant().config.branding.appTitle} · {{ people: "People", roles: "Roles and switches", requests: "Account requests", support: "Support access", log: "Security log" }[tab] ?? "People"}</p>
        </header>
        <div className="team-body">
          {tab === "roles" ? <RolesTab /> : tab === "requests" ? <RequestsTab reload={requests.reload} /> : tab === "support" ? <SupportTab data={support} /> : tab === "log" ? <LogTab /> : <PeopleTab />}
        </div>
        <SubTabs base="warehouse" current={tab} tabs={[
          { id: "people", label: "People" }, { id: "roles", label: "Roles" },
          { id: "requests", label: "Requests", badge: requests.data?.length ?? 0 }, { id: "support", label: "Support", badge: waiting }, { id: "log", label: "Security log" },
        ]} />
      </main>
    </ConfirmProvider>
  );
}

// ---------- People ----------
function PeopleTab() {
  const people = useApiData<PersonView[]>("people.list");
  const roles = useApiData<RoleView[]>("roles.list");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "active" | "invited" | "disabled">("all");
  const [open, setOpen] = useState<string | "new" | null>(null);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = (people.data ?? []).filter(p => (show === "all" || p.status === show) && words.every(w => `${p.name} ${p.username} ${p.roleName} ${p.email ?? ""}`.toLowerCase().includes(w)));
  const counts = { active: 0, invited: 0, disabled: 0 };
  for (const p of people.data ?? []) counts[p.status]++;
  const current = open && open !== "new" ? people.data?.find(p => p.id === open) : undefined;
  return (
    <>
      <div className="toolbar team-toolbar">
        <input className="input grow" type="search" placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" />
        <div className="seg-filter" role="group" aria-label="Show">
          {(["all", "active", "invited", "disabled"] as const).map(s => (
            <button key={s} className={`chip-btn${show === s ? " on" : ""}`} onClick={() => setShow(s)}>
              {{ all: "Everyone", active: "Active", invited: "Invited", disabled: "Account off" }[s]}{s !== "all" && counts[s] ? ` · ${counts[s]}` : ""}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setOpen("new")}>Invite someone</button>
      </div>
      {people.error && <p className="note warn">{people.error}</p>}
      <section className="panel glass team-panel">
        {!people.data ? <p className="muted small" role="status">Loading…</p> : (
          <div className="table-wrap">
            <table className="lines people-table">
              <thead><tr><th>Person</th><th>Role</th><th>Brands</th><th>Status</th><th>Last sign-in</th></tr></thead>
              <tbody>
                {list.map(p => (
                  <tr key={p.id} tabIndex={0} onClick={() => setOpen(p.id)} onKeyDown={e => { if (e.key === "Enter") setOpen(p.id); }} className={p.status === "disabled" ? "off" : undefined}>
                    <td><div className="who"><span className="avatar" aria-hidden="true">{initials(p.name)}</span><div><b translate="no">{p.name}</b><small className="muted block" translate="no">@{p.username}</small></div></div></td>
                    <td><span className={`role-pill ${p.base}`} translate="no">{p.roleName}</span></td>
                    <td className="muted" translate="no">{p.base === "owner" || !p.clients ? "All" : p.clients.join(", ")}</td>
                    <td><Status p={p} /></td>
                    <td className="muted">{when(p.lastSignInAt)}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={5} className="muted">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open === "new" && <InviteDrawer roles={roles.data ?? []} onClose={() => setOpen(null)} onDone={() => void people.reload()} />}
      {current && <PersonDrawer p={current} roles={roles.data ?? []} onClose={() => setOpen(null)} onChange={() => void people.reload()} />}
    </>
  );
}

function Status({ p }: { p: PersonView }) {
  if (p.status === "disabled") return <span className="status off">Account off</span>;
  if (p.status === "invited") return <span className="status wait">Invited{p.linkPending ? " · link waiting" : " · link expired"}</span>;
  if (p.linkPending === "reset") return <span className="status wait">Reset · link waiting</span>;
  return <span className="status ok">Active</span>;
}

/** Which brands someone sees: all, or chosen ones */
function BrandsPicker({ value, onChange, disabled }: { value: string[] | null; onChange: (v: string[] | null) => void; disabled?: boolean }) {
  const clients = tenant().config.clients;
  return (
    <fieldset className="pick" disabled={disabled}>
      <legend>Brands they see</legend>
      <label className="toggle-row"><input type="checkbox" checked={value === null} onChange={e => onChange(e.target.checked ? null : [])} /> All brands</label>
      {value !== null && (
        <div className="pick-grid">
          {clients.map(c => (
            <label key={c.id} className="toggle-row" translate="no"><input type="checkbox" checked={value.includes(c.id)} onChange={e => onChange(e.target.checked ? [...value, c.id] : value.filter(x => x !== c.id))} /> {c.name}</label>
          ))}
          {!clients.length && <span className="muted small">No brands set up yet.</span>}
        </div>
      )}
      {disabled && <small className="muted">Owners always see every brand.</small>}
    </fieldset>
  );
}

function GroupsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const groups = tenant().config.groups;
  if (!groups.length) return null;
  return (
    <fieldset className="pick">
      <legend>Groups (for @mentions and shift channels)</legend>
      <div className="pick-grid">
        {groups.map(g => <label key={g.id} className="toggle-row" translate="no"><input type="checkbox" checked={value.includes(g.id)} onChange={e => onChange(e.target.checked ? [...value, g.id] : value.filter(x => x !== g.id))} /> {g.name}</label>)}
      </div>
    </fieldset>
  );
}

function RoleSelect({ roles, value, onChange }: { roles: RoleView[]; value: string; onChange: (id: string) => void }) {
  const r = roles.find(x => x.id === value);
  return (
    <label className="field"><span>Role</span>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        {roles.map(x => <option key={x.id} value={x.id}>{x.name}{x.builtIn ? "" : ` (based on ${BASE_NAME[x.base]})`}</option>)}
      </select>
      {r && <small className="muted">{BASE_ROLES.find(b => b.id === r.base)?.about}</small>}
    </label>
  );
}

const suggestUsername = (name: string) => name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 40);

function InviteDrawer({ roles, onClose, onDone }: { roles: RoleView[]; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("worker");
  const [clients, setClients] = useState<string[] | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkResult | null>(null);
  const user = touched ? username : suggestUsername(name);
  const base = roles.find(r => r.id === roleId)?.base ?? "worker";
  const ok = name.trim().length >= 1 && /^[a-z0-9][a-z0-9._-]{1,39}$/.test(user) && (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    const r = await act<LinkResult>("people.invite", { name: name.trim(), username: user, email: email.trim() || null, roleId, clients: base === "owner" ? null : clients, groups });
    setBusy(false);
    if (r.ok) { setLink(r.value); onDone(); } else setError(r.error);
  };
  return (
    <aside className="drawer glass" aria-label="Invite someone">
      <div className="drawer-head"><div><h2>Invite someone</h2><p className="muted small">They get a link to choose a password and connect their phone.</p></div><button className="iconbtn" onClick={onClose} aria-label="Close">×</button></div>
      {link ? <LinkPanel {...link} who={name.trim()} kind="invite" onClose={onClose} /> : (
        <form className="drawer-body form-stack" onSubmit={submit} noValidate>
          <label className="field"><span>Full name</span><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
          <label className="field"><span>Username</span>
            <input className="input" value={user} onChange={e => { setTouched(true); setUsername(e.target.value.toLowerCase()); }} autoCapitalize="none" spellCheck={false} translate="no" />
            <small className="muted">What they sign in with. Letters, numbers, dots, dashes.</small>
          </label>
          <label className="field"><span>Email (to send the link)</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" /></label>
          <RoleSelect roles={roles} value={roleId} onChange={setRoleId} />
          <BrandsPicker value={base === "owner" ? null : clients} onChange={setClients} disabled={base === "owner"} />
          <GroupsPicker value={groups} onChange={setGroups} />
          {error && <p className="note warn" role="alert">{error}</p>}
          <button className="btn primary big" disabled={!ok || busy}>{busy ? "Inviting…" : "Invite"}</button>
        </form>
      )}
    </aside>
  );
}

function PersonDrawer({ p, roles, onClose, onChange }: { p: PersonView; roles: RoleView[]; onClose: () => void; onChange: () => void }) {
  const act = useAction();
  const toast = useToast();
  const { account } = useIdentity();
  const self = account.uid === p.id;
  const [roleId, setRoleId] = useState(p.roleId);
  const [clients, setClients] = useState<string[] | null>(p.clients);
  const [groups, setGroups] = useState<string[]>(p.groups);
  const [name, setName] = useState(p.name);
  const [email, setEmail] = useState(p.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: string; emailed: boolean; kind: "invite" | "reset" } | null>(null);
  const base = roles.find(r => r.id === roleId)?.base ?? p.base;
  const dirty = roleId !== p.roleId || JSON.stringify(clients) !== JSON.stringify(p.clients) || groups.join() !== p.groups.join() || name !== p.name || email !== (p.email ?? "");
  const run = async (method: string, input: Record<string, unknown>, done?: (v: any) => void) => {
    setBusy(true); setError(null);
    const r = await act<any>(method, { id: p.id, ...input });
    setBusy(false);
    if (r.ok) { done?.(r.value); onChange(); } else setError(r.error);
  };
  return (
    <aside className="drawer glass" aria-label={p.name}>
      <div className="drawer-head">
        <div className="who"><span className="avatar" aria-hidden="true">{initials(p.name)}</span><div><h2 translate="no">{p.name}</h2><p className="muted small" translate="no">@{p.username} · <Status p={p} /></p></div></div>
        <button className="iconbtn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="drawer-body form-stack">
        {link && <LinkPanel {...link} who={p.name} onClose={() => setLink(null)} />}
        <label className="field"><span>Full name</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="for sign-in links" /></label>
        {self ? <p className="muted small">You're {p.roleName}. Another owner can change your role.</p> : <RoleSelect roles={roles} value={roleId} onChange={setRoleId} />}
        <BrandsPicker value={base === "owner" ? null : clients} onChange={setClients} disabled={base === "owner"} />
        <GroupsPicker value={groups} onChange={setGroups} />
        {error && <p className="note warn" role="alert">{error}</p>}
        <button className="btn primary" disabled={!dirty || busy || !name.trim()} onClick={() => void run("people.update", {
          ...(roleId !== p.roleId ? { roleId } : {}), ...(name !== p.name ? { name: name.trim() } : {}), ...(email !== (p.email ?? "") ? { email: email.trim() || null } : {}),
          clients: base === "owner" ? null : clients, groups,
        }, () => toast("Saved."))}>Save changes</button>
        <p className="muted small">Signed up {when(p.createdAt)} · last sign-in {when(p.lastSignInAt)}</p>
        {!self && (
          <div className="danger-zone">
            <h3>Access</h3>
            {p.status === "invited" && <button className="btn" disabled={busy} onClick={() => void run("people.resetAccess", {}, v => setLink({ link: v.link, emailed: v.emailed, kind: "invite" }))}>Send a new invite link</button>}
            {p.status === "active" && (
              <button className="btn" disabled={busy} onClick={() => { if (window.confirm(t(`Reset ${p.name}'s sign-in? Their password and phone stop working right away; they get a new link to set both up again.`))) void run("people.resetAccess", {}, v => setLink({ link: v.link, emailed: v.emailed, kind: "reset" })); }}>Reset sign-in (lost phone or password)</button>
            )}
            {p.status !== "disabled"
              ? <button className="btn danger" disabled={busy} onClick={() => { if (window.confirm(t(`Turn off ${p.name}'s account? They're signed out everywhere and can't sign in until it's turned back on.`))) void run("people.disable", {}, () => toast(`${p.name} can't sign in now.`)); }}>Turn off account</button>
              : <button className="btn" disabled={busy} onClick={() => void run("people.enable", {}, v => { if (v.link) setLink({ link: v.link, emailed: v.emailed, kind: "invite" }); toast(`${p.name} can sign in again.`); })}>Turn account back on</button>}
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------- Roles and switches ----------
const GROUPS = [...new Set(SWITCHES.map(s => s.group))];

function RolesTab() {
  const roles = useApiData<RoleView[]>("roles.list");
  const act = useAction();
  const toast = useToast();
  const [sel, setSel] = useState<string | "new">("coordinator");
  const [draft, setDraft] = useState<{ name: string; base: BaseRole; permissions: Permissions } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = sel === "new" ? null : roles.data?.find(r => r.id === sel);
  const editing = draft ?? (role ? { name: role.name, base: role.base, permissions: role.permissions } : { name: "", base: "worker" as BaseRole, permissions: {} });
  const values = useMemo(() => effective(editing.base, editing.permissions), [editing.base, editing.permissions]);
  const dirty = sel === "new" || !!draft;
  const pick = (id: string | "new") => { setSel(id); setDraft(null); setError(null); };
  const flip = (a: Action, on: boolean) => setDraft({ ...editing, permissions: { ...editing.permissions, [a]: on } });
  const save = async () => {
    setBusy(true); setError(null);
    const r = await act<RoleView>("roles.save", { ...(role ? { id: role.id } : {}), name: editing.name.trim(), base: editing.base, permissions: editing.permissions });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await roles.reload();
    setSel(r.value.id); setDraft(null); toast(role ? "Role saved." : `${r.value.name} made.`);
  };
  const remove = async () => {
    if (!role || !window.confirm(t(`Delete the role ${role.name}?`))) return;
    const r = await act("roles.delete", { id: role.id });
    if (!r.ok) { setError(r.error); return; }
    await roles.reload(); pick("coordinator"); toast("Role deleted.");
  };
  const locked = role?.builtIn && role.base === "owner";
  return (
    <div className="roles-grid">
      <section className="panel glass role-list">
        <h2 className="plain-h">Roles</h2>
        <ul>
          {(roles.data ?? []).map(r => (
            <li key={r.id}><button className={`role-item${sel === r.id ? " on" : ""}`} onClick={() => pick(r.id)}>
              <span translate="no"><b>{r.name}</b>{r.builtIn ? <small className="muted"> · built-in</small> : <small className="muted"> · based on {BASE_NAME[r.base]}</small>}</span>
              <small className="muted">{r.people} {r.people === 1 ? "person" : "people"}</small>
            </button></li>
          ))}
        </ul>
        <button className={`btn${sel === "new" ? " primary" : ""}`} onClick={() => pick("new")}>New role</button>
        <p className="muted small">Make roles for how your team really works, like "Night lead" or "Receiving clerk": a name, a base role (which home screen they get), and the switches.</p>
      </section>
      <section className="panel glass role-edit">
        {sel === "new" || !role?.builtIn ? (
          <div className="role-head">
            <label className="field"><span>Role name</span><input className="input" value={editing.name} onChange={e => setDraft({ ...editing, name: e.target.value })} placeholder="e.g. Night lead" /></label>
            <label className="field"><span>Based on</span>
              <select className="input" value={editing.base} onChange={e => setDraft({ ...editing, base: e.target.value as BaseRole, permissions: {} })}>
                {BASE_ROLES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <small className="muted">{BASE_ROLES.find(b => b.id === editing.base)?.about}</small>
            </label>
          </div>
        ) : (
          <div className="role-head"><h2 className="role-title" translate="no">{role.name}</h2><p className="muted small">{BASE_ROLES.find(b => b.id === role.base)?.about}. Built-in: the switches can change, the name can't.</p></div>
        )}
        {locked && <p className="note">Owners can always do everything. Every direct stock change still needs a review and a reason, and is logged.</p>}
        <div className="switch-groups">
          {GROUPS.map(g => (
            <div key={g} className="switch-group">
              <h3>{g}</h3>
              {SWITCHES.filter(s => s.group === g).map(s => {
                const ownerOnly = !!s.ownerOnly;
                const disabled = locked || editing.base === "owner" || ownerOnly;
                return (
                  <label key={s.id} className={`switch-row${disabled ? " locked" : ""}`}>
                    <span className="switch-text"><b>{s.label}</b><small className="muted">{s.help}{ownerOnly ? " · owners only" : ""}</small></span>
                    <span className="switch"><input type="checkbox" checked={values[s.id]} disabled={disabled} onChange={e => flip(s.id, e.target.checked)} /><span /></span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        {error && <p className="note warn" role="alert">{error}</p>}
        {!locked && (
          <div className="btns role-actions">
            {role && !role.builtIn && <button className="btn danger" disabled={busy || role.people > 0} title={role.people ? "Give its people another role first" : undefined} onClick={() => void remove()}>Delete role</button>}
            {dirty && <button className="btn" onClick={() => pick(role ? role.id : "coordinator")}>Cancel</button>}
            <button className="btn primary" disabled={!dirty || busy || editing.name.trim().length < 2} onClick={() => void save()}>{busy ? "Saving…" : sel === "new" ? "Make role" : "Save switches"}</button>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Account requests ----------
function RequestsTab({ reload }: { reload: () => Promise<void> }) {
  const reqs = useApiData<RequestView[]>("requests.list");
  const roles = useApiData<RoleView[]>("roles.list");
  const act = useAction();
  const [choice, setChoice] = useState<Record<string, { roleId: string; clients: string[] | null }>>({});
  const [link, setLink] = useState<(LinkResult & { who: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (r: RequestView, approve: boolean) => {
    const c = choice[r.id] ?? { roleId: "worker", clients: null };
    if (!approve && !window.confirm(t(`Reject ${r.name}'s request?`))) return;
    const res = await act<any>("requests.decide", { id: r.id, approve, roleId: c.roleId, clients: c.clients });
    if (!res.ok) { setError(res.error); return; }
    if (approve) setLink({ link: res.value.link, emailed: res.value.emailed, who: r.name });
    await reqs.reload(); await reload();
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Account requests</h2>
      <p className="muted small">People asked from the sign-in screen. Approve to choose their role and brands; they get a link to set up their sign-in.</p>
      {link && <LinkPanel link={link.link} emailed={link.emailed} who={link.who} kind="invite" onClose={() => setLink(null)} />}
      {error && <p className="note warn">{error}</p>}
      {!reqs.data ? <p className="muted small">Loading…</p> : reqs.data.length ? (
        <ul className="acct-list">
          {reqs.data.map(r => {
            const c = choice[r.id] ?? { roleId: "worker", clients: null };
            const base = roles.data?.find(x => x.id === c.roleId)?.base ?? "worker";
            return (
              <li key={r.id} className="acct">
                <div className="who"><span className="avatar" aria-hidden="true">{initials(r.name)}</span><div><b translate="no">{r.name}</b> <span className="muted" translate="no">@{r.username}</span><small className="muted block">{r.email ? `${r.email} · ` : ""}asked {when(r.createdAt)}{r.note ? ` · "${r.note}"` : ""}</small></div></div>
                <div className="req-pick">
                  <RoleSelect roles={roles.data ?? []} value={c.roleId} onChange={roleId => setChoice({ ...choice, [r.id]: { ...c, roleId } })} />
                  <BrandsPicker value={base === "owner" ? null : c.clients} onChange={clients => setChoice({ ...choice, [r.id]: { ...c, clients } })} disabled={base === "owner"} />
                </div>
                <div className="btns"><button className="btn primary" onClick={() => void decide(r, true)}>Approve</button><button className="btn danger" onClick={() => void decide(r, false)}>Reject</button></div>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted">No requests waiting.</p>}
    </section>
  );
}

// ---------- Support access ----------
function SupportTab({ data }: { data: ReturnType<typeof useApiData<GrantView[]>> }) {
  const act = useAction();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const run = async (method: string, id: string, extra: Record<string, unknown>, msg: string) => {
    const r = await act(method, { id, ...extra });
    if (!r.ok) { setError(r.error); return; }
    toast(msg); await data.reload();
  };
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const list = data.data ?? [];
  const live = list.filter(g => g.status === "requested" || (g.status === "active" && g.endsAt && g.endsAt > new Date().toISOString()));
  const past = list.filter(g => !live.includes(g));
  return (
    <>
      <section className="panel glass">
        <h2 className="plain-h">Support access</h2>
        <p className="muted small">The WMS team can't see inside your warehouse unless you allow it, for a set time. Everything they do is in the security log, and any owner can end it at once. In an outage they can open emergency access; every owner gets an email when they do.</p>
        {error && <p className="note warn">{error}</p>}
        {live.length ? (
          <ul className="acct-list">
            {live.map(g => (
              <li key={g.id} className={`acct grant ${g.status}`}>
                <div><b translate="no">{g.operator}</b> <span className="muted">from the WMS team</span>{g.emergency && <em className="tag warn">emergency</em>}
                  <small className="block">{g.reason}{g.ticket ? ` · ticket ${g.ticket}` : ""}</small>
                  <small className="muted block">{g.status === "requested" ? `Asks for ${g.minutes} minutes · ${g.canChange ? "may change things" : "look only"} · asked ${t(g.requestedAt)}` : `Open until ${t(g.endsAt)} · ${g.canChange ? "may change things" : "look only"}${g.decidedBy ? ` · allowed by ${g.decidedBy}` : ""}`}</small>
                </div>
                <div className="btns">
                  {g.status === "requested" ? <>
                    <button className="btn primary" onClick={() => void run("support.decide", g.id, { approve: true }, `Support may look in for ${g.minutes} minutes.`)}>Allow for {g.minutes} min</button>
                    <button className="btn" onClick={() => void run("support.decide", g.id, { approve: false }, "Refused.")}>Refuse</button>
                  </> : <button className="btn danger" onClick={() => void run("support.end", g.id, {}, "Support access ended.")}>End now</button>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No support access open or asked for.</p>}
      </section>
      {past.length > 0 && (
        <section className="panel glass">
          <h2 className="plain-h">Earlier</h2>
          <ol className="dhist">{past.map(g => <li key={g.id}><span translate="no">{g.operator}: {g.reason}</span><small>{g.status} · {t(g.startsAt ?? g.requestedAt)}{g.decidedBy ? ` · ${g.decidedBy}` : ""}</small></li>)}</ol>
        </section>
      )}
    </>
  );
}

// ---------- Security log ----------
function LogTab() {
  const [before, setBefore] = useState<number | undefined>(undefined);
  const log = useApiData<{ entries: (LogView & { id: number })[]; more: boolean }>("security.list", before ? { before } : {});
  const [older, setOlder] = useState<(LogView & { id: number })[]>([]);
  const entries = [...older, ...(log.data?.entries ?? [])];
  return (
    <section className="panel glass">
      <h2 className="plain-h">Security log</h2>
      <p className="muted small">Sign-ins, failed tries, account and role changes, support access. Nothing here can be changed or deleted.</p>
      <div className="table-wrap">
        <table className="lines log-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th></tr></thead>
          <tbody>{entries.map(e => (
            <tr key={e.id} className={/fail|wrong|turned off|emergency/.test(e.action) ? "warn" : undefined}>
              <td className="muted nowrap">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
              <td translate="no">{e.actor}</td><td translate="no">{e.action}</td><td className="muted" translate="no">{e.target ?? ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {log.data?.more && <button className="link" onClick={() => { setOlder(entries); setBefore(entries.at(-1)!.id); }}>Show older</button>}
    </section>
  );
}
