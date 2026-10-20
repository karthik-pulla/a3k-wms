import { useEffect, useState } from "react";
import { passwordProblems, passwordStrength } from "../../auth/crypto";
import { LangSwitch } from "../../components/LangSwitch";
import { createVault, requestAccount, signIn, type Session, type VaultData } from "../../auth/vault";
import { sampleState } from "../../store/sample";
import { tenant } from "../../tenant";

const STRENGTH = ["Very weak", "Weak", "Fair", "Good", "Strong"];
/** The warehouse's name and mark (tenant config), never translated */
const brand = tenant().config.branding;

/** Sign in, or ask for an account (an admin approves it). */
export function LoginScreen({ message, onSignedIn }: { message?: string; onSignedIn: (s: Session, d: VaultData) => void }) {
  const [mode, setMode] = useState<"signin" | "request">("signin");
  return (
    <main className="login">
      <div className="login-card glass">
        <div className="login-brand"><span className="login-mark" aria-hidden="true" translate="no">{brand.mark}</span><div><h1 translate="no">{brand.appTitle}</h1><p className="muted small">Warehouse management</p></div></div>
        {mode === "signin" ? <SignIn message={message} onSignedIn={onSignedIn} onRequest={() => setMode("request")} /> : <RequestAccount onBack={() => setMode("signin")} />}
      </div>
      <LangSwitch className="login-lang" />
      <p className="login-foot muted small">Your data is encrypted on this device and opens only after you sign in.</p>
    </main>
  );
}

/**
 * A new device, outside the demo: the first person makes the owner account (there is no built-in password). It gets
 * the admin's testing switcher; everyone else asks for an account and this owner approves them.
 */
export function SetUpDevice({ onDone }: { onDone: (s: Session, d: VaultData) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = passwordProblems(pw, username);
  const strength = passwordStrength(pw);
  const userOk = /^[a-z0-9._-]{3,32}$/i.test(username.trim());
  const ok = name.trim().length >= 2 && userOk && !problems.length && pw === pw2;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try {
      await createVault(sampleState, { username: username.trim(), password: pw, name: name.trim() });
      const r = await signIn(username.trim(), pw, false);
      if (r.ok) onDone(r.session, r.data); else setError("Set up, but signing in didn't work. Reload and sign in.");
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't set this device up."); }
    finally { setBusy(false); }
  };
  return (
    <main className="login">
      <div className="login-card glass">
        <div className="login-brand"><span className="login-mark" aria-hidden="true" translate="no">{brand.mark}</span><div><h1 translate="no">{brand.appTitle}</h1><p className="muted small">Warehouse management</p></div></div>
        <form className="login-form" onSubmit={submit} noValidate>
          <h2>Set up this device</h2>
          <p className="muted small">Nobody has used the WMS on this device yet. Make the owner account: you'll approve everyone else's account requests.</p>
          <label className="field"><span>Your name</span><input className="input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
          <label className="field"><span>Username</span>
            <input className={`input${username && !userOk ? " invalid" : ""}`} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} aria-describedby="su-hint" />
            <small id="su-hint" className="muted">3–32 letters, numbers, dots, dashes or underscores</small>
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} aria-describedby="spw-hint" />
            <span className="pw-meter" aria-hidden="true"><i className={`s${strength}`} style={{ width: `${(strength / 4) * 100}%` }} /></span>
            <small id="spw-hint" className={problems.length && pw ? "warn" : "muted"}>{pw ? (problems.length ? `Needs ${problems.join(", ")}.` : `${STRENGTH[strength]} password.`) : "At least 12 characters. A short sentence works well."}</small>
          </label>
          <label className="field"><span>Password again</span>
            <input className={`input${pw2 && pw !== pw2 ? " invalid" : ""}`} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
            {pw2 && pw !== pw2 && <small className="warn">The passwords don't match.</small>}
          </label>
          {error && <p className="note warn" role="alert">{error}</p>}
          <button className="btn primary big" disabled={!ok || busy}>{busy ? "Setting up…" : "Set up and sign in"}</button>
        </form>
      </div>
      <LangSwitch className="login-lang" />
      <p className="login-foot muted small">Your data is encrypted on this device and opens only after you sign in.</p>
    </main>
  );
}

function SignIn({ message, onSignedIn, onRequest }: { message?: string; onSignedIn: (s: Session, d: VaultData) => void; onRequest: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (!until) return; const t = window.setInterval(() => { if (until <= new Date().toISOString()) { setUntil(null); setError(null); } tick(n => n + 1); }, 1000); return () => window.clearInterval(t); }, [until]);
  const wait = until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy || wait) return;
    setBusy(true); setError(null);
    try {
      const r = await signIn(username, password, keep);
      if (r.ok) { setPassword(""); onSignedIn(r.session, r.data); return; }
      setPassword("");
      if (r.reason === "locked") { setUntil(r.until ?? null); setError("Too many tries. Wait before trying again."); }
      else if (r.reason === "pending") setError("Your account request is waiting for an admin to approve it.");
      else if (r.reason === "disabled") setError("This account is turned off. Ask an admin.");
      else setError("Wrong username or password.");
    } catch { setError("Couldn't sign in on this browser."); }
    finally { setBusy(false); }
  };

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <h2>Sign in</h2>
      {message && <p className="note">{message}</p>}
      {import.meta.env.VITE_WMS_DEMO === "1" && <p className="note">Demo: the stock here is made up. Sign in with admin / password. Changes stay on this device only.</p>}
      <label className="field"><span>Username</span>
        <input className="input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={e => setUsername(e.target.value)} />
      </label>
      <label className="field"><span>Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      <label className="toggle-row"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Keep me signed in on this device (7 days; leave off on shared devices)</label>
      {error && <p className="note warn" role="alert">{error}{wait ? ` (${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait} s`})` : ""}</p>}
      <button className="btn primary big" disabled={busy || !!wait || !username.trim() || !password}>{busy ? "Checking…" : "Sign in"}</button>
      <button type="button" className="link" onClick={onRequest}>Need an account? Ask for one</button>
    </form>
  );
}

function RequestAccount({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const problems = passwordProblems(pw, username);
  const strength = passwordStrength(pw);
  const userOk = /^[a-z0-9._-]{3,32}$/i.test(username.trim());
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ok = name.trim().length >= 2 && userOk && emailOk && !problems.length && pw === pw2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await requestAccount({ name: name.trim(), username: username.trim(), email: email.trim() || undefined, note: note.trim() || undefined }, pw);
      if (r.ok) { setDone(true); setPw(""); setPw2(""); } else setError(r.error);
    } catch { setError("Couldn't send the request on this browser."); }
    finally { setBusy(false); }
  };

  if (done) return (
    <div className="login-form">
      <h2>Request sent</h2>
      <p>An admin needs to approve <b>{username}</b>. After that, sign in with the username and password you just chose.</p>
      <button className="btn primary" onClick={onBack}>Back to sign in</button>
    </div>
  );
  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <h2>Ask for an account</h2>
      <p className="muted small">An admin approves it and gives you your role (owner, coordinator or worker). Your request is encrypted so only an admin can read it.</p>
      <label className="field"><span>Full name</span><input className="input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
      <label className="field"><span>Username</span>
        <input className={`input${username && !userOk ? " invalid" : ""}`} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} aria-describedby="u-hint" />
        <small id="u-hint" className="muted">3–32 letters, numbers, dots, dashes or underscores</small>
      </label>
      <label className="field"><span>Email (optional)</span><input className={`input${!emailOk ? " invalid" : ""}`} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="field"><span>Password</span>
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} aria-describedby="pw-hint" />
        <span className="pw-meter" aria-hidden="true"><i className={`s${strength}`} style={{ width: `${(strength / 4) * 100}%` }} /></span>
        <small id="pw-hint" className={problems.length && pw ? "warn" : "muted"}>{pw ? (problems.length ? `Needs ${problems.join(", ")}.` : `${STRENGTH[strength]} password.`) : "At least 12 characters. A short sentence works well."}</small>
      </label>
      <label className="field"><span>Password again</span>
        <input className={`input${pw2 && pw !== pw2 ? " invalid" : ""}`} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
        {pw2 && pw !== pw2 && <small className="warn">The passwords don't match.</small>}
      </label>
      <label className="field"><span>Note for the admin (optional)</span><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. forklift driver, PM shift" /></label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <button className="btn primary big" disabled={!ok || busy}>{busy ? "Sending…" : "Send request"}</button>
      <button type="button" className="link" onClick={onBack}>Back to sign in</button>
    </form>
  );
}
