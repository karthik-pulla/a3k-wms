// Sign-in pieces shared by the warehouse app and the ops console: the 6-digit code box and the invite/reset flow
// (choose a password, connect an authenticator app). They don't touch the app's data, so the console can use them.
import { DEMO_LOGINS, isPublicDemo } from "./demo";
import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { api, ApiCallError, BACKEND } from "./client";
import { passwordProblems, passwordStrength } from "../../../server/src/shared/passwords.ts";
import type { InviteInfo, TenantPublic } from "../../../server/src/shared/api.ts";

const STRENGTH = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const preview = BACKEND === "preview";
export const message = (e: unknown) => (e instanceof ApiCallError ? e.message : "Something went wrong. Try again.");

/** Six boxes' worth of digits in one field (works with phone autofill and pasting); sends itself at 6 digits */
export function CodeInput({ busy, onCode, previewUser, previewScope = "tenant", secret }: { busy: boolean; onCode: (code: string) => void; previewUser?: string; previewScope?: "tenant" | "ops" | "portal"; secret?: string }) {
  const [code, setCode] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!busy) ref.current?.focus(); }, [busy]);
  const change = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) { onCode(digits); setCode(""); }
  };
  const fillPreview = async () => {
    // Written as one block so a real build drops it (and the preview) entirely
    if (import.meta.env.VITE_WMS_BACKEND === "preview") {
      if (secret) { const { totpAt, totpCounter } = await import("../../../server/src/core/crypto.ts"); change(await totpAt(secret, totpCounter(Date.now()))); return; }
      const c = await (await import("./preview")).previewCode(previewScope, previewUser ?? "");
      if (c) change(c);
    }
  };
  return (
    <div className="code-entry">
      <input ref={ref} className="input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={7} aria-label="6-digit code"
        placeholder="000000" value={code} disabled={busy} onChange={e => change(e.target.value)} translate="no" />
      {preview && (previewUser || secret) && <button type="button" className="btn small" onClick={() => void fillPreview()} title="Preview only: the code the phone would show">Preview: fill in the code</button>}
    </div>
  );
}

// ---------- Invite and reset links ----------
export function InviteFlow({ token, pub, onDone, call = api, scope = "tenant" }: {
  token: string; pub: TenantPublic | null; onDone: (me: any) => void;
  call?: typeof api; scope?: "tenant" | "ops" | "portal";
}) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    call<InviteInfo>("invite.read", { token }).then(i => { setInfo(i); }).catch(e => setError(message(e)));
  }, [token, call]);

  const own = pub ? [pub.name, pub.appTitle, pub.mark] : [];
  const problems = passwordProblems(pw, info?.username ?? "", own);
  const strength = passwordStrength(pw, own);
  const ok = !problems.length && pw === pw2;

  const choose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try { setSecret(await call("invite.password", { token, password: pw })); setPw(""); setPw2(""); setStep(2); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  const finish = async (code: string) => {
    setBusy(true); setError(null);
    try { onDone(await call("invite.finish", { token, code })); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  };

  if (error && !info) return (
    <div className="login-form">
      <h2>This link doesn't work</h2>
      <p className="note warn">{error}</p>
      <a className="btn primary" href="#/" onClick={() => setTimeout(() => location.reload(), 0)}>Go to sign in</a>
    </div>
  );
  if (!info) return <div className="login-form"><p className="muted" role="status">Checking your link…</p></div>;

  const reset = info.kind === "reset";
  return (
    <div className="login-form">
      <ol className="steps" aria-label="Steps">
        <li className={step === 1 ? "on" : "done"}><b>1</b> Password</li>
        <li className={step === 2 ? "on" : ""}><b>2</b> Phone</li>
      </ol>
      {step === 1 ? (
        <form className="login-form" onSubmit={choose} noValidate>
          <h2>{reset ? `Welcome back, ${info.name.split(" ")[0]}` : `Welcome, ${info.name.split(" ")[0]}`}</h2>
          <p className="muted small">{reset ? "Your sign-in was reset. Choose a new password, then connect your phone again." : <>You're joining <b translate="no">{info.warehouse.appTitle}</b> as <b translate="no">@{info.username}</b>. Choose a password, then connect your phone.</>}</p>
          <input type="text" autoComplete="username" value={info.username} readOnly hidden />
          <label className="field"><span>Password</span>
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus aria-describedby="pw-hint" />
            <span className="pw-meter" aria-hidden="true"><i className={`s${strength}`} style={{ width: `${(strength / 4) * 100}%` }} /></span>
            <small id="pw-hint" className={problems.length && pw ? "warn" : "muted"}>{pw ? (problems.length ? `Needs ${problems.join(", ")}.` : `${STRENGTH[strength]} password.`) : "At least 12 characters. A short sentence works well."}</small>
          </label>
          <label className="field"><span>Password again</span>
            <input className={`input${pw2 && pw !== pw2 ? " invalid" : ""}`} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
            {pw2 && pw !== pw2 && <small className="warn">The passwords don't match.</small>}
          </label>
          {error && <p className="note warn" role="alert">{error}</p>}
          <button className="btn primary big" disabled={!ok || busy}>{busy ? "Saving…" : "Next: connect your phone"}</button>
        </form>
      ) : secret && (
        <>
          <h2>Connect your phone</h2>
          <p className="muted small">Install an authenticator app if you don't have one (Google Authenticator, Microsoft Authenticator or 1Password all work). In the app, add an account and scan this code.</p>
          <div className="qr-box"><img src={qrImage(secret.uri)} alt="QR code for your authenticator app" width={196} height={196} /></div>
          <details className="manual-key">
            <summary>Can't scan? Type the key instead</summary>
            <p className="mono key" translate="no">{secret.secret.match(/.{1,4}/g)!.join(" ")}</p>
            <button type="button" className="btn small" onClick={() => { void navigator.clipboard?.writeText(secret.secret); setCopied(true); }}>{copied ? "Copied" : "Copy key"}</button>
          </details>
          <p className="small">Then type the 6-digit code the app shows:</p>
          <CodeInput busy={busy} onCode={finish} secret={preview ? secret.secret : undefined} previewScope={scope} />
          {error && <p className="note warn" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

/** A QR code as an image (drawn here; nothing is sent anywhere) */
function qrImage(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createDataURL(6, 2);
}

/** The public demo's ready-made logins (server/demo.ts): one tap fills in the username and password */
export function DemoLogins({ where, onPick }: { where: "warehouse" | "console" | "portal"; onPick: (username: string, password: string) => void }) {
  if (!isPublicDemo) return null;
  const names = where === "console" ? [DEMO_LOGINS.console] : where === "portal" ? [DEMO_LOGINS.portal] : DEMO_LOGINS.warehouse;
  return (
    <div className="note demo-logins">
      <p className="small"><b>Demo</b>: made-up data, kept in this browser only. Sign in as{where === "console" ? " the WMS team's console owner" : where === "portal" ? " a buyer from one of the brands" : ""}:</p>
      <div className="chip-wrap">{names.map(n => <button key={n} type="button" className="chip-btn" onClick={() => onPick(n, DEMO_LOGINS.password)} translate="no">{n}</button>)}</div>
      <p className="muted small">Password <b className="mono" translate="no">{DEMO_LOGINS.password}</b>, then "Preview: fill in the code" stands in for the phone app.</p>
    </div>
  );
}
