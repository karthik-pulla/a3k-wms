import { useStore } from "../../store/store";
import { useIdentity } from "../../auth/identity";
import { tenant } from "../../tenant";
import { buildLayout } from "../../tenant/layout";
import type { RackConfig } from "../../tenant/types";
import { LayoutEditor } from "./LayoutEditor";
import { DEMO_CONTACT } from "../../server/demo";
import { warehouseName } from "../../store/warehouse";
import { QrLabels } from "./QrLabels";

/** The layout (owners and our team change it with the server: LayoutEditor), and the slot code format (the Lattice team's) */
export function RacksTab() {
  const { kind } = useIdentity();
  return <div className="stack"><CodeFormat /><QrLabels />{kind === "server" ? <LayoutEditor /> : <RackList />}</div>;
}

function CodeFormat() {
  const { state } = useStore();
  const L = tenant().layout, f = tenant().config.layout.codeFormat;
  const face = L.faces.find(x => !x.junction) ?? L.faces[0];
  const slot = L.slots[0];
  const area = L.areas[0];
  const ask = `mailto:${DEMO_CONTACT}?subject=${encodeURIComponent(`Slot codes for ${warehouseName(state)}`)}&body=${encodeURIComponent(`Hello Lattice team,\n\nWe'd like to change how our slots are named.\nToday: ${slot?.code ?? f.slot}\nWhat we'd like: \n\nThanks`)}`;
  return (
    <section className="panel glass">
      <h2 className="plain-h">Slot codes</h2>
      <p className="muted small">How every slot, floor spot and area is named on labels, screens and messages. It's set up with the Lattice team, because every saved location, task and message uses it.</p>
      <dl className="facts code-facts">
        <div className="fact"><dt>Slot</dt><dd><code translate="no">{f.slot}</code> → <b className="mono" translate="no">{slot?.code ?? "—"}</b></dd></div>
        <div className="fact"><dt>Floor in front of a rack side</dt><dd><code translate="no">{f.floor}</code> → <b className="mono" translate="no">{face ? L.spotCode(face.id, 1) : "—"}</b></dd></div>
        <div className="fact"><dt>Spot in an area</dt><dd><code translate="no">{f.areaSpot}</code> → <b className="mono" translate="no">{area ? L.spotCode(area.id, 1) : "—"}</b></dd></div>
        <div className="fact"><dt>Padding</dt><dd>rack {f.rackDigits} digits, column {f.colDigits}, spot {f.spotDigits}{f.acceptUnpadded ? "; codes typed without it are understood too" : ""}</dd></div>
      </dl>
      <a className="btn" href={ask}>Ask the Lattice team to change it</a>
    </section>
  );
}

/** Without the server: the layout comes from the warehouse's settings file */
function RackList() {
  const L = tenant().layout;
  const racks = tenant().config.layout.racks;
  return (
    <section className="panel glass">
      <h2 className="plain-h">Racks · {L.slots.length.toLocaleString()} slots</h2>
      <p className="muted small">On this device the racks come from the warehouse's settings file. With the server, owners add and change racks here.</p>
      <RackSummary racks={racks} />
    </section>
  );
}

function RackSummary({ racks }: { racks: RackConfig[] }) {
  const layout = tenant().config.layout;
  return (
    <div className="table-wrap">
      <table className="lines">
        <thead><tr><th>Rack</th><th>Sides</th><th className="num">Columns</th><th>Shape</th><th className="num">Slots</th></tr></thead>
        <tbody>{racks.map(r => (
          <tr key={r.id}><td translate="no"><b>{r.name ?? `Rack ${r.id}`}</b></td><td translate="no">{r.sides.split("").join(", ")}</td><td className="num">{r.columns}</td>
            <td className="muted">{r.shape ?? layout.defaultShape}{r.columnShapes ? " + exceptions" : ""}</td><td className="num">{buildLayout({ ...layout, racks: [r] }).slots.length}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
