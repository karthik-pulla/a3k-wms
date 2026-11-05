// Receiving a delivery: what was announced against what arrived, and making pallets the warehouse's way.
import { useState } from "react";
import { productById } from "../../data/catalog";
import type { Shipment, ShipmentLine } from "../../store/types";
import { casesByProduct, receivingDifferences } from "../../../../server/src/shared/receiving.ts";
import { palletGroups, palletSizes, splitIntoPallets, tiHi } from "../../../../server/src/shared/pallets.ts";
import { useToast } from "../../components/Toast";

const name = (id: string) => { const p = productById(id); return p ? `${p.code} ${p.name}` : "Unknown product"; };
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Announced (kept when the delivery was marked arrived) against received (the lines now), per product. When they differ,
 * whoever confirms gives the reason (`reason`/`onReason`); after confirming it shows what was given.
 */
export function ReceivedCheck({ s, reason, onReason }: { s: Shipment; reason?: string; onReason?: (r: string) => void }) {
  if (!s.announced) return null;
  const diff = receivingDifferences(s.announced, s.lines);
  const received = new Map(casesByProduct(s.lines).map(x => [x.productId, x.cases]));
  const damaged = new Map<string, number>();
  for (const l of s.lines) if (l.productId) damaged.set(l.productId, (damaged.get(l.productId) ?? 0) + (l.damaged ?? 0));
  const ids = [...new Set([...s.announced.map(a => a.productId), ...received.keys()])];
  return (
    <div className="panel glass">
      <div className="plan-head">
        <h2 className="plain-h">Announced and received</h2>
        <span className={`small ${diff.length ? "warn" : "ok"}`}>{diff.length ? `Differs on ${diff.length} product${diff.length > 1 ? "s" : ""}` : "Everything announced arrived"}</span>
      </div>
      <div className="table-wrap">
        <table className="lines">
          <thead><tr><th>Product</th><th className="num">Announced</th><th className="num">Received</th><th className="num">Difference</th><th className="num">Damaged</th></tr></thead>
          <tbody>
            {ids.map(id => {
              const a = s.announced!.find(x => x.productId === id)?.cases ?? 0, r = received.get(id) ?? 0;
              return (
                <tr key={id} className={a !== r ? "warn" : undefined}>
                  <td className="prod">{name(id)}</td>
                  <td className="num">{a}</td>
                  <td className="num">{r}</td>
                  <td className={`num${a !== r ? " warn" : ""}`}>{a === r ? "—" : signed(r - a)}</td>
                  <td className="num">{damaged.get(id) || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {diff.length > 0 && (onReason
        ? <label className="field"><span>Why is what arrived different? (kept in Logs)</span>
            <input className={`input${reason?.trim() ? "" : " invalid"}`} value={reason ?? ""} maxLength={500} placeholder="e.g. 2 cases short on the container, driver signed for it" onChange={e => onReason(e.target.value)} />
          </label>
        : s.difference && <p className="muted small">Reason given: <span translate="no">{s.difference}</span></p>)}
    </div>
  );
}

/**
 * "Split into pallets": each product (one lot and best-before, on pallets of its own) put back together and made into
 * full pallets of its size plus one partial pallet, like the inbound report's new palletization. TI × HI fills the size.
 */
export function SplitPallets({ lines, onChange }: { lines: ShipmentLine[]; onChange: (lines: ShipmentLine[]) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const groups = palletGroups(lines);
  const [per, setPer] = useState<Record<string, string>>({});
  const [layers, setLayers] = useState<Record<string, { ti: string; hi: string }>>({});
  if (!groups.length) return null;
  const sizeOf = (key: string, productId: string) => {
    const typed = per[key];
    if (typed !== undefined) return parseInt(typed) || 0;
    return productById(productId)?.perPallet ?? 0;
  };
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Split into pallets…</button>;
  const apply = () => {
    const sizes = Object.fromEntries(groups.map(g => [g.key, sizeOf(g.key, g.productId)]).filter(([, n]) => (n as number) > 0));
    const before = new Set(lines.map(l => l.pallet)).size;
    const next = splitIntoPallets(lines, sizes);
    onChange(next);
    setOpen(false);
    toast(`Pallets made again: ${before} → ${new Set(next.map(l => l.pallet)).size}. Check the lots and dates.`);
  };
  return (
    <div className="panel glass">
      <div className="plan-head">
        <h2 className="plain-h">Split into pallets</h2>
        <span className="muted small">Full pallets of each product's size, then one partial pallet with the rest. Mixed pallets stay as they are.</span>
      </div>
      <div className="table-wrap">
        <table className="lines">
          <thead><tr><th>Product</th><th>Lot</th><th className="num">Cases</th><th className="num">Now</th><th className="num">Cases per pallet</th><th className="num">TI × HI</th><th>Makes</th></tr></thead>
          <tbody>
            {groups.map(g => {
              const size = sizeOf(g.key, g.productId), made = size > 0 ? palletSizes(g.cases, size) : [];
              const full = made.filter(n => n === size).length, part = made.length - full;
              const th = layers[g.key] ?? { ti: "", hi: "" };
              const setTh = (patch: Partial<typeof th>) => {
                const next = { ...th, ...patch };
                setLayers({ ...layers, [g.key]: next });
                const n = tiHi(parseInt(next.ti) || 0, parseInt(next.hi) || 0);
                if (n) setPer({ ...per, [g.key]: String(n) });
              };
              return (
                <tr key={g.key}>
                  <td className="prod">{name(g.productId)}</td>
                  <td>{g.lot || "—"}</td>
                  <td className="num">{g.cases}</td>
                  <td className="num">{g.pallets} pl</td>
                  <td className="num"><input className="input num-in" type="number" min={0} value={size || ""} aria-label="Cases per pallet" onChange={e => setPer({ ...per, [g.key]: e.target.value })} /></td>
                  <td className="num"><span className="ti-hi">
                    <input className="input num-in" type="number" min={0} value={th.ti} placeholder="TI" aria-label="Cases per layer (TI)" onChange={e => setTh({ ti: e.target.value })} />×
                    <input className="input num-in" type="number" min={0} value={th.hi} placeholder="HI" aria-label="Layers (HI)" onChange={e => setTh({ hi: e.target.value })} />
                  </span></td>
                  <td>{size > 0 ? `${full} full${part ? ` + 1 of ${made[made.length - 1]}` : ""}` : <span className="muted">no size, stays as it is</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" disabled={!groups.some(g => sizeOf(g.key, g.productId) > 0)} onClick={apply}>Make these pallets</button>
      </div>
    </div>
  );
}
