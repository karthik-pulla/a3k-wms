import { useState } from "react";
import { useStore } from "../../store/store";
import type { ReturnOutcome, ReturnRequest } from "../../store/types";
import { productById } from "../../data/catalog";
import { useToast } from "../../components/Toast";
import { statusLabel } from "./Returns";

const OUTCOMES: [ReturnOutcome, string, string][] = [
  ["restock", "Put back into stock", "Becomes a pending in-bound and gets a slot when confirmed"],
  ["writeoff", "Write off as damaged", "Recorded, not added to inventory"],
  ["brand", "Send back to the brand", "Recorded for the brand, not added to inventory"],
];

/** One return request. Owners approve (choosing what happens to the goods) or reject it. */
export function ReturnDetail({ request: r, who, owner }: { request: ReturnRequest; who: string; owner: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [outcome, setOutcome] = useState<ReturnOutcome>("restock");
  const [note, setNote] = useState("");
  const [big, setBig] = useState<string | null>(null);
  const restockShipment = state.shipments.find(s => s.returnId === r.id);

  return (
    <div className="stack">
      <div className="facts glass">
        <div className="fact"><span>Order</span><b>{r.orderId}</b></div>
        <div className="fact"><span>Store</span><b>{r.store}</b></div>
        <div className="fact"><span>Reason</span><b>{r.reason}</b></div>
        <div className="fact"><span>Sent by</span><b>{r.createdBy} · {new Date(r.createdAt).toLocaleDateString()}</b></div>
        <div className="fact"><span>Status</span><b className={r.status === "pending" ? "warn" : r.status === "rejected" ? "danger" : "ok"}>{statusLabel(r)}</b></div>
      </div>
      <div className="panel glass">
        <h2>Products</h2>
        <ul className="activity">
          {r.items.map(i => { const p = productById(i.productId ?? ""); return <li key={i.key}><span className="mono">{p?.code}</span><span>{p?.name} {p?.size}</span><b>{i.cases} cs</b></li>; })}
        </ul>
        <h2>Photos</h2>
        {r.photos.length ? <div className="photos">{r.photos.map((src, i) => <button key={i} className="photo" onClick={() => setBig(src)}><img src={src} alt={`Photo ${i + 1}`} /></button>)}</div> : <p className="muted">No photos attached.</p>}
        {r.notes && <><h2>Notes</h2><p>{r.notes}</p></>}
        {r.status !== "pending" && <p className="muted">Decided by {r.decidedBy} on {r.decidedAt ? new Date(r.decidedAt).toLocaleString() : ""}{r.decisionNote ? `: "${r.decisionNote}"` : ""}.</p>}
        {restockShipment && <p><a className="link" href={`#/inbounds/pending/${restockShipment.id}`}>Open the in-bound for these goods ›</a></p>}
      </div>
      {owner && r.status === "pending" && (
        <div className="panel glass">
          <h2>Decision</h2>
          <fieldset className="outcomes">
            <legend className="sr-only">What happens to the goods</legend>
            {OUTCOMES.map(([v, label, hint]) => (
              <label key={v} className={`outcome${outcome === v ? " sel" : ""}`}>
                <input type="radio" name="outcome" checked={outcome === v} onChange={() => setOutcome(v)} />
                <span>{label}<small>{hint}</small></span>
              </label>
            ))}
          </fieldset>
          <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. credit the store, boxes resealed" /></label>
          <div className="panel-foot">
            <button className="btn danger" onClick={() => { dispatch({ type: "decideReturn", id: r.id, by: who, approve: false, note }); toast(`${r.id} rejected.`); }}>Reject</button>
            <button className="btn primary" onClick={() => {
              dispatch({ type: "decideReturn", id: r.id, by: who, approve: true, outcome, note });
              toast(outcome === "restock" ? `${r.id} approved. The goods are now a pending in-bound waiting for a slot.` : `${r.id} approved.`);
            }}>Approve</button>
          </div>
        </div>
      )}
      {!owner && r.status === "pending" && <p className="panel glass muted">Waiting for an owner to review this request.</p>}
      {big && <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setBig(null)}><img src={big} alt="Return photo, enlarged" /></div>}
    </div>
  );
}
