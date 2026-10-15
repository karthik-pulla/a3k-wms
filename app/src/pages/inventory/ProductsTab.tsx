import { useEffect, useMemo, useRef, useState } from "react";
import { FACES, productById } from "../../data/catalog";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { can, visibleLines } from "../../auth/permissions";
import { messagesAbout } from "../../chat/selectors";
import { RackView, HIDDEN_PRODUCT, type SlotMark } from "../../components/RackView";
import { WarehouseMap, type MapMark } from "../../components/inventory/WarehouseMap";
import { ExportDialog } from "../../components/inventory/ExportDialog";
import { SlotDetail } from "../../components/inventory/SlotDetail";
import {
  PRODUCT_SORTS, brandList, brandOf, byLocation, fmtDay, fmtMonth, groupOf, looksLikeCode, matchesProduct, productSummaries, sortProducts,
  stockRows, type ProductSort, type StockRow,
} from "../../inventory/selectors";
import type { StockLine } from "../../store/types";
import { FilterIcon, SortIcon } from "../../components/icons";

type StockFilter = "in" | "all" | "none";
type ExpiryFilter = "any" | "warn" | "expired";
const SORT_KEY = "wms.inv.productSort";

/**
 * #/inventory/products                 search, filter and sort products
 * #/inventory/products/<productId>     every pallet of that product highlighted
 * #/inventory/products/brand:<name>    every pallet of a brand highlighted
 */
export function ProductsTab({ selection }: { selection?: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ProductSort>(() => { try { return (localStorage.getItem(SORT_KEY) as ProductSort) || "auto"; } catch { return "auto"; } });
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch { /* per visit */ } }, [sort]);
  const [stockF, setStockF] = useState<StockFilter>("in");
  const [expiryF, setExpiryF] = useState<ExpiryFilter>("any");
  const [clientsF, setClientsF] = useState<Set<string>>(new Set());
  const [brandsF, setBrandsF] = useState<Set<string>>(new Set());
  const [partialF, setPartialF] = useState(false);
  const [pop, setPop] = useState<"filter" | "sort" | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Dropdowns close on a click outside them or on Escape
  useEffect(() => {
    if (!pop) return;
    const out = (e: PointerEvent) => { if (!popRef.current?.contains(e.target as Node)) setPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [pop]);
  const [hl, setHl] = useState(0);
  const [exporting, setExporting] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const summaries = useMemo(() => productSummaries(state, me), [state, me]);
  const brands = useMemo(() => brandList(summaries), [summaries]);
  const clients = [...new Set(brands.map(b => b.client))];
  const results = useMemo(() => sortProducts(summaries.filter(s =>
    matchesProduct(s.product, q)
    && (stockF === "all" || (stockF === "in" ? s.cases > 0 : s.cases === 0))
    && (expiryF === "any" || (expiryF === "expired" ? s.worst === "expired" : s.worst !== "ok"))
    && (!clientsF.size || clientsF.has(s.product.client))
    && (!brandsF.size || brandsF.has(brandOf(s.product)))
    && (!partialF || s.partial > 0)), sort, q), [summaries, q, stockF, expiryF, clientsF, brandsF, partialF, sort]);
  // Brands whose name matches what's typed are offered first, to highlight a whole brand
  const brandHits = q.trim() && !looksLikeCode(q) ? brands.filter(b => b.brand.toLowerCase().includes(q.trim().toLowerCase())) : [];
  const items: ({ kind: "brand"; brand: string } | { kind: "product"; id: string })[] = [...brandHits.map(b => ({ kind: "brand" as const, brand: b.brand })), ...results.map(r => ({ kind: "product" as const, id: r.product.id }))];
  useEffect(() => setHl(0), [q, sort, stockF, expiryF, clientsF, brandsF, partialF]);
  const filters = (stockF !== "in" ? 1 : 0) + (expiryF !== "any" ? 1 : 0) + clientsF.size + brandsF.size + (partialF ? 1 : 0);
  const open = (it: (typeof items)[number]) => go(`#/inventory/products/${encodeURIComponent(it.kind === "brand" ? `brand:${it.brand}` : it.id)}`);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl(h => Math.min(items.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter" && items[hl]) { e.preventDefault(); open(items[hl]); }
    else if (e.key === "Escape") { if (q) setQ(""); else go("#/inventory/products"); }
  };
  useEffect(() => { listRef.current?.querySelector(".hl")?.scrollIntoView({ block: "nearest" }); }, [hl]);

  const brandSel = selection?.startsWith("brand:") ? selection.slice(6) : undefined;
  const productSel = selection && !brandSel ? productById(selection) : undefined;
  const sum = (set: Set<string>, v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

  return (
    <div className="inv-products">
      <div className="inv-left glass">
        <input className="input inv-search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type product code or name…" aria-label="Search products" autoFocus
          role="combobox" aria-expanded="true" aria-controls="inv-results" aria-activedescendant={items[hl] ? `inv-r-${hl}` : undefined} />
        <div className="inv-toolwrap" ref={popRef}>
        <div className="inv-tools">
          <button className={`toolbtn${pop === "filter" ? " on" : ""}`} onClick={() => setPop(p => (p === "filter" ? null : "filter"))} aria-expanded={pop === "filter"} title="Filter">
            <FilterIcon /> Filter{filters ? <span className="badge">{filters}</span> : null}
          </button>
          <button className={`toolbtn${pop === "sort" ? " on" : ""}`} onClick={() => setPop(p => (p === "sort" ? null : "sort"))} aria-expanded={pop === "sort"} title="Sort">
            <SortIcon /> {sort === "auto" ? (looksLikeCode(q) ? "By code" : "A–Z") : PRODUCT_SORTS.find(s => s[0] === sort)![1]}
          </button>
          <span className="muted small inv-count">{results.length}</span>
        </div>
        {pop === "filter" && (
          <div className="inv-pop glass" role="dialog" aria-label="Filter products">
            <div className="segment s3" role="group" aria-label="Stock">
              {([["in", "In stock"], ["all", "All"], ["none", "No stock"]] as const).map(([v, t]) => <button key={v} aria-pressed={stockF === v} onClick={() => setStockF(v)}>{t}</button>)}
            </div>
            <div className="segment s3" role="group" aria-label="Expiry">
              {([["any", "Any date"], ["warn", "Expiring"], ["expired", "Expired"]] as const).map(([v, t]) => <button key={v} aria-pressed={expiryF === v} onClick={() => setExpiryF(v)}>{t}</button>)}
            </div>
            <label className="toggle-row"><input type="checkbox" checked={partialF} onChange={e => setPartialF(e.target.checked)} /> Has partial pallets</label>
            {clients.length > 1 && <><h4>Client</h4><div className="chip-wrap">{clients.map(c => <button key={c} className={`chip-btn${clientsF.has(c) ? " on" : ""}`} onClick={() => setClientsF(s => sum(s, c))}>{c}</button>)}</div></>}
            <h4>Brand</h4>
            <div className="chip-wrap">{brands.filter(b => !clientsF.size || clientsF.has(b.client)).map(b => <button key={b.brand} className={`chip-btn${brandsF.has(b.brand) ? " on" : ""}`} onClick={() => setBrandsF(s => sum(s, b.brand))}>{b.brand}</button>)}</div>
            {filters > 0 && <button className="link" onClick={() => { setStockF("in"); setExpiryF("any"); setClientsF(new Set()); setBrandsF(new Set()); setPartialF(false); }}>Clear filters</button>}
          </div>
        )}
        {pop === "sort" && (
          <div className="inv-pop glass" role="listbox" aria-label="Sort products">
            {PRODUCT_SORTS.map(([v, t]) => (
              <button key={v} type="button" role="option" aria-selected={sort === v} className={`pop-opt${sort === v ? " on" : ""}`} onClick={() => { setSort(v); setPop(null); }}>
                <span className="pop-check" aria-hidden="true">{sort === v ? "✓" : ""}</span>{t}
              </button>
            ))}
          </div>
        )}
        </div>
        <ol className="inv-results" id="inv-results" ref={listRef} role="listbox" aria-label="Products">
          {items.map((it, i) => {
            if (it.kind === "brand") {
              const b = brands.find(x => x.brand === it.brand)!;
              return (
                <li key={`b-${it.brand}`} id={`inv-r-${i}`} role="option" aria-selected={brandSel === it.brand} className={`inv-r brand${i === hl ? " hl" : ""}${brandSel === it.brand ? " on" : ""}`} onClick={() => open(it)} onMouseEnter={() => setHl(i)}>
                  <span className="inv-r-code">ALL</span><span className="inv-r-name">All {b.brand} products<small>{b.products} products · {b.client}</small></span><span className="inv-r-n">{b.cases.toLocaleString()}<small>cs</small></span>
                </li>
              );
            }
            const s = summaries.find(x => x.product.id === it.id)!;
            return (
              <li key={it.id} id={`inv-r-${i}`} role="option" aria-selected={productSel?.id === it.id} className={`inv-r${i === hl ? " hl" : ""}${productSel?.id === it.id ? " on" : ""}${s.cases ? "" : " none"}`} onClick={() => open(it)} onMouseEnter={() => setHl(i)}>
                <span className="inv-r-code">{s.product.code}</span>
                <span className="inv-r-name">{s.product.name}<small>{s.product.size}{s.product.units ? ` × ${s.product.units}` : ""} · {brandOf(s.product)}{s.locations ? ` · ${s.locations} loc` : ""}</small></span>
                <span className="inv-r-n">{s.cases.toLocaleString()}<small>cs</small>{s.worst !== "ok" && <i className={`tone-dot ${s.worst}`} title={s.worst === "expired" ? "Has expired stock" : "Expiring within 6 months"} />}</span>
              </li>
            );
          })}
          {!items.length && <li className="muted small inv-none">No products match{filters ? " with these filters" : ""}.</li>}
        </ol>
        {can(me, "export") && <button className="btn small inv-export" onClick={() => setExporting(true)}>Export stock report (.xlsx)…</button>}
      </div>

      <Detail productId={productSel?.id} brand={brandSel} onExport={() => setExporting(true)} />
      {exporting && <ExportDialog initialBrands={brandSel ? [brandSel] : productSel ? [brandOf(productSel)] : [...brandsF]} onClose={() => setExporting(false)} />}
    </div>
  );
}

type Col = "location" | "product" | "cases" | "lot" | "bb" | "arrival";

function Detail({ productId, brand, onExport }: { productId?: string; brand?: string; onExport: () => void }) {
  const { state } = useStore();
  const { me } = useSession();
  const [view, setView] = useState<"map" | "table">("map");
  const [allSides, setAllSides] = useState(false);
  const [face, setFace] = useState<string | undefined>();
  const [open, setOpen] = useState<string | null>(null);
  const [col, setCol] = useState<Col>("arrival");
  const [asc, setAsc] = useState(true);
  useEffect(() => { setFace(undefined); setOpen(null); }, [productId, brand]);

  const rows: StockRow[] = useMemo(() => {
    if (!productId && !brand) return [];
    return stockRows(state, me).filter(r => r.product && (productId ? r.product.id === productId : brandOf(r.product) === brand));
  }, [state, me, productId, brand]);
  const marks = useMemo(() => {
    const m = new Map<string, MapMark>();
    for (const r of rows) { const cur = m.get(r.code); if (!cur || (r.tone === "expired") || (r.tone === "warn" && cur.tone === "ok")) m.set(r.code, { tone: r.tone, partial: r.partial || cur?.partial }); }
    return m;
  }, [rows]);
  // Open the rack side with the most matches by default
  const busiest = useMemo(() => { const n = new Map<string, number>(); for (const c of marks.keys()) n.set(groupOf(c), (n.get(groupOf(c)) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]; }, [marks]);
  const shownFace = face ?? busiest;
  const viewStock = useMemo(() => {
    const out: Record<string, StockLine[]> = {};
    for (const [code, lines] of Object.entries(state.stock)) { const { shown, hidden } = visibleLines(me, lines); out[code] = hidden ? [...shown, { productId: HIDDEN_PRODUCT, cases: 0 }] : shown; }
    return out;
  }, [state.stock, me]);

  const p = productId ? productById(productId) : undefined;
  const cases = rows.reduce((a, r) => a + (r.line?.cases ?? 0), 0);
  const locs = marks.size;
  const partial = rows.filter(r => r.partial).length;
  const expired = rows.filter(r => r.tone === "expired").reduce((a, r) => a + (r.line?.cases ?? 0), 0);
  const expiring = rows.filter(r => r.tone === "warn").reduce((a, r) => a + (r.line?.cases ?? 0), 0);
  const about = productId ? messagesAbout(state, me, { product: productId }).length : 0;

  const sorted = useMemo(() => {
    const v = (r: StockRow): string | number => col === "location" ? "" : col === "product" ? `${r.product?.name} ${r.product?.size}` : col === "cases" ? r.line?.cases ?? 0 : col === "lot" ? r.line?.lot ?? "" : col === "bb" ? r.line?.bestBefore ?? "9999" : r.arrival ?? "9999";
    const list = [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      const c = col === "location" ? byLocation(a.code, b.code) : typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), undefined, { numeric: true });
      return c || byLocation(a.code, b.code);
    });
    return asc ? list : list.reverse();
  }, [rows, col, asc]);
  const th = (c: Col, label: string) => (
    <th aria-sort={col === c ? (asc ? "ascending" : "descending") : "none"}><button className="th-btn" onClick={() => { if (col === c) setAsc(!asc); else { setCol(c); setAsc(c !== "cases"); } }}>{label}{col === c ? (asc ? " ↑" : " ↓") : ""}</button></th>
  );

  const rackMarks: Record<string, SlotMark> = {};
  if (shownFace) for (const [code, m] of marks) if (groupOf(code) === shownFace) rackMarks[code] = { kind: code === open ? "pulse" : `tone-${m.tone}`, label: viewStock[code]?.find(l => l.productId === productId)?.cases?.toString() ?? "●", partial: m.partial };
  const isRack = !!shownFace && FACES.some(f => f.id === shownFace);
  const floorHere = shownFace ? [...marks.keys()].filter(c => groupOf(c) === shownFace && !/-L\d-B\d$/.test(c)).sort(byLocation) : [];

  return (
    <div className="inv-right glass">
      {!productId && !brand ? (
        <>
          <div className="inv-head"><div><h2>Warehouse</h2><p className="muted small">Pick a product or a brand on the left to highlight every pallet. Squares are slots, darker ones hold stock.</p></div></div>
          <WarehouseMap stock={viewStock} marks={marks} current={face} onFace={f => { setFace(f); }} />
          {face && <FaceView face={face} stock={viewStock} marks={{}} onCell={setOpen} />}
        </>
      ) : (
        <>
          <div className="inv-head">
            <div>
              <h2>{p ? <>{p.name} <span className="muted">{p.size}{p.units ? ` × ${p.units}` : ""}</span></> : `All ${brand} products`}</h2>
              <p className="muted small">{p ? `${p.code} · ${brandOf(p)}${p.brand && p.brand !== p.client ? ` · ${p.client}` : ""}${p.perPallet ? ` · ${p.perPallet} cs per full pallet` : ""}` : `${new Set(rows.map(r => r.product!.id)).size} products in stock`}</p>
            </div>
            <div className="btns">
              <div className="segment s2" role="group" aria-label="View">
                <button aria-pressed={view === "map"} onClick={() => setView("map")}>Map</button>
                <button aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
              </div>
              {can(me, "export") && <button className="btn small" onClick={onExport}>Export…</button>}
            </div>
          </div>
          <div className="inv-stats">
            <span><b>{cases.toLocaleString()}</b> cases</span><span><b>{locs}</b> locations</span><span><b>{partial}</b> partial</span>
            {expiring > 0 && <span className="warn"><b>{expiring}</b> cs expiring</span>}
            {expired > 0 && <span className="expired-pill"><b>{expired}</b> cs expired</span>}
            {about > 0 && <a className="link" href={`#/messages`}>{about} message{about > 1 ? "s" : ""}</a>}
          </div>
          {!rows.length ? <p className="muted">No stock right now.</p> : view === "map" ? (
            <>
              <div className="map-bar">
                <span className="muted small">{new Set([...marks.keys()].map(groupOf)).size} rack sides and areas hold it · click one to see it below</span>
                <label className="toggle-row small"><input type="checkbox" checked={allSides} onChange={e => setAllSides(e.target.checked)} /> Show every rack side</label>
              </div>
              <WarehouseMap stock={viewStock} marks={marks} current={shownFace} onFace={setFace} onlyHits={!allSides} />
              {shownFace && (isRack
                ? <FaceView face={shownFace} stock={viewStock} marks={rackMarks} onCell={setOpen} />
                : null)}
              {floorHere.length > 0 && (
                <div className="offrack"><span className="muted small">On the floor{isRack ? ` of ${shownFace}` : ""}:</span>
                  {floorHere.map(c => <button key={c} className={`chip-btn tone-${marks.get(c)!.tone}`} onClick={() => setOpen(c)}>{c}</button>)}</div>
              )}
              <div className="legend-row muted small"><span><i className="sw tone-ok" /> in date</span><span><i className="sw tone-warn" /> expiring within 6 months</span><span><i className="sw tone-expired" /> expired</span><span><i className="sw partial" /> partial pallet</span></div>
            </>
          ) : (
            <div className="table-wrap">
              <table className="lines inv-table">
                <thead><tr>{th("location", "Location")}{brand && th("product", "Product")}{th("cases", "Cases")}{th("lot", "Lot")}{th("bb", "Best before")}{th("arrival", "Arrived")}<th>Pallet</th></tr></thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={`${r.code}-${i}`} className={r.tone === "expired" ? "expired" : ""} onClick={() => setOpen(r.code)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpen(r.code); }}>
                      <td className="mono">{r.code}</td>
                      {brand && <td>{r.product?.name} <small className="muted">{r.product?.size} · {r.product?.code}</small></td>}
                      <td className="num">{r.line?.cases}</td>
                      <td>{r.line?.lot || "—"}</td>
                      <td><span className={`bb ${r.tone}`}>{fmtMonth(r.line?.bestBefore)}</span></td>
                      <td>{fmtDay(r.arrival)}</td>
                      <td>{r.partial ? "Partial" : "Full"}{r.mixed ? " · mixed" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {open && <SlotDetail code={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

function FaceView({ face, stock, marks, onCell }: { face: string; stock: Record<string, StockLine[]>; marks: Record<string, SlotMark>; onCell: (code: string) => void }) {
  const [f, setF] = useState(face);
  useEffect(() => setF(face), [face]);
  if (!FACES.some(x => x.id === f)) return null;
  return <RackView faceId={f} onFace={setF} stock={stock} marks={marks} onCell={onCell} />;
}

