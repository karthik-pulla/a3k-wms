import { useState } from "react";
import { describeLocation, productById } from "../../data/catalog";
import { can } from "../../auth/permissions";
import { useStore, shipmentTitle } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../Toast";
import { nextSlot, taskLabel } from "../../store/tasks";
import { roughAgo } from "../../chat/presence";
import type { Task } from "../../store/types";
import { t as t_ } from "../../i18n";

const where = (code: string) => (code === "RECV-FLOOR" ? "Receiving floor (dock)" : describeLocation(code));

/**
 * One pallet task. Workers: start it, then confirm the pallet is in the slot (or report the slot blocked, and the WMS
 * gives the next free one). Coordinators also give it to a worker or cancel it. Big = forklift screen.
 */
export function TaskCard({ task: t, big = false, workers }: { task: Task; big?: boolean; workers?: { id: string; name: string }[] }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const mine = t.assignee === me.id;
  const lead = can(me, "assign-work");
  const canAct = mine || !t.assignee || lead;
  const ship = t.shipmentId ? state.shipments.find(s => s.id === t.shipmentId) : undefined;
  const who = (id?: string) => (id ? state.chat.users.find(u => u.id === id)?.name ?? id : "Anyone");
  const open = t.status === "open" || t.status === "doing";

  const done = () => { dispatch({ type: "task/done", id: t.id, by: me.name }); setConfirming(false); toast(`Confirmed: the pallet is in ${t.to}. Stock updated.`); };
  const blocked = () => {
    const to = nextSlot(state, t.to, [...(t.blocked ?? []), t.to], t.id);
    dispatch({ type: "task/blocked", id: t.id, to });
    setConfirming(false);
    toast(`${t.to} reported blocked. The WMS gave ${to} instead.`);
  };

  return (
    <article className={`task glass${big ? " big" : ""} ${t.status}${mine ? " mine" : ""}`} aria-label={`${taskLabel(t)} ${t.from} to ${t.to}`}>
      <header className="task-head">
        <span className={`task-kind ${t.kind}`}>{taskLabel(t)}</span>
        <span className="muted small">{ship ? `${shipmentTitle(ship)} · pallet ${t.pallet}` : t.reason ?? ""}</span>
        <span className="task-who small">{t.status === "done" ? `Done by ${t.doneBy} ${roughAgo(t.doneAt!)}` : t.status === "cancelled" ? "Cancelled" : t.status === "doing" ? `${who(t.assignee)} is on it` : t.assignee ? `For ${who(t.assignee)}` : "Anyone can take it"}</span>
      </header>
      <div className="task-route">
        <div><small>From</small><b className="mono">{t.from}</b><span className="muted small">{where(t.from)}</span></div>
        <span className="task-arrow" aria-hidden="true">→</span>
        <div><small>To</small><b className="mono task-to">{t.to}</b><span className="muted small">{where(t.to)}</span></div>
      </div>
      <p className="task-what">{t.lines.map((l, i) => { const p = productById(l.productId); return <span key={i}>{i ? " + " : ""}<b>{p?.code}</b> {p?.name} × {l.cases}</span>; })}</p>
      {t.blocked?.length ? <p className="small warn">Blocked before: {t.blocked.join(", ")}</p> : null}
      {open && (
        <div className="task-act">
          {lead && workers && !big && (
            <select className="input task-assign" value={t.assignee ?? ""} onChange={e => dispatch({ type: "task/assign", id: t.id, assignee: e.target.value || undefined })} aria-label="Give to">
              <option value="">Any worker</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          {canAct && t.status === "open" && <button className="btn primary" onClick={() => dispatch({ type: "task/start", id: t.id, byId: me.id })}>{big ? "Got the pallet, going" : "Start"}</button>}
          {canAct && t.status === "doing" && !confirming && <button className="btn primary" onClick={() => setConfirming(true)}>It's in the slot</button>}
          {lead && !big && <button className="btn small danger" onClick={() => { const r = window.prompt(t_("Cancel this task? Reason:")); if (r?.trim()) dispatch({ type: "task/cancel", id: t.id, by: me.name, reason: r.trim() }); }}>Cancel</button>}
        </div>
      )}
      {confirming && (
        <div className="task-confirm" role="dialog" aria-label="Confirm the pallet is in place">
          <p>Is the pallet in <b className="mono">{t.to}</b>?</p>
          <div className="btns">
            <button className="btn primary big" onClick={done}>Yes, it's in {t.to}</button>
            <button className="btn" onClick={blocked}>Slot is blocked</button>
            <button className="btn" onClick={() => setConfirming(false)}>Not yet</button>
          </div>
        </div>
      )}
    </article>
  );
}
