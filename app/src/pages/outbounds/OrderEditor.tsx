import { useMemo, useState } from "react";
import { CLIENTS, productById, type Client } from "../../data/catalog";
import { can, canSeeClient } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { ProductInput } from "../../components/ProductInput";
import { CloseIcon } from "../../components/icons";
import { defaultStrategy, nextOrderId, strategyName } from "../../outbound/plan";
import { pdfText, readOrder, type ReadOrder } from "../../outbound/reader";
import { productSummaries } from "../../inventory/selectors";
import type { OrderSource, StoreOrder } from "../../store/types";

type Line = { key: string; productId: string | null; cases: number; how?: "code" | "name" };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * A new order (typed in, or read from a PDF), or a draft to check. Saved orders are drafts until a coordinator or
 * owner approves them; approving plans which pallets to pick.
 */
export function OrderEditor({ order }: { order?: StoreOrder }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const clients = CLIENTS.filter(c => canSeeClient(me, c));
  const [client, setClient] = useState<Client>(order?.client ?? clients[0]);
  const [store, setStore] = useState(order?.store ?? "");
  const [due, setDue] = useState(order?.due ?? "");
  const [ref, setRef] = useState(order?.ref ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (order?.lines.length ? order.lines.map((l, i) => ({ key: `l${i}`, ...l })) : [{ key: "l0", productId: null, cases: 1 }]));
  const [source, setSource] = useState<{ kind: OrderSource; name?: string; text?: string; url?: string; read?: ReadOrder }>(() => ({ kind: order?.source ?? "app", name: order?.sourceName, text: order?.sourceText }));
  const [reading, setReading] = useState(false);
  const stores = useMemo(() => [...new Set(state.orders.map(o => o.store))].sort(), [state.orders]);
  const stockOf = useMemo(() => new Map(productSummaries(state, me).map(s => [s.product.id, s.cases])), [state, me]);

  const applyRead = (r: ReadOrder, kind: OrderSource, name: string, text: string, url?: string) => {
    setSource({ kind, name, text, url, read: r });
    if (r.client && canSeeClient(me, r.client)) setClient(r.client);
    if (r.store) setStore(r.store);
    if (r.due) setDue(r.due);
    if (r.ref) setRef(r.ref);
    if (r.lines.length) setLines(r.lines.map((l, i) => ({ key: `r${i}`, productId: l.productId, cases: l.cases, how: l.how })));
  };
  const onPdf = async (file: File) => {
    setReading(true);
    try {
      const { text, pages } = await pdfText(file);
      const url = URL.createObjectURL(file);
      if (!text.trim()) { setSource({ kind: "pdf", name: file.name, text: "", url }); toast(`No text in ${file.name} (${pages} page${pages > 1 ? "s" : ""}): it's probably a scan or photo. Type the lines while looking at it.`); return; }
      const r = readOrder(text, stores);
      applyRead(r, "pdf", file.name, text, url);
      toast(`Read ${r.lines.length} line${r.lines.length === 1 ? "" : "s"} from ${file.name}${r.unread.length ? `; ${r.unread.length} line${r.unread.length > 1 ? "s" : ""} need a look` : ""}. Check before saving.`);
    } catch { toast("That PDF couldn't be read."); } finally { setReading(false); }
  };

  const valid = lines.filter(l => l.productId && l.cases > 0);
  const wrongClient = valid.filter(l => productById(l.productId!)?.client !== client);
  const save = (approve: boolean) => {
    if (!store.trim()) { toast("Enter the store."); return; }
    if (!valid.length) { toast("Add at least one product."); return; }
    if (wrongClient.length) { toast(`Some products aren't ${client}'s. One order is for one client.`); return; }
    const merged = new Map<string, number>();
    for (const l of valid) merged.set(l.productId!, (merged.get(l.productId!) ?? 0) + l.cases);
    const id = order?.id ?? nextOrderId(state.orders);
    const next: StoreOrder = {
      ...order, id, store: store.trim(), client, due: due || undefined, ref: ref.trim() || undefined, notes: notes.trim() || undefined,
      date: order?.date ?? today(), lines: [...merged].map(([productId, cases]) => ({ productId, cases })),
      status: "draft", source: source.kind, sourceName: source.name, sourceText: source.text || undefined,
      createdBy: order?.createdBy ?? me.name, createdAt: order?.createdAt ?? new Date().toISOString(),
    };
    dispatch({ type: "order/save", order: next, isNew: !order });
    if (approve) dispatch({ type: "order/approve", id, by: me.name, strategy: next.strategy ?? defaultStrategy(state), created: next.createdAt });
    toast(approve ? `${id} saved and approved. Pallets planned: ${strategyName(next.strategy ?? defaultStrategy(state)).replace(/^./, c => c.toLowerCase())}.` : `${id} saved as a draft for approval.`);
    go(`#/outbounds/orders/${encodeURIComponent(id)}`);
  };

  return (
    <div className="order-editor">
      <div className="panel glass form">
        <div className="panel-foot"><h2 className="plain-h">{order ? `${order.id} · check and edit` : "New order"}</h2>
          {!order && (
            <label className={`btn small${reading ? " busy" : ""}`}>
              {reading ? "Reading…" : "Read from a PDF…"}
              <input type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onPdf(f); }} />
            </label>
          )}
        </div>
        <div className="facts">
          <label className="fact"><span>Client</span>
            <select className="input" value={client} onChange={e => setClient(e.target.value as Client)}>{clients.map(c => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="fact"><span>Store</span>
            <input className="input" list="stores" value={store} onChange={e => setStore(e.target.value)} placeholder="Store name and branch" />
            <datalist id="stores">{stores.map(s => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="fact"><span>Due date</span><input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
          <label className="fact"><span>Store's PO / slip no.</span><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="optional" /></label>
        </div>
        <div className="field">
          <span>Products and cases</span>
          <div className="ret-items">
            {lines.map((l, i) => {
              const p = l.productId ? productById(l.productId) : undefined;
              const have = l.productId ? stockOf.get(l.productId) ?? 0 : null;
              return (
                <div key={l.key} className={`ret-item${p && p.client !== client ? " wrong" : ""}`}>
                  <ProductInput productId={l.productId} client={client} ariaLabel={`Product ${i + 1}`} onChange={productId => setLines(lines.map((x, j) => (j === i ? { ...x, productId, how: undefined } : x)))} />
                  <input className="input num-in" type="number" min={1} value={l.cases || ""} aria-label="Cases" onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, cases: Math.max(0, parseInt(e.target.value) || 0) } : x)))} />
                  <button className="mini" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove product"><CloseIcon /></button>
                  <small className="ret-hint">
                    {l.how === "name" && <em className="tag warn">matched by name, check it</em>}
                    {p && p.client !== client && <em className="tag warn">{p.client}'s product</em>}
                    {have !== null && <span className={have < l.cases ? "warn" : "muted"}>{have.toLocaleString()} cs in stock{have < l.cases ? " · not enough" : ""}</span>}
                  </small>
                </div>
              );
            })}
            <button className="btn small" onClick={() => setLines([...lines, { key: `l${Date.now()}`, productId: null, cases: 1 }])}>+ Add product</button>
          </div>
        </div>
        <label className="field"><span>Notes</span><textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery instructions, contact…" /></label>
        <div className="panel-foot">
          <span className="muted small">{valid.length} product{valid.length === 1 ? "" : "s"} · {valid.reduce((a, l) => a + l.cases, 0)} cases · saved as a draft until approved</span>
          <span className="btns">
            <button className="btn" onClick={() => go(order ? `#/outbounds/orders/${encodeURIComponent(order.id)}` : "#/outbounds/orders")}>Cancel</button>
            <button className="btn" onClick={() => save(false)}>Save draft</button>
            {can(me, "approve-order") && <button className="btn primary" onClick={() => save(true)}>Save & approve</button>}
          </span>
        </div>
      </div>

      {(source.text !== undefined && source.kind !== "app") || source.url ? (
        <div className="panel glass source-panel">
          <h2 className="plain-h">{source.name ?? "Source"}</h2>
          {source.read && source.read.unread.length > 0 && (
            <div className="note warn"><b>Lines not read</b> (add them by hand if they're products):<ul>{source.read.unread.map((u, i) => <li key={i} className="mono">{u}</li>)}</ul></div>
          )}
          {source.url && <iframe className="pdf-view" src={source.url} title={`PDF ${source.name}`} />}
          {source.text ? <pre className="source-text">{source.text}</pre> : <p className="muted small">No text could be read from this file.</p>}
        </div>
      ) : (
        <div className="panel glass source-panel hint-panel">
          <h2 className="plain-h">Other ways orders come in</h2>
          <p className="small">Read from a PDF: the store's order slip or PO. Codes, cases, store, due date and PO number are filled in; you check and save.</p>
          <p className="small">Email: orders sent to the order inbox show up under Inbox, ready to turn into drafts.</p>
          <p className="small muted">Clients can also send orders themselves from the client portal; they arrive here as drafts.</p>
        </div>
      )}
    </div>
  );
}
