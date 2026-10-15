import { useState } from "react";
import { AREAS, FACES, rackName } from "../../data/catalog";
import { can } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { differences, scopeTotal } from "../../inventory/count";
import { fmtDay } from "../../inventory/selectors";
import { CountGrid } from "./CountGrid";
import { CountReview } from "./CountReview";
import { useDeleteCount } from "./useDeleteCount";
import type { CountSession } from "../../store/types";


/**
 * #/inventory/count                  counts: start one (owners), continue or review
 * #/inventory/count/<id>             keyboard count entry
 * #/inventory/count/<id>/review      differences, approved by an owner
 */
export function CountTab({ id, sub }: { id?: string; sub?: string }) {
  const { state } = useStore();
  const session = id ? state.counts.find(c => c.id === id) : undefined;
  if (id && !session) return <div className="panel glass"><p>This count doesn't exist any more.</p><a className="link" href="#/inventory/count">All counts ›</a></div>;
  if (session && sub === "review") return <CountReview session={session} />;
  if (session) return <CountGrid session={session} />;
  return <CountList />;
}

function CountList() {
  const { state } = useStore();
  const { me } = useSession();
  const [starting, setStarting] = useState(false);
  const open = state.counts.filter(c => c.status !== "closed");
  const closed = state.counts.filter(c => c.status === "closed");
  return (
    <div className="stack">
      <div className="panel glass">
        <div className="panel-foot">
          <div>
            <h2 className="plain-h">Counts</h2>
            <p className="muted small">Count slot by slot with the keyboard, see the differences, and an owner approves the corrections. Counts start when an owner decides.</p>
          </div>
          {can(me, "start-count") ? <button className="btn primary" onClick={() => setStarting(s => !s)} aria-expanded={starting}>+ Start a count</button>
            : <span className="muted small">Only an owner can start a count.</span>}
        </div>
        {starting && <StartCount onDone={() => setStarting(false)} />}
      </div>
      {open.length > 0 && <div className="rows">{open.map(c => <CountRow key={c.id} c={c} />)}</div>}
      {!open.length && !starting && <p className="muted panel glass">No count in progress.</p>}
      {closed.length > 0 && (
        <details className="panel glass"><summary>Finished counts · {closed.length}</summary><div className="rows">{closed.map(c => <CountRow key={c.id} c={c} />)}</div></details>
      )}
    </div>
  );
}

function CountRow({ c }: { c: CountSession }) {
  const { state } = useStore();
  const { me } = useSession();
  const del = useDeleteCount();
  const total = scopeTotal(c.scope);
  const counted = Object.keys(c.entries).length;
  const { diffs } = differences(c, state.stock);
  const pending = diffs.filter(d => !c.decided?.[d.code]).length;
  const pct = total ? Math.min(100, Math.round((counted / total) * 100)) : 0;
  return (
    <div className="row glass count-row">
      <div>
        <div className="row-title">{c.name} <span className={`tag${c.status === "review" ? " warn" : ""}`}>{c.status === "open" ? "counting" : c.status === "review" ? "waiting for approval" : "finished"}</span>{c.blind && <span className="tag">blind</span>}</div>
        <div className="row-sub">{c.scope.length === FACES.length + AREAS.length ? "Whole warehouse" : `${c.scope.length} rack sides and areas`} · started {fmtDay(c.startedAt)} by {c.startedBy}</div>
      </div>
      <div className="count-prog"><span className="fill-bar"><i style={{ width: `${pct}%` }} /></span><small>{counted.toLocaleString()} counted · {pct}% of slots</small></div>
      <div className="row-fig">{diffs.length} difference{diffs.length === 1 ? "" : "s"}{pending && c.status !== "open" ? ` · ${pending} to decide` : ""}</div>
      <div className="btns">
        {c.status === "open" && <button className="btn small primary" onClick={() => go(`#/inventory/count/${c.id}`)}>Count</button>}
        {(c.status !== "open" || can(me, "approve-count")) && <button className="btn small" onClick={() => go(`#/inventory/count/${c.id}/review`)}>{can(me, "approve-count") && c.status !== "closed" ? "Review" : "Results"}</button>}
        {can(me, "delete-count") && <button className="btn small danger" onClick={() => del(c)} aria-label={`Delete ${c.name}`}>Delete</button>}
      </div>
    </div>
  );
}

function StartCount({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [name, setName] = useState(() => `Count ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  const [whole, setWhole] = useState(true);
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [blind, setBlind] = useState(false);
  const racks = [...new Set(FACES.map(f => f.rack))];
  const flip = (ids: string[]) => setScope(s => { const n = new Set(s); const all = ids.every(i => n.has(i)); for (const i of ids) { if (all) n.delete(i); else n.add(i); } return n; });
  const chosen = whole ? [...FACES.map(f => f.id), ...AREAS.map(a => a.id)] : [...scope];
  const start = () => {
    const id = `count-${state.counts.length + 1}-${Date.now().toString(36)}`;
    dispatch({ type: "count/start", session: { id, name: name.trim() || "Count", scope: chosen, blind, status: "open", startedBy: me.name, startedAt: new Date().toISOString(), entries: {} } });
    toast(`"${name}" started. Everyone can count now.`);
    onDone();
    go(`#/inventory/count/${id}`);
  };
  return (
    <div className="start-count">
      <label className="field"><span>Name</span><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} /></label>
      <div className="segment s2" role="group" aria-label="What to count">
        <button aria-pressed={whole} onClick={() => setWhole(true)}>Whole warehouse</button>
        <button aria-pressed={!whole} onClick={() => setWhole(false)}>Chosen racks</button>
      </div>
      {!whole && (
        <div className="scope-pick">
          {racks.map(r => {
            const ids = FACES.filter(f => f.rack === r).map(f => f.id);
            return (
              <div key={r} className="scope-rack">
                <button className={`chip-btn${ids.every(i => scope.has(i)) ? " on" : ""}`} onClick={() => flip(ids)}>{rackName(r)}</button>
                {ids.length > 1 && ids.map(i => <button key={i} className={`chip-btn small${scope.has(i) ? " on" : ""}`} onClick={() => flip([i])}>{i}</button>)}
              </div>
            );
          })}
          <div className="scope-rack"><button className={`chip-btn${AREAS.every(a => scope.has(a.id)) ? " on" : ""}`} onClick={() => flip(AREAS.map(a => a.id))}>Floor areas</button></div>
        </div>
      )}
      <label className="toggle-row"><input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} /> Blind count: counters don't see what the system expects</label>
      <div className="btns">
        <button className="btn primary" disabled={!chosen.length} onClick={start}>Start counting {chosen.length && !whole ? `${chosen.length} sides` : ""}</button>
        <button className="btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
