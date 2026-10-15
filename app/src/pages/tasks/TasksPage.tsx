import { useMemo, useState } from "react";
import { productById } from "../../data/catalog";
import { can, canSeeClient } from "../../auth/permissions";
import { normalizeLocation } from "../../chat/refs";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../../components/Toast";
import { TaskCard } from "../../components/tasks/TaskCard";
import { PresenceDot } from "../../components/chat/Presence";
import { isOpen, nextSlot, occupied, taskId } from "../../store/tasks";
import { orderCases, pickedCases, statusOf } from "../../outbound/plan";
import { dueText, dueTone } from "../../outbound/labels";
import type { Task } from "../../store/types";

/** Coordinators: every pallet task, who has it, workers' load, orders to give out for packing, and new move tasks. */
export function TasksPage() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const [show, setShow] = useState<"open" | "done">("open");
  const workers = state.chat.users.filter(u => u.role === "worker");
  const today = new Date().toISOString().slice(0, 10);
  const open = state.tasks.filter(isOpen).sort((a, b) => (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) || a.createdAt.localeCompare(b.createdAt));
  const done = state.tasks.filter(t => t.status === "done" && t.doneAt?.startsWith(today));
  const orders = state.orders.filter(o => ["approved", "picking"].includes(statusOf(o)) && canSeeClient(me, o.client)).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  if (!can(me, "assign-work")) return <main className="section"><div className="panel glass"><p>Tasks are given out by coordinators. Your own tasks are on your Work screen.</p><a className="link" href="#/work">Work ›</a></div></main>;

  return (
    <main className="section tasks-page">
      <header className="section-head"><h1>Tasks</h1><p className="crumb">Pallet moves and packing for the workers</p></header>
      <div className="stats">
        <div className="stat glass"><span className="stat-n warn">{open.filter(t => t.status === "open").length}</span><span className="stat-l">waiting<small>{open.filter(t => !t.assignee).length} not given to anyone</small></span></div>
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
            <h2 className="plain-h">Workers</h2>
            <ul className="worker-list">
              {workers.map(w => {
                const mine = open.filter(t => t.assignee === w.id);
                const did = done.filter(t => t.doneBy === w.name).length;
                const packing = orders.filter(o => o.assignee === w.id).length;
                return <li key={w.id}><PresenceDot userId={w.id} /><b>{w.name}</b><small className="muted">{mine.length} task{mine.length === 1 ? "" : "s"} · {packing} order{packing === 1 ? "" : "s"} · {did} done today</small></li>;
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
    </main>
  );
}

/** A move task: pallet from a location, to the slot the WMS suggests (a coordinator may choose another, with a reason) */
function NewMove() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [openForm, setOpenForm] = useState(false);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [assignee, setAssignee] = useState(""), [reason, setReason] = useState("");
  const fromCode = normalizeLocation(from);
  const lines = fromCode ? state.stock[fromCode] ?? [] : [];
  const busy = fromCode ? state.tasks.some(t => isOpen(t) && (t.from === fromCode || t.to === fromCode)) : false;
  const suggestion = useMemo(() => (fromCode && lines.length ? nextSlot(state, fromCode) : ""), [state, fromCode, lines.length]);
  const toCode = to.trim() ? normalizeLocation(to) : suggestion;
  const toBusy = toCode ? !!occupied(state)[toCode]?.length : true;
  const ok = !!fromCode && lines.length > 0 && !busy && !!toCode && !toBusy && toCode !== fromCode && !!reason.trim();
  const workers = state.chat.users.filter(u => u.role === "worker");
  if (!openForm) return <button className="btn" onClick={() => setOpenForm(true)}>+ Move a pallet (create a task)</button>;
  return (
    <form className="panel glass new-move" onSubmit={e => {
      e.preventDefault(); if (!ok) return;
      const task: Task = { id: taskId(), kind: "move", status: "open", from: fromCode!, to: toCode!, lines, reason: reason.trim(), assignee: assignee || undefined, createdBy: me.name, createdAt: new Date().toISOString() };
      dispatch({ type: "task/create", task });
      toast(`Task created: ${fromCode} → ${toCode}.`);
      setOpenForm(false); setFrom(""); setTo(""); setReason(""); setAssignee("");
    }}>
      <h2 className="plain-h">Move a pallet</h2>
      <div className="facts">
        <label className="fact"><span>From</span><input className={`input${from && !fromCode ? " invalid" : ""}`} value={from} onChange={e => setFrom(e.target.value)} placeholder="e.g. 06B-08-L3-B1" autoFocus /></label>
        <label className="fact"><span>To</span><input className={`input${to && !normalizeLocation(to) ? " invalid" : ""}`} value={to} onChange={e => setTo(e.target.value)} placeholder={suggestion ? `WMS: ${suggestion}` : "WMS suggests a slot"} /></label>
        <label className="fact"><span>Give to</span><select className="input" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Any worker</option>{workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="fact"><span>Reason</span><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. consolidating partial pallets" /></label>
      </div>
      <p className="small muted">
        {!fromCode ? "Type where the pallet is now." : !lines.length ? `${fromCode} is empty.` : busy ? `${fromCode} already has an open task.`
          : `${lines.map(l => `${productById(l.productId)?.code} ${productById(l.productId)?.name} × ${l.cases}`).join(" + ")} → ${toCode ?? "?"}${to.trim() ? " (your choice)" : " (WMS suggestion: nearest free slot)"}${toBusy && toCode ? ` · ${toCode} isn't free` : ""}`}
      </p>
      <div className="btns"><button className="btn primary" disabled={!ok}>Create task</button><button type="button" className="btn" onClick={() => setOpenForm(false)}>Cancel</button></div>
    </form>
  );
}
