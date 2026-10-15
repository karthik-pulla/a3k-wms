import { useCallback, useState } from "react";
import { useStore } from "../../store/store";
import type { ReturnRequest, StoreOrder } from "../../store/types";
import { productById } from "../../data/catalog";
import { Autocomplete } from "../../components/Autocomplete";
import { ProductInput } from "../../components/ProductInput";
import { CloseIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { shrink } from "../../utils/image";

const REASONS = ["Damaged in transit", "Wrong product sent", "Short-dated or expired", "Store refused delivery", "Over-shipped", "Other"];

export const statusLabel = (r: ReturnRequest) => r.status === "pending" ? "Waiting for an owner" : r.status === "rejected" ? "Rejected" : r.outcome === "restock" ? "Approved · back into stock" : r.outcome === "writeoff" ? "Approved · written off" : "Approved · back to brand";

export function Returns({ who, owner }: { who: string; owner: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [orderText, setOrderText] = useState("");
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [items, setItems] = useState<ReturnRequest["items"]>([{ key: "r1", productId: null, cases: 1 }]);
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");
  const searchOrders = useCallback((q: string) => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return state.orders.filter(o => w.every(x => `${o.id} ${o.store} ${o.client}`.toLowerCase().includes(x))).slice(0, 8);
  }, [state.orders]);
  const valid = order && items.some(i => i.productId && i.cases > 0);
  const mine = owner ? state.returns : state.returns.filter(r => r.createdBy === who);
  const sorted = [...mine].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));

  const submit = () => {
    if (!order) return;
    const id = `R-${String(state.seq).padStart(4, "0")}`;
    dispatch({ type: "submitReturn", request: {
      id, orderId: order.id, store: order.store, photos, reason, notes: notes.trim(), status: "pending",
      items: items.filter(i => i.productId && i.cases > 0), createdAt: new Date().toISOString(), createdBy: who,
    } });
    toast(`Return ${id} sent to the owners. It won't change inventory until it's approved.`);
    setOrder(null); setOrderText(""); setPhotos([]); setItems([{ key: `r${Date.now()}`, productId: null, cases: 1 }]); setReason(REASONS[0]); setNotes("");
  };

  return (
    <div className="returns">
      <section className="panel glass form" aria-labelledby="ret-new">
        <h2 id="ret-new">New return request</h2>
        <div className="field">
          <span>Order</span>
          <Autocomplete<StoreOrder> value={orderText} ariaLabel="Order" placeholder="Order number or store"
            onInput={t => { setOrderText(t); setOrder(null); }} onPick={o => { setOrder(o); setOrderText(`${o.id} · ${o.store}`); }}
            search={searchOrders} itemKey={o => o.id} complete={o => `${o.id} · ${o.store}`}
            render={o => <><span className="ac-code">{o.id}</span><span className="ac-name">{o.store}<small>{o.client} · {o.date}</small></span></>} invalid={!!orderText && !order} />
          {order && <small className="muted">Ordered: {order.lines.map(l => `${productById(l.productId)?.name} × ${l.cases}`).join(", ")}</small>}
        </div>
        <div className="field">
          <span>Photos</span>
          <div className="photos">
            {photos.map((src, i) => (
              <div key={i} className="photo"><img src={src} alt={`Return photo ${i + 1}`} /><button className="mini" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}><CloseIcon /></button></div>
            ))}
            <label className="photo add">
              <input type="file" accept="image/*" multiple capture="environment" onChange={async e => {
                const files = [...(e.target.files ?? [])].slice(0, 6 - photos.length);
                e.target.value = "";
                try { const shrunk = await Promise.all(files.map(shrink)); setPhotos(p => [...p, ...shrunk]); } catch { toast("One of those photos couldn't be read. Try a JPG or PNG."); }
              }} />
              <span>+ Add photos</span>
            </label>
          </div>
        </div>
        <div className="field">
          <span>Products and quantity (cases)</span>
          <div className="ret-items">
            {items.map((it, i) => (
              <div key={it.key} className="ret-item">
                <ProductInput productId={it.productId} client={order?.client} ariaLabel={`Returned product ${i + 1}`}
                  onChange={productId => setItems(items.map((x, j) => (j === i ? { ...x, productId } : x)))} />
                <input className="input num-in" type="number" min={1} value={it.cases || ""} aria-label="Cases"
                  onChange={e => setItems(items.map((x, j) => (j === i ? { ...x, cases: Math.max(0, parseInt(e.target.value) || 0) } : x)))} />
                <button className="mini" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove product"><CloseIcon /></button>
              </div>
            ))}
            <button className="btn small" onClick={() => setItems([...items, { key: `r${Date.now()}`, productId: null, cases: 1 }])}>+ Add product</button>
          </div>
        </div>
        <label className="field"><span>Reason</span>
          <select className="input" value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r} value={r}>{r}</option>)}</select>
        </label>
        <label className="field"><span>Other notes</span>
          <textarea className="input" rows={3} value={notes} placeholder="What happened, who reported it, anything the owner should know" onChange={e => setNotes(e.target.value)} />
        </label>
        <div className="panel-foot">
          <span className="muted small">Goes to the owners for approval. Nothing changes in inventory until then.</span>
          <button className="btn primary" disabled={!valid} onClick={submit}>Send for approval</button>
        </div>
      </section>

      <section className="panel glass" aria-labelledby="ret-list">
        <h2 id="ret-list">{owner ? "Return requests" : "Your requests"}</h2>
        <div className="pills">
          {sorted.map(r => (
            <a key={r.id} className={`pill${r.status === "pending" ? "" : " done"}`} href={`#/inbounds/returns/${r.id}`}>
              <span className="pill-title">{r.id} · {r.store}</span>
              <span className={`pill-meta${r.status === "pending" ? " warn" : r.status === "rejected" ? " danger" : " ok"}`}>{statusLabel(r)}</span>
              <span className="pill-arrow" aria-hidden="true">›</span>
            </a>
          ))}
          {!sorted.length && <p className="muted">No return requests yet.</p>}
        </div>
      </section>
    </div>
  );
}
