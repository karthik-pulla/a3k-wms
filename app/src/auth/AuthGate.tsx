import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sampleState } from "../store/sample";
import type { State } from "../store/types";
import { clearSession, ensureVault, persist, restore, sessionLimits, touchSession, type Account, type Session, type VaultData } from "./vault";
import { LoginScreen } from "../pages/login/LoginScreen";
import { isDemo, startOver } from "../utils/freshLoad";
import { t } from "../i18n";
import { IdentityContext, type Identity } from "./identity";

export interface Auth {
  account: Account;
  data: VaultData;
  session: Session;
  /** Runs an account operation on the latest vault data (it saves itself) and keeps the result */
  run: (op: (s: Session, d: VaultData) => Promise<VaultData>) => Promise<void>;
  signOut: (why?: string) => Promise<void>;
}
const Ctx = createContext<Auth | null>(null);
export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth outside AuthGate");
  return a;
}

type Phase = { kind: "loading" } | { kind: "locked"; message?: string } | { kind: "open"; session: Session; data: VaultData };

/**
 * Nothing of the app shows until someone signs in. Signing in opens the encrypted vault; changes are encrypted and
 * saved a moment later (and at once when the app goes to the background). Idle too long, and it locks again.
 */
export function AuthGate({ children }: { children: (initial: State | null, onChange: (s: State) => void) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const dataRef = useRef<VaultData | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        await ensureVault(sampleState);
        const r = await restore();
        if (r) { dataRef.current = r.data; sessionRef.current = r.session; setPhase({ kind: "open", ...r }); }
        else setPhase({ kind: "locked" });
      } catch (e) { setPhase({ kind: "locked", message: e instanceof Error ? e.message : "Couldn't open the app's data." }); }
    })();
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (sessionRef.current && dataRef.current) await persist(sessionRef.current, dataRef.current).catch(() => undefined);
  }, []);
  const onChange = useCallback((state: State) => {
    if (!dataRef.current || dataRef.current.state === state) return;
    dataRef.current = { ...dataRef.current, state };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 300);
  }, [flush]);

  const signOut = useCallback(async (why?: string) => {
    await flush();
    await clearSession();
    dataRef.current = null; sessionRef.current = null;
    setPhase({ kind: "locked", message: why });
  }, [flush]);

  // Save right away when the app goes to the background; lock after the idle time
  useEffect(() => {
    if (phase.kind !== "open") return;
    const s = phase.session;
    let last = 0;
    const active = () => { const t = Date.now(); if (t - last > 60_000) { last = t; void touchSession(s); } };
    const hide = () => { if (document.hidden) void flush(); };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, active, { passive: true }));
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    const check = window.setInterval(() => {
      const { idleMin, maxHours } = sessionLimits(s);
      const idle = Date.now() - new Date(s.lastActive).getTime(), age = Date.now() - new Date(s.started).getTime();
      if (idle > idleMin * 6e4) void signOut(`Signed out after ${idleMin >= 60 * 24 ? `${Math.round(idleMin / 1440)} days` : `${idleMin} minutes`} without activity.`);
      else if (age > maxHours * 36e5) void signOut("Signed out: sessions last at most " + (maxHours >= 48 ? `${maxHours / 24} days.` : `${maxHours} hours.`));
    }, 30_000);
    return () => { events.forEach(e => window.removeEventListener(e, active)); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", hide); window.clearInterval(check); };
  }, [phase, flush, signOut]);

  const run = useCallback(async (op: (s: Session, d: VaultData) => Promise<VaultData>) => {
    if (!sessionRef.current || !dataRef.current) return;
    window.clearTimeout(timer.current);
    const next = await op(sessionRef.current, dataRef.current);
    dataRef.current = next;
    setPhase(p => (p.kind === "open" ? { ...p, data: next } : p));
  }, []);

  const auth = useMemo<Auth | null>(() => {
    if (phase.kind !== "open") return null;
    const account = phase.data.accounts.find(a => a.uid === phase.session.uid)!;
    return { account, data: phase.data, session: phase.session, run, signOut };
  }, [phase, run, signOut]);

  if (phase.kind === "loading") return <Opening />;
  if (phase.kind === "locked" || !auth) {
    return <LoginScreen message={phase.kind === "locked" ? phase.message : undefined} onSignedIn={(session, data) => { dataRef.current = data; sessionRef.current = session; setPhase({ kind: "open", session, data }); }} />;
  }
  return <Ctx.Provider value={auth}><DeviceIdentity auth={auth}>{children(phase.data.state, onChange)}</DeviceIdentity></Ctx.Provider>;
}

/** The vault's account as the app's identity */
function DeviceIdentity({ auth, children }: { auth: Auth; children: ReactNode }) {
  const a = auth.account;
  const identity = useMemo<Identity>(() => ({
    kind: "device",
    account: { uid: a.uid, name: a.name, username: a.username, role: a.role, clients: a.clients, admin: !!a.admin, mustChange: !!a.mustChange },
    signOut: auth.signOut,
    securityLog: auth.data.log,
  }), [a, auth.signOut, auth.data.log]);
  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

/** "Opening…", and after 8 seconds a way out instead of waiting forever */
function Opening() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setSlow(true), 8000); return () => window.clearTimeout(t); }, []);
  if (!slow) return <div className="auth-loading" role="status">Opening…</div>;
  return (
    <main className="auth-loading">
      <div className="glass crash-card">
        <h2>This is taking too long</h2>
        <p className="muted">The app couldn't open its saved data on this device. Reloading usually fixes it.</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        {isDemo && <StartOver />}
      </div>
    </main>
  );
}

function StartOver() {
  return <button className="btn" onClick={() => { if (window.confirm(t("Start over on this device? The demo's sample data and any changes you made here are cleared."))) void startOver(); }}>Start over on this device</button>;
}
