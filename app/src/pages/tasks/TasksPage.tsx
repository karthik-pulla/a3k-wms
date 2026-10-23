import { t as tr } from "../../i18n";
import { useMemo, useState } from "react";
import { SubTabs } from "../../components/SubTabs";
import { manualLabel, roughAgo } from "../../chat/presence";
import { newId } from "../../store/warehouse";
import { EXAMPLE_SLOT, isFloor, productById } from "../../data/catalog";
import { can, canSeeClient } from "../../auth/permissions";
import { normalizeLocation } from "../../chat/refs";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../../components/Toast";
import { TaskCard } from "../../components/tasks/TaskCard";
import { PresenceDot } from "../../components/chat/Presence";
import { fromAssignValue, isOpen, nextSlot, occupied, taskId, teamsOf } from "../../store/tasks";
import { orderCases, pickedCases, statusOf } from "../../outbound/plan";
import { dueText, dueTone } from "../../outbound/labels";
import type { State, StockLine, Task, User, WorkTeam } from "../../store/types";

const ROLE: Record<User["role"], string> = { owner: "Owner", coordinator: "Coordinator", worker: "Worker" };
/** People tasks can go to: workers first, then coordinators (owners run the office, not the forklifts) */
const crew = (state: State) => state.chat.users.filter(u => u.role !== "owner").sort((a, b) => Number(a.role !== "worker") - Number(b.role !== "worker") || a.name.localeCompare(b.name));

/**
 * #/tasks: every pallet task, who has it, orders to give out for packing, and new move tasks.
 * #/tasks/workers: each person's status and what they're doing. #/tasks/teams: groups of workers tasks can go to.
 */
export function TasksPage({ parts = [] }: { parts?: string[] }) {
  const { state } = useStore();
  const { me } = useSession();
  const [tab = ""] = parts;
  if (!can(me, "assign-work")) return <main className="section"><div className="panel glass"><p>Tasks are given out by coordinators. Your own tasks are on your Work screen.</p><a className="link" href="#/work">Work ›</a></div></main>;
  const busy = crew(state).filter(u => state.tasks.some(t => t.status === "doing" && t.assignee === u.id)).length;
  return (
    <main className="section tasks-page">
      <header className="section-head"><h1>Tasks</h1><p className="crumb">{tab === "workers" ? "What everyone is doing" : tab === "teams" ? "Teams of workers" : "Pallet moves and packing for the workers"}</p></header>
      {tab === "workers" ? <WorkersTab /> : tab === "teams" ? <TeamsTab /> : <TaskBoard />}
      <SubTabs base="tasks" current={tab} tabs={[{ id: "", label: "Tasks" }, { id: "workers", label: "Workers", badge: busy }, { id: "teams", label: "Teams" }]} />
    </main>
  );
}

function TaskBoard() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const [show, setShow] = useState<"open" | "done">("open");
  const workers = crew(state);
  const today = new Date().toISOString().slice(0, 10);
  const open = state.tasks.filter(isOpen).sort((a, b) => (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) || a.createdAt.localeCompare(b.createdAt));
  const done = state.tasks.filter(t => t.status === "done" && t.doneAt?.startsWith(today));
  const orders = state.orders.filter(o => ["approved", "picking"].includes(statusOf(o)) && canSeeClient(me, o.client)).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat glass"><span className="stat-n warn">{open.filter(t => t.status === "open").length}</span><span className="stat-l">waiting<small>{open.filter(t => !t.assignee && !t.team).length} not given to anyone</small></span></div>
        <div className="stat glass"><span className="stat-n">{open.filter(t => t.status === "doing").length}</span><span className="stat-l">in progress</span></div>
        <div className="stat glass"><span className="stat-n ok">{done.length}</span><span className="stat-l">done today</span></div>
        <div className="stat glass"><span className="stat-n">{orders.length}</span><span className="stat-l">orders to pack<small>{orders.filter(o => !o.assignee).length} not given out</small></span></div>
      </div>

      <div className="tasks-layout">
        <section className="stack">
          <NewMove />
          <div className="chip-wrap">
            <button className={`chip-btn${show === "open" ? " on" : ""}`} onClick={() => setShow("open")}>Open · {open.length}</button>
            <button className={`chip-btn${show === "done" ? " on" : ""}`} onClick={() => setShow("done")}>Done today · {done.length}</button>
          </div>
          <div className="task-list">
            {(show === "open" ? open : done).map(t => <TaskCard key={t.id} task={t} workers={workers} />)}
            {!(show === "open" ? open : done).length && <p className="muted panel glass">{show === "open" ? "No open tasks. Confirming a delivery creates put-away tasks; moves can be created above." : "Nothing done yet today."}</p>}
          </div>
        </section>

        <aside className="stack">
          <section className="panel glass">
            <h2 className="plain-h">Workers <a className="link small" href="#/tasks/workers">What they're doing ›</a></h2>
            <ul className="worker-list">
              {workers.map(w => {
                const mine = open.filter(t => t.assignee === w.id);
                const did = done.filter(t => t.doneBy === w.name).length;
                const packing = orders.filter(o => o.assignee === w.id).length;
                return <li key={w.id}><PresenceDot userId={w.id} /><a className="link" href="#/tasks/workers"><b>{w.name}</b></a><small className="muted">{mine.length} task{mine.length === 1 ? "" : "s"} · {packing} order{packing === 1 ? "" : "s"} · {did} done today</small></li>;
              })}
              {!workers.length && <li className="muted small">No workers yet. Approve account requests as Worker on the Account page.</li>}
            </ul>
          </section>
          <section className="panel glass">
            <h2 className="plain-h">Orders to pack</h2>
            <ul className="pack-list">
              {orders.map(o => (
                <li key={o.id}>
                  <a className="link" href={`#/outbounds/orders/${encodeURIComponent(o.id)}`}><b>{o.id}</b> · {o.store}</a>
                  <small className={`due-tag ${dueTone(o)}`}>{dueText(o)}</small>
                  <small className="muted">{pickedCases(o)}/{orderCases(o)} cases picked</small>
                  <select className="input" value={o.assignee ?? ""} onChange={e => dispatch({ type: "order/assign", id: o.id, assignee: e.target.value || undefined })} aria-label={`Who packs ${o.id}`}>
                    <option value="">Not given out</option>
                    {workers.filter(w => canSeeClient(w, o.client)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </li>
              ))}
              {!orders.length && <li className="muted small">No approved orders waiting to be packed.</li>}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * A move task: a pallet from a location, to the slot the WMS suggests (a coordinator may choose another, with a
 * reason). Where several pallets share a spot (floor, mixed), say which one: its number, the products on it (ticked),
 * or how to recognise it.
 */
function NewMove() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [openForm, setOpenForm] = useState(false);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [assign, setAssign] = useState(""), [reason, setReason] = useState("");
  const [pallet, setPallet] = useState("");
  const [skip, setSkip] = useState<number[]>([]);
  const fromCode = normalizeLocation(from);
  const all = fromCode ? state.stock[fromCode] ?? [] : [];
  const lines: StockLine[] = all.filter((_, i) => !skip.includes(i));
  const busy = fromCode ? state.tasks.some(t => isOpen(t) && (t.from === fromCode || t.to === fromCode)) : false;
  const suggestion = useMemo(() => (fromCode && all.length ? nextSlot(state, fromCode) : ""), [state, fromCode, all.length]);
  const toCode = to.trim() ? normalizeLocation(to) : suggestion;
  const toBusy = toCode ? !!occupied(state)[toCode]?.length : true;
  // A rack slot holds one pallet (mixed or not); a floor spot or area can hold several, so say which one moves
  const several = all.length > 1 && !!fromCode && isFloor(fromCode);
  const ok = !!fromCode && lines.length > 0 && !busy && !!toCode && !toBusy && toCode !== fromCode && !!reason.trim() && (!several || !!pallet.trim() || skip.length > 0);
  const workers = crew(state);
  const name = (l: StockLine) => { const p = productById(l.productId); return `${p?.code ?? "?"} ${p?.name ?? ""}`; };
  const reset = () => { setOpenForm(false); setFrom(""); setTo(""); setReason(""); setAssign(""); setPallet(""); setSkip([]); };
  if (!openForm) return <button className="btn" onClick={() => setOpenForm(true)}>+ Move a pallet (create a task)</button>;
  return (
    <form className="panel glass new-move" onSubmit={e => {
      e.preventDefault(); if (!ok) return;
      const task: Task = { id: taskId(), kind: "move", status: "open", from: fromCode!, to: toCode!, lines, reason: reason.trim(), palletNote: pallet.trim() || undefined, ...fromAssignValue(assign), createdBy: me.name, createdAt: new Date().toISOString() };
      dispatch({ type: "task/create", task });
      toast(`Task created: ${fromCode} → ${toCode}.`);
      reset();
    }}>
      <h2 className="plain-h">Move a pallet</h2>
      <div className="facts">
        <label className="fact"><span>From</span><input className={`input${from && !fromCode ? " invalid" : ""}`} value={from} onChange={e => { setFrom(e.target.value); setSkip([]); }} placeholder={`e.g. ${EXAMPLE_SLOT}`} autoFocus /></label>
        <label className="fact"><span>To</span><input className={`input${to && !normalizeLocation(to) ? " invalid" : ""}`} value={to} onChange={e => setTo(e.target.value)} placeholder={suggestion ? `WMS: ${suggestion}` : "WMS suggests a slot"} /></label>
        <label className="fact"><span>Which pallet</span><input className="input" value={pallet} onChange={e => setPallet(e.target.value)} maxLength={120} placeholder={several ? "Needed here: number, products or how it looks" : "e.g. pallet 2, the shrink-wrapped one"} /></label>
        <label className="fact"><span>Give to</span><select className="input" value={assign} onChange={e => setAssign(e.target.value)}>
          <option value="">Any worker</option>
          {(state.teams ?? []).length > 0 && <optgroup label="Teams">{(state.teams ?? []).map(x => <option key={x.id} value={`team:${x.id}`}>Team: {x.name} ({x.members.length})</option>)}</optgroup>}
          <optgroup label="People">{workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
        </select></label>
        <label className="fact"><span>Reason</span><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. consolidating partial pallets" /></label>
      </div>
      {several && (
        <fieldset className="pallet-pick">
          <legend className="small">{fromCode} is a floor spot with {all.length} lines on it. Tick what's on the pallet to move:</legend>
          {all.map((l, i) => (
            <label key={i} className="toggle-row small"><input type="checkbox" checked={!skip.includes(i)} onChange={e => setSkip(sk => (e.target.checked ? sk.filter(x => x !== i) : [...sk, i]))} /> <b>{name(l)}</b> × {l.cases}{l.lot ? ` · lot ${l.lot}` : ""}{l.bestBefore ? ` · BB ${l.bestBefore}` : ""}</label>
          ))}
        </fieldset>
      )}
      <p className="small muted">
        {!fromCode ? "Type where the pallet is now." : !all.length ? `${fromCode} is empty.` : busy ? `${fromCode} already has an open task.` : !lines.length ? "Tick at least one line."
          : `${lines.map(l => `${name(l)} × ${l.cases}`).join(" + ")} → ${toCode ?? "?"}${to.trim() ? " (your choice)" : " (WMS suggestion: nearest free slot)"}${toBusy && toCode ? ` · ${toCode} isn't free` : ""}${several && !pallet.trim() && !skip.length ? " · say which pallet" : ""}`}
      </p>
      <div className="btns"><button className="btn primary" disabled={!ok}>Create task</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
    </form>
  );
}

/** Each person: status (online, on forklift, on break…), the task they're on, what's waiting for them, and today's work */
function WorkersTab() {
  const { state } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const people = crew(state);
  const rows = people.map(u => {
    const tasks = state.tasks.filter(t => isOpen(t) && t.assignee === u.id);
    const doing = tasks.find(t => t.status === "doing");
    const teamTasks = state.tasks.filter(t => isOpen(t) && !t.assignee && t.team && teamsOf(state, u.id).some(x => x.id === t.team));
    const done = state.tasks.filter(t => t.status === "done" && t.doneBy === u.name && t.doneAt?.startsWith(today));
    const packing = state.orders.filter(o => o.assignee === u.id && ["approved", "picking"].includes(statusOf(o)));
    return { u, tasks, doing, teamTasks, done, packing, p: state.chat.presence[u.id] };
  });
  const rank = (r: (typeof rows)[number]) => (r.doing ? 0 : r.p?.state === "online" ? 1 : r.p?.state === "away" ? 2 : 3);
  rows.sort((a, b) => rank(a) - rank(b) || a.u.name.localeCompare(b.u.name));
  const stateWord = (r: (typeof rows)[number]) => manualLabel(r.p?.manual) ?? ({ online: "Online", away: "Away", syncing: "Offline · syncing later", offline: "Offline" } as const)[r.p?.state ?? "offline"];
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat glass"><span className="stat-n ok">{rows.filter(r => r.p?.state === "online").length}</span><span className="stat-l">online</span></div>
        <div className="stat glass"><span className="stat-n">{rows.filter(r => r.doing).length}</span><span className="stat-l">moving a pallet</span></div>
        <div className="stat glass"><span className="stat-n warn">{rows.filter(r => !r.doing && !r.tasks.length && r.p?.state === "online").length}</span><span className="stat-l">free<small>online, nothing given</small></span></div>
        <div className="stat glass"><span className="stat-n">{rows.reduce((a, r) => a + r.done.length, 0)}</span><span className="stat-l">tasks done today</span></div>
      </div>
      <div className="worker-grid">
        {rows.map(r => (
          <article key={r.u.id} className={`panel glass worker-card${r.doing ? " busy" : ""}`}>
            <header className="worker-head">
              <PresenceDot userId={r.u.id} />
              <div><b translate="no">{r.u.name}</b><small className="muted block">{r.u.roleName ?? ROLE[r.u.role]} · {stateWord(r)}{r.p && r.p.state !== "online" ? ` · ${roughAgo(r.p.lastSeenAt)}` : ""}</small></div>
              {teamsOf(state, r.u.id).length > 0 && <span className="tag">{teamsOf(state, r.u.id).map(t => t.name).join(", ")}</span>}
            </header>
            <p className="worker-now">{r.doing ? <>Moving <b className="mono">{r.doing.from}</b> → <b className="mono">{r.doing.to}</b>{r.doing.palletNote ? <span className="muted"> ({r.doing.palletNote})</span> : null}<small className="muted block">started {roughAgo(r.doing.startedAt ?? r.doing.createdAt)}</small></>
              : r.packing.length ? <>Packing <a className="link" href={`#/outbounds/orders/${encodeURIComponent(r.packing[0].id)}`}>{r.packing[0].id}</a></> : <span className="muted">No task in progress</span>}</p>
            <p className="small muted">{r.tasks.filter(t => t.status === "open").length} waiting for them · {r.teamTasks.length} for their team · {r.packing.length} to pack · {r.done.length} done today</p>
            <button className="link small" onClick={() => setOpen(o => (o === r.u.id ? null : r.u.id))} aria-expanded={open === r.u.id}>{open === r.u.id ? "Hide their tasks" : "Their tasks"}</button>
            {open === r.u.id && (
              <ul className="worker-tasks small">
                {[...r.tasks, ...r.teamTasks].map(t => <li key={t.id}><span className={`task-kind ${t.kind}`}>{t.kind === "move" ? "Move" : "Put away"}</span> <span className="mono">{t.from} → {t.to}</span>{t.status === "doing" ? " · in progress" : t.team && !t.assignee ? " · team" : ""}</li>)}
                {r.done.slice(0, 5).map(t => <li key={t.id} className="muted">✓ <span className="mono">{t.from} → {t.to}</span> {roughAgo(t.doneAt!)}</li>)}
                {!r.tasks.length && !r.teamTasks.length && !r.done.length && <li className="muted">Nothing today.</li>}
              </ul>
            )}
          </article>
        ))}
        {!rows.length && <p className="muted panel glass">No workers yet.</p>}
      </div>
    </div>
  );
}

/** Teams of workers (e.g. reach trucks, receiving, night shift): a task given to a team goes to whichever member takes it */
function TeamsTab() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState<WorkTeam | null>(null);
  const people = crew(state);
  const teams = state.teams ?? [];
  const openTasks = (id: string) => state.tasks.filter(t => isOpen(t) && t.team === id).length;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit || !edit.name.trim()) return;
    if (teams.some(t => t.id !== edit.id && t.name.toLowerCase() === edit.name.trim().toLowerCase())) { toast("There's already a team with that name."); return; }
    dispatch({ type: "team/save", team: { ...edit, name: edit.name.trim() } });
    toast(`${edit.name.trim()} saved.`);
    setEdit(null);
  };
  return (
    <div className="stack">
      <div className="panel glass">
        <div className="panel-foot">
          <div><h2 className="plain-h">Teams</h2><p className="muted small">Give a task to a team and any of its members can take it; the others don't see it. Owners and coordinators set teams up.</p></div>
          <button className="btn small primary" onClick={() => setEdit({ id: newId("T"), name: "", members: [], createdBy: me.name, createdAt: new Date().toISOString() })}>+ New team</button>
        </div>
        {edit && (
          <form className="stack team-form" onSubmit={save}>
            <label className="field">Name<input className="input" autoFocus value={edit.name} maxLength={40} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Reach trucks, Receiving, Night shift" /></label>
            <fieldset className="pallet-pick"><legend className="small">Members</legend>
              {people.map(u => <PersonBox key={u.id} u={u} on={edit.members.includes(u.id)} onChange={on => setEdit({ ...edit, members: on ? [...edit.members, u.id] : edit.members.filter(m => m !== u.id) })} />)}
            </fieldset>
            <div className="btns"><button className="btn primary" disabled={!edit.name.trim()}>Save team</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        )}
      </div>
      <div className="worker-grid">
        {teams.map(t => (
          <article key={t.id} className="panel glass">
            <h3 className="plain-h" translate="no">{t.name}</h3>
            <p className="small">{t.members.map(m => state.chat.users.find(u => u.id === m)?.name ?? m).join(", ") || <span className="muted">Nobody yet</span>}</p>
            <p className="muted small">{openTasks(t.id)} open task{openTasks(t.id) === 1 ? "" : "s"} · made by {t.createdBy}</p>
            <div className="btns">
              <button className="btn small" onClick={() => setEdit(t)}>Edit</button>
              <button className="btn small" onClick={() => { if (window.confirm(tr(openTasks(t.id) ? `Remove ${t.name}? Its ${openTasks(t.id)} open tasks go back to anyone.` : `Remove ${t.name}?`))) dispatch({ type: "team/delete", id: t.id }); }}>Remove</button>
            </div>
          </article>
        ))}
        {!teams.length && !edit && <p className="muted panel glass">No teams yet. Make one to give tasks to a group of workers.</p>}
      </div>
    </div>
  );
}

function PersonBox({ u, on, onChange }: { u: User; on: boolean; onChange: (on: boolean) => void }) {
  return <label className="toggle-row small"><input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} /> <PresenceDot userId={u.id} /> {u.name} <span className="muted">{u.roleName ?? ROLE[u.role]}</span></label>;
}
