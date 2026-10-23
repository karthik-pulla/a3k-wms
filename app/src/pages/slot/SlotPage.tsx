// What the QR codes on the racks open (they hold only an address; sign-in comes first):
//   #/slot/rack/<rack>   a rack's code: its columns as big numbers, side by side
//   #/slot/<column>      a column's code ("06B-02"): the column drawn level by level; tap a slot
//   #/slot/<slot>        one slot: what's on it, and (with the "scan-adjust" switch) correcting the case counts with a
//                        reason, which goes in the owners' log. Adding a product to a slot stays with owners (Inventory).
import { useState } from "react";
import { FACES, SLOTS, colLabel, columnCode, describeLocation, levelsOf, normalizeLocation, parseColumn, parseRack, productById, rackName, slotMeta } from "../../data/catalog";
import { can, visibleLines } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../../components/Toast";
import { expiryTone } from "../../chat/selectors";
import { fmtDay, fmtMonth } from "../../inventory/selectors";
import type { StockLine } from "../../store/types";

/** A line's identity on the slot (what it is, and which one of identical lines), so typed counts stay with their line when the slot updates */
const keysOf = (lines: StockLine[]) => { const seen = new Map<string, number>(); return lines.map(l => { const k = [l.productId, l.lot ?? "", l.bestBefore ?? "", l.shipmentId ?? ""].join("|"); const n = seen.get(k) ?? 0; seen.set(k, n + 1); return `${k}#${n}`; }); };
const name = (l: StockLine) => { const p = productById(l.productId); return p ? `${p.name}${p.size ? ` ${p.size}` : ""}` : "Unknown product"; };

export function SlotPage({ parts }: { parts: string[] }) {
  const [first = "", second = ""] = parts;
  if (first === "rack") { const rack = parseRack(second); return rack ? <RackPanel rack={rack} /> : <NotHere text={second} />; }
  const slot = normalizeLocation(first);
  if (slot) return <SlotEditor code={slot} />;
  const col = parseColumn(first);
  if (col) return <ColumnMap face={col.face} col={col.col} />;
  const rack = parseRack(first);
  return rack ? <RackPanel rack={rack} /> : <NotHere text={first} />;
}

function NotHere({ text }: { text: string }) {
  return <main className="section slot-page"><div className="panel glass"><h1 className="plain-h">Not found here</h1><p className="muted">"{text}" isn't a rack, column, slot or floor spot in this warehouse. Check the label, or find it in Inventory.</p><a className="btn" href="#/inventory/stock">Inventory ›</a></div></main>;
}

/** A rack's QR code: every column as a big number, one row of numbers per side */
function RackPanel({ rack }: { rack: string }) {
  const { state } = useStore();
  const faces = FACES.filter(f => f.rack === rack);
  return (
    <main className="section slot-page">
      <header className="section-head"><h1 translate="no">{rackName(rack)}</h1><p className="crumb">Pick a column</p></header>
      <div className="stack">
        {faces.map(f => (
          <section key={f.id} className="panel glass">
            <h2 className="plain-h">Side {f.side}</h2>
            <div className="col-pad">
              {f.cols.map(([col, cells]) => {
                const full = cells.filter(([l, b]) => SLOTS.some(s => s.face === f.id && s.col === col && s.level === l && s.bay === b && state.stock[s.code]?.length)).length;
                return <a key={col} className="col-btn glass" href={`#/slot/${encodeURIComponent(columnCode(f.id, col))}`} aria-label={`Column ${col}, ${full} of ${cells.length} slots in use`}><b>{colLabel(col)}</b><small>{full}/{cells.length}</small></a>;
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

/** A column's QR code: the column drawn as it stands (top level first), each slot with what's on it; tap one to correct it */
function ColumnMap({ face, col }: { face: string; col: number }) {
  const { state } = useStore();
  const { me } = useSession();
  const f = FACES.find(x => x.id === face)!;
  const cols = f.cols.map(([c]) => c);
  const i = cols.indexOf(col);
  const levels = levelsOf(f);
  const bays = Math.max(...f.cols.flatMap(([c, cells]) => (c === col ? cells.map(([, b]) => b) : [])));
  const cell = (level: number, bay: number) => SLOTS.find(s => s.face === face && s.col === col && s.level === level && s.bay === bay);
  return (
    <main className="section slot-page">
      <header className="section-head">
        <h1 className="mono slot-code" translate="no">{columnCode(face, col)}</h1>
        <p className="crumb">{rackName(f.rack)}, side {f.side} · column {col} · <a className="link" href={`#/slot/rack/${encodeURIComponent(f.rack)}`}>All columns ›</a></p>
      </header>
      <div className="stack">
        <div className="col-map" style={{ gridTemplateColumns: `auto repeat(${bays}, minmax(0, 1fr))` }}>
          {levels.flatMap(level => [
            <span key={`l${level}`} className="col-level">Level {level}</span>,
            ...Array.from({ length: bays }, (_, b) => {
              const s = cell(level, b + 1);
              if (!s) return <span key={`${level}-${b}`} className="col-slot none" aria-hidden="true" />;
              const { shown, hidden } = visibleLines(me, state.stock[s.code] ?? []);
              return (
                <a key={s.code} className={`col-slot glass${shown.length || hidden ? "" : " empty"}`} href={`#/slot/${encodeURIComponent(s.code)}`}>
                  <span className="mono col-slot-code" translate="no">{s.code}</span>
                  {shown.map((l, n) => <span key={n} className="col-slot-line" translate="no"><b>{productById(l.productId)?.code}</b> {name(l)} <em>× {l.cases}</em></span>)}
                  {hidden > 0 && <span className="muted small">{hidden} hidden</span>}
                  {!shown.length && !hidden && <span className="muted small">Empty</span>}
                </a>
              );
            }),
          ])}
        </div>
        <div className="btns col-nav">
          {i > 0 && <a className="btn" href={`#/slot/${encodeURIComponent(columnCode(face, cols[i - 1]))}`}>‹ Column {cols[i - 1]}</a>}
          {i < cols.length - 1 && <a className="btn" href={`#/slot/${encodeURIComponent(columnCode(face, cols[i + 1]))}`}>Column {cols[i + 1]} ›</a>}
        </div>
      </div>
    </main>
  );
}

function SlotEditor({ code }: { code: string }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const all = state.stock[code] ?? [];
  const { shown, hidden } = visibleLines(me, all);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const mayChange = can(me, "scan-adjust");

  const keys = keysOf(shown);
  const value = (i: number) => counts[keys[i]] ?? String(shown[i].cases);
  const parsed = (i: number) => { const v = value(i).trim(); return /^\d{1,5}$/.test(v) ? Number(v) : null; };
  const changed = shown.map((l, i) => ({ l, cases: parsed(i) })).filter(x => x.cases !== null && x.cases !== x.l.cases) as { l: StockLine; cases: number }[];
  const invalid = shown.some((_, i) => parsed(i) === null);
  const ok = changed.length > 0 && !invalid && reason.trim().length >= 4;
  const step = (i: number, d: number) => setCounts(c => ({ ...c, [keys[i]]: String(Math.max(0, (parsed(i) ?? shown[i].cases) + d)) }));
  const history = (state.movements ?? []).filter(m => m.location === code || m.from === code).slice(0, 5);
  const reset = () => { setCounts({}); setReason(""); setReviewing(false); };
  const meta = slotMeta(code);

  return (
    <main className="section slot-page">
      <header className="section-head">
        <h1 className="mono slot-code" translate="no">{code}</h1>
        <p className="crumb">{describeLocation(code)}{meta ? <> · <a className="link" href={`#/slot/${encodeURIComponent(columnCode(meta.face, meta.col))}`}>Back to column {columnCode(meta.face, meta.col)} ›</a></> : null}</p>
      </header>
      <div className="stack">
        <section className="panel glass">
          <h2 className="plain-h">On this slot</h2>
          {!shown.length && !hidden && <p className="muted">Nothing is recorded here. If there's a pallet, an owner adds it with "Adjust stock here" in Inventory.</p>}
          <ul className="slot-lines">
            {shown.map((l, i) => {
              const p = productById(l.productId);
              const tone = expiryTone(l.bestBefore);
              const n = parsed(i);
              return (
                <li key={keys[i]} className={n !== null && n !== l.cases ? "changed" : ""}>
                  <div className="slot-line-what">
                    <b translate="no">{p?.code} {name(l)}</b>
                    <small className="muted" translate="no">{[l.lot && `Lot ${l.lot}`, l.bestBefore && `Best before ${fmtMonth(l.bestBefore)}`, l.arrived && `Arrived ${fmtDay(l.arrived)}`].filter(Boolean).join(" · ")}{tone === "expired" ? " · " : ""}</small>
                    {tone === "expired" && <span className="tag expired">Expired</span>}
                  </div>
                  {mayChange && !reviewing ? (
                    <div className="qty-edit">
                      <button type="button" className="btn qty-btn" onClick={() => step(i, -1)} aria-label={`One case fewer of ${name(l)}`}>−</button>
                      <input className={`input qty-input${n === null ? " invalid" : ""}`} inputMode="numeric" pattern="[0-9]*" value={value(i)} onChange={e => setCounts(c => ({ ...c, [keys[i]]: e.target.value.replace(/[^\d]/g, "") }))} aria-label={`Cases of ${name(l)}`} />
                      <button type="button" className="btn qty-btn" onClick={() => step(i, 1)} aria-label={`One case more of ${name(l)}`}>+</button>
                    </div>
                  ) : <span className="qty-now"><b>{n ?? l.cases}</b> cases{n !== null && n !== l.cases ? <small className="muted"> (was {l.cases})</small> : null}</span>}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && <p className="muted small">{hidden} line{hidden === 1 ? "" : "s"} of another client's stock hidden.</p>}
        </section>

        {mayChange && shown.length > 0 && (
          <section className="panel glass">
            {!reviewing ? <>
              <label className="field">Why is it different?
                <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. counted 38, two cases damaged and removed" maxLength={200} />
              </label>
              <div className="btns">
                <button className="btn primary" disabled={!ok} onClick={() => setReviewing(true)}>Review the change</button>
                {Object.keys(counts).length > 0 && <button className="btn" onClick={reset}>Undo</button>}
              </div>
              <p className="muted small">{invalid ? "Cases are whole numbers." : !changed.length ? "Change a count above if it's different from what's on the slot." : reason.trim().length < 4 ? "Say why (at least 4 letters)." : `${changed.length} line${changed.length === 1 ? "" : "s"} to change.`}</p>
            </> : <>
              <h2 className="plain-h">Check before saving</h2>
              <ul className="slot-review">{changed.map((c, i) => <li key={i}><b translate="no">{name(c.l)}</b>: {c.l.cases} → <b>{c.cases}</b> cases{c.cases === 0 ? " (removed from the slot)" : ""}</li>)}</ul>
              <p className="small">Reason: <span translate="no">{reason.trim()}</span></p>
              <p className="muted small">It's saved with your name and the time in the owners' log.</p>
              <div className="btns">
                <button className="btn primary" onClick={() => { dispatch({ type: "stock/scan-adjust", location: code, changes: changed.map(c => ({ line: c.l, cases: c.cases })), by: me.name, reason: reason.trim() }); toast(`${code} corrected. It's in the owners' log.`); reset(); }}>Save the change</button>
                <button className="btn" onClick={() => setReviewing(false)}>Back</button>
              </div>
            </>}
          </section>
        )}
        {!mayChange && shown.length > 0 && <p className="muted small">Counts look wrong? Tell a coordinator or owner; your role can't change them here.</p>}

        {can(me, "view-history") && history.length > 0 && (
          <section className="panel glass">
            <h2 className="plain-h">Recent changes here</h2>
            <ul className="notice-list">{history.map(m => <li key={m.id}><span><span translate="no">{m.productId ? name({ productId: m.productId, cases: 0 }) : ""}</span> {m.cases !== undefined ? `${m.cases > 0 ? "+" : ""}${m.cases} cs` : ""} · {m.type.replace("-", " ")}<small className="muted block">{m.by} · {fmtDay(m.at)}{m.reason ? ` · ${m.reason}` : ""}</small></span></li>)}</ul>
          </section>
        )}
        <a className="link" href={`#/inventory/stock/${encodeURIComponent(code)}`}>Open in Inventory ›</a>
      </div>
    </main>
  );
}
