import { productById } from "../data/catalog";
import type { ShipmentLine } from "../store/types";
import { ProductInput } from "./ProductInput";
import { CloseIcon } from "./icons";

const thisMonth = new Date().toISOString().slice(0, 7);
const soon = (() => { const d = new Date(); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 7); })();
const fmtMonth = (ym: string) => (ym ? new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");

/** Products · Cases · Pallet · Lot · Best before. Editable for incoming and pending shipments, read-only once stored. */
export function LinesEditor({ lines, onChange, client, editable, showDamaged }: {
  lines: ShipmentLine[];
  onChange?: (lines: ShipmentLine[]) => void;
  client?: string;
  editable: boolean;
  showDamaged?: boolean;
}) {
  const set = (i: number, patch: Partial<ShipmentLine>) => onChange?.(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => {
    const last = lines[lines.length - 1];
    onChange?.([...lines, { key: `n${Date.now()}`, productId: null, cases: 0, pallet: (last?.pallet ?? 0) + 1, lot: "", bestBefore: "" }]);
  };
  const remove = (i: number) => onChange?.(lines.filter((_, j) => j !== i));
  const totals = { cases: lines.reduce((a, l) => a + (l.cases || 0), 0), pallets: new Set(lines.map(l => l.pallet)).size };

  return (
    <div className="table-wrap">
      <table className="lines">
        <thead>
          <tr>
            <th>Product</th><th className="num">Cases</th><th className="num">Pallet</th><th>Lot</th><th>Best before</th>
            {showDamaged && <th className="num">Damaged</th>}
            {editable && <th aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const p = l.productId ? productById(l.productId) : undefined;
            const bbTone = l.bestBefore && l.bestBefore < thisMonth ? "expired" : l.bestBefore && l.bestBefore <= soon ? "warn" : "";
            const mixed = lines.filter(x => x.pallet === l.pallet).length > 1;
            return (
              <tr key={l.key}>
                <td className="prod">
                  {editable ? <ProductInput productId={l.productId} client={client} onChange={productId => set(i, { productId })} autoFocus={!l.productId && i === lines.length - 1 && lines.length > 1} />
                    : <>{p?.name ?? "Unknown product"} <small>{p ? `${p.code} · ${p.size}${p.units ? ` × ${p.units}` : ""}` : ""}</small></>}
                </td>
                <td className="num">{editable ? <input className="input num-in" type="number" min={0} value={l.cases || ""} aria-label="Cases" onChange={e => set(i, { cases: Math.max(0, parseInt(e.target.value) || 0) })} /> : l.cases}</td>
                <td className="num">
                  {editable ? <input className="input num-in" type="number" min={1} value={l.pallet} aria-label="Pallet number" onChange={e => set(i, { pallet: Math.max(1, parseInt(e.target.value) || 1) })} /> : `P${l.pallet}`}
                  {mixed && <span className="mixed" title="Shares a pallet with another line">mixed</span>}
                </td>
                <td>{editable ? <input className="input" value={l.lot} placeholder="Lot no." aria-label="Lot number" onChange={e => set(i, { lot: e.target.value })} /> : l.lot || "—"}</td>
                <td className={bbTone}>
                  {editable ? <input className={`input ${bbTone}`} type="month" value={l.bestBefore} aria-label="Best before" onChange={e => set(i, { bestBefore: e.target.value })} />
                    : <span className={`bb ${bbTone}`}>{fmtMonth(l.bestBefore)}</span>}
                </td>
                {showDamaged && <td className="num">{editable ? <input className="input num-in" type="number" min={0} max={l.cases} value={l.damaged || ""} aria-label="Damaged cases" onChange={e => set(i, { damaged: Math.min(l.cases, Math.max(0, parseInt(e.target.value) || 0)) })} /> : l.damaged || "—"}</td>}
                {editable && <td><button className="mini" onClick={() => remove(i)} aria-label={`Remove ${p?.name ?? "line"}`}><CloseIcon /></button></td>}
              </tr>
            );
          })}
          {!lines.length && <tr><td colSpan={7} className="empty-row">No products yet.</td></tr>}
        </tbody>
        <tfoot>
          <tr><td>{editable && <button className="btn" onClick={add}>+ Add product</button>}</td><td className="num"><b>{totals.cases}</b></td><td className="num"><b>{totals.pallets}</b> pl</td><td colSpan={4} /></tr>
        </tfoot>
      </table>
    </div>
  );
}
