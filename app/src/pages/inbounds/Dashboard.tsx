import { useSession } from "../../session";
import { can } from "../../auth/permissions";
import { buildXlsx, download } from "../../utils/xlsx";
import { useStore, shipmentTitle, totalCases, palletCount } from "../../store/store";
import type { Shipment } from "../../store/types";
import { productById } from "../../data/catalog";

const day = (iso: string) => {
  const d = Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(new Date().toDateString()).getTime() - 432e5) / 864e5);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function Pill({ s, href, meta }: { s: Shipment; href: string; meta: string }) {
  return (
    <a className="pill" href={href}>
      <span className="pill-title">{shipmentTitle(s)}{s.returnId && <span className="tag">return</span>}{s.condition === "damaged" && <span className="tag warn">damage</span>}</span>
      <span className="pill-meta">{meta}</span>
      <span className="pill-arrow" aria-hidden="true">›</span>
    </a>
  );
}

export function Dashboard({ owner }: { owner: boolean }) {
  const { state } = useStore();
  const { me } = useSession();
  const incoming = state.shipments.filter(s => s.status === "incoming").sort((a, b) => a.expected.localeCompare(b.expected));
  const pending = state.shipments.filter(s => s.status === "pending");
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const thisWeek = incoming.filter(s => s.expected <= week);
  const pendingReturns = state.returns.filter(r => r.status === "pending");
  const today = new Date().toISOString().slice(0, 10);
  const storedToday = state.movements.filter(m => m.type === "putaway" && m.at.startsWith(today));
  const recent = state.movements.filter(m => m.type === "putaway").slice(0, 6);

  const report = () => download(buildXlsx([{
    name: "In-bounds", header: ["Delivery", "Client", "Supplier", "Container / BOL", "Status", "Expected", "Arrived", "Received by", "Condition", "Pallets", "Cases", "Damaged cases", "Confirmed by"],
    widths: [16, 10, 20, 16, 12, 11, 17, 14, 10, 8, 8, 9, 14],
    rows: [...state.shipments].sort((a, b) => (b.receivedAt ?? b.expected).localeCompare(a.receivedAt ?? a.expected)).map(s => [`${s.client} ${s.number}`, s.client, s.supplier, s.ref, s.status, s.expected, s.receivedAt?.slice(0, 16).replace("T", " ") ?? "", s.receivedBy ?? "", s.condition ?? "", palletCount(s), totalCases(s), s.lines.reduce((a, l) => a + (l.damaged ?? 0), 0), s.confirmedBy ?? ""]),
  }, {
    name: "Lines", header: ["Delivery", "Pallet", "Code", "Product", "Cases", "Damaged", "Lot", "Best before"], widths: [16, 7, 10, 34, 7, 8, 12, 11],
    rows: state.shipments.flatMap(s => s.lines.map(l => [`${s.client} ${s.number}`, l.pallet, productById(l.productId ?? "")?.code ?? "", productById(l.productId ?? "")?.name ?? "", l.cases, l.damaged ?? 0, l.lot, l.bestBefore])),
  }]), `inbound-report-${today}.xlsx`);

  return (
    <div className="stack">
      {can(me, "export") && <div className="btns"><button className="btn small" onClick={report}>In-bound report (.xlsx)</button></div>}
      <div className="stats">
        <div className="stat glass"><span className="stat-n">{thisWeek.length}</span><span className="stat-l">arriving this week<small>{thisWeek.reduce((a, s) => a + totalCases(s), 0)} cases</small></span></div>
        <div className="stat glass"><span className="stat-n warn">{pending.length}</span><span className="stat-l">waiting for confirmation<small>{pending.reduce((a, s) => a + palletCount(s), 0)} pallets on the dock</small></span></div>
        <div className="stat glass"><span className="stat-n">{pendingReturns.length}</span><span className="stat-l">{owner ? "returns to review" : "returns waiting"}<small>not in inventory yet</small></span></div>
        <div className="stat glass"><span className="stat-n ok">{new Set(storedToday.map(m => m.location)).size}</span><span className="stat-l">pallets put away today<small>across {new Set(storedToday.map(m => m.shipmentId)).size} deliveries</small></span></div>
      </div>

      <div className="boards">
        <section className="board glass" aria-labelledby="b-inc">
          <div className="board-head"><h2 id="b-inc">Incoming</h2><a className="btn small" href="#/inbounds/new">+ New delivery</a></div>
          <div className="pills">
            {incoming.map(s => <Pill key={s.id} s={s} href={`#/inbounds/incoming/${s.id}`} meta={`${day(s.expected)} · ${palletCount(s)} pl`} />)}
            {!incoming.length && <p className="muted">Nothing expected. Add a delivery when a brand sends a packing list.</p>}
          </div>
        </section>
        <section className="board glass" aria-labelledby="b-pen">
          <div className="board-head"><h2 id="b-pen">Pending</h2>{owner && pending.length > 0 && <span className="muted small">Confirm to get slots</span>}</div>
          <div className="pills">
            {pending.map(s => <Pill key={s.id} s={s} href={`#/inbounds/pending/${s.id}`} meta={`${palletCount(s)} pl · ${totalCases(s)} cs`} />)}
            {!pending.length && <p className="muted">Nothing waiting. Deliveries land here once they arrive.</p>}
          </div>
        </section>
        {owner && (
          <section className="board glass" aria-labelledby="b-ret">
            <div className="board-head"><h2 id="b-ret">Return requests</h2><a className="link" href="#/inbounds/returns">All ›</a></div>
            <div className="pills">
              {pendingReturns.map(r => (
                <a key={r.id} className="pill" href={`#/inbounds/returns/${r.id}`}>
                  <span className="pill-title">{r.store}</span>
                  <span className="pill-meta">{r.orderId} · {r.items.reduce((a, i) => a + i.cases, 0)} cs</span>
                  <span className="pill-arrow" aria-hidden="true">›</span>
                </a>
              ))}
              {!pendingReturns.length && <p className="muted">No return requests waiting.</p>}
            </div>
          </section>
        )}
        <section className="board glass" aria-labelledby="b-rec">
          <div className="board-head"><h2 id="b-rec">Recently put away</h2></div>
          <ul className="activity">
            {recent.map(m => (
              <li key={m.id}><span className="mono">{m.location}</span><span>{productById(m.productId ?? "")?.name ?? ""} × {m.cases}</span><small>{m.by}</small></li>
            ))}
            {!recent.length && <li className="muted">Nothing put away yet. Confirm a pending delivery to see it here.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
