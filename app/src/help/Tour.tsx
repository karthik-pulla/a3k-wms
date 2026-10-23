// The first-time tour: a map of the whole software, then each section of the left menu in turn (lit up where it
// sits), then choosing the home widgets. Shown once per person on this device; Help → "Take the tour" starts it again.
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSession } from "../session";
import { can } from "../auth/permissions";
import { tenant } from "../tenant";
import { WidgetPicker } from "../components/home/WidgetPicker";
import type { HomeCardKind } from "../settings";
import { SECTIONS, type HelpSection } from "./content";

export const sectionsFor = (me: Parameters<typeof can>[0]) => SECTIONS.filter(s => (!s.need || can(me, s.need)) && (!s.not || !can(me, s.not)));

const PRESETS: { name: string; kinds: HomeCardKind[] }[] = [
  { name: "Orders and deliveries", kinds: ["deadlines", "ordersToApprove", "incoming", "toConfirm"] },
  { name: "Stock", kinds: ["stockByBrand", "expiry", "changesToApprove"] },
  { name: "Everything", kinds: ["messages", "outgoing", "deadlines", "ordersToApprove", "incoming", "toConfirm", "expiry", "returns", "changesToApprove", "stockByBrand"] },
  { name: "Nothing", kinds: [] },
];

type Step = { kind: "map" } | { kind: "section"; s: HelpSection } | { kind: "widgets" } | { kind: "done" };

export function Tour({ onClose }: { onClose: () => void }) {
  const { me, settings, update } = useSession();
  const lead = can(me, "use-inbounds");
  const sections = useMemo(() => sectionsFor(me), [me]);
  const steps: Step[] = useMemo(() => [
    { kind: "map" },
    ...sections.filter(s => s.id !== "home").map(s => ({ kind: "section" as const, s })),
    ...(lead ? [{ kind: "widgets" as const }] : []),
    { kind: "done" },
  ], [sections, lead]);
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;

  // The menu item this step is about, lit up where it sits
  const href = step.kind === "section" ? step.s.href : null;
  const [ring, setRing] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!href) { setRing(null); return; }
    const find = () => setRing(document.querySelector(`.modes a[href="${href}"]`)?.getBoundingClientRect() ?? null);
    find();
    window.addEventListener("resize", find);
    return () => window.removeEventListener("resize", find);
  }, [href]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight" && !last) setI(n => n + 1); if (e.key === "ArrowLeft" && i > 0) setI(n => n - 1); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i, last, onClose]);

  const choose = (kinds: HomeCardKind[]) => update({ cards: [...kinds.map(kind => ({ kind, visible: true })), ...settings.cards.filter(c => !kinds.includes(c.kind)).map(c => ({ ...c, visible: false }))] });

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-h">
      {ring ? <div className="tour-ring" style={{ left: ring.left - 6, top: ring.top - 6, width: ring.width + 12, height: ring.height + 12 }} aria-hidden="true" /> : <div className="tour-dim" aria-hidden="true" />}
      <div className={`tour-card glass${step.kind === "map" ? " wide" : ""}`}>
        <p className="tour-count muted small">{i + 1} of {steps.length}</p>
        {step.kind === "map" && <>
          <h2 id="tour-h">Welcome to <span translate="no">{tenant().config.branding.appTitle}</span></h2>
          <p className="muted">A quick map of everything you can use here. The sections are on the left{lead ? "" : " (at the bottom on a phone)"}; each one has tabs at the bottom.</p>
          <div className="tour-map">
            {sections.map(s => (
              <div key={s.id} className="tour-map-cell">
                <b>{s.title}</b><span className="muted small">{s.about}</span>
                <small className="tour-tabs">{s.tabs.map(t => t.name).join(" · ")}</small>
              </div>
            ))}
          </div>
        </>}
        {step.kind === "section" && <>
          <h2 id="tour-h">{step.s.title}</h2>
          <p>{step.s.about}</p>
          <ul className="tour-list">{step.s.tabs.map(t => <li key={t.name}><b>{t.name}</b>: {t.about}</li>)}</ul>
        </>}
        {step.kind === "widgets" && <>
          <h2 id="tour-h">Your home</h2>
          <p className="muted">Home starts clear. Pick what you'd like to see there; you can change it any time with "Widgets".</p>
          <div className="chip-wrap">{PRESETS.map(p => <button key={p.name} className="chip-btn" onClick={() => choose(p.kinds)}>{p.name}</button>)}</div>
          <WidgetPicker cards={settings.cards} onChange={cards => update({ cards })} />
        </>}
        {step.kind === "done" && <>
          <h2 id="tour-h">That's the map</h2>
          <p>Help (the <b>?</b> at the top) has the same map, step-by-step guides for each job, and this tour again.</p>
        </>}
        <div className="btns tour-btns">
          {!last && <button className="btn link-btn" onClick={onClose}>Skip the tour</button>}
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          {last ? <button className="btn primary" autoFocus onClick={onClose}>Start</button> : <button className="btn primary" autoFocus onClick={() => setI(i + 1)}>Next</button>}
        </div>
      </div>
    </div>
  );
}
