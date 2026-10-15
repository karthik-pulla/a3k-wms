import { useEffect, useState } from "react";
import { CLIENTS, type Client } from "../../data/catalog";
import { canManageAccounts } from "../../auth/permissions";
import { passwordProblems, passwordStrength } from "../../auth/crypto";
import { useAuth } from "../../auth/AuthGate";
import {
  approve, changePassword, pendingRequests, reject, resetPassword, sessionLimits, setDisabled, setRole, temporaryPassword, updateProfile,
  type Account, type PendingRequest,
} from "../../auth/vault";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../../components/Toast";
import { fmtDay } from "../../inventory/selectors";
import { accountUser, initials } from "../../auth/accountUser";
import type { Role } from "../../store/types";
import { t } from "../../i18n";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", coordinator: "Coordinator", worker: "Worker" };
/** What each role may do (shown when giving someone a role) */
export const ROLE_HELP: Record<Role, string> = {
  owner: "Sees and can change everything; direct changes need a review and a reason; sees every change in Logs; manages accounts.",
  coordinator: "Confirms in-bound quantities, oversees in-bounds, orders and inventory, gives out pallet tasks and packing, prints labels, confirms orders before they leave, sends reports, sees the workers' pallet log.",
  worker: "Moves pallets only through tasks where the WMS gives the slot, confirms each one, packs orders given to them; Work screen and forklift mode.",
};
const STRENGTH = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const when = (iso?: string) => (iso ? `${fmtDay(iso)} ${new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "—");

/** #/account: your profile, password and sign-out; for owners, account requests, accounts and the security log. */
export function AccountPage() {
  const { account, data } = useAuth();
  const { me } = useSession();
  const manage = canManageAccounts(me) && me.id === account.uid;
  return (
    <main className="section account">
      <header className="section-head"><h1>Account</h1><p className="crumb">{account.name} · {ROLE_LABEL[account.role]}</p></header>
      <div className="stack">
        {account.mustChange && <p className="note warn" role="alert">{account.admin ? "You're using the default password. Change it now: anyone who knows the default could sign in." : "You signed in with a temporary password. Choose your own below."}</p>}
        <div className="account-grid">
          <Profile />
          <PasswordForm />
        </div>
        {manage && <Admin />}
        {manage && <SecurityLog />}
        {!manage && <p className="muted small">Account requests and the security log are for owners. Signed in since {when(data.accounts.find(a => a.uid === account.uid)?.lastSignIn)}.</p>}
      </div>
    </main>
  );
}

function Profile() {
  const { account, session, run, signOut } = useAuth();
  const { dispatch } = useStore();
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email ?? "");
  const { idleMin } = sessionLimits(session);
  const save = async () => {
    if (name.trim().length < 2) { toast("Enter your name."); return; }
    await run((s, d) => updateProfile(s, d, { name: name.trim(), email: email.trim() || undefined }));
    dispatch({ type: "account/user", user: accountUser({ ...account, name: name.trim() }) });
    toast("Profile saved.");
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Profile</h2>
      <div className="avatar-row"><span className="avatar big" aria-hidden="true">{initials(account.name)}</span><div><b>{account.name}</b><p className="muted small">@{account.username} · {ROLE_LABEL[account.role]}{account.clients?.length ? ` · ${account.clients.join(" + ")} only` : " · all clients"}</p></div></div>
      <label className="field"><span>Name</span><input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
      <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
      <dl className="facts-list">
        <div><dt>Member since</dt><dd>{fmtDay(account.createdAt)}</dd></div>
        <div><dt>Last sign-in</dt><dd>{when(account.lastSignIn)}</dd></div>
        <div><dt>Password changed</dt><dd>{account.passwordChangedAt ? fmtDay(account.passwordChangedAt) : "never"}</dd></div>
        <div><dt>This session</dt><dd>signs out after {idleMin >= 1440 ? `${idleMin / 1440} days` : `${idleMin} min`} idle{session.keep ? " (kept signed in)" : ""}</dd></div>
      </dl>
      <div className="panel-foot"><button className="btn" onClick={() => void signOut("Signed out.")}>Sign out</button><button className="btn primary" onClick={() => void save()}>Save profile</button></div>
    </section>
  );
}

function PasswordForm() {
  const { account, run } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const problems = passwordProblems(pw, account.username);
  const strength = passwordStrength(pw);
  const ok = !!cur && !problems.length && pw === pw2 && pw !== cur;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try { await run((s, d) => changePassword(s, d, cur, pw)); setCur(""); setPw(""); setPw2(""); toast("Password changed. Use the new one next time you sign in."); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't change the password."); }
    finally { setBusy(false); }
  };
  return (
    <form className="panel glass" onSubmit={submit} noValidate>
      <h2 className="plain-h">Change password</h2>
      <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
      <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>
      <label className="field"><span>New password</span>
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
        <span className="pw-meter" aria-hidden="true"><i className={`s${strength}`} style={{ width: `${(strength / 4) * 100}%` }} /></span>
        <small className={problems.length && pw ? "warn" : "muted"}>{pw ? (problems.length ? `Needs ${problems.join(", ")}.` : `${STRENGTH[strength]} password.`) : "At least 12 characters, not used anywhere else."}</small>
      </label>
      <label className="field"><span>New password again</span><input className={`input${pw2 && pw !== pw2 ? " invalid" : ""}`} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <p className="muted small">Your data's key is re-encrypted under the new password; the password itself is never stored.</p>
      <button className="btn primary" disabled={!ok || busy}>{busy ? "Changing…" : "Change password"}</button>
    </form>
  );
}

/** Asks for the signed-in person's password before a sensitive change */
function Confirm({ title, children, action, danger, onDone }: { title: string; children?: React.ReactNode; action: string; danger?: boolean; onDone: (pw: string) => Promise<void> }) {
  const [open, setOpen] = useState(false), [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  if (!open) return <button className={`btn small${danger ? " danger" : " primary"}`} onClick={() => setOpen(true)}>{title}</button>;
  return (
    <form className="confirm-pw" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(null); try { await onDone(pw); setOpen(false); setPw(""); } catch (err) { setError(err instanceof Error ? err.message : "That didn't work."); } finally { setBusy(false); } }}>
      {children}
      <label className="field"><span>Your password, to confirm</span><input className="input" type="password" autoComplete="current-password" autoFocus value={pw} onChange={e => setPw(e.target.value)} /></label>
      {error && <p className="note warn">{error}</p>}
      <span className="btns"><button className={`btn small${danger ? " danger" : " primary"}`} disabled={!pw || busy}>{busy ? "Checking…" : action}</button><button type="button" className="btn small" onClick={() => { setOpen(false); setPw(""); }}>Cancel</button></span>
    </form>
  );
}

function ScopePicker({ role, clients, onRole, onClients }: { role: Role; clients: Client[]; onRole: (r: Role) => void; onClients: (c: Client[]) => void }) {
  return (
    <div className="scope-pick-row">
      <select className="input" value={role} onChange={e => onRole(e.target.value as Role)} aria-label="Role">{(["worker", "coordinator", "owner"] as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      <span className="chip-wrap" role="group" aria-label="Clients this person may see">
        {CLIENTS.map(c => <button type="button" key={c} className={`chip-btn small${clients.includes(c) ? " on" : ""}`} aria-pressed={clients.includes(c)} onClick={() => onClients(clients.includes(c) ? clients.filter(x => x !== c) : [...clients, c])}>{c}</button>)}
      </span>
      <small className="muted">{clients.length ? `Sees only ${clients.join(" + ")}` : "Sees all clients"}</small>
      <small className="role-help">{ROLE_HELP[role]}</small>
    </div>
  );
}

function Admin() {
  const { data, account, run } = useAuth();
  const { dispatch } = useStore();
  const toast = useToast();
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [choice, setChoice] = useState<Record<string, { role: Role; clients: Client[] }>>({});
  const [temp, setTemp] = useState<{ uid: string; pw: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, { role: Role; clients: Client[] }>>({});
  useEffect(() => { void pendingRequests(data).then(setRequests); }, [data]);
  // Everyone starts as a worker; the admin chooses the role
  const pick = (r: PendingRequest) => choice[r.id] ?? { role: "worker" as Role, clients: [] };

  return (
    <>
      <section className="panel glass">
        <div className="panel-foot"><h2 className="plain-h">Account requests</h2><span className="muted small">Approving needs your password; the person signs in with the password they chose</span></div>
        {requests === null ? <p className="muted small">Reading requests…</p> : requests.length ? (
          <ul className="acct-list">
            {requests.map(r => {
              const c = pick(r);
              return (
                <li key={r.id} className="acct">
                  <div className="acct-who"><span className="avatar" aria-hidden="true">{initials(r.name)}</span><div><b>{r.name}</b> <span className="muted">@{r.username}</span><small className="muted block">{r.email ? `${r.email} · ` : ""}asked {when(r.at)}{r.note ? ` · “${r.note}”` : ""}</small></div></div>
                  <ScopePicker role={c.role} clients={c.clients} onRole={role => setChoice({ ...choice, [r.id]: { ...c, role } })} onClients={clients => setChoice({ ...choice, [r.id]: { ...c, clients } })} />
                  <div className="btns">
                    <Confirm title="Approve" action={`Approve as ${ROLE_LABEL[c.role]}`} onDone={async pw => { await run((s, d) => approve(s, d, pw, r, c.role, c.clients.length ? c.clients : undefined)); toast(`${r.username} approved as ${ROLE_LABEL[c.role]}. They can sign in now.`); }} />
                    <button className="btn small danger" onClick={async () => { if (window.confirm(t(`Reject ${r.name}'s request? They'd have to ask again.`))) { await run((s, d) => reject(s, d, r)); toast("Request rejected."); } }}>Reject</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted small">No requests waiting.</p>}
      </section>

      <section className="panel glass">
        <h2 className="plain-h">Accounts · {data.accounts.length}</h2>
        <ul className="acct-list">
          {data.accounts.map((a: Account) => {
            const e = edit[a.uid] ?? { role: a.role, clients: a.clients ?? [] };
            const changed = e.role !== a.role || e.clients.join() !== (a.clients ?? []).join();
            const self = a.uid === account.uid;
            return (
              <li key={a.uid} className={`acct${a.status === "disabled" ? " off" : ""}`}>
                <div className="acct-who"><span className="avatar" aria-hidden="true">{initials(a.name)}</span><div><b>{a.name}</b> <span className="muted">@{a.username}</span>{self && <em className="tag">you</em>}{a.status === "disabled" && <em className="tag warn">turned off</em>}{a.mustChange && <em className="tag warn">{a.admin ? "default password" : "temporary password"}</em>}
                  <small className="muted block">last sign-in {when(a.lastSignIn)}{a.approvedBy ? ` · approved by ${a.approvedBy}` : ""}</small></div></div>
                {self ? <p className="muted small">{ROLE_LABEL[a.role]} · all clients</p> : <ScopePicker role={e.role} clients={e.clients} onRole={role => setEdit({ ...edit, [a.uid]: { ...e, role } })} onClients={clients => setEdit({ ...edit, [a.uid]: { ...e, clients } })} />}
                {!self && (
                  <div className="btns">
                    {changed && <button className="btn small primary" onClick={async () => { await run((s, d) => setRole(s, d, a.uid, e.role, e.clients.length ? e.clients : undefined)); dispatch({ type: "account/user", user: accountUser({ ...a, role: e.role, clients: e.clients.length ? e.clients : undefined }) }); toast(`${a.username} is now ${ROLE_LABEL[e.role]}.`); }}>Save role</button>}
                    <Confirm title="Reset password" action="Set a temporary password" danger onDone={async pw => { const t = temporaryPassword(); await run((s, d) => resetPassword(s, d, pw, a.uid, t)); setTemp({ uid: a.uid, pw: t }); }}>
                      <p className="small muted">Makes a temporary password for {a.name}. They're asked to choose their own when they sign in.</p>
                    </Confirm>
                    {a.status === "active"
                      ? <Confirm title="Turn off" action="Turn off sign-in" danger onDone={async pw => { await run((s, d) => setDisabled(s, d, pw, a.uid, true)); toast(`${a.username} can't sign in now.`); }} />
                      : <Confirm title="Turn on" action="Allow sign-in" onDone={async pw => { await run((s, d) => setDisabled(s, d, pw, a.uid, false)); toast(`${a.username} can sign in again.`); }} />}
                  </div>
                )}
                {temp?.uid === a.uid && (
                  <p className="note temp-pw" role="status">Temporary password for {a.username}: <b className="mono">{temp.pw}</b> Give it to them in person; it isn't shown again. <button className="link" onClick={() => setTemp(null)}>Done</button></p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function SecurityLog() {
  const { data } = useAuth();
  const [all, setAll] = useState(false);
  const list = all ? data.log : data.log.slice(0, 12);
  const label: Record<string, string> = { created: "Vault created", "sign-in": "Signed in", "failed-attempts": "Failed sign-ins", request: "Account requested", approved: "Approved", rejected: "Rejected", "password-changed": "Changed password", "password-reset": "Reset password", disabled: "Turned off", enabled: "Turned on", "role-changed": "Role changed" };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Security log</h2>
      <ol className="dhist">{list.map((e, i) => <li key={i} className={e.kind === "failed-attempts" ? "warn" : ""}><span>{label[e.kind] ?? e.kind}{e.detail ? ` · ${e.detail}` : ""}</span><small>{when(e.at)}{e.who ? ` · ${e.who}` : ""}</small></li>)}</ol>
      {data.log.length > 12 && <button className="link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${data.log.length}`}</button>}
    </section>
  );
}

