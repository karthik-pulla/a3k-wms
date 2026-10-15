import { useEffect, useMemo, useRef, useState } from "react";
import { FACES, describeLocation, faceOf, isFloor, productById, rackName, slotMeta } from "../../data/catalog";
import { canSeeClient, visibleLines } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import type { StockLine } from "../../store/types";
import type { OverlayRequest } from "../../chat/overlay";
import { productLocations, expiryTone, isPartial, arrivalDate } from "../../chat/selectors";
import { ThreadSection } from "./ThreadSection";
import { RackView, HIDDEN_PRODUCT, type SlotMark } from "../RackView";
import { CloseIcon } from "../icons";

const fmtMonth = (ym?: string) => (ym ? new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The map that slot and product chips open: pulsing slots, numbered markers, every location of a product in FIFO order. */
export function MapOverlay({ request, onClose, onSwitch }: { request: OverlayRequest; onClose: () => void; onSwitch: (r: OverlayRequest) => void }) {
  const { state } = useStore();
  const { me } = useSession();

  // The viewer only ever sees stock of clients they're allowed to see
  const stock = useMemo(() => {
    const out: Record<string, StockLine[]> = {};
    for (const [code, lines] of Object.entries(state.stock)) out[code] = lines.map(l => {
      const p = productById(l.productId);
      return p && canSeeClient(me, p.client) ? l : { productId: HIDDEN_PRODUCT, cases: l.cases };
    });
    return out;
  }, [state.stock, me]);

  const product = request.kind === "product" ? productById(request.productId) : undefined;
  const denied = request.kind === "product" && (!product || !canSeeClient(me, product.client));
  const locations = useMemo(() => (request.kind === "product" && !denied ? productLocations(state, request.productId) : []), [request, denied, state]);
  const [picked, setPicked] = useState<string[]>([]);

  const targets: string[] = request.kind === "slots" ? request.codes : request.kind === "product" ? locations.map(l => l.code) : picked;
  const firstRack = targets.find(c => !isFloor(c)) ?? (targets[0] ? faceOf(targets[0]) : "");
  const [face, setFace] = useState(() => (FACES.some(f => f.id === faceOf(firstRack)) ? faceOf(firstRack) : FACES[0].id));
  const [selected, setSelected] = useState<string | null>(targets[0] ?? null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); window.addEventListener("hashchange", onClose);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("hashchange", onClose); };
  }, [onClose]);

  // Bring the chosen slot (or the first marked one) into view when the rack side changes
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mapRef.current?.querySelector(".rack-cell.pulse") ?? mapRef.current?.querySelector(".rack-cell.focus, .rack-cell.selected, .rack-cell[class*='tone-']");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [face, selected]);

  const marks: Record<string, SlotMark> = {};
  if (request.kind === "product") {
    locations.forEach((l, i) => { if (!marks[l.code]) marks[l.code] = { kind: l.code === selected ? "pulse" : `tone-${l.tone}`, label: String(i + 1), partial: l.partial }; });
  } else {
    targets.forEach((c, i) => { marks[c] = { kind: request.kind === "pick" ? "selected" : c === selected ? "pulse" : "focus", label: String(i + 1) }; });
  }
  const facesWithTargets = [...new Set(targets.filter(c => !isFloor(c)).map(faceOf))];
  const offRack = [...new Set(targets.filter(c => isFloor(c)))];
  const select = (code: string) => { setSelected(code); if (!isFloor(code)) setFace(faceOf(code)); else if (FACES.some(f => f.id === faceOf(code))) setFace(faceOf(code)); };
  const onSend = request.kind !== "pick" ? request.onSend : undefined;

  const title = request.kind === "product" ? (product ? `${product.name} ${product.size}` : "Product")
    : request.kind === "pick" ? "Choose slots" : targets.length > 1 ? `${targets.length} locations` : targets[0];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="overlay glass" role="dialog" aria-modal="true" aria-label={`Map: ${title}`}>
        <div className="overlay-head">
          <div>
            <h2>{title}</h2>
            {request.kind === "product" && product && !denied && (
              <p className="muted small">{product.code} · {product.client} · {locations.reduce((a, l) => a + l.line.cases, 0)} cases in {new Set(locations.map(l => l.code)).size} locations · oldest arrival first</p>
            )}
            {request.kind === "slots" && targets.length > 1 && <p className="muted small">Numbered in the order they were written</p>}
            {request.kind === "pick" && <p className="muted small">Pick rack, side, column, level and bay, or tap slots on the map</p>}
          </div>
          <div className="btns">
            {onSend && <button className="btn small" onClick={() => onSwitch({ kind: "pick", onSend })}>Select slots to send</button>}
            <button className="iconbtn glass" onClick={onClose} aria-label="Close map"><CloseIcon /></button>
          </div>
        </div>

        {denied ? (
          <p className="note warn">You don't have access to {product?.client ?? "this client"}'s stock.</p>
        ) : (
          <div className="overlay-body">
            <div className="overlay-map" ref={mapRef}>
              {facesWithTargets.length > 1 && (
                <div className="face-chips">
                  {facesWithTargets.map(f => <button key={f} className={`chip-btn${f === face ? " on" : ""}`} onClick={() => setFace(f)}>{f} · {targets.filter(c => !isFloor(c) && faceOf(c) === f).length}</button>)}
                </div>
              )}
              <RackView faceId={face} onFace={setFace} stock={stock} marks={marks}
                onCell={code => request.kind === "pick" ? setPicked(p => (p.includes(code) ? p.filter(x => x !== code) : [...p, code])) : select(code)} />
              {offRack.length > 0 && (
                <div className="offrack">
                  <span className="muted small">Not on a rack:</span>
                  {offRack.map(c => <button key={c} className={`chip-btn${c === selected ? " on" : ""}`} onClick={() => select(c)}>{c}</button>)}
                </div>
              )}
              {request.kind === "product" && <Legend />}
            </div>
            <div className="overlay-side">
              {request.kind === "pick" ? <Picker picked={picked} setPicked={setPicked} onFace={setFace} />
                : request.kind === "product" ? (
                  <ol className="loc-list">
                    {locations.map((l, i) => (
                      <li key={`${l.code}-${i}`}>
                        <button className={`loc-row${l.code === selected ? " on" : ""}${l.tone === "expired" ? " expired" : ""}`} onClick={() => select(l.code)}>
                          <span className="loc-n">{i + 1}</span>
                          <span className="loc-main"><b className="mono">{l.code}</b><small>{l.line.cases} cs · lot {l.line.lot || "—"} · best before {fmtMonth(l.line.bestBefore)}</small></span>
                          <span className="loc-tags">
                            <small>arrived {fmtDay(l.arrival)}</small>
                            {l.mixed && <em className="tag">mixed</em>}{l.partial && <em className="tag">partial</em>}
                            {l.tone !== "ok" && <em className={`tag ${l.tone}`}>{l.tone === "expired" ? "expired" : "expiring"}</em>}
                          </span>
                        </button>
                      </li>
                    ))}
                    {!locations.length && <li className="muted">No stock of this product right now.</li>}
                  </ol>
                ) : (
                  <ol className="loc-list">
                    {targets.map((c, i) => <li key={c}><button className={`loc-row${c === selected ? " on" : ""}`} onClick={() => select(c)}><span className="loc-n">{i + 1}</span><span className="loc-main"><b className="mono">{c}</b><small>{describeLocation(c)}</small></span></button></li>)}
                  </ol>
                )}
              {selected && request.kind !== "pick" && <SlotCard code={selected} snapshot={request.kind === "slots" ? request.snapshots?.[selected] : undefined} />}
              {request.kind === "product" && <ThreadSection target={{ product: request.productId }} title="Messages about this product" />}
              {request.kind === "slots" && selected && <ThreadSection target={{ slot: selected }} title={`Messages about ${selected}`} />}
              {request.kind === "pick" && (
                <button className="btn primary" disabled={!picked.length} onClick={() => { request.onSend(picked); onClose(); }}>Send {picked.length || ""} to chat</button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Legend() {
  return (
    <div className="legend-row muted small">
      <span><i className="sw tone-ok" /> in date</span><span><i className="sw tone-warn" /> expiring within 6 months</span>
      <span><i className="sw tone-expired" /> expired</span><span><i className="sw partial" /> partial pallet</span>
    </div>
  );
}

/** What's in one slot right now, with "when sent" if it changed since the message. */
export function SlotCard({ code, snapshot }: { code: string; snapshot?: { productId: string; cases: number }[] }) {
  const { state } = useStore();
  const { me } = useSession();
  const { shown, hidden } = visibleLines(me, state.stock[code] ?? []);
  const changed = snapshot && JSON.stringify(snapshot.map(l => [l.productId, l.cases]).sort()) !== JSON.stringify((state.stock[code] ?? []).map(l => [l.productId, l.cases]).sort());
  return (
    <div className="slot-card">
      <div className="slot-card-head"><b className="mono">{code}</b><small className="muted">{describeLocation(code)}</small></div>
      {shown.length ? shown.map((l, i) => {
        const p = productById(l.productId);
        const tone = expiryTone(l.bestBefore);
        return (
          <div key={i} className={`slot-line${tone === "expired" ? " expired" : ""}`}>
            <span>{p?.name} <small>{p?.size}{p?.units ? ` × ${p.units}` : ""}</small></span>
            <span className="mono">{l.cases} cs</span>
            <small>lot {l.lot || "—"} · best before <b className={tone}>{fmtMonth(l.bestBefore)}</b> · arrived {fmtDay(arrivalDate(state, code, l))}</small>
            <small>{isPartial(l) ? "Partial pallet" : "Full pallet"}{shown.length + hidden > 1 ? " · mixed pallet" : ""}</small>
          </div>
        );
      }) : !hidden && <p className="muted small">Empty.</p>}
      {hidden > 0 && <p className="muted small">{hidden} line{hidden > 1 ? "s" : ""} of another client's stock hidden.</p>}
      {changed && <p className="muted small when-sent">When sent: {snapshot!.length ? snapshot!.map(l => `${productById(l.productId)?.name ?? "?"} × ${l.cases}`).join(", ") : "empty"}</p>}
    </div>
  );
}

/** Rack → side → column → level → bay, for phones (or anyone) who'd rather not tap the map. */
function Picker({ picked, setPicked, onFace }: { picked: string[]; setPicked: (f: (p: string[]) => string[]) => void; onFace: (f: string) => void }) {
  const racks = [...new Set(FACES.map(f => f.rack))];
  const [rack, setRack] = useState(racks[0]);
  const sides = FACES.filter(f => f.rack === rack);
  const [faceId, setFaceId] = useState(sides[0].id);
  const face = FACES.find(f => f.id === faceId) ?? sides[0];
  const [col, setCol] = useState(face.cols[0][0]);
  const colSlots = face.cols.find(c => c[0] === col)?.[1] ?? face.cols[0][1];
  const levels = [...new Set(colSlots.map(s => s[0]))].sort();
  const [level, setLevel] = useState(levels[0]);
  const bays = colSlots.filter(s => s[0] === level).map(s => s[1]);
  const [bay, setBay] = useState(bays[0]);
  const code = `${face.id}-${String(col).padStart(2, "0")}-L${level}-B${bay}`;
  const valid = !!slotMeta(code);
  const pickFace = (id: string) => { const f = FACES.find(x => x.id === id)!; setFaceId(id); onFace(id); setCol(f.cols[0][0]); setLevel(f.cols[0][1][0][0]); setBay(f.cols[0][1][0][1]); };
  return (
    <div className="picker">
      <div className="picker-row">
        <label>Rack<select className="input" value={rack} onChange={e => { setRack(e.target.value); pickFace(FACES.find(f => f.rack === e.target.value)!.id); }}>{racks.map(r => <option key={r} value={r}>{rackName(r)}</option>)}</select></label>
        <label>Side<select className="input" value={face.id} onChange={e => pickFace(e.target.value)}>{sides.map(f => <option key={f.id} value={f.id}>{f.side}</option>)}</select></label>
        <label>Column<select className="input" value={col} onChange={e => { const c = Number(e.target.value); setCol(c); const s = face.cols.find(x => x[0] === c)![1]; setLevel(s[0][0]); setBay(s[0][1]); }}>{face.cols.map(c => <option key={c[0]} value={c[0]}>{String(c[0]).padStart(2, "0")}</option>)}</select></label>
        <label>Level<select className="input" value={level} onChange={e => { const l = Number(e.target.value); setLevel(l); setBay(colSlots.find(s => s[0] === l)![1]); }}>{levels.map(l => <option key={l} value={l}>L{l}</option>)}</select></label>
        <label>Bay<select className="input" value={bay} onChange={e => setBay(Number(e.target.value))}>{bays.map(b => <option key={b} value={b}>B{b}</option>)}</select></label>
      </div>
      <button className="btn small" disabled={!valid || picked.includes(code)} onClick={() => setPicked(p => [...p, code])}>Add {code}</button>
      <ol className="loc-list">
        {picked.map((c, i) => <li key={c}><div className="loc-row on"><span className="loc-n">{i + 1}</span><span className="loc-main"><b className="mono">{c}</b></span><button className="mini" onClick={() => setPicked(p => p.filter(x => x !== c))} aria-label={`Remove ${c}`}><CloseIcon /></button></div></li>)}
      </ol>
    </div>
  );
}
