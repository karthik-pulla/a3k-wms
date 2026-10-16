// Signing in with the server (VITE_WMS_BACKEND=server or preview): sign-in with an authenticator code, invite and reset
// links, "Ask for an account", support links. Once signed in, the warehouse's settings and products come from its own
// database and the app opens. Nothing here imports the app's data modules before then (they need the settings).
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiCallError, BACKEND } from "./client";
import { serverAccount, type Identity } from "../auth/identity";
import { LangSwitch } from "../components/LangSwitch";
import { Background } from "../components/Background";
import { setServerTenant, fetchSeed, tenantId } from "../tenant";
import type { Me, TenantPublic } from "../../../server/src/shared/api.ts";
import { CodeInput, InviteFlow, message } from "./authParts";
import type { ServerStart } from "../App";
// Preview only; a real build leaves it out
const PreviewTools = import.meta.env.VITE_WMS_BACKEND === "preview" ? lazy(() => import("./PreviewTools").then(m => ({ default: m.PreviewTools }))) : null;
import { useAppearance, useSettings } from "../settings";

const App = lazy(() => import("../App"));
const preview = BACKEND === "preview";
const route = () => window.location.hash.replace(/^#\/?/, "").split("/");

type Phase =
  | { kind: "loading" }
  | { kind: "signin"; note?: string }
  | { kind: "invite"; token: string }
  | { kind: "open"; start: ServerStart; me: Me }
  | { kind: "error"; message: string };

export default function ServerRoot() {
  const { settings } = useSettings();
  useAppearance(settings.theme, settings.glass);
  const [pub, setPub] = useState<TenantPublic | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  /** Signed in: the warehouse's settings and products from its database, then the app */
  const open = useCallback(async (me: Me) => {
    // The server says which warehouse this is (the preview: the one the app was built for)
    const [{ config, logos }, products, seed] = await Promise.all([api("tenant.config"), api("tenant.products"), preview ? fetchSeed() : Promise.resolve(null)]);
    if (!config) throw new Error("This warehouse has no settings yet. The WMS team sets them up during onboarding.");
    setServerTenant({ id: me.tenant.id || tenantId(), config, products, logos: logos ?? {}, seed });
    // Loaded only now: these read the settings when they load
    const { sampleState, emptyState } = await import("../store/sample");
    const identity: Identity = {
      kind: "server", account: serverAccount(me), me, securityLog: [],
      signOut: async (why?: string) => { await api("auth.signOut").catch(() => {}); setPhase({ kind: "signin", note: why }); },
    };
    // Stock, orders and messages aren't on the server yet: the preview shows its sample data, a real warehouse starts empty
    setPhase({ kind: "open", me, start: { identity, initial: seed ? sampleState() : emptyState() } });
  }, []);

  const begin = useCallback(async () => {
    const [first, token] = route();
    try {
      setPub(await api<TenantPublic>("tenant.public"));
      if (first === "invite" && token) { setPhase({ kind: "invite", token }); return; }
      if (import.meta.env.VITE_WMS_BACKEND === "preview" && first === "handoff" && token) {
        await (await import("./preview")).previewHandoff(token);
        window.location.hash = "#/";
      }
      const me = await api<Me>("auth.me").catch(e => { if (e instanceof ApiCallError && e.code === "not-signed-in") return null; throw e; });
      if (me) await open(me); else setPhase({ kind: "signin" });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Couldn't reach the warehouse" });
    }
  }, [open]);
  useEffect(() => { void begin(); }, [begin]);

  // Signed out somewhere else (idle, an owner turned the account off, support time ran out): back to sign-in
  useEffect(() => {
    if (phase.kind !== "open") return;
    // Also keeps the support banner current
    const t = window.setInterval(() => {
      api<Me>("auth.me").then(me => setPhase(p => (p.kind === "open" ? { ...p, me } : p)))
        .catch(e => { if (e instanceof ApiCallError && e.code === "not-signed-in") setPhase({ kind: "signin", note: "You were signed out. Sign in again to carry on." }); });
    }, 30_000);
    return () => window.clearInterval(t);
  }, [phase.kind]);

  let body: ReactNode;
  if (phase.kind === "loading") body = <div className="auth-loading" role="status">Opening…</div>;
  else if (phase.kind === "error") body = (
    <main className="auth-loading"><div className="glass crash-card"><h2>Can't open the warehouse</h2><p className="muted">{phase.message}</p><button className="btn primary" onClick={() => location.reload()}>Reload</button></div></main>
  );
  else if (phase.kind === "open") body = (
    <Suspense fallback={<div className="auth-loading" role="status">Opening…</div>}>
      <App server={phase.start} />
      <ServerNotes me={phase.me} />
    </Suspense>
  );
  else body = (
    <>
      <Background moving={settings.movingBackground} />
      <AuthCard pub={pub}>
        {phase.kind === "invite"
          ? <InviteFlow token={phase.token} pub={pub} onDone={me => { window.location.hash = "#/"; void open(me); }} />
          : <SignInFlow note={phase.note} onSignedIn={me => void open(me)} />}
      </AuthCard>
    </>
  );
  return <>{body}{PreviewTools && <Suspense fallback={null}><PreviewTools /></Suspense>}</>;
}

/** The sign-in card: the warehouse's name and mark, the language switch */
function AuthCard({ pub, children }: { pub: TenantPublic | null; children: ReactNode }) {
  return (
    <main className="login">
      <div className="login-card glass">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true" translate="no">{pub?.mark || "WMS"}</span>
          <div><h1 translate="no">{pub?.appTitle ?? "Warehouse"}</h1><p className="muted small">Warehouse management</p></div>
        </div>
        {children}
      </div>
      {pub && <LangSwitch className="login-lang" enabled={pub.languages.enabled} />}
      <p className="login-foot muted small">Sign-in uses your password and a code from your phone. Nobody at the WMS team can see your password.</p>
    </main>
  );
}

// ---------- Sign in: password, then the code ----------
function SignInFlow({ note, onSignedIn }: { note?: string; onSignedIn: (me: Me) => void }) {
  const [step, setStep] = useState<"password" | "code" | "request">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(false);
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (!wait) return; const t = window.setTimeout(() => setWait(w => Math.max(0, w - 1)), 1000); return () => window.clearTimeout(t); }, [wait]);

  const fail = (e: unknown) => {
    if (e instanceof ApiCallError && e.code === "locked") setWait(Number(e.info?.seconds ?? 30));
    setError(message(e));
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy || wait) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ ticket: string }>("auth.signIn", { username: username.trim().toLowerCase(), password, keep });
      setTicket(r.ticket); setPassword(""); setStep("code");
    } catch (err) { setPassword(""); fail(err); } finally { setBusy(false); }
  };

  const submitCode = async (code: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { onSignedIn(await api<Me>("auth.verify", { ticket, code })); }
    catch (err) {
      fail(err);
      if (err instanceof ApiCallError && err.code === "expired") { setStep("password"); setTicket(""); }
    } finally { setBusy(false); }
  };

  if (step === "request") return <RequestForm onBack={() => { setStep("password"); setError(null); }} />;
  if (step === "code") return (
    <div className="login-form">
      <h2>Enter the code</h2>
      <p className="muted small">Open the authenticator app on your phone and type the 6-digit code it shows for this warehouse.</p>
      <CodeInput busy={busy} onCode={submitCode} previewUser={preview ? username : undefined} />
      {error && <p className="note warn" role="alert">{error}{wait ? ` (${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait} s`})` : ""}</p>}
      <button type="button" className="link" onClick={() => { setStep("password"); setTicket(""); setError(null); }}>Back</button>
      <p className="muted small">Lost your phone? Ask an owner to reset your sign-in. They'll send you a new link.</p>
    </div>
  );
  return (
    <form className="login-form" onSubmit={submitPassword} noValidate>
      <h2>Sign in</h2>
      {note && <p className="note">{note}</p>}
      <label className="field"><span>Username</span>
        <input className="input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={e => setUsername(e.target.value)} />
      </label>
      <label className="field"><span>Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      <label className="toggle-row"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Keep me signed in on this device (7 days; leave off on shared devices)</label>
      {error && <p className="note warn" role="alert">{error}{wait ? ` (${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait} s`})` : ""}</p>}
      <button className="btn primary big" disabled={busy || !!wait || !username.trim() || !password}>{busy ? "Checking…" : "Continue"}</button>
      <button type="button" className="link" onClick={() => { setStep("request"); setError(null); }}>Need an account? Ask for one</button>
    </form>
  );
}

// ---------- Ask for an account ----------
function RequestForm({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const userOk = /^[a-z0-9][a-z0-9._-]{1,39}$/i.test(username.trim());
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ok = name.trim().length >= 2 && userOk && emailOk;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try { await api("requests.create", { name: name.trim(), username: username.trim().toLowerCase(), email: email.trim() || null, note: note.trim() }); setDone(true); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  if (done) return (
    <div className="login-form">
      <h2>Request sent</h2>
      <p>An owner will look at it. If they approve it, you'll get a link{email.trim() ? ` at ${email.trim()}` : " from them"} to choose your password and connect your phone.</p>
      <button className="btn primary" onClick={onBack}>Back to sign in</button>
    </div>
  );
  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <h2>Ask for an account</h2>
      <p className="muted small">An owner approves it and chooses your role and which brands you see. You'll choose your password when you get your link.</p>
      <label className="field"><span>Full name</span><input className="input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
      <label className="field"><span>Username</span>
        <input className={`input${username && !userOk ? " invalid" : ""}`} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} />
        <small className="muted">2–40 letters, numbers, dots, dashes or underscores</small>
      </label>
      <label className="field"><span>Email (for your link)</span><input className={`input${!emailOk ? " invalid" : ""}`} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="field"><span>Note for the owner (optional)</span><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. forklift driver, PM shift" /></label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <button className="btn primary big" disabled={!ok || busy}>{busy ? "Sending…" : "Send request"}</button>
      <button type="button" className="link" onClick={onBack}>Back to sign in</button>
    </form>
  );
}

/** Things the server knows that the signed-in person should see: support access, and that data isn't on the server yet */
function ServerNotes({ me }: { me: Me }) {
  const [hide, setHide] = useState(false);
  const owner = me.can["manage-support"];
  return (
    <div className="server-notes" role="status">
      {me.support && <p className="server-note support"><b>Support session</b> · {me.support.canChange ? "may change things" : "look only"} · until {new Date(me.support.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
      {!me.support && owner && me.supportActive.map(s => (
        <p key={s.endsAt + s.operator} className="server-note support"><b translate="no">{s.operator}</b> from the WMS team has {s.emergency ? "emergency " : ""}access until {new Date(s.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · <a className="link" href="#/warehouse/support">Manage</a></p>
      ))}
      {!hide && <p className="server-note">Stock, orders and messages aren't saved on the server yet: changes stay in this page until it's reloaded. <button className="link" onClick={() => setHide(true)}>OK</button></p>}
    </div>
  );
}
