import { useState } from "react";
import { useStore, shipmentTitle, totalCases, palletCount } from "../../store/store";
import { productById } from "../../data/catalog";
import type { ShipmentStatus } from "../../store/types";

/** All deliveries in one state, searchable by client, number, supplier, container or product. */
export function ShipmentList({ status }: { status: Extract<ShipmentStatus, "incoming" | "pending"> }) {
  const { state } = useStore();
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = state.shipments
    .filter(s => s.status === status || (status === "pending" && s.status === "putaway"))
    .filter(s => {
      const hay = [shipmentTitle(s), s.supplier, s.ref, ...s.lines.map(l => `${productById(l.productId ?? "")?.name ?? ""} ${productById(l.productId ?? "")?.code ?? ""}`)].join(" ").toLowerCase();
      return words.every(w => hay.includes(w));
    })
    .sort((a, b) => a.expected.localeCompare(b.expected));
  return (
    <div className="stack">
      <div className="toolbar">
        <input className="input search" type="search" placeholder="Search client, number, container or product" value={q} onChange={e => setQ(e.target.value)} aria-label="Search deliveries" />
        {status === "incoming" && <a className="btn primary" href="#/inbounds/new">+ New delivery</a>}
      </div>
      <div className="rows">
        {list.map(s => (
          <a key={s.id} className="row glass" href={`#/inbounds/${status}/${s.id}`}>
            <span className="row-title">{shipmentTitle(s)}{s.returnId && <span className="tag">return</span>}{s.condition === "damaged" && <span className="tag warn">damage</span>}{s.status === "putaway" && <span className="tag">being put away</span>}</span>
            <span className="row-sub">{s.supplier} · {s.ref}</span>
            <span className="row-fig">{palletCount(s)} pallets · {totalCases(s)} cases</span>
            <span className="row-date">{status === "incoming" ? `expected ${s.expected}` : `arrived ${new Date(s.receivedAt ?? "").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}</span>
          </a>
        ))}
        {!list.length && <p className="panel glass muted">{q ? "No delivery matches that search." : status === "incoming" ? "No deliveries expected." : "Nothing is waiting for confirmation."}</p>}
      </div>
    </div>
  );
}
