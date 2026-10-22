// The product's public page (Lattice). Minimal pages (#/features, #/how, #/data, #/visit) reached from the logo's
// square, which spins and drops a menu when it's hovered or tapped (the page behind fades). Sections slide in as you
// scroll; there's a warehouse to click around, a picking rule to switch, a timeline that fills, questions that open and
// a "who sees what" switch. "Book a visit" goes to the server on the real site (core/site.ts, the console's Visits) and
// is an email link on the demo site, where "Try the demo" opens the WMS beside this page (scripts/site.mjs).
// Everything stays still when the system asks for less motion. Every claim here is something the WMS does.
import { useCallback, useEffect, useRef, useState } from "react";
import { Background } from "../components/Background";
import { LatticeWord } from "../components/LatticeLogo";
import { siteApi, ApiCallError } from "../server/client";
import { DEMO_CONTACT, isPublicDemo } from "../server/demo";
import { FeatureArt, type ArtKind } from "./FeatureArt";
import { PlayMap } from "./PlayMap";
import { Reveal, useInMiddle } from "./Reveal";

// On the demo site this page is the front page and the WMS itself is in demo/ beside its files (scripts/site.mjs)
const appUrl = import.meta.env.DEV ? "/" : new URL("../", import.meta.url).href;
const consoleUrl = import.meta.env.DEV ? "/ops.html" : new URL("../ops.html", import.meta.url).href;
const mailto = `mailto:${DEMO_CONTACT}?subject=${encodeURIComponent("Visit request: Lattice")}`;
const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

type Page = "home" | "features" | "how" | "data" | "visit";
const PAGES: { id: Page; label: string }[] = [
  { id: "home", label: "Home" }, { id: "features", label: "Features" }, { id: "how", label: "How it works" },
  { id: "data", label: "Your data" }, { id: "visit", label: "Book a visit" },
];
const pageOf = (hash: string): Page => (PAGES.find(p => hash === `#/${p.id}`)?.id ?? "home");

export function Landing() {
  const [page, setPage] = useState<Page>(() => pageOf(location.hash));
  const [menuOpen, setMenuOpen] = useState(false);
  // Once the page is scrolled, the logo sits on a frosted pill so it stays readable over what's beneath
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
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
      <main className={`lp${menuOpen ? " menu-open" : ""}${scrolled ? " scrolled" : ""}`}>
        <header className="lp-top">
          <BoxMenu page={page} onOpen={setMenuOpen} />
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
function BoxMenu({ page, onOpen }: { page: Page; onOpen: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpen(open), [open, onOpen]);
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

function Actions() {
  return (
    <div className="lp-actions">
      {isPublicDemo && <a className="btn primary" href={appUrl}>Try the demo</a>}
      <a className={`btn${isPublicDemo ? "" : " primary"}`} href="#/visit">Book a visit</a>
    </div>
  );
}

// ---------- Home ----------
function Home() {
  const places = [
    { title: "In the office", text: "Deliveries, orders, labels, counts and reports, on a computer." },
    { title: "On the floor", text: "Tasks, moves and packing on a phone, and it keeps working where the Wi-Fi drops." },
    { title: "On the forklift", text: "One task at a time in very large type, on a screen mounted on the forklift." },
  ];
  return (
    <>
      <section className="lp-hero">
        <h1>Every pallet, on the map.</h1>
        <p>Warehouse management for warehouses that store for several brands. We set it up at yours.</p>
        <Actions />
      </section>
      <Reveal as="section" className="lp-block">
        <h2 className="lp-h3">The whole warehouse on one screen</h2>
        <p className="lp-lead">Every slot, what's on it and since when. Hover a slot, or pick a brand to see where its pallets are.</p>
        <PlayMap />
      </Reveal>
      <section className="lp-block">
        <Reveal><h2 className="lp-h3">Made for every part of the job</h2></Reveal>
        <div className="lp-cols">
          {places.map((p, i) => <Reveal key={p.title} delay={i * 90} className="lp-col"><h3>{p.title}</h3><p>{p.text}</p></Reveal>)}
        </div>
      </section>
      <Reveal as="section" className="lp-block lp-cta">
        <h2 className="lp-h3">See it on your own racks.</h2>
        <Actions />
      </Reveal>
    </>
  );
}

// ---------- Features ----------
const FEATURES: { kind: ArtKind; title: string; text: string; more: string[] }[] = [
  { kind: "putaway", title: "A slot for every pallet", text: "Each pallet gets a slot next to the same product, then the same brand. Workers get it as a task on their phone or forklift screen.", more: ["Stock counts only once a worker confirms it's in the slot", "Choose another slot, with the reason logged", "No room on the racks: the floor beside the rest of that product"] },
  { kind: "picking", title: "Picking, your way", text: "Choose how picks are planned for each order: oldest arrival first, or finish open pallets first to keep partial pallets down. Try the switch.", more: ["Expired stock is never planned", "Pick lists walk the racks in order", "Fewer cases than planned? It plans the rest from the next pallet"] },
  { kind: "count", title: "Counts in days, not weeks", text: "Several people count at once from the keyboard. An owner sees every difference and decides what to correct.", more: ["The whole warehouse or chosen racks", "Blind counts if you want them", "Uncounted slots never change"] },
  { kind: "labels", title: "Case labels from an order", text: "One label per case, with the brand's logo and each pallet's best-before, on the label sheets you already use.", more: ["From an order, a PDF or by hand", "Logos and footers per brand", "Start part-way down a used sheet"] },
  { kind: "chat", title: "Messages that know the racks", text: "Type a slot and it opens on the map; type a product and every pallet of it lights up.", more: ["A thread for every order and delivery", "Mention people, groups and products", "Urgent flags for what can't wait"] },
  { kind: "brands", title: "Each brand sees its own", text: "Owners, coordinators and workers, plus roles you name yourself. People see only the brands they handle.", more: ["Big changes stay with owners", "Every change logged: what, who and when", "Direct stock changes need a reason"] },
];

function Features() {
  return (
    <section className="lp-section">
      <Reveal><h2>Features</h2><p className="lp-lead">Hover a panel to see it work.</p></Reveal>
      <div className="lp-features">
        {FEATURES.map((f, i) => <Feature key={f.kind} f={f} delay={(i % 2) * 90} />)}
      </div>
      <Reveal className="lp-block lp-cta"><Actions /></Reveal>
    </section>
  );
}

/** A feature panel: its animation runs while it's hovered or focused (on phones: while it's mid-screen) */
function Feature({ f, delay }: { f: (typeof FEATURES)[number]; delay: number }) {
  const [hover, setHover] = useState(false);
  const touch = typeof window !== "undefined" && !canHover();
  const { ref, inMiddle } = useInMiddle<HTMLDivElement>(touch);
  return (
    <Reveal as="article" delay={delay} className="lp-feature-wrap">
      <div ref={ref} className={`lp-feature${hover || inMiddle ? " active" : ""}`} tabIndex={0}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
        <FeatureArt kind={f.kind} />
        <div className="lp-feature-text">
          <h3>{f.title}</h3>
          <p>{f.text}</p>
          <ul>{f.more.map(m => <li key={m}>{m}</li>)}</ul>
        </div>
      </div>
    </Reveal>
  );
}

// ---------- How it works ----------
function How() {
  const steps = [
    { title: "We visit", text: "We walk your racks with you and see how your team works.", more: ["How your locations are named", "Your product lists, brand by brand", "How orders come in today"] },
    { title: "We set it up", text: "Everything goes in the way your warehouse already works.", more: ["Your layout and your own location codes", "Products, label sheets, people and roles", "Your team trained on the floor"] },
    { title: "You go live", text: "One full count, loaded in, and the spreadsheets stop that day.", more: ["Everyone signs in with their own account", "Stock, orders and tasks in one place", "Every change logged from the first day"] },
  ];
  const need = ["Computers or tablets for the office", "Phones for the floor: the warehouse's or your team's own", "Your usual printer and label sheets", "Wi-Fi in the building (dead spots are fine)"];
  const faq = [
    ["Can we keep our location codes?", "Yes. The WMS reads and writes codes in your own format, set up on the visit."],
    ["Do we need special hardware?", "No: computers, tablets and phones you already have, and your usual printer for labels."],
    ["What if the Wi-Fi drops?", "Phones keep working and send their changes once they're back on."],
    ["Can someone see only one brand's stock?", "Yes. Each person can be limited to the brands they handle; other stock shows as hidden."],
    ["How do orders come in?", "Typed in, read from a PDF, or emailed to your own order address. Each becomes a draft that someone approves."],
  ];
  return (
    <section className="lp-section">
      <Reveal><h2>How it works</h2><p className="lp-lead">Warehouses don't sign up on a website. We come to you.</p></Reveal>
      {/* The line draws across as it comes into view, lighting each step as it passes */}
      <Reveal className="lp-timeline-wrap">
        <ol className="lp-timeline">
          {steps.map((s, i) => (
            <li key={s.title} style={{ ["--i" as string]: i }}>
              <span className="lp-step-n">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <ul>{s.more.map(m => <li key={m}>{m}</li>)}</ul>
            </li>
          ))}
        </ol>
      </Reveal>
      <Reveal className="lp-block">
        <h2 className="lp-h3">What you'll need</h2>
        <ul className="lp-ticks">{need.map(n => <li key={n}>{n}</li>)}</ul>
      </Reveal>
      <Reveal className="lp-block">
        <h2 className="lp-h3">Questions</h2>
        <div className="lp-faq">{faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </Reveal>
      <Reveal className="lp-block lp-cta"><Actions /></Reveal>
    </section>
  );
}

// ---------- Your data ----------
const ROLES = {
  owner: { label: "Owner", line: "Everything, with a review step and a reason for direct stock changes.", sees: ["In-bounds", "Inventory", "Out-bounds", "Tasks", "Messages", "Logs", "Team and settings"] },
  coordinator: { label: "Coordinator", line: "Confirms deliveries, approves orders, prints labels and gives out work.", sees: ["In-bounds", "Inventory", "Out-bounds", "Tasks", "Messages", "Logs"] },
  worker: { label: "Worker", line: "Moves pallets with the slot the WMS gives, and packs the orders given to them.", sees: ["Work", "Inventory", "Messages"] },
} as const;
const SECTIONS = ["Work", "In-bounds", "Inventory", "Out-bounds", "Tasks", "Messages", "Logs", "Team and settings"];

function Data() {
  const points = [
    ["Its own database", "Every warehouse has a database of its own, with its own encryption key."],
    ["Backed up nightly", "Each warehouse is saved every night, and you can download a full copy any time."],
    ["Two-step sign-in", "A password and a code from a phone, for everyone."],
    ["Works offline", "Phones keep working in dead spots and catch up when they're back."],
  ];
  const [role, setRole] = useState<keyof typeof ROLES>("coordinator");
  const support = ["We ask to look in", "An owner says yes", "For a set time", "Every look is logged"];
  return (
    <section className="lp-section">
      <Reveal><h2>Your data</h2><p className="lp-lead">Your stock, your orders, your people: kept apart from every other warehouse.</p></Reveal>
      <dl className="lp-points">
        {points.map(([t, d], i) => <Reveal key={t} delay={i * 70}><dt>{t}</dt><dd>{d}</dd></Reveal>)}
      </dl>
      <Reveal className="lp-block">
        <h2 className="lp-h3">Who sees what</h2>
        <div className="lp-rule lp-roles" role="group" aria-label="Role">
          {(Object.keys(ROLES) as (keyof typeof ROLES)[]).map(r => <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLES[r].label}</button>)}
        </div>
        <p className="lp-role-line" key={role}>{ROLES[role].line}</p>
        <ul className="lp-sees">
          {SECTIONS.map(s => { const yes = (ROLES[role].sees as readonly string[]).includes(s); return <li key={s} className={yes ? "yes" : "no"}><i aria-hidden="true" />{s}<span className="sr">{yes ? "" : " (not shown)"}</span></li>; })}
        </ul>
        <p className="lp-small">Roles are switches an owner can change, and each person can be limited to the brands they handle.</p>
      </Reveal>
      <Reveal className="lp-block">
        <h2 className="lp-h3">When our team looks in</h2>
        <ol className="lp-flow">{support.map((s, i) => <li key={s} style={{ transitionDelay: `${i * 160}ms` }}><span>{i + 1}</span>{s}</li>)}</ol>
        <p className="lp-small">In an emergency, access opens at once and every owner is emailed.</p>
      </Reveal>
    </section>
  );
}

// ---------- Book a visit ----------
function Visit() {
  const next = ["We reply to find a day that suits you", "We visit and look at how you work", "We show you Lattice on your own racks"];
  return (
    <section className="lp-section lp-visit">
      <Reveal><h2>Book a visit</h2><p className="lp-lead">We come to your warehouse, see how you work and show you Lattice on your own racks.</p></Reveal>
      <Reveal className="lp-visit-body">
        {isPublicDemo ? <div className="lp-actions"><a className="btn primary" href={mailto}>Email {DEMO_CONTACT}</a></div> : <VisitForm />}
        <ol className="lp-next">{next.map((n, i) => <li key={n}><span>{i + 1}</span>{n}</li>)}</ol>
      </Reveal>
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
