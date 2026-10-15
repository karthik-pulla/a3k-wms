import { useState } from "react";
import { useStore, shipmentTitle } from "../../store/store";
import type { Shipment } from "../../store/types";
import { LinesEditor } from "../../components/LinesEditor";
import { useToast } from "../../components/Toast";
import { go } from "../../router";

/** An expected delivery: edit what's coming, then mark it as arrived to move it to Pending. */
/** canReceive: coordinators and owners confirm what arrived (the quantities); others can look */
export function IncomingDetail({ shipment: s, who, canReceive }: { shipment: Shipment; who: string; canReceive: boolean }) {
  const { dispatch } = useStore();
  const toast = useToast();
  const [arriving, setArriving] = useState(false);
  const [condition, setCondition] = useState<"ok" | "damaged">("ok");
  const [by, setBy] = useState(who);
  const save = (patch: Partial<Shipment>) => dispatch({ type: "saveShipment", shipment: { ...s, ...patch } });
  const ready = s.lines.length > 0 && s.lines.every(l => l.productId && l.cases > 0);

  return (
    <div className="stack">
      <div className="facts glass">
        <label className="fact"><span>Supplier</span><input className="input" value={s.supplier} onChange={e => save({ supplier: e.target.value })} /></label>
        <label className="fact"><span>Container / BOL</span><input className="input" value={s.ref} onChange={e => save({ ref: e.target.value })} /></label>
        <label className="fact"><span>Expected</span><input className="input" type="date" value={s.expected} onChange={e => save({ expected: e.target.value })} /></label>
        <div className="fact"><span>Client</span><b>{s.client}</b></div>
      </div>
      <div className="panel glass">
        <LinesEditor lines={s.lines} client={s.client} editable onChange={lines => save({ lines })} />
        <div className="panel-foot">
          <span className="muted small">Changes save as you type. Lines with the same pallet number are one mixed pallet.</span>
          {!arriving && (canReceive ? <button className="btn primary" disabled={!ready} onClick={() => setArriving(true)}>Mark as arrived</button>
            : <span className="muted small">A coordinator confirms the quantities when it arrives.</span>)}
        </div>
        {arriving && (
          <div className="arrive">
            <fieldset className="radio-row">
              <legend>Condition on arrival</legend>
              <label><input type="radio" name="cond" checked={condition === "ok"} onChange={() => setCondition("ok")} /> All good</label>
              <label><input type="radio" name="cond" checked={condition === "damaged"} onChange={() => setCondition("damaged")} /> Some damage</label>
            </fieldset>
            <label className="field inline"><span>Received by</span><input className="input" value={by} onChange={e => setBy(e.target.value)} /></label>
            <div className="btns">
              <button className="btn" onClick={() => setArriving(false)}>Cancel</button>
              <button className="btn primary" disabled={!by.trim()} onClick={() => {
                dispatch({ type: "receive", id: s.id, by: by.trim(), condition });
                toast(`${shipmentTitle(s)} moved to Pending. A coordinator or owner confirms it and assigns slots.`);
                go(`/inbounds/pending/${s.id}`);
              }}>Move to Pending</button>
            </div>
            {condition === "damaged" && <p className="muted small">Enter the damaged cases on the next screen; they're kept out of put-away.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
