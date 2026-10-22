// The product's public page (Lattice). Minimal: a few short pages (#/features, #/how, #/data, #/visit) reached from
// the logo's square, which spins and drops a menu when it's hovered or tapped. "Book a visit" goes to the server on
// the real site (core/site.ts, the console's Visits) and is an email link on the demo site, where "Try the demo" opens
// the WMS beside this page (scripts/site.mjs). Every animation stops when the system asks for less motion.
import { useCallback, useEffect, useRef, useState } from "react";
import { Background } from "../components/Background";
import { LatticeWord } from "../components/LatticeLogo";
import { siteApi, ApiCallError } from "../server/client";
import { DEMO_CONTACT, isPublicDemo } from "../server/demo";
import { FeatureArt, type ArtKind } from "./FeatureArt";

// On the demo site this page is the front page and the WMS itself is in demo/ beside its files (scripts/site.mjs)
const appUrl = import.meta.env.DEV ? "/" : new URL("../", import.meta.url).href;
const consoleUrl = import.meta.env.DEV ? "/ops.html" : new URL("../ops.html", import.meta.url).href;
const mailto = `mailto:${DEMO_CONTACT}?subject=${encodeURIComponent("Visit request: Lattice")}`;

type Page = "home" | "features" | "how" | "data" | "visit";
const PAGES: { id: Page; label: string }[] = [
  { id: "home", label: "Home" }, { id: "features", label: "Features" }, { id: "how", label: "How it works" },
  { id: "data", label: "Your data" }, { id: "visit", label: "Book a visit" },
];
const pageOf = (hash: string): Page => (PAGES.find(p => hash === `#/${p.id}`)?.id ?? "home");

export function Landing() {
  const [page, setPage] = useState<Page>(() => pageOf(location.hash));
  useEffect(() => {
    const on = () => { setPage(pageOf(location.hash)); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [name, setName] = useState("Lattice");
  useEffect(() => {
    if (!isPublicDemo) siteApi<{ productName: string }>("site.info").then(r => setName(r.productName)).catch(() => {});
  }, []);
  useEffect(() => { document.title = page === "home" ? name : `${PAGES.find(p => p.id === page)!.label} · ${name}`; }, [page, name]);
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <>
      <Background moving={!reduced} />
      <main className="lp">
        <header className="lp-top">
          <BoxMenu page={page} />
          <a href="#/" className="lp-word" aria-label="Lattice home"><LatticeWord height={22} /></a>
        </header>
        <div className="lp-page" key={page}>
          {page === "features" ? <Features /> : page === "how" ? <How /> : page === "data" ? <Data /> : page === "visit" ? <Visit /> : <Home />}
        </div>
        <footer className="lp-foot">
          {isPublicDemo ? <>Made-up data, in your browser only · <a href={consoleUrl}>Console</a></> : <span translate="no">{name} · {new Date().getFullYear()}</span>}
        </footer>
      </main>
    </>
  );
}

/** The logo's square: hover (or tap, or focus) and it spins and drops the menu below it */
function BoxMenu({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open, close]);
  useEffect(close, [page, close]);
  const canHover = () => window.matchMedia("(hover: hover)").matches;
  const links = [
    ...PAGES.map(p => ({ href: `#/${p.id === "home" ? "" : p.id}`, label: p.label, current: p.id === page })),
    ...(isPublicDemo ? [{ href: appUrl, label: "Try the demo", current: false }, { href: consoleUrl, label: "Console", current: false }] : []),
  ];
  return (
    <div className={`lp-menu${open ? " open" : ""}`} ref={ref}
      onMouseEnter={() => { if (canHover()) setOpen(true); }}
      onMouseLeave={() => { if (canHover()) setOpen(false); }}
      onBlur={e => { if (!ref.current?.contains(e.relatedTarget as Node)) close(); }}>
      <button type="button" className="lp-box" aria-label="Menu" aria-expanded={open} aria-controls="lp-nav" onClick={() => setOpen(o => !o)} />
      <nav id="lp-nav" className="lp-nav" aria-label="Pages" aria-hidden={!open}>
        {links.map((l, i) => (
          <a key={l.label} href={l.href} aria-current={l.current ? "page" : undefined} tabIndex={open ? 0 : -1} style={{ transitionDelay: open ? `${60 + i * 35}ms` : "0ms" }}>{l.label}</a>
        ))}
      </nav>
    </div>
  );
}

function Home() {
  return (
    <section className="lp-hero">
      <h1>Every pallet, on the map.</h1>
      <p>Warehouse management for warehouses that store for several brands. We set it up at yours.</p>
      <Actions />
      <FeatureArt kind="map" />
    </section>
  );
}

function Actions() {
  return (
    <div className="lp-actions">
      {isPublicDemo && <a className="btn primary" href={appUrl}>Try the demo</a>}
      <a className={`btn${isPublicDemo ? "" : " primary"}`} href="#/visit">Book a visit</a>
    </div>
  );
}

const FEATURES: { kind: ArtKind; title: string; text: string }[] = [
  { kind: "putaway", title: "A slot for every pallet", text: "Next to the same product, then the same brand. Workers get it as a task on their phone or forklift screen." },
  { kind: "fifo", title: "Oldest stock first", text: "Pick lists walk the racks in order, finish open pallets first and never plan expired stock." },
  { kind: "count", title: "Counts in days", text: "Several people count at once. An owner sees every difference and decides what to correct." },
  { kind: "labels", title: "Labels from an order", text: "One label per case, with the brand's logo and best-before, on the sheets you already use." },
  { kind: "chat", title: "Messages that know the racks", text: "Type a slot and it opens on the map. Every order and delivery has its own thread." },
  { kind: "brands", title: "Each brand sees its own", text: "Owners, coordinators and workers, and roles you name. Other brands' stock stays hidden." },
];

function Features() {
  return (
    <section className="lp-section">
      <h2>Features</h2>
      <div className="lp-features">
        {FEATURES.map(f => (
          <article key={f.kind} className="lp-feature">
            <FeatureArt kind={f.kind} />
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </article>
        ))}
      </div>
      <Actions />
    </section>
  );
}

function How() {
  const steps = [
    { title: "We visit", text: "We walk your racks with you, note how your locations are named, and collect your product lists." },
    { title: "We set it up", text: "Your layout, codes, products, label sheets and opening stock go in. We train your team on the floor." },
    { title: "You go live", text: "One full count, loaded in, and the spreadsheets stop that day." },
  ];
  return (
    <section className="lp-section">
      <h2>How it works</h2>
      <ol className="lp-steps">
        {steps.map((s, i) => <li key={s.title} style={{ animationDelay: `${i * 160}ms` }}><span className="lp-step-n">{i + 1}</span><h3>{s.title}</h3><p>{s.text}</p></li>)}
      </ol>
      <Actions />
    </section>
  );
}

function Data() {
  const points = [
    ["Its own database", "Every warehouse has a database of its own, with its own encryption key."],
    ["Backed up nightly", "Each warehouse is saved every night, and you can download a full copy any time."],
    ["Two-step sign-in", "A password and a code from a phone, for everyone."],
    ["You decide who looks in", "Our team sees inside only when an owner allows it, for a set time. Every look is logged."],
    ["Works offline", "Phones keep working in dead spots and catch up when they're back."],
  ];
  return (
    <section className="lp-section">
      <h2>Your data</h2>
      <dl className="lp-points">
        {points.map(([t, d], i) => <div key={t} style={{ animationDelay: `${i * 90}ms` }}><dt>{t}</dt><dd>{d}</dd></div>)}
      </dl>
    </section>
  );
}

function Visit() {
  return (
    <section className="lp-section lp-visit">
      <h2>Book a visit</h2>
      <p className="lp-lead">We come to your warehouse, see how you work and show you Lattice on your own racks.</p>
      {isPublicDemo ? <div className="lp-actions"><a className="btn primary" href={mailto}>Email {DEMO_CONTACT}</a></div> : <VisitForm />}
    </section>
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
