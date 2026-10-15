import { useMemo, useState } from "react";
import { FACES, productById } from "../../data/catalog";
import { canSeeClient, visibleLines } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { RackView, HIDDEN_PRODUCT, type SlotMark } from "../../components/RackView";
import { WarehouseMap, type MapMark } from "../../components/inventory/WarehouseMap";
import { SlotDetail } from "../../components/inventory/SlotDetail";
import { groupOf, stockRows } from "../../inventory/selectors";
import { ACTIVE, statusOf } from "../../outbound/plan";
import { dueTone, isActive } from "../../outbound/labels";
import { OrderRow } from "./OrderList";
import type { StockLine } from "../../store/types";

/** Today's out-bounds at a glance: what to approve, pick and ship, every pallet to pick on one map, and open pallets. */
export function OutboundsDashboard() {
  const { state } = useStore();
  const { me } = useSession();
  const [face, setFace] = useState<string | undefined>();
  const [open, setOpen] = useState<string | null>(null);
  const mine = useMemo(() => state.orders.filter(o => canSeeClient(me, o.client)), [state.orders, me]);
  const today = new Date().toISOString().slice(0, 10);
  const drafts = mine.filter(o => statusOf(o) === "draft");
  const toPick = mine.filter(o => ACTIVE.includes(statusOf(o))).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  const toShip = mine.filter(o => statusOf(o) === "picked");
  const late = mine.filter(o => isActive(o) && dueTone(o) === "overdue");
  const dueToday = mine.filter(o => isActive(o) && dueTone(o) === "today");
  const shippedToday = mine.filter(o => statusOf(o) === "shipped" && o.shippedAt?.startsWith(today));
  const newMail = state.inbox.filter(m => m.status === "new").length;

  // Every pallet still to pick, for all open orders
  const picks = useMemo(() => toPick.flatMap(o => (o.picks ?? []).filter(p => !p.picked).map(p => ({ ...p, order: o.id }))), [toPick]);
  const marks = useMemo(() => { const m = new Map<string, MapMark>(); for (const p of picks) m.set(p.location, { tone: "ok", partial: p.cases < p.onPallet }); return m; }, [picks]);
  const busiest = useMemo(() => { const n = new Map<string, number>(); for (const c of marks.keys()) n.set(groupOf(c), (n.get(groupOf(c)) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]; }, [marks]);
  const shownFace = face ?? busiest;
  const viewStock = useMemo(() => {
    const out: Record<string, StockLine[]> = {};
    for (const [code, lines] of Object.entries(state.stock)) { const { shown, hidden } = visibleLines(me, lines); out[code] = hidden ? [...shown, { productId: HIDDEN_PRODUCT, cases: 0 }] : shown; }
    return out;
  }, [state.stock, me]);
  const rackMarks: Record<string, SlotMark> = {};
  for (const p of picks) if (shownFace && groupOf(p.location) === shownFace) rackMarks[p.location] = { kind: "selected", label: p.order.replace("Order ", "#"), partial: p.cases < p.onPallet };
  // Open (partial) pallets: the next orders take from these before opening a full pallet
  const openPallets = useMemo(() => stockRows(state, me).filter(r => r.partial && r.tone !== "expired").sort((a, b) => (a.line!.cases - b.line!.cases)).slice(0, 8), [state, me]);

  return (
    <div className="stack">
      <div className="stats">
        <a className="stat glass" href="#/outbounds/orders"><span className="stat-n warn">{drafts.length}</span><span className="stat-l">to approve<small>{newMail ? `${newMail} new email${newMail > 1 ? "s" : ""} in the inbox` : "drafts from PDFs, email and the app"}</small></span></a>
        <div className="stat glass"><span className="stat-n">{toPick.length}</span><span className="stat-l">to pick<small>{picks.length} pallets to visit</small></span></div>
        <div className="stat glass"><span className={`stat-n${late.length ? " danger" : ""}`}>{dueToday.length + late.length}</span><span className="stat-l">due today{late.length ? ` or late` : ""}<small>{late.length ? `${late.length} overdue` : "none overdue"}</small></span></div>
        <div className="stat glass"><span className="stat-n ok">{shippedToday.length}</span><span className="stat-l">shipped today<small>{toShip.length} picked, ready to ship</small></span></div>
      </div>

      <div className="boards">
        <section className="board glass" aria-labelledby="ob-pick">
          <div className="board-head"><h2 id="ob-pick">To pick and ship</h2><a className="btn small" href="#/outbounds/new">+ New order</a></div>
          <div className="rows">{[...toPick, ...toShip].map(o => <OrderRow key={o.id} o={o} />)}{!toPick.length && !toShip.length && <p className="muted">Nothing to pick.</p>}</div>
        </section>
        <section className="board glass" aria-labelledby="ob-appr">
          <div className="board-head"><h2 id="ob-appr">To approve</h2>{newMail > 0 && <a className="link" href="#/outbounds/inbox">{newMail} new email{newMail > 1 ? "s" : ""} ›</a>}</div>
          <div className="rows">{drafts.map(o => <OrderRow key={o.id} o={o} />)}{!drafts.length && <p className="muted">No drafts waiting.</p>}</div>
        </section>
      </div>

      <section className="panel glass">
        <div className="panel-foot"><h2 className="plain-h">Every pallet to pick</h2><span className="muted small">All open orders · labels show the order number · click a rack side to open it</span></div>
        {picks.length ? (
          <>
            <WarehouseMap stock={viewStock} marks={marks} current={shownFace} onFace={setFace} onlyHits />
            {shownFace && FACES.some(f => f.id === shownFace) && <RackView faceId={shownFace} onFace={setFace} stock={viewStock} marks={rackMarks} onCell={setOpen} />}
          </>
        ) : <p className="muted">No picks planned.</p>}
      </section>

      <section className="panel glass">
        <div className="panel-foot"><h2 className="plain-h">Open pallets</h2><span className="muted small">Partial pallets are used up first, so fewer pallets stay open</span></div>
        <div className="open-pallets">
          {openPallets.map(r => {
            const p = productById(r.line!.productId)!;
            const full = p.perPallet ?? r.line!.cases;
            return (
              <button key={`${r.code}-${p.id}`} className="open-pallet" onClick={() => setOpen(r.code)}>
                <b className="mono">{r.code}</b><span>{p.name} <small className="muted">{p.size} · {p.code}</small></span>
                <span className="fill-bar"><i style={{ width: `${(r.line!.cases / full) * 100}%` }} /></span><small>{r.line!.cases} of {full} cs left</small>
              </button>
            );
          })}
          {!openPallets.length && <p className="muted">No open pallets.</p>}
        </div>
        <a className="link" href="#/inventory/stock">All partial pallets in Inventory ›</a>
      </section>
      {open && <SlotDetail code={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
