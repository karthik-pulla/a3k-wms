import { useMemo, useState } from "react";
import { canSeeClient } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { orderCases, pickedCases, statusOf } from "../../outbound/plan";
import { STATUS_LABEL, dueText, dueTone, isActive } from "../../outbound/labels";
import type { OrderStatus, StoreOrder } from "../../store/types";

type Show = "active" | OrderStatus | "all";
const SHOWS: [Show, string][] = [["active", "Open orders"], ["draft", "To approve"], ["approved", "Ready to pick"], ["picking", "Picking"], ["picked", "Ready to ship"], ["shipped", "Shipped"], ["cancelled", "Cancelled"], ["all", "All"]];

/** Every order the person may see, soonest due first. */
export function OrderList() {
  const { state } = useStore();
  const { me } = useSession();
  const [show, setShow] = useState<Show>("active");
  const [q, setQ] = useState("");
  const mine = useMemo(() => state.orders.filter(o => canSeeClient(me, o.client)), [state.orders, me]);
  const count = (s: Show) => mine.filter(o => (s === "all" ? true : s === "active" ? isActive(o) : statusOf(o) === s)).length;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = mine.filter(o => (show === "all" ? true : show === "active" ? isActive(o) : statusOf(o) === show) && words.every(w => `${o.id} ${o.store} ${o.client} ${o.ref ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => (isActive(a) ? 0 : 1) - (isActive(b) ? 0 : 1) || (isActive(a) ? (a.due ?? "9999").localeCompare(b.due ?? "9999") : (b.shippedAt ?? b.date).localeCompare(a.shippedAt ?? a.date)));
  return (
    <div className="stack">
      <div className="toolbar">
        <input className="input search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search order, store, client or PO" aria-label="Search orders" />
        <a className="btn primary" href="#/outbounds/new">+ New order</a>
      </div>
      <div className="chip-wrap">{SHOWS.map(([s, t]) => <button key={s} className={`chip-btn${show === s ? " on" : ""}`} onClick={() => setShow(s)}>{t} · {count(s)}</button>)}</div>
      <div className="rows">
        {list.map(o => <OrderRow key={o.id} o={o} />)}
        {!list.length && <p className="muted panel glass">No orders here.</p>}
      </div>
    </div>
  );
}

export function OrderRow({ o }: { o: StoreOrder }) {
  const s = statusOf(o);
  const total = orderCases(o), done = pickedCases(o);
  const short = Object.values(o.short ?? {}).reduce((a, n) => a + n, 0);
  return (
    <a className="row glass order-row" href={`#/outbounds/orders/${encodeURIComponent(o.id)}`}>
      <span className="order-who">
        <span className="order-name"><b>{o.id}</b> · {o.store}</span>
        <small>{o.client} · {o.lines.length} product{o.lines.length === 1 ? "" : "s"} · {total} cs{o.ref ? ` · PO ${o.ref}` : ""}</small>
      </span>
      <span className={`due-tag ${dueTone(o)}`}>{dueText(o)}</span>
      <span className="order-prog">{["approved", "picking", "picked"].includes(s) ? <><span className="fill-bar"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span><small>{done}/{total} picked{short ? ` · ${short} short` : ""}</small></> : null}</span>
      <span className={`status-tag ${s}`}>{STATUS_LABEL[s]}</span>
    </a>
  );
}
