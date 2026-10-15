import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { productById } from "../../data/catalog";
import { arrivalDate, expiryTone, isPartial } from "../../chat/selectors";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useToast } from "../Toast";
import { CloseIcon } from "../icons";
import { buildXlsx, download, type Sheet } from "../../utils/xlsx";
import { brandList, brandOf, byLocation, natural, productSummaries, today, type ProductSummary } from "../../inventory/selectors";

type Order = "code" | "name" | "cases";

/**
 * Stock report for the brands you pick: cases per product, plus (optionally) every pallet location.
 * Only clients the person may see are offered. "One file per brand" keeps each brand's stock in its own file.
 */
export function ExportDialog({ initialBrands, onClose }: { initialBrands: string[]; onClose: () => void }) {
  const { state } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const summaries = useMemo(() => productSummaries(state, me), [state, me]);
  const brands = useMemo(() => brandList(summaries), [summaries]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialBrands.length ? initialBrands : brands.filter(b => b.cases > 0).map(b => b.brand)));
  const [zero, setZero] = useState(false);
  const [locations, setLocations] = useState(true);
  const [perBrand, setPerBrand] = useState(false);
  const [order, setOrder] = useState<Order>("code");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const clients = [...new Set(brands.map(b => b.client))];
  const toggle = (b: string) => setPicked(p => { const n = new Set(p); if (n.has(b)) n.delete(b); else n.add(b); return n; });
  const chosen = summaries.filter(s => picked.has(brandOf(s.product)) && (zero || s.cases > 0));

  const run = () => {
    const groups = perBrand ? [...picked].map(b => [b]) : [[...picked]];
    let files = 0;
    for (const g of groups) {
      const list = summaries.filter(s => g.includes(brandOf(s.product)) && (zero || s.cases > 0));
      if (!list.length) continue;
      download(buildXlsx(sheetsFor(list, g)), `stock-report-${g.length === 1 ? g[0].replace(/\W+/g, "-").toLowerCase() : `${g.length}-brands`}-${today()}.xlsx`);
      files++;
    }
    toast(files ? `Downloaded ${files} report${files > 1 ? "s" : ""}.` : "Nothing to report for those brands.");
    if (files) onClose();
  };

  const sheetsFor = (list: ProductSummary[], g: string[]): Sheet[] => {
    const cmp = (a: ProductSummary, b: ProductSummary) => order === "cases" ? b.cases - a.cases || natural(a.product.name, b.product.name)
      : order === "name" ? natural(a.product.name, b.product.name) || natural(a.product.size, b.product.size) : natural(a.product.code, b.product.code);
    const sorted = [...list].sort((a, b) => natural(brandOf(a.product), brandOf(b.product)) || cmp(a, b));
    const sum = (f: (s: ProductSummary) => number) => sorted.reduce((a, s) => a + f(s), 0);
    const sheets: Sheet[] = [{
      name: "Products",
      header: ["Brand", "Client", "Code", "Product", "Size", "Units per case", "Cases", "Locations", "Partial pallets", "Expired cases", "Earliest best before", "Oldest stock arrived"],
      widths: [16, 10, 12, 38, 12, 9, 9, 10, 9, 9, 13, 13],
      rows: sorted.map(s => [brandOf(s.product), s.product.client, s.product.code, s.product.name, s.product.size, s.product.units, s.cases, s.locations, s.partial, s.expiredCases, s.earliestBB ?? "", s.oldestArrival ?? ""]),
      totalRow: ["Total", "", "", `${sorted.length} products`, "", "", sum(s => s.cases), sum(s => s.locations), sum(s => s.partial), sum(s => s.expiredCases), "", ""],
    }];
    if (g.length > 1) {
      const byBrand = g.map(b => { const l = sorted.filter(s => brandOf(s.product) === b); return [b, l[0]?.product.client ?? "", l.filter(s => s.cases > 0).length, l.reduce((a, s) => a + s.cases, 0), l.reduce((a, s) => a + s.locations, 0)]; });
      sheets.push({ name: "By brand", header: ["Brand", "Client", "Products in stock", "Cases", "Locations"], widths: [18, 10, 12, 10, 10], rows: byBrand.sort((a, b) => natural(String(a[0]), String(b[0]))) });
    }
    if (locations) {
      const ids = new Set(sorted.map(s => s.product.id));
      const rows = Object.entries(state.stock).flatMap(([code, lines]) => lines.filter(l => ids.has(l.productId)).map(l => ({ code, l, mixed: lines.length > 1 })))
        .sort((a, b) => byLocation(a.code, b.code));
      sheets.push({
        name: "Locations",
        header: ["Location", "Brand", "Code", "Product", "Size", "Cases", "Lot", "Best before", "Arrived", "Pallet", "Mixed", "Status"],
        widths: [15, 14, 11, 34, 11, 7, 11, 11, 11, 8, 7, 9],
        rows: rows.map(({ code, l, mixed }) => {
          const p = productById(l.productId)!;
          const t = expiryTone(l.bestBefore);
          return [code, brandOf(p), p.code, p.name, p.size, l.cases, l.lot ?? "", l.bestBefore ?? "", arrivalDate(state, code, l), isPartial(l) ? "Partial" : "Full", mixed ? "Yes" : "", t === "expired" ? "EXPIRED" : t === "warn" ? "Expiring" : ""];
        }),
      });
    }
    sheets.push({ name: "About", header: ["Report", "Value"], widths: [22, 60], rows: [
      ["Stock report", g.join(", ")], ["Made", new Date().toLocaleString()], ["By", me.name],
      ["Data", "SAMPLE: the 27 Sep 2026 sheets moved onto the new slot codes, with made-up lots and best-before dates"],
      ["Units", "Quantities are cases"],
    ] });
    return sheets;
  };

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog glass" role="dialog" aria-modal="true" aria-labelledby="exp-h">
        <div className="sheet-head"><h2 id="exp-h">Export stock report</h2><button className="iconbtn glass" onClick={onClose} aria-label="Close"><CloseIcon /></button></div>
        <p className="muted small">An .xlsx file with cases per product for the brands you choose.</p>
        <div className="exp-brands">
          {clients.map(c => {
            const bs = brands.filter(b => b.client === c);
            const all = bs.every(b => picked.has(b.brand));
            return (
              <fieldset key={c} className="exp-client">
                <legend>
                  <label><input type="checkbox" checked={all} onChange={() => setPicked(p => { const n = new Set(p); for (const b of bs) { if (all) n.delete(b.brand); else n.add(b.brand); } return n; })} /> {c}</label>
                </legend>
                {bs.map(b => (
                  <label key={b.brand} className="exp-brand">
                    <input type="checkbox" checked={picked.has(b.brand)} onChange={() => toggle(b.brand)} />
                    <span>{b.brand}</span><small>{b.cases.toLocaleString()} cs</small>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        <div className="exp-opts">
          <label className="toggle-row"><input type="checkbox" checked={locations} onChange={e => setLocations(e.target.checked)} /> Add a sheet with every pallet location</label>
          <label className="toggle-row"><input type="checkbox" checked={zero} onChange={e => setZero(e.target.checked)} /> Include products with no stock</label>
          <label className="toggle-row"><input type="checkbox" checked={perBrand} onChange={e => setPerBrand(e.target.checked)} /> One file per brand</label>
          <label className="field inline"><span>Sort</span>
            <select className="input" value={order} onChange={e => setOrder(e.target.value as Order)}>
              <option value="code">Brand, then product code</option><option value="name">Brand, then name</option><option value="cases">Brand, then most cases</option>
            </select>
          </label>
        </div>
        <div className="sheet-foot">
          <span>{picked.size} brand{picked.size === 1 ? "" : "s"} · {chosen.length} products · {chosen.reduce((a, s) => a + s.cases, 0).toLocaleString()} cases</span>
          <button className="btn primary" disabled={!chosen.length} onClick={run}>Download .xlsx</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

