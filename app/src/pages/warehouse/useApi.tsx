// Calling the server from a screen: loading state, errors, and "enter your password again" when an owner action
// needs it (the server answers `confirm`; we ask, confirm, and try once more).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiCallError } from "../../server/client";

/** Which API the screens below call: the warehouse's (default) or the ops console's */
type Call = typeof api;
const ApiCtx = createContext<Call>(api);
export const ApiProvider = ApiCtx.Provider;

export function useApiData<T>(method: string, input?: Record<string, unknown>) {
  const call = useContext(ApiCtx);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(input ?? {});
  const reload = useCallback(async () => {
    try { setData(await call<T>(method, JSON.parse(key))); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load"); }
  }, [method, key, call]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload, setData };
}

type Ask = () => Promise<boolean>;
const ConfirmCtx = createContext<Ask | null>(null);

/** Asks for the owner's password (once per 10 minutes, as the server decides) */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const call = useContext(ApiCtx);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback<Ask>(() => new Promise(resolve => { done.current = resolve; setPw(""); setError(null); setOpen(true); }), []);
  const close = (ok: boolean) => { setOpen(false); done.current?.(ok); done.current = null; };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setError(null);
    try { await call("auth.confirm", { password: pw }); close(true); } catch (err) { setError(err instanceof Error ? err.message : "That didn't work"); } finally { setBusy(false); setPw(""); }
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {open && (
        <div className="dialog-backdrop" onClick={e => { if (e.target === e.currentTarget) close(false); }}>
          <form className="dialog glass" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="confirm-h">
            <h2 id="confirm-h">Enter your password</h2>
            <p className="muted small">Changes to people, warehouses and access need your password again. It counts for 10 minutes.</p>
            <input className="input" type="password" autoComplete="current-password" autoFocus value={pw} onChange={e => setPw(e.target.value)} aria-label="Your password" />
            {error && <p className="note warn" role="alert">{error}</p>}
            <div className="btns"><button type="button" className="btn" onClick={() => close(false)}>Cancel</button><button className="btn primary" disabled={!pw || busy}>{busy ? "Checking…" : "Confirm"}</button></div>
          </form>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/** Runs a server call; if it needs the password again, asks for it and tries once more. Errors come back as text. */
export function useAction() {
  const ask = useContext(ConfirmCtx);
  const call = useContext(ApiCtx);
  return useCallback(async <T,>(method: string, input: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
    try { return { ok: true, value: await call<T>(method, input) }; }
    catch (e) {
      if (e instanceof ApiCallError && e.code === "confirm" && ask && (await ask())) {
        try { return { ok: true, value: await call<T>(method, input) }; } catch (e2) { return { ok: false, error: e2 instanceof Error ? e2.message : "That didn't work" }; }
      }
      if (e instanceof ApiCallError && e.code === "confirm") return { ok: false, error: "Cancelled" };
      return { ok: false, error: e instanceof Error ? e.message : "That didn't work" };
    }
  }, [ask, call]);
}

/** A link someone needs: say whether it was emailed, and let it be copied either way */
export function LinkPanel({ link, emailed, who, kind, onClose }: { link: string; emailed: boolean; who: string; kind: "invite" | "reset"; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-panel" role="status">
      <p><b>{kind === "invite" ? `Invite ready for ${who}` : `New sign-in link for ${who}`}</b></p>
      <p className="muted small">{emailed ? "We emailed it to them. You can also copy it and send it another way (text, WhatsApp)." : "No email address on file (or email isn't set up yet): copy the link and send it to them yourself."} It works for {kind === "invite" ? "7 days" : "24 hours"}, once.</p>
      <div className="link-row"><input className="input mono" readOnly value={link} onFocus={e => e.target.select()} aria-label="Link" translate="no" /><button className="btn small primary" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button></div>
      <button className="link" onClick={onClose}>Done</button>
    </div>
  );
}
