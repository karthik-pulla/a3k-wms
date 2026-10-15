import { useEffect, useMemo, useState } from "react";
import { canSeeClient } from "../../auth/permissions";
import { normalizeLocation } from "../../chat/refs";
import { mentionsFor, unreadTotals, visibleText } from "../../chat/selectors";
import { roughAgo } from "../../chat/presence";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { TaskCard } from "../../components/tasks/TaskCard";
import { OrderDetail } from "../outbounds/OrderDetail";
import { isOpen, nextSlot, taskId } from "../../store/tasks";
import { orderCases, pickedCases, statusOf } from "../../outbound/plan";
import { dueText, dueTone } from "../../outbound/labels";
import type { State, Task, User } from "../../store/types";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  return now;
}

/** My tasks first (in progress, then given to me), then ones anyone can take */
function myQueue(state: State, me: User): { mine: Task[]; pool: Task[] } {
  const open = state.tasks.filter(isOpen).sort((a, b) => (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) || a.createdAt.localeCompare(b.createdAt));
  return { mine: open.filter(t => t.assignee === me.id), pool: open.filter(t => !t.assignee) };
}

/** Recent messages for me: mentions, direct messages and my channels (newest first) */
function notices(state: State, me: User, n: number) {
  const mentions = mentionsFor(state, me).slice(0, n).map(m => ({ m: m.message, unread: m.unread }));
  const dms = state.chat.messages.filter(m => m.authorId !== me.id && state.chat.conversations.find(c => c.id === m.conversationId)?.kind === "dm" && state.chat.conversations.find(c => c.id === m.conversationId)?.members.includes(me.id))
    .map(m => ({ m, unread: m.createdAt > (state.chat.reads[me.id]?.[m.conversationId] ?? "") }));
  return [...mentions, ...dms].sort((a, b) => b.m.createdAt.localeCompare(a.m.createdAt)).filter((x, i, arr) => arr.findIndex(y => y.m.id === x.m.id) === i).slice(0, n);
}

/**
 * #/work: the worker's screen. Clock, my pallet tasks (the WMS gives every slot), tasks anyone can take, orders given
 * to me to pack, and message alerts. #/work/forklift: the same, big, for a device mounted on a forklift.
 * #/work/order/<id>: packing an order given to me.
 */
export function WorkPage({ parts }: { parts: string[] }) {
  const [sub, id] = parts;
  if (sub === "forklift") return <Forklift />;
  if (sub === "order" && id) return <PackOrder id={id} />;
  return <WorkHome />;
}

function WorkHome() {
  const { state } = useStore();
  const { me } = useSession();
  const now = useClock();
  const { mine, pool } = myQueue(state, me);
  const orders = state.orders.filter(o => o.assignee === me.id && ["approved", "picking"].includes(statusOf(o)) && canSeeClient(me, o.client));
  const doneToday = state.tasks.filter(t => t.status === "done" && t.doneBy === me.name && t.doneAt?.startsWith(now.toISOString().slice(0, 10))).length;
  const unread = unreadTotals(state, me);
  const alerts = notices(state, me, 5);
  return (
    <main className="section work">
      <header className="work-head">
        <div><h1>Hi {me.name.split(" ")[0]}</h1><p className="crumb">{mine.length} task{mine.length === 1 ? "" : "s"} for you · {orders.length} order{orders.length === 1 ? "" : "s"} to pack · {doneToday} done today</p></div>
        <div className="work-clock" aria-label="Time"><b>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</b><span>{now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span></div>
      </header>
      <div className="btns"><a className="btn primary big" href="#/work/forklift">Forklift mode</a><MoveRequest /></div>
      <div className="work-layout">
        <section className="stack">
          <h2 className="plain-h">My tasks</h2>
          {mine.length ? mine.map(t => <TaskCard key={t.id} task={t} />) : <p className="muted panel glass">Nothing given to you right now.</p>}
          {pool.length > 0 && <><h2 className="plain-h">Anyone can take</h2>{pool.map(t => <TaskCard key={t.id} task={t} />)}</>}
        </section>
        <aside className="stack">
          <section className="panel glass">
            <h2 className="plain-h">Orders to pack</h2>
            {orders.length ? <ul className="pack-list">{orders.map(o => (
              <li key={o.id}><a className="link" href={`#/work/order/${encodeURIComponent(o.id)}`}><b>{o.id}</b> · {o.store}</a><small className={`due-tag ${dueTone(o)}`}>{dueText(o)}</small><small className="muted">{pickedCases(o)}/{orderCases(o)} cases picked</small></li>
            ))}</ul> : <p className="muted small">A coordinator gives you orders to pack.</p>}
          </section>
          <section className="panel glass">
            <div className="panel-foot"><h2 className="plain-h">Messages</h2>{unread.count > 0 && <span className="badge">{unread.count}</span>}</div>
            <ul className="notice-list">{alerts.map(({ m, unread: u }) => (
              <li key={m.id} className={u ? "unread" : ""}><a href={`#/messages/${encodeURIComponent(m.conversationId)}/${m.id}`}><b>{state.chat.users.find(x => x.id === m.authorId)?.name}</b> <span translate="no">{visibleText(state, me, m, "…").slice(0, 120)}</span><small className="muted"> · {roughAgo(m.createdAt)}</small></a></li>
            ))}{!alerts.length && <li className="muted small">No messages for you.</li>}</ul>
            <a className="link" href="#/messages">All messages ›</a>
          </section>
        </aside>
      </div>
    </main>
  );
}

/** "Move a pallet": the worker says which pallet; the WMS gives the slot and the task */
function MoveRequest() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false), [from, setFrom] = useState(""), [reason, setReason] = useState("");
  const code = normalizeLocation(from);
  const lines = code ? state.stock[code] ?? [] : [];
  const busy = code ? state.tasks.some(t => isOpen(t) && (t.from === code || t.to === code)) : false;
  if (!open) return <button className="btn big" onClick={() => setOpen(true)}>Move a pallet…</button>;
  return (
    <form className="panel glass move-req" onSubmit={e => {
      e.preventDefault();
      if (!code || !lines.length || busy || !reason.trim()) return;
      const to = nextSlot(state, code);
      dispatch({ type: "task/create", task: { id: taskId(), kind: "move", status: "open", from: code, to, lines, reason: reason.trim(), assignee: me.id, createdBy: me.name, createdAt: new Date().toISOString() } });
      toast(`The WMS gave ${to}. Your task: ${code} → ${to}.`);
      setOpen(false); setFrom(""); setReason("");
    }}>
      <label className="field"><span>Pallet is at</span><input className={`input${from && !code ? " invalid" : ""}`} autoFocus value={from} onChange={e => setFrom(e.target.value)} placeholder="e.g. 06B-FLOOR-P01" /></label>
      <label className="field"><span>Why</span><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. blocking the aisle" /></label>
      <p className="small muted">{!code ? "Type the slot or floor spot." : !lines.length ? `${code} is empty.` : busy ? `${code} already has a task.` : "The WMS picks the slot it goes to."}</p>
      <div className="btns"><button className="btn primary" disabled={!code || !lines.length || busy || !reason.trim()}>Get a slot</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

function PackOrder({ id }: { id: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const o = state.orders.find(x => x.id === id);
  if (!o || !canSeeClient(me, o.client)) return <main className="section"><div className="panel glass"><p>This order isn't available.</p><a className="link" href="#/work">Back to Work ›</a></div></main>;
  return (
    <main className="section outbounds">
      <header className="section-head"><h1>Packing</h1><p className="crumb"><a className="link" href="#/work">Work</a> / {o.id}</p></header>
      <OrderDetail order={o} />
    </main>
  );
}

/** Forklift screen: the current pallet task huge, the next ones, the clock and the latest message. Keeps the screen on. */
function Forklift() {
  const { state } = useStore();
  const { me } = useSession();
  const now = useClock();
  const { mine, pool } = myQueue(state, me);
  const queue = [...mine, ...pool];
  const current = queue[0];
  const latest = useMemo(() => notices(state, me, 1)[0], [state, me]);
  // Keep the screen awake while this page is open (where the browser allows it)
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const ask = () => { void navigator.wakeLock?.request("screen").then(l => { lock = l; }).catch(() => undefined); };
    ask();
    const vis = () => { if (!document.hidden) ask(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); void lock?.release(); };
  }, []);
  return (
    <main className="forklift">
      <header className="fk-top">
        <button className="btn" onClick={() => go("#/work")}>Exit</button>
        <span className="fk-name">{me.name}</span>
        <b className="fk-clock">{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</b>
      </header>
      <section className="fk-main">{current ? <TaskCard task={current} big /> : <div className="fk-idle glass"><b>No pallet tasks</b><span className="muted">New tasks show here as soon as they're given.</span></div>}</section>
      {queue.length > 1 && <section className="fk-next"><h2>Next</h2><ol>{queue.slice(1, 4).map(t => <li key={t.id}><b className="mono">{t.from}</b> → <b className="mono">{t.to}</b></li>)}</ol></section>}
      {latest && <a className={`fk-msg glass${latest.unread ? " unread" : ""}`} href={`#/messages/${encodeURIComponent(latest.m.conversationId)}/${latest.m.id}`}><b>{state.chat.users.find(u => u.id === latest.m.authorId)?.name}:</b> <span translate="no">{visibleText(state, me, latest.m, "…").slice(0, 140)}</span> <small>{roughAgo(latest.m.createdAt)}</small></a>}
    </main>
  );
}
