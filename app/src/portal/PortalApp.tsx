// The client portal (<warehouse address>/portal): a client's people sign in with their own login (password, then a
// code from their phone) and place an order for a store or tell the warehouse about a delivery on its way. Orders
// arrive in the warehouse's Out-bounds as drafts for a coordinator to approve; delivery notices as expected deliveries
// in In-bounds. Only the client's own products and what its own logins sent are shown (server/src/core/portal-api.ts).
// Owners make the logins in Manage warehouse → Clients. A warehouse login doesn't work here, nor the other way round.
import { LatticeLogo } from "../components/LatticeLogo";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { portalApi, ApiCallError, BACKEND } from "../server/client";
import { CodeInput, DemoLogins, InviteFlow, message } from "../server/authParts";
import { Background } from "../components/Background";
import { LangSwitch } from "../components/LangSwitch";
import { ToastProvider, useToast } from "../components/Toast";
import { useAppearance, useSettings } from "../settings";
import { t } from "../i18n";
import { PORTAL_LIMITS, type PortalMe, type PortalProduct, type PortalSent, type TenantPublic } from "../../../server/src/shared/api.ts";
// Preview only; a real build leaves it out
const PreviewTools = import.meta.env.VITE_WMS_BACKEND === "preview" ? lazy(() => import("../server/PreviewTools").then(m => ({ default: m.PreviewTools }))) : null;

const preview = BACKEND === "preview";
const route = () => window.location.hash.replace(/^#\/?/, "").split("/");
const useRoute = () => {
  const [r, setR] = useState(route);
  useEffect(() => { const on = () => setR(route()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  return r;
};
const dayIso = (offsetDays = 0) => { const d = new Date(Date.now() + offsetDays * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDay = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const newRequest = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

type Phase = { kind: "loading" } | { kind: "signin"; note?: string } | { kind: "invite"; token: string } | { kind: "open"; me: PortalMe } | { kind: "error"; message: string };

export function PortalApp() {
  const { settings } = useSettings();
  useAppearance(settings.theme, settings.glass);
  const [pub, setPub] = useState<TenantPublic | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    const [first, token] = route();
    (async () => {
      try {
        setPub(await portalApi<TenantPublic>("portal.public"));
        if (first === "invite" && token) { setPhase({ kind: "invite", token }); return; }
        const me = await portalApi<PortalMe>("auth.me").catch(e => { if (e instanceof ApiCallError && e.code === "not-signed-in") return null; throw e; });
        setPhase(me ? { kind: "open", me } : { kind: "signin" });
      } catch (e) { setPhase({ kind: "error", message: message(e) }); }
    })();
  }, []);
  useEffect(() => { document.title = pub ? `${pub.appTitle} · ${t("Client portal")}` : t("Client portal"); }, [pub]);
  // Signed out elsewhere (idle, the warehouse turned the login off): back to sign-in
  useEffect(() => {
    if (phase.kind !== "open") return;
    const id = window.setInterval(() => portalApi("auth.me").catch(e => { if (e instanceof ApiCallError && e.code === "not-signed-in") setPhase({ kind: "signin", note: "You were signed out. Sign in again to carry on." }); }), 60_000);
    return () => window.clearInterval(id);
  }, [phase.kind]);

  let body: ReactNode;
  if (phase.kind === "loading") body = <div className="auth-loading" role="status">Opening…</div>;
  else if (phase.kind === "error") body = <main className="auth-loading"><div className="glass crash-card"><h2>Can't open the client portal</h2><p className="muted">{phase.message}</p><button className="btn primary" onClick={() => location.reload()}>Reload</button></div></main>;
  else if (phase.kind === "open") body = <Portal me={phase.me} onSignOut={async () => { await portalApi("auth.signOut").catch(() => {}); setPhase({ kind: "signin" }); }} />;
  else body = (
    <main className="login">
      <div className="login-card glass">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true" translate="no">{pub?.mark || "WMS"}</span>
          <div><h1 translate="no">{pub?.appTitle ?? "Warehouse"}</h1><p className="muted small">Client portal</p></div>
        </div>
        {phase.kind === "invite"
          ? <InviteFlow token={phase.token} pub={pub} call={portalApi} scope="portal" onDone={me => { window.location.hash = "#/"; setPhase({ kind: "open", me }); }} />
          : <SignIn note={phase.note} onSignedIn={me => setPhase({ kind: "open", me })} />}
      </div>
      {pub && <LangSwitch className="login-lang" enabled={pub.languages.enabled} />}
      <p className="login-foot muted small">For the warehouse's clients: order and tell us about deliveries. Your login comes from the warehouse; warehouse staff sign in on the warehouse's own page.</p>
      <div className="lattice-by"><LatticeLogo height={11} /></div>
    </main>
  );
  return (
    <ToastProvider>
      <Background moving={settings.movingBackground} />
      {body}
      {PreviewTools && <Suspense fallback={null}><PreviewTools /></Suspense>}
    </ToastProvider>
  );
}

// ---------- Sign in: password, then the code ----------
function SignIn({ note, onSignedIn }: { note?: string; onSignedIn: (me: PortalMe) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(false);
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true); setError(null);
    try { setTicket((await portalApi<{ ticket: string }>("auth.signIn", { username: username.trim().toLowerCase(), password, keep })).ticket); setPassword(""); }
    catch (err) { setError(message(err)); setPassword(""); } finally { setBusy(false); }
  };
  const code = async (c: string) => {
    setBusy(true); setError(null);
    try { onSignedIn(await portalApi<PortalMe>("auth.verify", { ticket, code: c })); }
    catch (err) { setError(message(err)); if (err instanceof ApiCallError && err.code === "expired") setTicket(""); } finally { setBusy(false); }
  };
  if (ticket) return (
    <div className="login-form">
      <h2>Enter the code</h2>
      <p className="muted small">Open the authenticator app on your phone and type the 6-digit code it shows for this portal.</p>
      <CodeInput busy={busy} onCode={code} previewUser={preview ? username : undefined} previewScope="portal" />
      {error && <p className="note warn" role="alert">{error}</p>}
      <button type="button" className="link" onClick={() => { setTicket(""); setError(null); }}>Back</button>
      <p className="muted small">Lost your phone? Ask the warehouse to reset your sign-in. They'll send you a new link.</p>
    </div>
  );
  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <h2>Sign in</h2>
      {note && <p className="note">{note}</p>}
      <DemoLogins where="portal" onPick={(u, p) => { setUsername(u); setPassword(p); }} />
      <label className="field"><span>Username</span><input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="toggle-row"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Keep me signed in on this device (7 days; leave off on shared devices)</label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <button className="btn primary big" disabled={busy || !username.trim() || !password}>{busy ? "Checking…" : "Continue"}</button>
    </form>
  );
}

// ---------- Signed in ----------
const TABS = [{ id: "order", label: "Place an order" }, { id: "delivery", label: "Announce a delivery" }, { id: "sent", label: "Sent" }] as const;

function Portal({ me, onSignOut }: { me: PortalMe; onSignOut: () => void }) {
  const [tab] = useRoute();
  const current = TABS.some(x => x.id === tab) ? tab : "order";
  const [products, setProducts] = useState<PortalProduct[] | null>(null);
  const [sent, setSent] = useState<PortalSent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSent = useCallback(() => portalApi<PortalSent[]>("sent").then(setSent).catch(e => setError(message(e))), []);
  useEffect(() => { portalApi<PortalProduct[]>("products").then(setProducts).catch(e => setError(message(e))); void loadSent(); }, [loadSent]);
  // What was sent may move on at the warehouse (confirmed, shipped, received): look again now and then
  useEffect(() => { if (current !== "sent") return; void loadSent(); const id = window.setInterval(() => void loadSent(), 30_000); return () => window.clearInterval(id); }, [current, loadSent]);
  const done = (s: PortalSent | null) => { if (s) setSent(list => [s, ...(list ?? []).filter(x => x.key !== s.key)]); window.location.hash = "#/sent"; };
  return (
    <div className="portal-shell">
      <header className="portal-head glass">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true" translate="no">{me.warehouse.mark || "WMS"}</span>
          <div><b translate="no">{me.warehouse.appTitle}</b><small className="muted block">Client portal · <span translate="no">{me.client.name}</span></small></div>
        </div>
        <nav className="chip-wrap" aria-label="Client portal">
          {TABS.map(x => <a key={x.id} className={`chip-btn${current === x.id ? " on" : ""}`} aria-current={current === x.id ? "page" : undefined} href={`#/${x.id}`}>{x.label}{x.id === "sent" && sent?.length ? ` · ${sent.length}` : ""}</a>)}
        </nav>
        <div className="portal-me">
          <LangSwitch enabled={me.warehouse.languages.enabled} />
          <span><b translate="no">{me.account.name}</b><small className="muted block" translate="no">@{me.account.username}</small></span>
          <button className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <main className="portal-main">
        {error && <p className="note warn" role="alert">{error}</p>}
        {current === "sent" ? <SentList sent={sent} />
          : !products ? <p className="muted panel glass" role="status">Loading your products…</p>
          : !products.length ? <p className="panel glass">The warehouse hasn't set up any products for <b translate="no">{me.client.name}</b> yet. Ask them to add your product list.</p>
          : current === "delivery" ? <DeliveryForm products={products} onSent={done} />
          : <OrderForm products={products} onSent={done} />}
      </main>
    </div>
  );
}

// ---------- Choosing products ----------
const label = (p: PortalProduct) => [p.code, p.name, p.size].filter(Boolean).join(" · ");
/** The product someone typed or picked: the list's text exactly, or a code */
function findProduct(products: PortalProduct[], text: string): PortalProduct | undefined {
  const v = text.trim().toLowerCase();
  if (!v) return undefined;
  return products.find(p => label(p).toLowerCase() === v) ?? products.find(p => p.code.toLowerCase() === v) ?? (() => { const m = products.filter(p => label(p).toLowerCase().includes(v)); return m.length === 1 ? m[0] : undefined; })();
}

function ProductPick({ products, value, onChange, listId }: { products: PortalProduct[]; value: string; onChange: (text: string) => void; listId: string }) {
  const p = findProduct(products, value);
  return (
    <span className="portal-product">
      <input className={`input${value.trim() && !p ? " invalid" : ""}`} list={listId} value={value} onChange={e => onChange(e.target.value)} placeholder="Code or name" aria-label="Product" />
      {p && value.trim() !== label(p) && <small className="muted" translate="no">{label(p)}</small>}
    </span>
  );
}
const ProductList = ({ products, id }: { products: PortalProduct[]; id: string }) => <datalist id={id}>{products.map(p => <option key={p.id} value={label(p)} />)}</datalist>;

/** Shared bits of both forms: which request this is (so a resend saves once), busy and errors */
function useSend(onSent: (s: PortalSent | null) => void) {
  const toast = useToast();
  const [requestId, setRequestId] = useState(newRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (method: "order.send" | "delivery.send", input: Record<string, unknown>, reset: () => void) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const s = await portalApi<PortalSent | null>(method, { ...input, requestId });
      toast(s?.kind === "delivery" ? `Delivery ${s.number} sent to the warehouse.` : `${s?.id ?? "Your order"} sent to the warehouse.`);
      reset(); setRequestId(newRequest()); onSent(s);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return { busy, error, send };
}

// ---------- Placing an order ----------
interface OrderLine { key: number; product: string; cases: string }

function OrderForm({ products, onSent }: { products: PortalProduct[]; onSent: (s: PortalSent | null) => void }) {
  const [store, setStore] = useState(""), [ref, setRef] = useState(""), [due, setDue] = useState(""), [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([{ key: 1, product: "", cases: "" }]);
  const { busy, error, send } = useSend(onSent);
  const read = useMemo(() => lines.map(l => ({ ...l, p: findProduct(products, l.product), n: Number(l.cases) })), [lines, products]);
  const good = read.filter(l => l.p && Number.isInteger(l.n) && l.n >= 1 && l.n <= PORTAL_LIMITS.cases);
  const unfinished = read.some(l => (l.product.trim() || l.cases) && !good.includes(l));
  const total = good.reduce((s, l) => s + l.n, 0);
  const ok = store.trim() && good.length > 0 && !unfinished;
  const set = (key: number, patch: Partial<OrderLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    void send("order.send", { today: dayIso(), store: store.trim(), ref: ref.trim(), due: due || null, notes: notes.trim(), lines: good.map(l => ({ productId: l.p!.id, cases: l.n })) },
      () => { setStore(""); setRef(""); setDue(""); setNotes(""); setLines([{ key: Date.now(), product: "", cases: "" }]); });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <section className="panel glass">
        <h2 className="plain-h">Place an order</h2>
        <p className="muted small">For one store. The warehouse checks it and confirms it; you can follow it under Sent.</p>
        <div className="facts portal-facts">
          <label className="fact"><span>Store</span><input className="input" value={store} onChange={e => setStore(e.target.value)} placeholder="Who it goes to" maxLength={PORTAL_LIMITS.store} required /></label>
          <label className="fact"><span>PO number (optional)</span><input className="input" value={ref} onChange={e => setRef(e.target.value)} maxLength={PORTAL_LIMITS.ref} /></label>
          <label className="fact"><span>Due date (optional)</span><input className="input" type="date" value={due} min={dayIso()} onChange={e => setDue(e.target.value)} /></label>
        </div>
      </section>
      <section className="panel glass">
        <ProductList products={products} id="portal-products" />
        <div className="table-wrap">
          <table className="lines portal-lines">
            <thead><tr><th>Product</th><th>Cases</th><th aria-label="Remove" /></tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.key}>
                  <td><ProductPick products={products} listId="portal-products" value={l.product} onChange={v => set(l.key, { product: v })} /></td>
                  <td><input className="input num" type="number" inputMode="numeric" min={1} max={PORTAL_LIMITS.cases} value={l.cases} onChange={e => set(l.key, { cases: e.target.value })} aria-label="Cases" /></td>
                  <td>{lines.length > 1 && <button type="button" className="mini" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label="Remove this line">×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <button type="button" className="btn small" disabled={lines.length >= PORTAL_LIMITS.lines} onClick={() => setLines(ls => [...ls, { key: Date.now(), product: "", cases: "" }])}>+ Add a line</button>
          <span className="muted small">{good.length ? `${good.length} product${good.length === 1 ? "" : "s"}, ${total} case${total === 1 ? "" : "s"}` : "Type a product code or name, then the cases."}</span>
        </div>
        <label className="field"><span>Notes for the warehouse (optional)</span><textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={PORTAL_LIMITS.notes} placeholder="e.g. delivery window, pallet labels" /></label>
        {unfinished && <p className="small warn">Finish or remove the lines without a product from your list or a number of cases.</p>}
        {error && <p className="note warn" role="alert">{error}</p>}
        <div className="btns"><button className="btn primary" disabled={!ok || busy}>{busy ? "Sending…" : "Send the order"}</button></div>
      </section>
    </form>
  );
}

// ---------- Announcing a delivery ----------
interface DeliveryLine { key: number; product: string; cases: string; pallets: string; lot: string; bestBefore: string }
const blankDelivery = (): DeliveryLine => ({ key: Date.now(), product: "", cases: "", pallets: "1", lot: "", bestBefore: "" });

function DeliveryForm({ products, onSent }: { products: PortalProduct[]; onSent: (s: PortalSent | null) => void }) {
  const [expected, setExpected] = useState(dayIso(1)), [ref, setRef] = useState(""), [supplier, setSupplier] = useState(""), [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DeliveryLine[]>([{ ...blankDelivery(), key: 1 }]);
  const { busy, error, send } = useSend(onSent);
  const read = useMemo(() => lines.map(l => ({ ...l, p: findProduct(products, l.product), n: Number(l.cases), pal: Number(l.pallets || 1) })), [lines, products]);
  const good = read.filter(l => l.p && Number.isInteger(l.n) && l.n >= 1 && l.n <= PORTAL_LIMITS.cases && Number.isInteger(l.pal) && l.pal >= 1 && l.pal <= Math.min(PORTAL_LIMITS.palletsPerLine, l.n));
  const unfinished = read.some(l => (l.product.trim() || l.cases) && !good.includes(l));
  const pallets = good.reduce((s, l) => s + l.pal, 0), cases = good.reduce((s, l) => s + l.n, 0);
  const ok = expected && good.length > 0 && !unfinished && pallets <= PORTAL_LIMITS.pallets;
  const set = (key: number, patch: Partial<DeliveryLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    void send("delivery.send", { expected, ref: ref.trim(), supplier: supplier.trim(), notes: notes.trim(), lines: good.map(l => ({ productId: l.p!.id, cases: l.n, pallets: l.pal, lot: l.lot.trim(), bestBefore: l.bestBefore })) },
      () => { setRef(""); setSupplier(""); setNotes(""); setExpected(dayIso(1)); setLines([blankDelivery()]); });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <section className="panel glass">
        <h2 className="plain-h">Announce a delivery</h2>
        <p className="muted small">Goods on their way to the warehouse (an advance shipping notice). The warehouse expects them on the day you give and checks each pallet when it arrives.</p>
        <div className="facts portal-facts">
          <label className="fact"><span>Expected</span><input className="input" type="date" value={expected} min={dayIso()} onChange={e => setExpected(e.target.value)} required /></label>
          <label className="fact"><span>Container / BOL (optional)</span><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. MSKU 482910" maxLength={PORTAL_LIMITS.ref} /></label>
          <label className="fact"><span>Supplier (optional)</span><input className="input" value={supplier} onChange={e => setSupplier(e.target.value)} maxLength={PORTAL_LIMITS.supplier} /></label>
        </div>
      </section>
      <section className="panel glass">
        <ProductList products={products} id="portal-products-in" />
        <div className="table-wrap">
          <table className="lines portal-lines">
            <thead><tr><th>Product</th><th>Cases</th><th>Pallets</th><th>Lot (optional)</th><th>Best before (optional)</th><th aria-label="Remove" /></tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.key}>
                  <td><ProductPick products={products} listId="portal-products-in" value={l.product} onChange={v => set(l.key, { product: v })} /></td>
                  <td><input className="input num" type="number" inputMode="numeric" min={1} max={PORTAL_LIMITS.cases} value={l.cases} onChange={e => set(l.key, { cases: e.target.value })} aria-label="Cases" /></td>
                  <td><input className="input num" type="number" inputMode="numeric" min={1} max={PORTAL_LIMITS.palletsPerLine} value={l.pallets} onChange={e => set(l.key, { pallets: e.target.value })} aria-label="Pallets" /></td>
                  <td><input className="input" value={l.lot} onChange={e => set(l.key, { lot: e.target.value })} maxLength={PORTAL_LIMITS.lot} aria-label="Lot" /></td>
                  <td><input className="input" type="month" value={l.bestBefore} onChange={e => set(l.key, { bestBefore: e.target.value })} aria-label="Best before" /></td>
                  <td>{lines.length > 1 && <button type="button" className="mini" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label="Remove this line">×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <button type="button" className="btn small" disabled={lines.length >= PORTAL_LIMITS.lines} onClick={() => setLines(ls => [...ls, blankDelivery()])}>+ Add a line</button>
          <span className="muted small">{good.length ? `${pallets} pallet${pallets === 1 ? "" : "s"}, ${cases} case${cases === 1 ? "" : "s"}` : "One line per product; a line's cases are shared over its pallets."}</span>
        </div>
        <label className="field"><span>Notes for the warehouse (optional)</span><textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={PORTAL_LIMITS.notes} placeholder="e.g. driver's phone, appointment time" /></label>
        {unfinished && <p className="small warn">Finish or remove the lines without a product from your list, cases, or with more pallets than cases.</p>}
        {pallets > PORTAL_LIMITS.pallets && <p className="small warn">At most {PORTAL_LIMITS.pallets} pallets in one delivery: send the rest as another.</p>}
        {error && <p className="note warn" role="alert">{error}</p>}
        <div className="btns"><button className="btn primary" disabled={!ok || busy}>{busy ? "Sending…" : "Send the delivery notice"}</button></div>
      </section>
    </form>
  );
}

// ---------- What was sent ----------
const STATUS: Record<string, [string, "ok" | "wait" | "off"]> = {
  draft: ["Waiting for the warehouse to confirm", "wait"], approved: ["Confirmed", "ok"], picking: ["Being picked", "ok"], picked: ["Packed, ready to go", "ok"],
  shipped: ["Shipped", "ok"], cancelled: ["Cancelled", "off"], removed: ["Removed by the warehouse", "off"],
  incoming: ["Expected", "wait"], pending: ["Arrived, being checked", "ok"], putaway: ["Being put away", "ok"], stored: ["Received", "ok"],
};

function SentList({ sent }: { sent: PortalSent[] | null }) {
  if (!sent) return <p className="muted panel glass" role="status">Loading…</p>;
  if (!sent.length) return <p className="muted panel glass">Nothing sent yet. Orders and delivery notices you send show here, with where they stand.</p>;
  return (
    <div className="rows">
      {sent.map(s => {
        const [status, tone] = STATUS[s.status] ?? [s.status, "wait"];
        return (
          <div key={s.key} className="row glass portal-sent">
            <span className="row-title">
              {s.kind === "order" ? <><span translate="no">{s.id}</span> · <span translate="no">{s.store}</span></> : <span>{`Delivery ${s.number}`}</span>}
              <span className={`status ${tone}`}>{status}</span>
            </span>
            <span className="row-sub">
              {s.kind === "order"
                ? <>{s.ref && <>PO <span translate="no">{s.ref}</span> · </>}<span>{s.due ? `Due ${fmtDay(s.due)}` : "No due date"}</span></>
                : <><span>{`Expected ${fmtDay(s.expected)}`}</span>{s.ref && <> · <span translate="no">{s.ref}</span></>}</>}
              {" · "}<span>{`Sent by ${s.sentBy}, ${new Date(s.sentAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}</span>
            </span>
            <ul className="portal-sent-lines">
              {s.lines.map(l => <li key={l.code + l.name}><span className="mono" translate="no">{l.code}</span> <span translate="no">{l.name}</span> <b>× {l.cases}</b>{l.pallets ? <span className="muted">{` · ${l.pallets} pallet${l.pallets === 1 ? "" : "s"}`}</span> : null}</li>)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
