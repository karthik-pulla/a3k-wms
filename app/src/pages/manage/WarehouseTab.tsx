import { useState } from "react";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useIdentity } from "../../auth/identity";
import { useToast } from "../../components/Toast";
import { tenant } from "../../tenant";
import { useAction } from "../warehouse/useApi";
import { RULE_NAMES } from "../../outbound/plan";
import { activeNotices, noticeId } from "../../store/notices";
import { warehouseName } from "../../store/warehouse";
import type { PickRule } from "../../store/types";

const RULE_ABOUT: Record<PickRule, string> = {
  fifo: "First in, first out: the stock that arrived first leaves first. Most dry goods.",
  fefo: "First expired, first out: the earliest best-before leaves first, whenever it arrived. Food with dates.",
  lifo: "Last in, first out: the newest stock leaves first. Goods that don't age, stacked deep.",
};

/** The warehouse itself: its name, how orders are picked, and announcements on everyone's home */
export function WarehouseTab() {
  return <div className="stack manage-grid"><NamePanel /><PickingPanel /><NoticesPanel /></div>;
}

function NamePanel() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const { kind } = useIdentity();
  const act = useAction();
  const toast = useToast();
  const [name, setName] = useState(warehouseName(state));
  const [busy, setBusy] = useState(false);
  const clean = name.trim().replace(/\s+/g, " ");
  const changed = clean !== warehouseName(state);
  const save = async () => {
    if (clean.length < 2 || clean.length > 60) { toast("A name of 2–60 characters."); return; }
    setBusy(true);
    try {
      if (kind === "server") {
        // On the server the name is part of the warehouse's settings (sign-in screen, emails, the authenticator app)
        const c = tenant().config;
        const config = { ...c, tenant: { ...c.tenant, name: clean }, branding: { ...c.branding, appTitle: clean } };
        const r = await act("setup.saveSettings", { config });
        if (!r.ok) { toast(r.error); return; }
        c.tenant.name = clean; c.branding.appTitle = clean;
      }
      dispatch({ type: "warehouse/settings", patch: { name: clean }, by: me.name });
      document.title = clean;
      toast("Name saved.");
    } finally { setBusy(false); }
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Name</h2>
      <p className="muted small">Shown at the top of every screen{kind === "server" ? ", on the sign-in page, in emails and in the authenticator app" : ""}.</p>
      <div className="link-row"><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} aria-label="Warehouse name" translate="no" /><button className="btn primary" disabled={!changed || busy} onClick={() => void save()}>Save</button></div>
    </section>
  );
}

function PickingPanel() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const rule = state.settings?.pickRule ?? "fifo";
  const openFirst = state.settings?.openFirst !== false;
  const set = (patch: { pickRule?: PickRule; openFirst?: boolean }) => { dispatch({ type: "warehouse/settings", patch, by: me.name }); toast("Picking rule saved. New orders use it."); };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Picking</h2>
      <p className="muted small">Which pallets an approved order is picked from. Expired stock is never picked. An order can still be planned another way on its page.</p>
      <div className="rule-cards" role="radiogroup" aria-label="Picking rule">
        {(Object.keys(RULE_NAMES) as PickRule[]).map(r => (
          <button key={r} type="button" role="radio" aria-checked={rule === r} className={`rule-card${rule === r ? " on" : ""}`} onClick={() => rule !== r && set({ pickRule: r })}>
            <b>{r.toUpperCase()}</b><span>{RULE_NAMES[r].replace(/ \(.*\)$/, "")}</span><small className="muted">{RULE_ABOUT[r]}</small>
          </button>
        ))}
      </div>
      <label className="toggle-row"><input type="checkbox" checked={openFirst} onChange={e => set({ openFirst: e.target.checked })} /> Finish pallets already opened before opening a full one (fewer partial pallets)</label>
      {state.settings?.updatedBy && <p className="muted small">Last changed by {state.settings.updatedBy}{state.settings.updatedAt ? `, ${new Date(state.settings.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}.</p>}
    </section>
  );
}

function NoticesPanel() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [until, setUntil] = useState("");
  const live = activeNotices(state);
  const old = (state.notices ?? []).filter(n => !live.includes(n)).slice(0, 10);
  const post = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    dispatch({ type: "notice/post", notice: { id: noticeId(), text: t.slice(0, 500), by: me.name, at: new Date().toISOString(), urgent: urgent || undefined, until: until || undefined } });
    setText(""); setUrgent(false); setUntil("");
    toast("Posted. It's on everyone's home and Work screens.");
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Announcements</h2>
      <p className="muted small">On top of everyone's home and Work screens. People can hide one on their device; urgent ones stay until they end.</p>
      <form className="stack notice-form" onSubmit={post}>
        <textarea className="input" rows={3} maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Door 2 is closed Friday for repairs; use Door 3." aria-label="Announcement" />
        <div className="link-row">
          <label className="toggle-row"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> Urgent</label>
          <label className="log-date">Until <input className="input" type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={e => setUntil(e.target.value)} /></label>
          <button className="btn primary" disabled={!text.trim()}>Post</button>
        </div>
      </form>
      <ul className="notice-list">
        {live.map(n => (
          <li key={n.id}>
            <span><span translate="no">{n.text}</span><small className="muted block">{n.urgent ? "Urgent · " : ""}{n.by} · {new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{n.until ? ` · until ${n.until}` : " · no end date"}</small></span>
            <button className="btn small" onClick={() => { dispatch({ type: "notice/remove", id: n.id }); toast("Taken down."); }}>Take down</button>
          </li>
        ))}
        {!live.length && <li className="muted small">No announcements showing.</li>}
      </ul>
      {old.length > 0 && <details className="small"><summary className="muted">Ended · {old.length}</summary><ul className="notice-list">{old.map(n => <li key={n.id}><span className="muted" translate="no">{n.text}</span><button className="btn small" onClick={() => dispatch({ type: "notice/remove", id: n.id })}>Remove</button></li>)}</ul></details>}
    </section>
  );
}
