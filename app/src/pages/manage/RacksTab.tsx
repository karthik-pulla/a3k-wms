import { useMemo, useState } from "react";
import { useStore } from "../../store/store";
import { useIdentity } from "../../auth/identity";
import { useToast } from "../../components/Toast";
import { tenant } from "../../tenant";
import { buildLayout } from "../../tenant/layout";
import type { RackConfig } from "../../tenant/types";
import { isOpen } from "../../store/tasks";
import { useAction } from "../warehouse/useApi";
import { DEMO_CONTACT } from "../../server/demo";
import { warehouseName } from "../../store/warehouse";

/** The racks (owners change them with the server), and the slot code format (the Lattice team's to change) */
export function RacksTab() {
  const { kind } = useIdentity();
  return <div className="stack"><CodeFormat />{kind === "server" ? <RackEditor /> : <RackList />}</div>;
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

/** Add, change or remove racks. A rack, side or column holding stock (or promised to a task) can't be taken away. */
function RackEditor() {
  const { state } = useStore();
  const act = useAction();
  const toast = useToast();
  const cfg = tenant().config;
  const shapes = Object.keys(cfg.layout.shapes);
  const [racks, setRacks] = useState<RackConfig[]>(() => cfg.layout.racks.map(r => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const check = useMemo(() => {
    try {
      const ids = racks.map(r => r.id.trim().toUpperCase());
      if (ids.some(id => !/^[A-Z0-9]{1,6}$/.test(id))) return { error: "Each rack needs an ID of 1–6 letters or digits (\"21\", \"D7\")." };
      if (new Set(ids).size !== ids.length) return { error: "Two racks have the same ID." };
      if (racks.some(r => !/^[A-Z]{1,4}$/.test(r.sides) || new Set(r.sides).size !== r.sides.length)) return { error: "Sides are letters, each once (\"AB\")." };
      if (racks.some(r => !Number.isInteger(r.columns) || r.columns < 1 || r.columns > 99)) return { error: "Columns: 1 to 99." };
      const next = buildLayout({ ...cfg.layout, racks });
      const kept = new Set(next.slots.map(s => s.code));
      const lost = tenant().layout.slots.filter(s => !kept.has(s.code));
      const used = lost.filter(s => state.stock[s.code]?.length || state.tasks.some(t => isOpen(t) && (t.to === s.code || t.from === s.code))).map(s => s.code);
      if (used.length) return { error: `${used.length} slot${used.length > 1 ? "s" : ""} you'd take away hold stock or open tasks: ${used.slice(0, 6).join(", ")}${used.length > 6 ? "…" : ""}. Move the pallets first.` };
      return { slots: next.slots.length, added: next.slots.length - (tenant().layout.slots.length - lost.length), removed: lost.length };
    } catch (e) { return { error: e instanceof Error ? e.message : "That layout doesn't work" }; }
  }, [racks, cfg.layout, state.stock, state.tasks]);
  const changed = JSON.stringify(racks) !== JSON.stringify(cfg.layout.racks);
  const set = (i: number, patch: Partial<RackConfig>) => setRacks(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    if ("error" in check) return;
    setBusy(true);
    const r = await act("setup.saveSettings", { config: { ...cfg, layout: { ...cfg.layout, racks: racks.map(x => ({ ...x, id: x.id.trim().toUpperCase() })) } } });
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    toast("Racks saved. Reloading with the new layout…");
    window.setTimeout(() => window.location.reload(), 900);
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Racks · {tenant().layout.slots.length.toLocaleString()} slots</h2>
      <p className="muted small">In the order they're shown and walked. Each column has the rack's shape ({shapes.map(s => `${s}: levels ${cfg.layout.shapes[s].levels.join(", ")} × ${cfg.layout.shapes[s].bays} bays`).join("; ")}). Special columns set up with our team stay as they are.</p>
      <div className="table-wrap">
        <table className="lines rack-edit">
          <thead><tr><th>ID</th><th>Name</th><th>Sides</th><th className="num">Columns</th><th>Shape</th><th aria-label="Order and remove" /></tr></thead>
          <tbody>{racks.map((r, i) => (
            <tr key={i}>
              <td><input className="input mono" value={r.id} onChange={e => set(i, { id: e.target.value })} aria-label="Rack ID" size={5} translate="no" /></td>
              <td><input className="input" value={r.name ?? ""} placeholder={`Rack ${r.id}`} onChange={e => set(i, { name: e.target.value || undefined })} aria-label="Name" /></td>
              <td><input className="input mono" value={r.sides} onChange={e => set(i, { sides: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} aria-label="Sides" size={4} /></td>
              <td className="num"><input className="input" type="number" min={1} max={99} value={r.columns} onChange={e => set(i, { columns: Number(e.target.value) })} aria-label="Columns" style={{ width: 70 }} /></td>
              <td><select className="input" value={r.shape ?? cfg.layout.defaultShape} onChange={e => set(i, { shape: e.target.value === cfg.layout.defaultShape ? undefined : e.target.value })} aria-label="Shape">{shapes.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
              <td className="row-acts">
                <button className="mini" disabled={i === 0} onClick={() => setRacks(rs => { const n = [...rs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} aria-label="Move up">↑</button>
                <button className="mini" onClick={() => setRacks(rs => rs.filter((_, j) => j !== i))} aria-label={`Remove rack ${r.id}`}>×</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="btns">
        <button className="btn" onClick={() => setRacks(rs => [...rs, { id: String(Math.max(0, ...rs.map(r => Number(r.id) || 0)) + 1), sides: "AB", columns: 10 }])}>+ Add a rack</button>
        <span className={`small ${"error" in check ? "warn" : "muted"}`} role="status">{"error" in check ? check.error : changed ? `${check.slots.toLocaleString()} slots after saving (${check.added >= 0 ? "+" : ""}${check.added} new, ${check.removed} taken away).` : "No changes."}</span>
        <button className="btn primary" disabled={!changed || "error" in check || busy} onClick={() => void save()}>Save racks</button>
        {changed && <button className="btn" onClick={() => setRacks(cfg.layout.racks.map(r => ({ ...r })))}>Undo changes</button>}
      </div>
    </section>
  );
}
