import { useState } from "react";
import { CLIENTS, clientConfig, type Client } from "../../data/catalog";
import { useStore } from "../../store/store";
import type { ShipmentLine } from "../../store/types";
import { LinesEditor } from "../../components/LinesEditor";
import { useToast } from "../../components/Toast";
import { go } from "../../router";

/** The supplier usually filled in for a client (tenant config) */
const supplierOf = (c: Client) => clientConfig(c)?.defaultSupplier ?? "";

/** Record a delivery that's on its way, product by product, using the product database to fill names. */
export function NewShipment() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [client, setClient] = useState<Client>(CLIENTS[0]);
  const nextNumber = String(Math.max(1000, ...state.shipments.map(s => parseInt(s.number) || 0)) + 1);
  const [number, setNumber] = useState(nextNumber);
  const [supplier, setSupplier] = useState(() => supplierOf(CLIENTS[0]));
  const [ref, setRef] = useState("");
  const [expected, setExpected] = useState(new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const [lines, setLines] = useState<ShipmentLine[]>([{ key: "n1", productId: null, cases: 0, pallet: 1, lot: "", bestBefore: "" }]);
  const id = `${client}-${number}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const clash = state.shipments.some(s => s.id === id);
  const good = lines.filter(l => l.productId && l.cases > 0);
  const ok = !clash && number.trim() && good.length > 0;

  return (
    <div className="stack">
      <div className="facts glass">
        <div className="fact"><span>Client</span>
          <div className="segment" role="group" aria-label="Client">
            {CLIENTS.map(c => <button key={c} type="button" aria-pressed={client === c} onClick={() => { setClient(c); setSupplier(supplierOf(c)); }}>{c}</button>)}
          </div>
        </div>
        <label className="fact"><span>Number</span><input className={`input${clash ? " invalid" : ""}`} value={number} onChange={e => setNumber(e.target.value.trim())} /></label>
        <label className="fact"><span>Supplier</span><input className="input" value={supplier} onChange={e => setSupplier(e.target.value)} /></label>
        <label className="fact"><span>Container / BOL</span><input className="input" value={ref} placeholder="e.g. MSKU 482910" onChange={e => setRef(e.target.value)} /></label>
        <label className="fact"><span>Expected</span><input className="input" type="date" value={expected} onChange={e => setExpected(e.target.value)} /></label>
      </div>
      {clash && <p className="note warn">{client} {number} already exists. Use another number.</p>}
      <div className="panel glass">
        <LinesEditor lines={lines} client={client} editable onChange={setLines} />
        <div className="panel-foot">
          <span className="muted small">Type part of a name or a code; Tab accepts the suggestion. {client}'s products come first.</span>
          <div className="btns">
            <a className="btn" href="#/inbounds/incoming">Cancel</a>
            <button className="btn primary" disabled={!ok} onClick={() => {
              dispatch({ type: "saveShipment", shipment: { id, client, number, supplier, ref, expected, status: "incoming", lines: good } });
              toast(`${client} ${number} added to Incoming.`);
              go(`/inbounds/incoming/${id}`);
            }}>Save delivery</button>
          </div>
        </div>
      </div>
    </div>
  );
}
