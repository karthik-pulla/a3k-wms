import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FACES, describeLocation, productById, slotCode, slotMeta, spotCode } from "../../data/catalog";
import { can, visibleLines } from "../../auth/permissions";
import { normalizeLocation } from "../../chat/refs";
import { arrivalDate, expiryTone, isPartial } from "../../chat/selectors";
import { useOverlay } from "../../chat/overlay";
import { useStore, shipmentTitle } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../Toast";
import { ThreadSection } from "../chat/ThreadSection";
import { ProductInput } from "../ProductInput";
import { isOpen, nextSlot, occupied, taskId } from "../../store/tasks";
import type { StockLine } from "../../store/types";
import { CloseIcon } from "../icons";
import { fmtDay, fmtMonth, groupOf, locKind } from "../../inventory/selectors";

const MOVE_REASONS = ["Consolidating partial pallets", "Making room for a delivery", "Wrong slot at put-away", "Closer to where it's picked", "Damaged or unsafe rack", "Other"];

/** Everything about one location: each product on the pallet, its history and messages, and moving it. */
export function SlotDetail({ code, onClose, onOpen }: { code: string; onClose: () => void; onOpen?: (code: string) => void }) {
  const { state } = useStore();
  const { me } = useSession();
  const overlay = useOverlay();
  const [moving, setMoving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => { setMoving(false); setAdjusting(false); }, [code]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof Element && e.target.closest("input, select, textarea"))) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const lines = state.stock[code] ?? [];
  const { shown, hidden } = visibleLines(me, lines);
  const kind = locKind(code);
  const history = can(me, "view-history") ? state.movements.filter(m => m.location === code || m.from === code).slice(0, 12) : null;
  const meta = slotMeta(code);

  // Rendered at the page root: a frosted (backdrop-filter) parent would otherwise trap the fixed drawer inside it
  return createPortal(
    <aside className="drawer glass" aria-label={`Location ${code}`}>
      <div className="drawer-head">
        <div>
          <h2 className="mono-h">{code}</h2>
          <p className="muted small">{describeLocation(code)}{kind !== "slot" ? " · floor spot" : ""}</p>
        </div>
        <button className="iconbtn glass" onClick={onClose} aria-label="Close details"><CloseIcon /></button>
      </div>

      <div className="btns">
        <button className="btn small" onClick={() => overlay({ kind: "slots", codes: [code] })}>Show on map</button>
        {shown.length > 0 && !hidden && can(me, "move-stock") && <button className="btn small" onClick={() => setMoving(m => !m)} aria-expanded={moving}>Move pallet…</button>}
        {meta && onOpen && <NeighbourNav code={code} onOpen={onOpen} />}
      </div>
      {moving && <MovePallet from={code} onDone={to => { setMoving(false); onOpen?.(to); }} />}
      {can(me, "adjust-stock") && !hidden && (adjusting ? <AdjustStock code={code} onDone={() => setAdjusting(false)} /> : <button className="link small adjust-open" onClick={() => setAdjusting(true)}>Adjust stock here (owner)…</button>)}

      {shown.length > 0 ? (
        <section className="dsec">
          <h3>{shown.length + hidden > 1 ? `Mixed pallet · ${shown.length + hidden} products` : "On this pallet"}</h3>
          {shown.map((l, i) => {
            const p = productById(l.productId)!;
            const tone = expiryTone(l.bestBefore);
            const ship = l.shipmentId ? state.shipments.find(s => s.id === l.shipmentId) : undefined;
            return (
              <div key={i} className={`dline${tone === "expired" ? " expired" : ""}`}>
                <div className="dline-top">
                  <span><b>{p.name}</b> <span className="muted">{p.size}{p.units ? ` × ${p.units}` : ""}</span></span>
                  <span className="dcases">{l.cases}<small> cs</small></span>
                </div>
                <dl className="dfacts">
                  <div><dt>Code</dt><dd className="mono">{p.code}</dd></div>
                  <div><dt>Brand</dt><dd>{p.brand || p.client}{p.brand && p.brand !== p.client ? ` · ${p.client}` : ""}</dd></div>
                  <div><dt>Lot</dt><dd>{l.lot || "—"}</dd></div>
                  <div><dt>Best before</dt><dd><span className={`bb ${tone}`}>{fmtMonth(l.bestBefore)}</span>{tone === "expired" ? " · can't be picked" : tone === "warn" ? " · expiring" : ""}</dd></div>
                  <div><dt>Arrived</dt><dd>{fmtDay(arrivalDate(state, code, l))}{l.shipmentId ? "" : " (sample)"}</dd></div>
                  <div><dt>Pallet</dt><dd>{p.perPallet ? `${isPartial(l) ? "Partial" : "Full"} · ${p.perPallet} cs when full` : "Full size unknown"}</dd></div>
                  {p.cat && <div><dt>Category</dt><dd>{p.cat}</dd></div>}
                  {ship && <div><dt>Delivery</dt><dd><a className="link" href={`#/inbounds/${ship.status === "incoming" ? "incoming" : "pending"}/${ship.id}`}>{shipmentTitle(ship)} · {ship.ref}</a></dd></div>}
                </dl>
                {p.item && <p className="mono ditem" title="Full item text">{p.item}</p>}
              </div>
            );
          })}
        </section>
      ) : !hidden && <p className="dempty">{kind === "slot" ? "Empty slot." : "Nothing on this floor spot."}</p>}
      {hidden > 0 && <p className="muted small">{hidden} product line{hidden > 1 ? "s" : ""} of another client's stock here (hidden).</p>}

      {history && (
        <section className="dsec">
          <h3>History</h3>
          {history.length ? (
            <ol className="dhist">
              {history.map(m => (
                <li key={m.id}>
                  <span>{m.type === "move" ? (m.from === code ? `Moved to ${m.location}` : `Moved in from ${m.from}`) : m.type === "count-correction" ? `Count correction ${m.cases! > 0 ? "+" : ""}${m.cases}` : m.type === "putaway" ? `Put away ${m.cases} cs` : m.type}
                    {m.productId && <small> · {productById(m.productId)?.name}</small>}</span>
                  <small>{fmtDay(m.at)} · {m.by}{m.reason ? ` · ${m.reason}` : ""}</small>
                </li>
              ))}
            </ol>
          ) : <p className="muted small">No changes recorded here since the sheets were loaded.</p>}
        </section>
      )}
      <ThreadSection target={{ slot: code }} title="Messages about this location" />
    </aside>,
    document.body,
  );
}

/** The slots next to this one on the same rack side (null at the edges) */
export function neighbours(code: string) {
  const m = slotMeta(code);
  if (!m) return { left: null, right: null, up: null, down: null };
  const at = (col: number, level: number, bay: number) => { const c = slotCode(m.face, col, level, bay); return slotMeta(c) ? c : null; };
  return {
    left: at(m.col, m.level, m.bay - 1) ?? at(m.col - 1, m.level, 3) ?? at(m.col - 1, m.level, 2) ?? at(m.col - 1, m.level, 1),
    right: at(m.col, m.level, m.bay + 1) ?? at(m.col + 1, m.level, 1),
    up: at(m.col, m.level + 1, m.bay) ?? at(m.col, m.level + 1, 1),
    down: at(m.col, m.level - 1, m.bay) ?? at(m.col, m.level - 1, 1),
  };
}

/** ← → ↑ ↓ buttons (and the arrow keys) to step to the neighbouring slot on the same rack side */
function NeighbourNav({ code, onOpen }: { code: string; onOpen: (code: string) => void }) {
  const n = neighbours(code);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.closest("input, select, textarea, .count-grid")) || e.metaKey || e.ctrlKey || e.altKey) return;
      const to = { ArrowLeft: n.left, ArrowRight: n.right, ArrowUp: n.up, ArrowDown: n.down }[e.key];
      if (to) { e.preventDefault(); onOpen(to); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [n.left, n.right, n.up, n.down, onOpen]);
  return (
    <span className="nbr" role="group" aria-label="Neighbouring slots (arrow keys)">
      {([["←", n.left, "Left"], ["↑", n.up, "Level up"], ["↓", n.down, "Level down"], ["→", n.right, "Right"]] as const).map(([t, c, l]) => (
        <button key={l} className="mini" disabled={!c} onClick={() => c && onOpen(c)} aria-label={`${l}${c ? `: ${c}` : ""}`} title={c ?? ""}>{t}</button>
      ))}
    </span>
  );
}

/** Move a whole pallet to an empty slot or floor spot. A reason is required and the move is logged. */
/**
 * Moving a pallet. Workers: the WMS gives the slot and it becomes their task (stock moves when they confirm it's there).
 * Coordinators and owners may choose the slot, then give the move to a worker or record a move they already did.
 */
function MovePallet({ from, onDone }: { from: string; onDone: (to: string) => void }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const lead = can(me, "choose-slot");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState(MOVE_REASONS[0]);
  const [other, setOther] = useState("");
  const [how, setHow] = useState<"task" | "done">("task");
  const [assignee, setAssignee] = useState("");
  const taken = useMemo(() => occupied(state), [state]);
  const wmsSlot = useMemo(() => nextSlot(state, from), [state, from]);
  const suggestions = useMemo(() => {
    const m = slotMeta(from);
    const face = groupOf(from);
    const out: string[] = [];
    const f = FACES.find(x => x.id === face);
    if (f) {
      const empties = f.cols.flatMap(([col, slots]) => slots.map(([lv, bay]) => ({ code: slotCode(f.id, col, lv, bay), col, lv })))
        .filter(s => !taken[s.code]?.length && s.code !== from)
        .sort((a, b) => Math.abs(a.col - (m?.col ?? 0)) - Math.abs(b.col - (m?.col ?? 0)) || a.lv - b.lv);
      out.push(...empties.slice(0, 4).map(s => s.code));
    }
    for (let n = 1; n < 100; n++) { const c = spotCode(face, n); if (!taken[c]?.length) { out.push(c); break; } }
    return out;
  }, [from, taken]);
  const pending = state.tasks.some(t => isOpen(t) && (t.from === from || t.to === from));
  const target = lead ? normalizeLocation(to) : wmsSlot;
  const busy = target ? !!taken[target]?.length : false;
  const why = reason === "Other" ? other.trim() : reason;
  const ok = !pending && !!target && !busy && target !== from && !!why;
  const workers = state.chat.users.filter(u => u.role === "worker");
  if (pending) return <p className="note">This pallet already has an open task. <a className="link" href={lead ? "#/tasks" : "#/work"}>See tasks ›</a></p>;
  return (
    <form className="move glass" onSubmit={e => {
      e.preventDefault(); if (!ok) return;
      if (lead && how === "done") {
        dispatch({ type: "move", from, to: target!, by: me.name, reason: why });
        toast(`Moved ${from} to ${target}. Logged with reason "${why}".`);
        onDone(target!);
        return;
      }
      dispatch({ type: "task/create", task: { id: taskId(), kind: "move", status: "open", from, to: target!, lines: state.stock[from] ?? [], reason: why, assignee: lead ? assignee || undefined : me.id, createdBy: me.name, createdAt: new Date().toISOString() } });
      toast(lead ? `Task created: ${from} → ${target}.` : `The WMS gave ${target}. It's on your Work screen; confirm when the pallet is there.`);
      onDone(from);
    }}>
      {lead ? (
        <>
          <label className="field"><span>Move to</span>
            <input className={`input${to && (!target || busy) ? " invalid" : ""}`} value={to} onChange={e => setTo(e.target.value)} placeholder={`WMS suggests ${wmsSlot}`} autoFocus aria-describedby="move-hint" />
          </label>
          <p id="move-hint" className="small muted">{!to ? "Nearest free spots:" : !target ? "That isn't a real slot, floor spot or area." : busy ? `${target} isn't free.` : target === from ? "That's where it is now." : `Moves everything on ${from} to ${target}.`}</p>
          <div className="chip-wrap">{suggestions.map(c => <button type="button" key={c} className="chip-btn" onClick={() => setTo(c)}>{c}</button>)}</div>
        </>
      ) : <p className="move-wms">The WMS gives this pallet <b className="mono">{wmsSlot}</b>. Take it there and confirm on your Work screen.</p>}
      <label className="field"><span>Reason</span>
        <select className="input" value={reason} onChange={e => setReason(e.target.value)}>{MOVE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}</select>
      </label>
      {reason === "Other" && <input className="input" value={other} onChange={e => setOther(e.target.value)} placeholder="Why is it moving?" aria-label="Reason" />}
      {lead && (
        <div className="segment s2" role="group" aria-label="Who moves it">
          <button type="button" aria-pressed={how === "task"} onClick={() => setHow("task")}>Give to a worker</button>
          <button type="button" aria-pressed={how === "done"} onClick={() => setHow("done")}>I moved it already</button>
        </div>
      )}
      {lead && how === "task" && <select className="input" value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Give to"><option value="">Any worker</option>{workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
      <button className="btn primary" disabled={!ok}>{lead ? (how === "done" ? "Record the move" : "Create the task") : "Get this task"}</button>
    </form>
  );
}

/** Owners only: change what's in a location directly. Edit, review the before/after, give a reason, confirm. Logged. */
function AdjustStock({ code, onDone }: { code: string; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const before = state.stock[code] ?? [];
  const [lines, setLines] = useState<StockLine[]>(() => before.map(l => ({ ...l })));
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [reason, setReason] = useState("");
  const valid = lines.every(l => l.productId && l.cases > 0);
  const same = JSON.stringify(lines) === JSON.stringify(before);
  const show = (ls: StockLine[]) => ls.length ? ls.map(l => `${productById(l.productId)?.code ?? "?"} ${productById(l.productId)?.name ?? ""} × ${l.cases}${l.lot ? ` (lot ${l.lot})` : ""}${l.bestBefore ? ` bb ${l.bestBefore}` : ""}`).join(" + ") : "empty";
  return (
    <div className="adjust glass">
      <p className="note warn">Changing stock directly skips counts and tasks. Use it to fix mistakes; every change is in Logs.</p>
      {step === "edit" ? (
        <>
          {lines.map((l, i) => (
            <div key={i} className="adjust-line">
              <ProductInput productId={l.productId || null} ariaLabel={`Product ${i + 1}`} onChange={id => setLines(lines.map((x, j) => (j === i ? { ...x, productId: id ?? "" } : x)))} />
              <input className="input num-in" type="number" min={1} value={l.cases || ""} aria-label="Cases" onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, cases: Math.max(0, parseInt(e.target.value) || 0) } : x)))} />
              <input className="input" value={l.lot ?? ""} placeholder="Lot" aria-label="Lot" onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, lot: e.target.value || undefined } : x)))} />
              <input className="input" type="month" value={l.bestBefore ?? ""} aria-label="Best before" onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, bestBefore: e.target.value || undefined } : x)))} />
              <button className="mini" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><CloseIcon /></button>
            </div>
          ))}
          <div className="btns">
            <button className="btn small" onClick={() => setLines([...lines, { productId: "", cases: 1 }])}>+ Line</button>
            <span className="grow" />
            <button className="btn small" onClick={onDone}>Cancel</button>
            <button className="btn small primary" disabled={!valid || same} onClick={() => setStep("review")}>Review change</button>
          </div>
        </>
      ) : (
        <>
          <dl className="adjust-diff"><div><dt>Now</dt><dd>{show(before)}</dd></div><div><dt>After</dt><dd>{show(lines)}</dd></div></dl>
          <label className="field"><span>Reason (required)</span><input className="input" autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. wrong product recorded at put-away" /></label>
          <div className="btns">
            <button className="btn small" onClick={() => setStep("edit")}>Back</button>
            <span className="grow" />
            <button className="btn small primary" disabled={reason.trim().length < 4} onClick={() => { dispatch({ type: "stock/adjust", location: code, lines, by: me.name, reason: reason.trim() }); toast(`${code} changed. It's in Logs.`); onDone(); }}>Confirm change</button>
          </div>
        </>
      )}
    </div>
  );
}
