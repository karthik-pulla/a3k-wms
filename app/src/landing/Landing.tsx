// The product's public page: what the WMS does, how a warehouse gets started (we visit and set it up: warehouses
// never sign themselves up), and "Book a visit" (server: core/site.ts; requests show in the ops console under Visits).
import { useEffect, useState } from "react";
import { Background } from "../components/Background";
import { siteApi, ApiCallError } from "../server/client";

const FEATURES = [
  { title: "Put-away that knows your racks", text: "Each pallet gets a slot next to the same product, then the same brand. Workers get the slot as a task on their phone or forklift screen." },
  { title: "Picking, oldest stock first", text: "Orders from PDFs, emails or typed in. The pick list walks the racks in order, uses up open pallets first and never plans expired stock." },
  { title: "Counts in days, not weeks", text: "Several people count at once from the keyboard. An owner sees every difference and decides what to correct." },
  { title: "Case labels from an order", text: "One label per case with the right logo, best-before and footer, on the label sheets you already use." },
  { title: "Messages that know the warehouse", text: "Type a slot or a product and it becomes a chip that opens the map. Order and delivery threads for the people who handle them." },
  { title: "Each brand sees its own", text: "Owners, coordinators and workers, plus roles you name yourself. A brand's stock is hidden from people who don't handle it." },
];
const STEPS = [
  { title: "We visit", text: "We walk your racks with you, note how your locations are named, collect your product lists and see how orders come in." },
  { title: "We set it up", text: "Your layout, location codes, products, label sheets and opening stock go in. We train your team on the floor." },
  { title: "You go live", text: "One full count, loaded in, and the spreadsheets stop that day." },
];
const SIZES = ["Under 500 pallet spots", "500–2,000", "2,000–5,000", "Over 5,000", "Not sure"];

export function Landing() {
  const [name, setName] = useState("WMS");
  useEffect(() => { siteApi<{ productName: string }>("site.info").then(r => { setName(r.productName); document.title = `${r.productName}: warehouse management`; }).catch(() => {}); }, []);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <>
      <Background moving={!reduced} />
      <div className="landing">
        <header className="landing-top">
          <span className="landing-name" translate="no">{name}</span>
          <a className="btn small primary" href="#visit">Book a visit</a>
        </header>
        <section className="landing-hero">
          <p className="landing-kicker">Warehouse management, set up at your warehouse</p>
          <h1>Every pallet, <em>on the map.</em></h1>
          <p className="landing-lead">For warehouses that store goods for several brands: put-away, picking, counts, labels and your team's messages, on computers, phones and forklift screens. It runs in the browser: nothing to install.</p>
          <div className="btns"><a className="btn primary big" href="#visit">Book a visit</a><a className="btn big" href="#how">How it starts</a></div>
        </section>
        <section className="landing-grid" aria-label="What it does">
          {FEATURES.map(f => <article key={f.title} className="glass landing-card"><h3>{f.title}</h3><p>{f.text}</p></article>)}
        </section>
        <section id="how" className="landing-how">
          <h2>How it starts</h2>
          <ol className="landing-steps">
            {STEPS.map((s, i) => <li key={s.title} className="glass landing-card"><span className="landing-step">{i + 1}</span><h3>{s.title}</h3><p>{s.text}</p></li>)}
          </ol>
        </section>
        <section className="glass landing-trust">
          <h2>Your data stays yours</h2>
          <p>Every warehouse has its own database and its own encryption key, backed up every night. Sign-in uses a password and a code from a phone. Our team looks in only when an owner allows it, for a set time (in an emergency, every owner is emailed at once), and every look is logged. Download a full copy whenever you like.</p>
        </section>
        <VisitForm name={name} />
        <footer className="landing-foot muted small"><span translate="no">{name}</span> · {new Date().getFullYear()}</footer>
      </div>
    </>
  );
}

function VisitForm({ name }: { name: string }) {
  const [f, setF] = useState({ name: "", company: "", email: "", phone: "", location: "", size: "", when: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
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
  return (
    <section id="visit" className="glass landing-visit">
      {done ? (
        <div className="landing-thanks" role="status">
          <h2>Thank you</h2>
          <p>We'll get in touch to find a day that suits you.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <h2>Book a visit</h2>
          <p className="muted">We come to your warehouse, see how you work and show you <span translate="no">{name}</span> on your own racks.</p>
          <div className="landing-fields">
            <label className="field"><span>Your name</span><input className="input" autoComplete="name" value={f.name} onChange={set("name")} required /></label>
            <label className="field"><span>Warehouse or company</span><input className="input" autoComplete="organization" value={f.company} onChange={set("company")} required /></label>
            <label className="field"><span>Email</span><input className={`input${f.email && !emailOk ? " invalid" : ""}`} type="email" autoComplete="email" value={f.email} onChange={set("email")} required /></label>
            <label className="field"><span>Phone (optional)</span><input className="input" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} /></label>
            <label className="field"><span>Where is the warehouse?</span><input className="input" placeholder="City, state" value={f.location} onChange={set("location")} /></label>
            <label className="field"><span>Size</span>
              <select className="input" value={f.size} onChange={set("size")}><option value="">Choose…</option>{SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            </label>
            <label className="field wide"><span>When suits you? (optional)</span><input className="input" placeholder="e.g. weekday mornings, the week of the 9th" value={f.when} onChange={set("when")} /></label>
            <label className="field wide"><span>Anything we should know? (optional)</span><textarea className="input" rows={4} placeholder="How many brands you store, how orders come in, what you use today…" value={f.message} onChange={set("message")} /></label>
            {/* Left empty by people; bots fill it in */}
            <label className="landing-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
          </div>
          {error && <p className="note warn" role="alert">{error}</p>}
          <button className="btn primary big" disabled={!ok || busy}>{busy ? "Sending…" : "Book a visit"}</button>
        </form>
      )}
    </section>
  );
}
