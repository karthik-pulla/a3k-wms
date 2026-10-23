// QR labels for the racks (Manage warehouse → Racks): one per rack, and one per column. They hold only an address:
// a rack's opens its columns as big numbers, a column's opens that column drawn level by level, and tapping a slot
// there shows what's on it and lets people (with the switch) correct the case counts, logged for the owners
// (pages/slot/SlotPage.tsx). People still sign in. Printed from the browser; laminate them for the racks.
import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { FACES, columnCode, rackName } from "../../data/catalog";
import { BACKEND } from "../../server/client";

/** What a code holds: the warehouse's address plus the rack or column; without the server (static hosting), the app's own route */
const scanUrl = (path: string) => BACKEND === "server"
  ? `${window.location.origin}/${path}`
  : `${window.location.origin}${window.location.pathname}#/slot/${path}`;
export const rackUrl = (rack: string) => scanUrl(`rack/${encodeURIComponent(rack)}`);
export const columnUrl = (face: string, col: number) => scanUrl(encodeURIComponent(columnCode(face, col)));

const svgOf = (text: string) => { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };
const RACKS = [...new Set(FACES.map(f => f.rack))];

export function QrLabels() {
  const [racks, setRacks] = useState<string[]>([]);
  const [show, setShow] = useState<"racks" | "columns" | null>(null);
  const labels = useMemo(() => {
    if (show === "racks") return racks.map(r => ({ key: `r${r}`, title: rackName(r), sub: "All its columns", svg: svgOf(rackUrl(r)) }));
    if (show === "columns") return FACES.filter(f => racks.includes(f.rack)).flatMap(f => f.cols.map(([col]) => ({ key: `${f.id}-${col}`, title: columnCode(f.id, col), sub: `${rackName(f.rack)}, side ${f.side} · column ${col}`, svg: svgOf(columnUrl(f.id, col)) })));
    return [];
  }, [show, racks]);
  const columns = FACES.filter(f => racks.includes(f.rack)).reduce((n, f) => n + f.cols.length, 0);
  const toggle = (id: string) => { setShow(null); setRacks(r => (r.includes(id) ? r.filter(x => x !== id) : [...r, id])); };
  return (
    <section className="panel glass">
      <h2 className="plain-h">QR labels for the racks</h2>
      <p className="muted small">A rack's label opens its columns as big numbers; a column's label opens that column level by level. Tap a slot there to see what's on it and, for people allowed, correct the case counts with a reason (it goes in the owners' log). The labels hold only an address; people still sign in.</p>
      <div className="chip-wrap qr-faces">
        {RACKS.map(r => <button key={r} type="button" className={`chip-btn${racks.includes(r) ? " on" : ""}`} onClick={() => toggle(r)} aria-pressed={racks.includes(r)} translate="no">{rackName(r)}</button>)}
      </div>
      <div className="btns">
        <button className="btn" onClick={() => { setShow(null); setRacks(racks.length === RACKS.length ? [] : RACKS); }}>{racks.length === RACKS.length ? "Clear" : "All racks"}</button>
        <button className="btn primary" disabled={!racks.length} onClick={() => setShow("racks")}>Rack labels ({racks.length})</button>
        <button className="btn primary" disabled={!racks.length} onClick={() => setShow("columns")}>Column labels ({columns})</button>
        {show && <button className="btn" onClick={() => window.print()}>Print</button>}
      </div>
      {show && <p className="muted small">Print at Actual size (100%). Scan one to test before printing them all.</p>}
      {show && (
        <div className="qr-sheet">
          {labels.map(l => (
            <figure key={l.key} className="qr-label">
              <span className="qr-img" dangerouslySetInnerHTML={{ __html: l.svg }} />
              <figcaption><b className="mono" translate="no">{l.title}</b><small>{l.sub}</small></figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
