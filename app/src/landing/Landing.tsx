// The product's public page, kept minimal: one line about the WMS and "Book a visit" (warehouses never sign themselves
// up; we visit and set it up). On the real site the request goes to the server (core/site.ts, the console's Visits);
// on the demo site (GitHub can't receive it) it's an email link, and "Try the demo" opens the WMS beside it.
import { useEffect, useState } from "react";
import { siteApi, ApiCallError } from "../server/client";
import { DEMO_CONTACT, isPublicDemo } from "../server/demo";

// On the demo site this page is the front page and the WMS itself is in demo/ beside its files (scripts/site.mjs)
const appUrl = import.meta.env.DEV ? "/" : new URL("../", import.meta.url).href;
const consoleUrl = import.meta.env.DEV ? "/ops.html" : new URL("../ops.html", import.meta.url).href;

export function Landing() {
  const [name, setName] = useState("WMS");
  const [booking, setBooking] = useState(false);
  useEffect(() => {
    if (isPublicDemo) { document.title = "WMS"; return; }
    siteApi<{ productName: string }>("site.info").then(r => { setName(r.productName); document.title = r.productName; }).catch(() => {});
  }, []);
  return (
    <main className="lp">
      <header className="lp-top"><span translate="no">{name}</span></header>
      <section className="lp-hero">
        <h1>Every pallet, on the map.</h1>
        <p>Warehouse management for warehouses that store for several brands. We set it up at yours.</p>
        <div className="lp-actions">
          {isPublicDemo && <a className="btn primary" href={appUrl}>Try the demo</a>}
          {isPublicDemo
            ? <a className="btn" href={`mailto:${DEMO_CONTACT}?subject=${encodeURIComponent("Visit request: WMS")}`}>Book a visit</a>
            : <button className={`btn${booking ? "" : " primary"}`} onClick={() => setBooking(b => !b)} aria-expanded={booking}>Book a visit</button>}
        </div>
        {booking && !isPublicDemo && <VisitForm />}
      </section>
      <footer className="lp-foot">
        {isPublicDemo ? <>Made-up data, in your browser only · <a href={consoleUrl}>Console</a></> : <span translate="no">{name}</span>}
      </footer>
    </main>
  );
}

function VisitForm() {
  const [f, setF] = useState({ name: "", company: "", email: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const ok = f.name.trim().length >= 2 && f.company.trim().length >= 2 && emailOk;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try { await siteApi("visit.request", f); setDone(true); }
    catch (err) { setError(err instanceof ApiCallError ? err.message : "Couldn't send it. Try again in a moment."); }
    finally { setBusy(false); }
  };
  if (done) return <p className="lp-done" role="status">Thank you. We'll be in touch to find a day.</p>;
  return (
    <form className="lp-form" onSubmit={submit} noValidate>
      <input className="input" aria-label="Your name" placeholder="Your name" autoComplete="name" value={f.name} onChange={set("name")} />
      <input className="input" aria-label="Warehouse or company" placeholder="Warehouse or company" autoComplete="organization" value={f.company} onChange={set("company")} />
      <input className={`input${f.email && !emailOk ? " invalid" : ""}`} aria-label="Email" placeholder="Email" type="email" autoComplete="email" value={f.email} onChange={set("email")} />
      <textarea className="input" aria-label="Anything we should know (optional)" placeholder="Anything we should know (optional)" rows={3} value={f.message} onChange={set("message")} />
      {/* Left empty by people; bots fill it in */}
      <label className="landing-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
      {error && <p className="note warn" role="alert">{error}</p>}
      <button className="btn primary" disabled={!ok || busy}>{busy ? "Sending…" : "Send"}</button>
    </form>
  );
}
