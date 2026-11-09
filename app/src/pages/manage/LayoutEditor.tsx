import { Fragment, useMemo, useState } from "react";
import { useStore } from "../../store/store";
import { useToast } from "../../components/Toast";
import { tenant } from "../../tenant";
import { buildLayout, layoutProblems } from "../../tenant/layout";
import type { AreaConfig, ColumnShape, LayoutConfig, RackConfig } from "../../tenant/types";
import { isOpen } from "../../store/tasks";
import { useAction } from "../warehouse/useApi";

/** Everything about the layout but the slot codes (those are the Lattice team's: Slot codes above) */
type Draft = Omit<LayoutConfig, "codeFormat">;
const draftOf = (l: LayoutConfig): Draft => JSON.parse(JSON.stringify({ shapes: l.shapes, defaultShape: l.defaultShape, racks: l.racks, areas: l.areas, receivingArea: l.receivingArea }));
const levelsText = (s: ColumnShape) => s.levels.join(", ");
const parseLevels = (v: string) => [...new Set(v.split(/[^0-9]+/).filter(Boolean).map(Number))].sort((a, b) => a - b);

/**
 * The warehouse's layout, edited on a tablet during the site visit or by an owner later: column types (levels × bays),
 * racks and their sides, columns, odd columns and junctions, and floor areas, with the map redrawn as you type.
 * The same checks as the server (shared/layout.ts): nothing that holds stock or an open task can be taken away.
 */
export function LayoutEditor() {
  const { state } = useStore();
  const act = useAction();
  const toast = useToast();
  const cfg = tenant().config;
  const live = tenant().setup !== "setup";
  const [orig] = useState(() => draftOf(cfg.layout));
  const [d, setD] = useState<Draft>(() => draftOf(cfg.layout));
  const [open, setOpen] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const held = useMemo(() => [...new Set([
    ...Object.entries(state.stock).filter(([, ls]) => ls?.length).map(([code]) => code),
    ...state.tasks.filter(isOpen).flatMap(t => [t.from, t.to]).filter(Boolean),
  ])], [state.stock, state.tasks]);
  const full: LayoutConfig = useMemo(() => ({ ...d, codeFormat: cfg.layout.codeFormat }), [d, cfg.layout.codeFormat]);
  const problems = useMemo(() => layoutProblems(full, held), [full, held]);
  const next = useMemo(() => { try { return buildLayout(full); } catch { return null; } }, [full]);
  const before = tenant().layout;
  const counts = useMemo(() => {
    if (!next) return null;
    const had = new Set(before.slots.map(s => s.code)), has = new Set(next.slots.map(s => s.code));
    return { slots: next.slots.length, added: next.slots.filter(s => !had.has(s.code)).length, removed: before.slots.filter(s => !has.has(s.code)).length };
  }, [next, before]);
  const changed = JSON.stringify(d) !== JSON.stringify(orig);
  const needReason = live && orig.racks.length > 0 && changed;
  const shapeNames = Object.keys(d.shapes);
  const used = (name: string) => d.defaultShape === name || d.racks.some(r => r.shape === name || Object.values(r.columnShapes ?? {}).includes(name));

  const setRack = (i: number, patch: Partial<RackConfig>) => setD(x => ({ ...x, racks: x.racks.map((r, j) => (j === i ? clean({ ...r, ...patch }) : r)) }));
  const setArea = (i: number, patch: Partial<AreaConfig>) => setD(x => {
    const areas = x.areas.map((a, j) => (j === i ? { ...a, ...patch } : a));
    return { ...x, areas, receivingArea: patch.id !== undefined && x.receivingArea === x.areas[i].id ? patch.id : x.receivingArea };
  });
  const renameShape = (from: string, to: string) => setD(x => {
    if (!to || to === from || to in x.shapes) return x;
    const shapes = Object.fromEntries(Object.entries(x.shapes).map(([k, v]) => [k === from ? to : k, v]));
    const swap = (s?: string) => (s === from ? to : s);
    return { ...x, shapes, defaultShape: swap(x.defaultShape)!, racks: x.racks.map(r => clean({ ...r, shape: swap(r.shape), columnShapes: r.columnShapes && Object.fromEntries(Object.entries(r.columnShapes).map(([c, s]) => [c, swap(s)!])) })) };
  });

  const save = async () => {
    if (problems.length || (needReason && reason.trim().length < 3)) return;
    setBusy(true);
    const r = await act("setup.saveSettings", { config: { ...cfg, layout: full }, ...(needReason ? { reason: reason.trim() } : {}) });
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    toast("Layout saved. Reloading with the new racks…");
    window.setTimeout(() => window.location.reload(), 900);
  };

  return (
    <section className="panel glass layout-editor">
      <h2 className="plain-h">Layout · {before.slots.length.toLocaleString()} slots</h2>
      <p className="muted small">{live
        ? "Changes to racks people already use need a reason, kept in the security log. Anything holding stock or promised to a task can't be taken away: move the pallets first."
        : "Setting up: walk the floor and enter each rack as you go; the map below redraws as you type. Anything holding stock can't be taken away."}</p>

      <h3 className="sub-h">Column types</h3>
      <p className="muted small">What a column looks like: its levels (1 is the bottom beam) and how many pallets fit side by side on each level.</p>
      <div className="table-wrap">
        <table className="lines rack-edit">
          <thead><tr><th>Name</th><th>Levels</th><th className="num">Pallets per level</th><th>Usual</th><th aria-label="Remove" /></tr></thead>
          <tbody>{shapeNames.map(name => (
            <tr key={name}>
              <td><input className="input" defaultValue={name} onBlur={e => renameShape(name, e.target.value.trim())} aria-label="Column type name" /></td>
              <td><input className="input mono" defaultValue={levelsText(d.shapes[name])} onBlur={e => setD(x => ({ ...x, shapes: { ...x.shapes, [name]: { ...x.shapes[name], levels: parseLevels(e.target.value) } } }))} aria-label="Levels" placeholder="1, 2, 3, 4" /></td>
              <td className="num"><input className="input" type="number" min={1} max={9} value={d.shapes[name].bays} onChange={e => setD(x => ({ ...x, shapes: { ...x.shapes, [name]: { ...x.shapes[name], bays: Number(e.target.value) } } }))} aria-label="Pallets per level" style={{ width: 64 }} /></td>
              <td><input type="radio" name="usual-shape" checked={d.defaultShape === name} onChange={() => setD(x => ({ ...x, defaultShape: name }))} aria-label={`${name} is the usual column type`} /></td>
              <td className="row-acts"><button className="mini" disabled={used(name)} title={used(name) ? "In use" : ""} onClick={() => setD(x => { const shapes = { ...x.shapes }; delete shapes[name]; return { ...x, shapes }; })} aria-label={`Remove column type ${name}`}>×</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="btns"><button className="btn small" onClick={() => setD(x => { let n = 1; while (`type ${n}` in x.shapes) n++; return { ...x, shapes: { ...x.shapes, [`type ${n}`]: { levels: [1, 2, 3, 4], bays: 2 } } }; })}>+ Add a column type</button></div>

      <h3 className="sub-h">Racks</h3>
      <p className="muted small">In the order they're shown and walked. Sides are letters ("AB"). Odd columns (fewer levels, more pallets) are exceptions on the rack.</p>
      <div className="table-wrap">
        <table className="lines rack-edit">
          <thead><tr><th>Number</th><th>Name</th><th>Sides</th><th className="num">Columns</th><th>Column type</th><th>Junction</th><th>Odd columns</th><th aria-label="Order and remove" /></tr></thead>
          <tbody>{d.racks.map((r, i) => {
            const odd = Object.entries(r.columnShapes ?? {});
            return (
              <Fragment key={i}>
                <tr>
                  <td><input className="input mono" value={r.id} onChange={e => setRack(i, { id: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} aria-label="Rack number" size={5} translate="no" /></td>
                  <td><input className="input" value={r.name ?? ""} placeholder={`Rack ${r.id}`} onChange={e => setRack(i, { name: e.target.value || undefined })} aria-label="Name" /></td>
                  <td><input className="input mono" value={r.sides} onChange={e => setRack(i, { sides: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) })} aria-label="Sides" size={4} /></td>
                  <td className="num"><input className="input" type="number" min={1} max={99} value={r.columns} onChange={e => setRack(i, { columns: Number(e.target.value) })} aria-label="Columns" style={{ width: 70 }} /></td>
                  <td><select className="input" value={r.shape ?? d.defaultShape} onChange={e => setRack(i, { shape: e.target.value === d.defaultShape ? undefined : e.target.value })} aria-label="Column type">{shapeNames.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td><input type="checkbox" checked={!!r.junction} onChange={e => setRack(i, { junction: e.target.checked || undefined })} aria-label="A small rack between two others" /></td>
                  <td><button className="mini" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{odd.length ? `${odd.length} odd` : "None"} {open === i ? "▴" : "▾"}</button></td>
                  <td className="row-acts">
                    <button className="mini" disabled={i === 0} onClick={() => setD(x => { const n = [...x.racks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return { ...x, racks: n }; })} aria-label="Move up">↑</button>
                    <button className="mini" disabled={i === d.racks.length - 1} onClick={() => setD(x => { const n = [...x.racks]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return { ...x, racks: n }; })} aria-label="Move down">↓</button>
                    <button className="mini" onClick={() => { setD(x => ({ ...x, racks: x.racks.filter((_, j) => j !== i) })); setOpen(null); }} aria-label={`Remove rack ${r.id}`}>×</button>
                  </td>
                </tr>
                {open === i && (
                  <tr className="odd-cols"><td colSpan={8}>
                    <div className="odd-list">
                      {odd.map(([col, s]) => (
                        <span key={col} className="odd-item">
                          Column <input className="input" type="number" min={1} max={r.columns} defaultValue={col} aria-label="Column"
                            onBlur={e => { const to = String(Number(e.target.value)); if (to === col || !Number(to)) return; const cs = { ...r.columnShapes }; delete cs[col]; setRack(i, { columnShapes: { ...cs, [to]: s } }); }} />
                          <select className="input" value={s} onChange={e => setRack(i, { columnShapes: { ...r.columnShapes, [col]: e.target.value } })} aria-label="Its column type">{shapeNames.map(n => <option key={n} value={n}>{n}</option>)}</select>
                          <button className="mini" onClick={() => { const cs = { ...r.columnShapes }; delete cs[col]; setRack(i, { columnShapes: cs }); }} aria-label={`Column ${col} back to normal`}>×</button>
                        </span>
                      ))}
                      <button className="btn small" disabled={shapeNames.length < 2} title={shapeNames.length < 2 ? "Add another column type first" : ""} onClick={() => {
                        const free = Array.from({ length: r.columns }, (_, c) => String(c + 1)).find(c => !r.columnShapes?.[c]);
                        if (free) setRack(i, { columnShapes: { ...r.columnShapes, [free]: shapeNames.find(n => n !== (r.shape ?? d.defaultShape)) ?? d.defaultShape } });
                      }}>+ Odd column</button>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table>
      </div>
      <div className="btns"><button className="btn small" onClick={() => setD(x => ({ ...x, racks: [...x.racks, { id: String(Math.max(0, ...x.racks.map(r => Number(r.id) || 0)) + 1), sides: "AB", columns: 10 }] }))}>+ Add a rack</button></div>

      <h3 className="sub-h">Floor areas</h3>
      <p className="muted small">Places with no racks: coolers, lanes, docks. Every rack side also has its own floor. Deliveries wait in the receiving area until they're put away.</p>
      <div className="table-wrap">
        <table className="lines rack-edit">
          <thead><tr><th>Code</th><th>Name</th><th>Receiving</th><th aria-label="Remove" /></tr></thead>
          <tbody>{d.areas.map((a, i) => (
            <tr key={i}>
              <td><input className="input mono" value={a.id} onChange={e => setArea(i, { id: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24) })} aria-label="Area code" translate="no" /></td>
              <td><input className="input" value={a.name} onChange={e => setArea(i, { name: e.target.value })} aria-label="Area name" /></td>
              <td><input type="radio" name="receiving-area" checked={d.receivingArea === a.id} onChange={() => setD(x => ({ ...x, receivingArea: a.id }))} aria-label={`${a.name} is where deliveries wait`} /></td>
              <td className="row-acts"><button className="mini" disabled={d.receivingArea === a.id} onClick={() => setD(x => ({ ...x, areas: x.areas.filter((_, j) => j !== i) }))} aria-label={`Remove area ${a.id}`}>×</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="btns"><button className="btn small" onClick={() => setD(x => { let n = 1; while (x.areas.some(a => a.id === `AREA-${n}`)) n++; return { ...x, areas: [...x.areas, { id: `AREA-${n}`, name: `Area ${n}` }] }; })}>+ Add a floor area</button></div>

      <h3 className="sub-h">Map</h3>
      {next ? <LayoutMap layout={next} stock={state.stock} had={new Set(before.slots.map(s => s.code))} /> : <p className="muted small">The map shows once the layout can be read.</p>}

      <div className="panel-foot layout-save">
        {problems.length > 0
          ? <ul className="warn small problems" role="status">{problems.slice(0, 6).map(p => <li key={p}>{p}</li>)}{problems.length > 6 && <li>…and {problems.length - 6} more</li>}</ul>
          : <span className="muted small" role="status">{changed && counts ? `${counts.slots.toLocaleString()} slots after saving (${counts.added} new, ${counts.removed} taken away).` : "No changes."}</span>}
        {needReason && <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why the racks changed (kept in the security log)" aria-label="Reason" maxLength={300} />}
        <div className="btns">
          {changed && <button className="btn" onClick={() => { setD(draftOf(cfg.layout)); setReason(""); }}>Undo changes</button>}
          <button className="btn primary" disabled={!changed || problems.length > 0 || busy || (needReason && reason.trim().length < 3)} onClick={() => void save()}>Save layout</button>
        </div>
      </div>
    </section>
  );
}

/** Drops empty optional fields, so an unchanged rack compares equal */
function clean(r: RackConfig): RackConfig {
  const out: RackConfig = { ...r };
  if (!out.name) delete out.name;
  if (!out.shape) delete out.shape;
  if (!out.junction) delete out.junction;
  if (!out.columnShapes || !Object.keys(out.columnShapes).length) delete out.columnShapes;
  return out;
}

/** Every rack side as a small grid (top level first), redrawn as the layout changes: stock and new slots marked */
function LayoutMap({ layout: L, stock, had }: { layout: ReturnType<typeof buildLayout>; stock: Record<string, unknown[]>; had: Set<string> }) {
  return (
    <div className="layout-map" aria-label="Map of the layout">
      {L.faces.map(f => {
        const levels = L.levelsOf(f);
        return (
          <div key={f.id} className={`lm-face${f.junction ? " junction" : ""}`}>
            <b className="mono lm-name" translate="no">{f.id}</b>
            <div className="lm-cols">{f.cols.map(([col, cells]) => {
              const bays = Math.max(1, ...cells.map(([, b]) => b));
              return (
                <div key={col} className="lm-col" title={`${f.id} column ${L.colLabel(col)}`} style={{ gridTemplateColumns: `repeat(${bays}, 1fr)` }}>
                  {levels.flatMap(l => Array.from({ length: bays }, (_, b) => {
                    const has = cells.some(([lv, by]) => lv === l && by === b + 1);
                    const code = has ? L.slotCode(f.id, col, l, b + 1) : "";
                    return <span key={`${l}-${b}`} className={`lm-cell${!has ? " none" : stock[code]?.length ? " full" : !had.has(code) ? " new" : ""}`} />;
                  }))}
                </div>
              );
            })}</div>
          </div>
        );
      })}
      {L.areas.length > 0 && <p className="muted small lm-areas">Floor areas: {L.areas.map(a => `${a.name} (${a.id})`).join(", ")}</p>}
      <p className="muted small lm-key"><span className="lm-cell full" /> has stock · <span className="lm-cell new" /> new · <span className="lm-cell" /> empty</p>
    </div>
  );
}
