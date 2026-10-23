import { useMemo, useState } from "react";
import { useSession } from "../../session";
import { can } from "../../auth/permissions";
import { GUIDES } from "../../help/content";
import { sectionsFor } from "../../help/Tour";

/** #/help: the map of the software, "how do I…" guides that lead to the right screen, and the tour again. */
export function HelpPage({ onTour }: { onTour: () => void }) {
  const { me } = useSession();
  const [q, setQ] = useState("");
  const sections = useMemo(() => sectionsFor(me), [me]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every(w => text.toLowerCase().includes(w));
  const guides = GUIDES.filter(g => (!g.need || can(me, g.need)) && hit(`${g.q} ${g.steps.join(" ")}`));
  const shown = sections.filter(s => hit(`${s.title} ${s.about} ${s.tabs.map(t => `${t.name} ${t.about}`).join(" ")}`));
  return (
    <main className="section help-page">
      <header className="section-head"><h1>Help</h1><p className="crumb">What everything does, and how to do each job</p></header>
      <div className="stack">
      <div className="toolbar">
        <input className="input search grow" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="What do you want to do? e.g. receive, labels, group chat" aria-label="Search help" autoFocus />
        <button className="btn" onClick={onTour}>Take the tour</button>
      </div>
      <section className="panel glass">
        <h2 className="plain-h">How do I…</h2>
        <div className="guide-list">
          {guides.map(g => (
            <details key={g.q} className="guide" open={words.length > 0 && guides.length <= 3}>
              <summary>{g.q}</summary>
              <ol>{g.steps.map(s => <li key={s}>{s}</li>)}</ol>
              <a className="link small" href={g.href}>Go there ›</a>
            </details>
          ))}
          {!guides.length && <p className="muted small">No guide for that. Try other words, or look through the map below.</p>}
        </div>
      </section>
      <section aria-labelledby="map-h" className="stack">
        <h2 id="map-h" className="plain-h">The map</h2>
        <div className="help-map">
          {shown.map(s => (
            <article key={s.id} className="panel glass help-sec">
              <h3><a className="link" href={s.href}>{s.title} ›</a></h3>
              <p className="muted small">{s.about}</p>
              <ul>{s.tabs.map(t => <li key={t.name}><a className="link" href={t.href}>{t.name}</a> <span className="muted small">{t.about}</span></li>)}</ul>
            </article>
          ))}
        </div>
      </section>
      </div>
    </main>
  );
}
