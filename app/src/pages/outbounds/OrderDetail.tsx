import { useEffect, useMemo, useState } from "react";
import { FACES, productById } from "../../data/catalog";
import { can, canSeeClient, visibleLines } from "../../auth/permissions";
import { expiryTone } from "../../chat/selectors";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { RackView, HIDDEN_PRODUCT, type SlotMark } from "../../components/RackView";
import { WarehouseMap, type MapMark } from "../../components/inventory/WarehouseMap";
import { SlotDetail } from "../../components/inventory/SlotDetail";
import { ThreadSection } from "../../components/chat/ThreadSection";
import { buildXlsx, download } from "../../utils/xlsx";
import { byLocation, fmtDay, fmtMonth, groupOf } from "../../inventory/selectors";
import { orderCases, pickRoute, pickedCases, reservations, statusOf } from "../../outbound/plan";
import { STATUS_LABEL, SOURCE_LABEL, dueText, dueTone } from "../../outbound/labels";
import type { PickLine, PickStrategy, StockLine, StoreOrder } from "../../store/types";
import { t } from "../../i18n";

const STRATEGIES: [PickStrategy, string][] = [["fifo-open-first", "Oldest stock first, finish open pallets first"], ["fifo", "Strictly oldest stock first"]];

/** One order: what was ordered, which pallets to pick (oldest stock first), where they are, and its status. */
export function OrderDetail({ order: o }: { order: StoreOrder }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const status = statusOf(o);
  // Coordinators and owners, or the worker the order was given to
  const mayPick = can(me, "assign-work") || o.assignee === me.id;
  const [focusProduct, setFocusProduct] = useState<string | null>(null);
  const [focusPick, setFocusPick] = useState<string | null>(null);
  const [face, setFace] = useState<string | undefined>();
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setFocusProduct(null); setFocusPick(null); setFace(undefined); }, [o.id]);

  const route = useMemo(() => pickRoute(o.picks ?? []), [o.picks]);
  const seq = new Map(route.map((p, i) => [p.key, i + 1]));
  // FIFO rank of each pallet within its product (1 = oldest stock)
  const fifoRank = useMemo(() => {
    const m = new Map<string, number>();
    const byProduct = new Map<string, PickLine[]>();
    for (const p of o.picks ?? []) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
    for (const list of byProduct.values()) [...list].sort((a, b) => a.arrival.localeCompare(b.arrival)).forEach((p, i) => m.set(p.key, i + 1));
    return m;
  }, [o.picks]);
  const shown = route.filter(p => !focusProduct || p.productId === focusProduct);
  const todo = shown.filter(p => !p.picked);
  const nextPick = route.find(p => !p.picked);

  // The plan is stale if a pallet no longer has the cases planned (moved, counted, or picked by someone else)
  const stale = useMemo(() => {
    if (!["approved", "picking"].includes(status)) return [];
    const reserved = reservations(state, o.id);
    return (o.picks ?? []).filter(p => {
      if (p.picked) return false;
      const here = (state.stock[p.location] ?? []).filter(l => l.productId === p.productId && expiryTone(l.bestBefore) !== "expired").reduce((a, l) => a + l.cases, 0);
      return here - (reserved.get(`${p.location}|${p.productId}`) ?? 0) < p.cases;
    });
  }, [state, o, status]);

  const marks = useMemo(() => {
    const m = new Map<string, MapMark>();
    for (const p of o.picks ?? []) if (!p.picked && (!focusProduct || p.productId === focusProduct)) m.set(p.location, { tone: "ok", partial: p.openPallet || p.cases < p.onPallet });
    return m;
  }, [o.picks, focusProduct]);
  const firstFace = (focusPick ? route.find(p => p.key === focusPick)?.location : todo[0]?.location ?? shown[0]?.location);
  const shownFace = face ?? (firstFace ? groupOf(firstFace) : undefined);
  const viewStock = useMemo(() => {
    const out: Record<string, StockLine[]> = {};
    for (const [code, lines] of Object.entries(state.stock)) { const { shown: s, hidden } = visibleLines(me, lines); out[code] = hidden ? [...s, { productId: HIDDEN_PRODUCT, cases: 0 }] : s; }
    return out;
  }, [state.stock, me]);
  const rackMarks: Record<string, SlotMark> = {};
  for (const p of shown) {
    if (!shownFace || groupOf(p.location) !== shownFace) continue;
    const n = seq.get(p.key)!;
    rackMarks[p.location] = p.picked ? { kind: "tone-ok", label: `✓${n}` } : { kind: p.key === focusPick ? "pulse" : "selected", label: `${n}`, partial: p.openPallet || p.cases < p.onPallet };
  }
  const floorPicks = shown.filter(p => shownFace && groupOf(p.location) === shownFace && !/-L\d-B\d$/.test(p.location));

  if (!canSeeClient(me, o.client)) return <div className="panel glass"><p>This order is for {o.client}, which you don't have access to.</p></div>;

  const lineStats = o.lines.map(l => {
    const ps = (o.picks ?? []).filter(p => p.productId === l.productId);
    return { ...l, planned: ps.reduce((a, p) => a + (p.picked ? p.picked.cases : p.cases), 0), picked: ps.reduce((a, p) => a + (p.picked?.cases ?? 0), 0), short: o.short?.[l.productId] ?? 0,
      expired: Object.values(state.stock).flat().filter(x => x.productId === l.productId && expiryTone(x.bestBefore) === "expired").reduce((a, x) => a + x.cases, 0) };
  });
  const totalShort = Object.values(o.short ?? {}).reduce((a, n) => a + n, 0);
  const done = pickedCases(o), total = orderCases(o);
  const choose = (p: PickLine) => { setFocusPick(p.key); setFace(groupOf(p.location)); };

  const confirm = (p: PickLine) => {
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n < 0) { toast("Enter the cases taken."); return; }
    if (n < p.cases && !note.trim()) { toast("Say why fewer cases were taken (e.g. pallet was short)."); return; }
    dispatch({ type: "order/pick", id: o.id, key: p.key, cases: n, by: me.name, note: note.trim() || undefined });
    toast(n < p.cases ? `Took ${n} of ${p.cases} from ${p.location}. The rest is planned from the next oldest pallet.` : `Picked ${n} cs from ${p.location}.`);
    setConfirming(null); setNote("");
    const next = route.find(x => !x.picked && x.key !== p.key);
    if (next) choose(next);
  };
  const exportList = () => download(buildXlsx([{
    name: "Pick list", header: ["#", "Location", "Code", "Product", "Size", "Take (cases)", "On pallet", "After pick", "Lot", "Best before", "Arrived", "Picked"],
    widths: [5, 15, 10, 32, 11, 10, 9, 10, 11, 11, 11, 14],
    rows: route.map((p, i) => { const pr = productById(p.productId); return [i + 1, p.location, pr?.code, pr?.name, pr?.size, p.cases, p.onPallet, p.onPallet - p.cases, p.lot ?? "", p.bestBefore ?? "", p.arrival, p.picked ? `${p.picked.cases} · ${p.picked.by}` : ""]; }),
    totalRow: ["", "", "", `${o.id} · ${o.store}`, "", route.reduce((a, p) => a + p.cases, 0), "", "", "", "", "", ""],
  }]), `pick-list-${o.id.replace(/\s+/g, "-").toLowerCase()}.xlsx`);

  return (
    <div className="stack order">
      <div className="panel glass order-head">
        <div className="order-title">
          <h2>{o.id} <span className="muted">· {o.store}</span></h2>
          <p className="muted small">{o.client}{o.ref ? ` · PO ${o.ref}` : ""} · {SOURCE_LABEL[o.source ?? "app"]}{o.sourceName ? ` (${o.sourceName})` : ""} · ordered {fmtDay(o.date)}{o.approvedBy ? ` · approved by ${o.approvedBy}` : ""}</p>
        </div>
        <div className="order-tags">
          <span className={`status-tag ${status}`}>{STATUS_LABEL[status]}</span>
          <span className={`due-tag ${dueTone(o)}`}>{dueText(o)}</span>
          {["approved", "picking"].includes(status) && (can(me, "assign-work")
            ? <select className="input packer" value={o.assignee ?? ""} onChange={e => { dispatch({ type: "order/assign", id: o.id, assignee: e.target.value || undefined }); toast(e.target.value ? `${o.id} given to ${state.chat.users.find(u => u.id === e.target.value)?.name} to pack.` : `${o.id} isn't given to anyone now.`); }} aria-label="Who packs this order">
                <option value="">Packer: not given out</option>
                {state.chat.users.filter(u => u.role === "worker" && canSeeClient(u, o.client)).map(u => <option key={u.id} value={u.id}>Packer: {u.name}</option>)}
              </select>
            : o.assignee ? <span className="tag">packed by {o.assignee === me.id ? "you" : state.chat.users.find(u => u.id === o.assignee)?.name}</span> : null)}
        </div>
        <div className="order-prog">
          <span className="fill-bar"><i style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} /></span>
          <small>{done} of {total} cases picked{totalShort ? ` · ${totalShort} short` : ""}</small>
        </div>
        <div className="btns">
          {status === "draft" && <a className="btn small" href={`#/outbounds/orders/${encodeURIComponent(o.id)}/edit`}>Edit</a>}
          {status === "draft" && can(me, "approve-order") && <button className="btn small primary" disabled={!o.lines.length} onClick={() => { dispatch({ type: "order/approve", id: o.id, by: me.name, strategy: o.strategy ?? "fifo-open-first" }); toast(`${o.id} approved. Pallets planned, oldest stock first.`); }}>Approve & plan picks</button>}
          {status === "draft" && !can(me, "approve-order") && <span className="muted small">A coordinator or owner approves orders.</span>}
          {status === "draft" && <button className="btn small danger" onClick={() => { if (window.confirm(t(`Delete the draft ${o.id}?`))) { dispatch({ type: "order/delete", id: o.id }); go("#/outbounds/orders"); } }}>Delete draft</button>}
          {status !== "draft" && can(me, "print-labels") && <a className="btn small" href={`#/outbounds/labels/${encodeURIComponent(o.id)}`}>Case labels</a>}
          {(o.picks?.length ?? 0) > 0 && can(me, "export") && <><button className="btn small" onClick={exportList}>Pick list (.xlsx)</button><button className="btn small" onClick={() => window.print()}>Print</button></>}
          {(status === "picked" || (status === "picking" && route.every(p => p.picked))) && can(me, "ship-order") && (
            <button className="btn small primary" onClick={() => { if (!totalShort || window.confirm(t(`${totalShort} cases are short. Ship what was picked?`))) { dispatch({ type: "order/ship", id: o.id, by: me.name }); toast(`${o.id} marked shipped.`); } }}>Mark shipped</button>
          )}
          {["approved", "picking", "picked"].includes(status) && can(me, "cancel-order") && (
            <button className="btn small danger" onClick={() => { const r = window.prompt(t(`Cancel ${o.id}? Picked cases go back on their pallets. Reason:`)); if (r?.trim()) { dispatch({ type: "order/cancel", id: o.id, by: me.name, reason: r.trim() }); toast(`${o.id} cancelled.`); } }}>Cancel order</button>
          )}
        </div>
      </div>

      {totalShort > 0 && status !== "draft" && (
        <p className="note warn">Short {totalShort} cases: {lineStats.filter(l => l.short).map(l => `${productById(l.productId)?.code} ${productById(l.productId)?.name} (${l.short} cs${l.expired ? `; ${l.expired} cs in stock are expired and can't be picked` : ""})`).join(", ")}. Not enough stock that isn't expired or already reserved for other orders.</p>
      )}
      {(o.avoid?.length ?? 0) > 0 && (
        <p className="note warn">Recount: a picker found fewer cases than recorded at {o.avoid!.map(k => { const [loc, pid] = k.split("|"); return `${loc} (${productById(pid)?.code})`; }).join(", ")}. {o.avoid!.length > 1 ? "They're" : "It's"} skipped for this order; the stock record still shows the old cases until it's counted. <a className="link" href={`#/inventory/stock/${encodeURIComponent(o.avoid![0].split("|")[0])}`}>Open in Inventory ›</a></p>
      )}
      {stale.length > 0 && (
        <p className="note warn">Stock changed since this plan ({stale.map(p => p.location).join(", ")}). <button className="link" onClick={() => { dispatch({ type: "order/plan", id: o.id, strategy: o.strategy ?? "fifo-open-first" }); toast("Re-planned the picks still to do."); }}>Re-plan picks</button></p>
      )}

      <div className="panel glass">
        <div className="panel-foot"><h2 className="plain-h">Ordered</h2><span className="muted small">Click a product to see only its pallets on the map</span></div>
        <div className="order-lines">
          {lineStats.map(l => {
            const p = productById(l.productId);
            return (
              <button key={l.productId} className={`oline${focusProduct === l.productId ? " on" : ""}${l.short ? " short" : ""}`} onClick={() => setFocusProduct(f => (f === l.productId ? null : l.productId))} aria-pressed={focusProduct === l.productId}>
                <span className="mono">{p?.code}</span>
                <span className="oline-name">{p?.name}<small>{p?.size}{p?.units ? ` × ${p.units}` : ""}</small></span>
                <span className="oline-n"><b>{l.cases}</b> cs</span>
                <span className="oline-prog"><span className="fill-bar"><i style={{ width: `${Math.min(100, (l.picked / l.cases) * 100)}%` }} /></span><small>{l.picked} picked{l.short ? ` · ${l.short} short` : ""}</small></span>
              </button>
            );
          })}
          {!o.lines.length && <p className="muted">No products yet.</p>}
        </div>
      </div>

      {(o.picks?.length ?? 0) > 0 ? (
        <div className="pick-layout">
          <div className="panel glass pick-panel">
            <div className="panel-foot">
              <div><h2 className="plain-h">Pick list</h2><p className="muted small">In walking order. Pallets are chosen oldest stock first; open pallets are finished before a new one is opened.</p></div>
              {["approved", "picking"].includes(status) && (
                <label className="field inline small-field"><span>Plan</span>
                  <select className="input" value={o.strategy ?? "fifo-open-first"} onChange={e => { dispatch({ type: "order/plan", id: o.id, strategy: e.target.value as PickStrategy }); toast("Re-planned the picks still to do."); }}>
                    {STRATEGIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </label>
              )}
            </div>
            {nextPick && status !== "draft" && !focusProduct && <p className="next-pick">Next: <b className="mono">{nextPick.location}</b> · take <b>{nextPick.cases}</b> × {productById(nextPick.productId)?.name}</p>}
            <ol className="picks">
              {shown.map(p => {
                const pr = productById(p.productId)!;
                const n = seq.get(p.key)!;
                const left = p.onPallet - p.cases;
                const whole = left === 0;
                const tone = expiryTone(p.bestBefore);
                return (
                  <li key={p.key} className={`pick${p.picked ? " done" : ""}${p.key === focusPick ? " on" : ""}`} onClick={() => choose(p)}>
                    <span className="pick-n">{p.picked ? "✓" : n}</span>
                    <div className="pick-main">
                      <div className="pick-top"><b className="mono">{p.location}</b><span>{pr.name} <small className="muted">{pr.size} · {pr.code}</small></span></div>
                      <div className="pick-take">
                        Take <b>{p.cases}</b> of {p.onPallet} cs
                        {whole ? <em className="tag">whole pallet · slot empties</em> : <em className="tag warn">leaves {left} · open pallet, used first next time</em>}
                        {p.openPallet && <em className="tag">open pallet</em>}
                        <em className="tag" title="1 = oldest stock of this product on the list">FIFO {fifoRank.get(p.key)}</em>
                      </div>
                      <small className="muted">arrived {fmtDay(p.arrival)} · lot {p.lot || "—"} · best before <span className={`bb ${tone}`}>{fmtMonth(p.bestBefore)}</span></small>
                      {p.picked && <small className="muted">Picked {p.picked.cases} cs by {p.picked.by}, {fmtDay(p.picked.at)}{p.picked.note ? ` · ${p.picked.note}` : ""}</small>}
                      {confirming === p.key && (
                        <form className="pick-confirm" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); confirm(p); }}>
                          <label>Cases taken <input className="input num-in" autoFocus inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ""))} /></label>
                          {Number(qty) < p.cases && <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Why fewer? e.g. pallet was short" aria-label="Reason" />}
                          <button className="btn small primary">Confirm</button>
                          <button type="button" className="btn small" onClick={() => setConfirming(null)}>Cancel</button>
                        </form>
                      )}
                    </div>
                    <div className="pick-act" onClick={e => e.stopPropagation()}>
                      {!p.picked && ["approved", "picking"].includes(status) && confirming !== p.key && mayPick && <button className="btn small primary" onClick={() => { setConfirming(p.key); setQty(String(p.cases)); setNote(""); choose(p); }}>Picked</button>}
                      {p.picked && ["picking", "picked"].includes(status) && <button className="btn small" onClick={() => { dispatch({ type: "order/unpick", id: o.id, key: p.key, by: me.name }); toast(`Put ${p.picked!.cases} cs back on ${p.location}.`); }}>Undo</button>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="panel glass map-panel">
            <div className="panel-foot"><h2 className="plain-h">{focusProduct ? `Where ${productById(focusProduct)?.name} is` : "Where to pick"}</h2>
              <span className="muted small">{marks.size} pallet{marks.size === 1 ? "" : "s"} to visit · numbers are the walking order</span></div>
            <WarehouseMap stock={viewStock} marks={marks} current={shownFace} onFace={setFace} onlyHits />
            {shownFace && FACES.some(f => f.id === shownFace) && <RackView faceId={shownFace} onFace={setFace} stock={viewStock} marks={rackMarks} onCell={setOpen} />}
            {floorPicks.length > 0 && <div className="offrack"><span className="muted small">On the floor:</span>{floorPicks.sort((a, b) => byLocation(a.location, b.location)).map(p => <button key={p.key} className={`chip-btn${p.key === focusPick ? " on" : ""}`} onClick={() => choose(p)}>{seq.get(p.key)}. {p.location}</button>)}</div>}
            <div className="legend-row muted small"><span><i className="sw sel" /> pallet to pick (number = walking order)</span><span><i className="sw partial" /> partial take or open pallet</span><span><i className="sw tone-ok" /> picked</span></div>
          </div>
        </div>
      ) : status === "draft" ? (
        <p className="panel glass muted">Pallets are planned when the order is approved: oldest stock first, open pallets first, never expired stock.</p>
      ) : null}

      {o.sourceText && (
        <details className="panel glass"><summary>Text read from the {o.source === "email" ? "email" : "PDF"}</summary><pre className="source-text">{o.sourceText}</pre></details>
      )}
      {o.notes && <p className="panel glass small" style={{ whiteSpace: "pre-wrap" }}>{o.notes}</p>}
      <ThreadSection target={{ order: o.id }} />
      {open && <SlotDetail code={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
