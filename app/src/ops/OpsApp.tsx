// The ops console: the WMS team's own page at ops.<domain>, with its own accounts (never an account inside a
// warehouse). Every warehouse at a glance (health, people, setup progress), creating warehouses, restoring an owner's
// access, support access, the team, the platform's log and errors.
// It never shows a warehouse's stock, orders or messages: looking inside needs a support grant from its owner (or,
// in an outage, emergency access, which emails every owner). Everything here is logged.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { opsApi, ApiCallError, BACKEND } from "../server/client";
import { CodeInput, InviteFlow, message } from "../server/authParts";
// Preview only; a real build leaves it out
const PreviewTools = import.meta.env.VITE_WMS_BACKEND === "preview" ? lazy(() => import("../server/PreviewTools").then(m => ({ default: m.PreviewTools }))) : null;
import { Background } from "../components/Background";
import { ToastProvider, useToast } from "../components/Toast";
import { useAppearance, useSettings } from "../settings";
import { initials } from "../auth/accountUser";
import { ApiProvider, ConfirmProvider, LinkPanel, useAction, useApiData } from "../pages/warehouse/useApi";
import { ONBOARDING_STEPS, type GrantView, type LinkResult, type OperatorMe, type PersonView, type TenantSummary } from "../../../server/src/shared/api.ts";

const preview = BACKEND === "preview";
const CONSOLE_PUB = { id: "ops", name: "WMS team", appTitle: "WMS console", mark: "OPS", languages: { default: "en" as const, enabled: ["en" as const] } };
const DOMAIN = (import.meta.env.VITE_WMS_DOMAIN as string | undefined) ?? (preview ? "preview.test" : "example.com");
const when = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const useHash = () => {
  const [h, setH] = useState(() => window.location.hash.replace(/^#\/?/, "").split("/"));
  useEffect(() => { const on = () => setH(window.location.hash.replace(/^#\/?/, "").split("/")); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  return h;
};

export function OpsApp() {
  const { settings } = useSettings();
  useAppearance(settings.theme, settings.glass);
  const [phase, setPhase] = useState<{ kind: "loading" } | { kind: "signin"; note?: string } | { kind: "invite"; token: string } | { kind: "open"; me: OperatorMe }>({ kind: "loading" });
  useEffect(() => {
    const [first, token] = window.location.hash.replace(/^#\/?/, "").split("/");
    if (first === "invite" && token) { setPhase({ kind: "invite", token }); return; }
    opsApi<OperatorMe>("auth.me").then(me => setPhase({ kind: "open", me })).catch(() => setPhase({ kind: "signin" }));
  }, []);
  useEffect(() => { document.title = "WMS console"; }, []);
  // Signed out elsewhere or idle: back to sign-in
  useEffect(() => {
    if (phase.kind !== "open") return;
    const t = window.setInterval(() => opsApi("auth.me").catch(e => { if (e instanceof ApiCallError && e.code === "not-signed-in") setPhase({ kind: "signin", note: "You were signed out." }); }), 60_000);
    return () => window.clearInterval(t);
  }, [phase.kind]);
  let body: ReactNode;
  if (phase.kind === "loading") body = <div className="auth-loading" role="status">Opening…</div>;
  else if (phase.kind === "open") body = <Shell me={phase.me} onSignOut={async () => { await opsApi("auth.signOut").catch(() => {}); setPhase({ kind: "signin" }); }} />;
  else body = (
    <main className="login">
      <div className="login-card glass">
        <div className="login-brand"><span className="login-mark ops" aria-hidden="true">OPS</span><div><h1>WMS console</h1><p className="muted small">For the WMS team only</p></div></div>
        {phase.kind === "invite"
          ? <InviteFlow token={phase.token} pub={CONSOLE_PUB} call={opsApi} scope="ops" onDone={me => { window.location.hash = "#/"; setPhase({ kind: "open", me }); }} />
          : <OpsSignIn note={phase.note} onSignedIn={me => setPhase({ kind: "open", me })} />}
      </div>
      <p className="login-foot muted small">Warehouse accounts don't work here, and console accounts don't work in any warehouse.</p>
    </main>
  );
  return (
    <ToastProvider>
      <Background moving={settings.movingBackground} />
      <ApiProvider value={opsApi}><ConfirmProvider>{body}</ConfirmProvider></ApiProvider>
      {PreviewTools && <Suspense fallback={null}><PreviewTools console /></Suspense>}
    </ToastProvider>
  );
}

function OpsSignIn({ note, onSignedIn }: { note?: string; onSignedIn: (me: OperatorMe) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true); setError(null);
    try { setTicket((await opsApi<{ ticket: string }>("auth.signIn", { username: username.trim().toLowerCase(), password })).ticket); setPassword(""); }
    catch (err) { setError(message(err)); setPassword(""); } finally { setBusy(false); }
  };
  const code = async (c: string) => {
    setBusy(true); setError(null);
    try { onSignedIn(await opsApi<OperatorMe>("auth.verify", { ticket, code: c })); }
    catch (err) { setError(message(err)); if (err instanceof ApiCallError && err.code === "expired") setTicket(""); } finally { setBusy(false); }
  };
  if (ticket) return (
    <div className="login-form">
      <h2>Enter the code</h2>
      <p className="muted small">From the authenticator app on your phone.</p>
      <CodeInput busy={busy} onCode={code} previewUser={preview ? username : undefined} previewScope="ops" />
      {error && <p className="note warn" role="alert">{error}</p>}
      <button className="link" onClick={() => setTicket("")}>Back</button>
    </div>
  );
  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <h2>Sign in</h2>
      {note && <p className="note">{note}</p>}
      <label className="field"><span>Username</span><input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <button className="btn primary big" disabled={busy || !username || !password}>{busy ? "Checking…" : "Continue"}</button>
    </form>
  );
}

// ---------- The console ----------
const PAGES = [
  { id: "warehouses", label: "Warehouses" },
  { id: "team", label: "Team" },
  { id: "activity", label: "Activity" },
  { id: "errors", label: "Errors" },
] as const;

function Shell({ me, onSignOut }: { me: OperatorMe; onSignOut: () => void }) {
  const [page = "warehouses", id] = useHash();
  return (
    <div className="ops-shell">
      <nav className="ops-nav glass" aria-label="Console">
        <div className="ops-brand"><span className="login-mark ops small" aria-hidden="true">OPS</span><b>WMS console</b></div>
        {PAGES.map(p => <a key={p.id} href={`#/${p.id}`} aria-current={page === p.id || (p.id === "warehouses" && page === "new") ? "page" : undefined}>{p.label}</a>)}
        <div className="ops-me"><span className="avatar" aria-hidden="true">{initials(me.name)}</span><span><b translate="no">{me.name}</b><small className="muted block" translate="no">@{me.username}</small></span><button className="link" onClick={onSignOut}>Sign out</button></div>
      </nav>
      <main className="ops-main">
        {page === "team" ? <TeamPage me={me} /> : page === "activity" ? <ActivityPage /> : page === "errors" ? <ErrorsPage /> : page === "new" ? <NewWarehouse /> : <WarehousesPage open={page === "warehouses" ? id : undefined} />}
      </main>
    </div>
  );
}

function WarehousesPage({ open }: { open?: string }) {
  const list = useApiData<TenantSummary[]>("tenants.list");
  const [q, setQ] = useState("");
  const all = list.data ?? [];
  const shown = all.filter(t => !q.trim() || `${t.name} ${t.id} ${t.hosts.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const totals = useMemo(() => ({
    live: all.filter(t => t.status === "active").length, setup: all.filter(t => t.status === "setup").length,
    people: all.reduce((a, t) => a + (t.people?.active ?? 0), 0), support: all.reduce((a, t) => a + t.supportActive, 0),
    errors: all.reduce((a, t) => a + t.errors24h, 0), attention: all.filter(t => needsAttention(t)).length,
  }), [all]);
  const current = open ? all.find(t => t.id === open) : undefined;
  return (
    <>
      <header className="ops-head">
        <div><h1>Warehouses</h1><p className="muted">Health and setup of every warehouse. Their stock and messages stay private to them.</p></div>
        <a className="btn primary" href="#/new">New warehouse</a>
      </header>
      <div className="ops-tiles">
        <Tile n={totals.live} label="Live" />
        <Tile n={totals.setup} label="Being set up" />
        <Tile n={totals.people} label="People signed up" />
        <Tile n={totals.support} label="Support sessions open" tone={totals.support ? "warn" : undefined} />
        <Tile n={totals.errors} label="Errors, last 24 h" tone={totals.errors ? "danger" : undefined} />
        <Tile n={totals.attention} label="Need attention" tone={totals.attention ? "danger" : undefined} />
      </div>
      <input className="input ops-search" type="search" placeholder="Search warehouses" value={q} onChange={e => setQ(e.target.value)} aria-label="Search warehouses" />
      {list.error && <p className="note warn">{list.error}</p>}
      {!list.data ? <p className="muted" role="status">Loading…</p> : (
        <div className="ops-cards">
          {shown.map(t => <WarehouseCard key={t.id} t={t} />)}
          {!shown.length && <p className="muted">{all.length ? "Nothing matches." : "No warehouses yet. Make the first one with New warehouse."}</p>}
        </div>
      )}
      {current && <WarehouseDrawer t={current} onChange={() => void list.reload()} />}
    </>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone?: "warn" | "danger" }) {
  return <div className={`stat glass${tone ? ` ${tone}` : ""}`}><span className={`stat-n${tone === "danger" ? " danger" : ""}`}>{n.toLocaleString()}</span><span className="stat-l">{label}</span></div>;
}

const needsAttention = (t: TenantSummary) => !!t.unreachable || (t.lastMigration && !t.lastMigration.ok) || t.errors24h > 0 || (t.people?.owners === 0 && t.status !== "setup");
const STATUS_LABEL: Record<TenantSummary["status"], string> = { setup: "Being set up", active: "Live", leaving: "Leaving", suspended: "Suspended", deleted: "Deleted" };

function WarehouseCard({ t }: { t: TenantSummary }) {
  const done = t.onboarding.length;
  return (
    <a className={`ops-card glass${needsAttention(t) ? " attention" : ""}`} href={`#/warehouses/${t.id}`}>
      <div className="ops-card-head">
        <span className="login-mark small" aria-hidden="true">{initials(t.name)}</span>
        <div><b translate="no">{t.name}</b><small className="muted block" translate="no">{t.hosts[0] ?? t.id}</small></div>
        <span className={`role-pill st-${t.status}`}>{STATUS_LABEL[t.status]}</span>
      </div>
      <dl className="ops-facts">
        <div><dt>People</dt><dd>{t.people ? `${t.people.active} active${t.people.invited ? ` · ${t.people.invited} invited` : ""}` : "—"}</dd></div>
        <div><dt>Last sign-in</dt><dd>{when(t.lastSignInAt)}</dd></div>
        <div><dt>Database</dt><dd className={t.unreachable || (t.lastMigration && !t.lastMigration.ok) ? "danger" : ""}>{t.unreachable ? "Can't reach it" : t.lastMigration && !t.lastMigration.ok ? `Update failed (${t.lastMigration.failedFile})` : t.schemaVersion ? "Up to date" : "New"}</dd></div>
        <div><dt>Errors (24 h)</dt><dd className={t.errors24h ? "danger" : ""}>{t.errors24h}</dd></div>
      </dl>
      {t.status === "setup" && <div className="ops-progress" aria-label={`Setup ${done} of ${ONBOARDING_STEPS.length}`}><i style={{ width: `${(done / ONBOARDING_STEPS.length) * 100}%` }} /><small className="muted">Setup {done}/{ONBOARDING_STEPS.length}</small></div>}
      {t.supportActive > 0 && <small className="tag warn">support open</small>}
    </a>
  );
}

function WarehouseDrawer({ t, onChange }: { t: TenantSummary; onChange: () => void }) {
  const act = useAction();
  const toast = useToast();
  const owners = useApiData<PersonView[]>("tenants.owners", { id: t.id });
  const grants = useApiData<GrantView[]>("support.list", { tenantId: t.id });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<(LinkResult & { who: string; kind: "invite" | "reset" }) | null>(null);
  const [restoreFor, setRestoreFor] = useState<PersonView | "new" | null>(null);
  const [askOpen, setAskOpen] = useState<"normal" | "emergency" | null>(null);
  const close = () => { window.location.hash = "#/warehouses"; };
  const step = async (s: string, done: boolean) => { const r = await act("tenants.onboarding", { id: t.id, step: s, done }); if (!r.ok) setError(r.error); else onChange(); };
  const setStatus = async (status: string) => {
    const reason = window.prompt(`Why change ${t.name} to "${STATUS_LABEL[status as TenantSummary["status"]]}"? (kept in the log)`);
    if (!reason) return;
    const r = await act("tenants.setStatus", { id: t.id, status, reason });
    if (!r.ok) setError(r.error); else { toast("Status changed."); onChange(); }
  };
  const openAsSupport = async (g: GrantView) => {
    const r = await act<{ url: string }>("support.open", { tenantId: t.id, grantId: g.id });
    if (!r.ok) { setError(r.error); return; }
    window.open(r.value.url, "_blank", "noopener");
  };
  const active = (grants.data ?? []).filter(g => g.status === "active" && g.endsAt && g.endsAt > new Date().toISOString());
  const pending = (grants.data ?? []).filter(g => g.status === "requested");
  return (
    <aside className="drawer glass ops-drawer" aria-label={t.name}>
      <div className="drawer-head">
        <div className="who"><span className="login-mark small" aria-hidden="true">{initials(t.name)}</span><div><h2 translate="no">{t.name}</h2><p className="muted small" translate="no">{t.hosts.join(" · ")}</p></div></div>
        <button className="iconbtn" onClick={close} aria-label="Close">×</button>
      </div>
      <div className="drawer-body">
        {error && <p className="note warn" role="alert">{error}</p>}
        {link && <LinkPanel link={link.link} emailed={link.emailed} who={link.who} kind={link.kind} onClose={() => setLink(null)} />}

        <section className="ops-sec">
          <h3>Status</h3>
          <div className="seg-filter">
            {(["setup", "active", "leaving", "suspended"] as const).map(s => <button key={s} className={`chip-btn${t.status === s ? " on" : ""}`} disabled={t.status === s} onClick={() => void setStatus(s)}>{STATUS_LABEL[s]}</button>)}
          </div>
          <p className="muted small">Database: {t.unreachable ? "can't reach it" : t.schemaVersion ?? "new"}{t.lastMigration ? ` · last update ${when(t.lastMigration.at)} ${t.lastMigration.ok ? "ok" : `failed at ${t.lastMigration.failedFile}: ${t.lastMigration.error}`}` : ""}</p>
        </section>

        <section className="ops-sec">
          <h3>Setup checklist</h3>
          <ul className="checklist">
            {ONBOARDING_STEPS.map(s => (
              <li key={s.id}><label className="toggle-row"><input type="checkbox" checked={t.onboarding.includes(s.id)} onChange={e => void step(s.id, e.target.checked)} /> {s.label}</label></li>
            ))}
          </ul>
        </section>

        <section className="ops-sec">
          <h3>Owners</h3>
          {!owners.data ? <p className="muted small">Loading…</p> : (
            <ul className="acct-list">
              {owners.data.map(o => (
                <li key={o.id} className="acct compact">
                  <div className="who"><span className="avatar" aria-hidden="true">{initials(o.name)}</span><div><b translate="no">{o.name}</b> <span className="muted" translate="no">@{o.username}</span><small className="muted block">{o.status === "active" ? `last sign-in ${when(o.lastSignInAt)}` : o.status === "invited" ? "invited, hasn't joined" : "turned off"}{o.linkPending ? ` · ${o.linkPending} link waiting` : ""}</small></div></div>
                  <button className="btn small" onClick={() => setRestoreFor(o)}>Restore access</button>
                </li>
              ))}
              {!owners.data.length && <li className="muted small">No owner yet.</li>}
            </ul>
          )}
          <button className="btn small" onClick={() => setRestoreFor("new")}>{owners.data?.length ? "Invite another owner" : "Invite the first owner"}</button>
          {restoreFor && <RestoreForm tenantId={t.id} owner={restoreFor === "new" ? null : restoreFor} onCancel={() => setRestoreFor(null)} onDone={(l, who, kind) => { setRestoreFor(null); setLink({ ...l, who, kind }); void owners.reload(); onChange(); }} />}
        </section>

        <section className="ops-sec">
          <h3>Support access</h3>
          <p className="muted small">To look inside, ask the warehouse's owners; they approve it in their Team page. Emergency access is for outages: it opens at once and emails every owner.</p>
          {active.map(g => (
            <div key={g.id} className="acct grant active compact">
              <div><b>Open</b> until {new Date(g.endsAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {g.canChange ? "may change things" : "look only"}{g.emergency ? " · emergency" : ""}<small className="muted block">{g.reason}</small></div>
              <button className="btn small primary" onClick={() => void openAsSupport(g)}>Open the warehouse</button>
            </div>
          ))}
          {pending.map(g => <p key={g.id} className="muted small">Waiting for an owner: "{g.reason}" ({g.minutes} min, asked {when(g.requestedAt)})</p>)}
          <div className="btns">
            <button className="btn small" onClick={() => setAskOpen("normal")}>Ask for access</button>
            <button className="btn small danger" onClick={() => setAskOpen("emergency")}>Emergency access</button>
          </div>
          {askOpen && <AskSupport tenantId={t.id} emergency={askOpen === "emergency"} onCancel={() => setAskOpen(null)} onDone={() => { setAskOpen(null); void grants.reload(); onChange(); toast(askOpen === "emergency" ? "Emergency access open. The owners were emailed." : "Asked. The owners will see it in their Team page."); }} />}
        </section>
      </div>
    </aside>
  );
}

function RestoreForm({ tenantId, owner, onCancel, onDone }: { tenantId: string; owner: PersonView | null; onCancel: () => void; onDone: (l: LinkResult, who: string, kind: "invite" | "reset") => void }) {
  const act = useAction();
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 5 && (owner || (name.trim() && /^[a-z0-9][a-z0-9._-]{1,39}$/.test(username)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    const r = await act<LinkResult & { person: PersonView }>("tenants.restoreOwner", owner ? { id: tenantId, personId: owner.id, reason } : { id: tenantId, name: name.trim(), username, email: email.trim() || null, reason });
    setBusy(false);
    if (r.ok) onDone(r.value, owner?.name ?? name.trim(), r.value.person.status === "invited" ? "invite" : "reset"); else setError(r.error);
  };
  return (
    <form className="ops-form" onSubmit={submit}>
      {owner
        ? <p className="small">Gives <b translate="no">{owner.name}</b> a new sign-in link. Their old password and phone stop working at once. Only do this after checking it's really them (call them back on a number you already have).</p>
        : <>
          <p className="small">A new owner for this warehouse, for when nobody can sign in, or the first owner after setup.</p>
          <label className="field"><span>Full name</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="field"><span>Username</span><input className="input" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} /></label>
          <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        </>}
      <label className="field"><span>Why (kept in both logs)</span><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Lost her phone, called from the office number" /></label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <div className="btns"><button type="button" className="btn small" onClick={onCancel}>Cancel</button><button className="btn small primary" disabled={!ok || busy}>{owner ? "Send a new sign-in link" : "Invite"}</button></div>
    </form>
  );
}

function AskSupport({ tenantId, emergency, onCancel, onDone }: { tenantId: string; emergency: boolean; onCancel: () => void; onDone: () => void }) {
  const act = useAction();
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [canChange, setCanChange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    if (emergency && !window.confirm("Open emergency access now, without the owners' approval? Every owner gets an email.")) return;
    const r = await act("support.request", { tenantId, reason: reason.trim(), ticket: ticket.trim() || null, minutes, canChange, emergency });
    if (r.ok) onDone(); else setError(r.error);
  };
  return (
    <form className={`ops-form${emergency ? " emergency" : ""}`} onSubmit={submit}>
      <label className="field"><span>{emergency ? "What's broken" : "Why"}</span><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={emergency ? "e.g. Outage: nobody can sign in" : "e.g. Labels print off-centre (they called)"} autoFocus /></label>
      <div className="field-row">
        <label className="field"><span>Ticket (optional)</span><input className="input" value={ticket} onChange={e => setTicket(e.target.value)} /></label>
        <label className="field"><span>For</span><select className="input" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[15, 30, 60, 120, 240, 480].map(m => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}</select></label>
      </div>
      <label className="toggle-row"><input type="checkbox" checked={canChange} onChange={e => setCanChange(e.target.checked)} /> May change things (otherwise look only)</label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <div className="btns"><button type="button" className="btn small" onClick={onCancel}>Cancel</button><button className={`btn small ${emergency ? "danger" : "primary"}`} disabled={reason.trim().length < 5}>{emergency ? "Open emergency access" : "Ask the owners"}</button></div>
    </form>
  );
}

// ---------- New warehouse ----------
function NewWarehouse() {
  const act = useAction();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [touched, setTouched] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [state, setState] = useState<{ state: string; detail?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slug = touched ? id : name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 30);
  const host = `${slug}.${DOMAIN}`;
  const ok = name.trim().length >= 2 && /^[a-z][a-z0-9-]{1,29}$/.test(slug) && !slug.endsWith("-") && !slug.includes("--");
  const poll = useCallback(async (j: string) => {
    for (let i = 0; i < 120; i++) {
      const r = await opsApi<{ state: string; detail?: string }>("tenants.job", { job: j }).catch(() => ({ state: "running" }));
      setState(r);
      if (r.state !== "running") return;
      await new Promise(res => setTimeout(res, 5000));
    }
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setError(null);
    const r = await act<{ job: string }>("tenants.create", { id: slug, name: name.trim(), hosts: [host] });
    if (!r.ok) { setError(r.error); return; }
    setJob(r.value.job); void poll(r.value.job);
  };
  return (
    <>
      <header className="ops-head"><div><h1>New warehouse</h1><p className="muted">After the contract is signed. Creates its own database, login, encryption key and address; then invite its first owner.</p></div></header>
      <section className="panel glass ops-new">
        {!job ? (
          <form className="form-stack" onSubmit={submit}>
            <label className="field"><span>Warehouse name</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bravo Foods Warehouse" autoFocus /></label>
            <label className="field"><span>Address name</span><input className="input mono" value={slug} onChange={e => { setTouched(true); setId(e.target.value.toLowerCase()); }} translate="no" />
              <small className="muted">Their address: <b className="mono" translate="no">{host}</b>. Lower-case letters, numbers and dashes. Can be neutral if they'd rather not be recognisable.</small></label>
            {error && <p className="note warn" role="alert">{error}</p>}
            <button className="btn primary big" disabled={!ok}>Create warehouse</button>
          </form>
        ) : (
          <div className="form-stack">
            <p><b>{state?.state === "done" ? "Created." : state?.state === "failed" ? "It didn't work." : "Creating…"}</b> {state?.detail ?? ""}</p>
            {state?.state === "failed" && <p className="muted small">Nothing half-made is left behind: fix the problem (the task's log has details) and try again.</p>}
            {state?.state === "done" && <><p className="muted small">Next: open it in Warehouses and invite its first owner. The setup checklist is there too.</p><a className="btn primary" href={`#/warehouses/${slug}`}>Open {name.trim()}</a></>}
          </div>
        )}
      </section>
    </>
  );
}

// ---------- The team, activity, errors ----------
function TeamPage({ me }: { me: OperatorMe }) {
  const list = useApiData<{ id: string; name: string; username: string; email: string; status: string; lastSignInAt: string | null }[]>("operators.list");
  const act = useAction();
  const [name, setName] = useState(""), [username, setUsername] = useState(""), [email, setEmail] = useState("");
  const [link, setLink] = useState<(LinkResult & { who: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act<LinkResult>("operators.invite", { name: name.trim(), username, email: email.trim() });
    if (!r.ok) { setError(r.error); return; }
    setLink({ ...r.value, who: name.trim() }); setName(""); setUsername(""); setEmail(""); setError(null); void list.reload();
  };
  return (
    <>
      <header className="ops-head"><div><h1>Team</h1><p className="muted">People at the WMS team with a console account. Each signs a confidentiality agreement before they get one.</p></div></header>
      <div className="ops-two">
        <section className="panel glass">
          <ul className="acct-list">
            {(list.data ?? []).map(o => (
              <li key={o.id} className={`acct compact${o.status === "disabled" ? " off" : ""}`}>
                <div className="who"><span className="avatar" aria-hidden="true">{initials(o.name)}</span><div><b translate="no">{o.name}</b> <span className="muted" translate="no">@{o.username}</span>{o.id === me.id && <em className="tag">you</em>}<small className="muted block">{o.email} · {o.status === "invited" ? "invited" : o.status === "disabled" ? "turned off" : `last sign-in ${when(o.lastSignInAt)}`}</small></div></div>
                {o.id !== me.id && o.status !== "disabled" && <button className="btn small danger" onClick={async () => { if (!window.confirm(`Turn off ${o.name}'s console account?`)) return; const r = await act("operators.disable", { id: o.id }); if (!r.ok) setError(r.error); void list.reload(); }}>Turn off</button>}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel glass">
          <h2 className="plain-h">Invite to the team</h2>
          {link ? <LinkPanel link={link.link} emailed={link.emailed} who={link.who} kind="invite" onClose={() => setLink(null)} /> : (
            <form className="form-stack" onSubmit={invite}>
              <label className="field"><span>Full name</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
              <label className="field"><span>Username</span><input className="input" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} /></label>
              <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
              {error && <p className="note warn" role="alert">{error}</p>}
              <button className="btn primary" disabled={!name.trim() || !/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>Invite</button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

function ActivityPage() {
  const log = useApiData<{ id: number; at: string; actor: string; action: string; tenantId: string | null; detail: Record<string, unknown> }[]>("audit.list");
  return (
    <>
      <header className="ops-head"><div><h1>Activity</h1><p className="muted">Everything the console did: warehouses made and changed, access restored, support access. Kept for good.</p></div></header>
      <section className="panel glass"><div className="table-wrap"><table className="lines log-table">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Warehouse</th><th>Why</th></tr></thead>
        <tbody>{(log.data ?? []).map(e => (
          <tr key={e.id} className={/emergency|restored/.test(e.action) ? "warn" : undefined}>
            <td className="muted nowrap">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
            <td translate="no">{e.actor}</td><td>{e.action}</td><td translate="no">{e.tenantId ?? ""}</td><td className="muted">{String(e.detail.reason ?? "")}</td>
          </tr>
        ))}</tbody>
      </table></div></section>
    </>
  );
}

function ErrorsPage() {
  const errs = useApiData<{ tenantId: string | null; route: string; message: string; hour: string; count: number }[]>("errors.list");
  return (
    <>
      <header className="ops-head"><div><h1>Errors</h1><p className="muted">Server errors in the last 7 days, counted per hour. Details are in CloudWatch logs; nothing here contains warehouse data.</p></div></header>
      <section className="panel glass">
        {errs.data && !errs.data.length ? <p className="muted">No errors. </p> : (
          <div className="table-wrap"><table className="lines log-table">
            <thead><tr><th>Hour</th><th>Warehouse</th><th>Where</th><th>Error</th><th className="num">Times</th></tr></thead>
            <tbody>{(errs.data ?? []).map((e, i) => <tr key={i}><td className="muted nowrap">{new Date(e.hour).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" })}</td><td translate="no">{e.tenantId ?? "—"}</td><td className="mono">{e.route}</td><td>{e.message}</td><td className="num">{e.count}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
