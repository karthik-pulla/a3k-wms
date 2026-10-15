import { useEffect, useMemo, useState } from "react";
import { WARN_MONTHS } from "../../chat/selectors";
import { AREAS, FACES, SLOTS, faceOf, isFloor, rackName, slotCode } from "../../data/catalog";
import { can, visibleLines } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { RackView, HIDDEN_PRODUCT, type SlotMark } from "../../components/RackView";
import { SlotDetail } from "../../components/inventory/SlotDetail";
import { buildXlsx, download } from "../../utils/xlsx";
import { brandOf, byLocation, fmtDay, fmtMonth, groupOf, natural, stockRows, today, type StockRow } from "../../inventory/selectors";
import type { StockLine } from "../../store/types";

type Status = "all" | "occupied" | "empty" | "floor" | "partial" | "mixed" | "warn" | "expired";
const STATUSES: [Status, string][] = [["all", "All"], ["occupied", "Occupied"], ["empty", "Empty slots"], ["floor", "Floor & areas"], ["partial", "Partial"], ["mixed", "Mixed"], ["warn", "Expiring"], ["expired", "Expired"]];
type Col = "location" | "product" | "brand" | "cases" | "lot" | "bb" | "arrival";
const PAGE = 150;

/** Every rack, slot and floor spot: a searchable, sortable table, or rack by rack with fill levels. */
export function StockTab({ openCode }: { openCode?: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const [view, setView] = useState<"table" | "racks">("table");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("occupied");
  const [where, setWhere] = useState("");
  const [col, setCol] = useState<Col>("location");
  const [asc, setAsc] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(openCode ?? null);
  useEffect(() => { if (openCode) setOpen(openCode); }, [openCode]);
  useEffect(() => setLimit(PAGE), [q, status, where, col, asc]);

  const all = useMemo(() => stockRows(state, me, { empties: true }), [state, me]);
  const stats = useMemo(() => {
    const occupied = SLOTS.filter(s => state.stock[s.code]?.length).length;
    const vis = all.filter(r => r.line);
    return {
      occupied, empty: SLOTS.length - occupied,
      cases: vis.reduce((a, r) => a + r.line!.cases, 0),
      floor: new Set(all.filter(r => r.kind !== "slot" && (r.line || r.hidden)).map(r => r.code)).size,
      partial: vis.filter(r => r.partial).length,
      mixed: new Set(all.filter(r => r.mixed).map(r => r.code)).size,
      warn: vis.filter(r => r.tone === "warn").reduce((a, r) => a + r.line!.cases, 0),
      expired: vis.filter(r => r.tone === "expired").reduce((a, r) => a + r.line!.cases, 0),
    };
  }, [all, state.stock]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(() => {
    const list = all.filter(r => {
      if (where && r.group !== where && !(where === "floor-all" && r.kind !== "slot")) return false;
      switch (status) {
        case "occupied": if (!r.line && !r.hidden) return false; break;
        case "empty": if (r.line || r.hidden || r.kind !== "slot") return false; break;
        case "floor": if (r.kind === "slot" || (!r.line && !r.hidden)) return false; break;
        case "partial": if (!r.partial) return false; break;
        case "mixed": if (!r.mixed) return false; break;
        case "warn": if (r.tone !== "warn") return false; break;
        case "expired": if (r.tone !== "expired") return false; break;
      }
      if (!words.length) return true;
      const hay = `${r.code} ${r.product ? `${r.product.code} ${r.product.name} ${brandOf(r.product)} ${r.product.size}` : r.hidden ? "hidden" : "empty"} ${r.line?.lot ?? ""}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    const v = (r: StockRow): string | number => col === "product" ? `${r.product?.name ?? "~"} ${r.product?.size ?? ""}` : col === "brand" ? (r.product ? brandOf(r.product) : "~") : col === "cases" ? r.line?.cases ?? -1
      : col === "lot" ? r.line?.lot ?? "~" : col === "bb" ? r.line?.bestBefore ?? "9999" : col === "arrival" ? r.arrival ?? "9999" : "";
    list.sort((a, b) => {
      if (col === "location") return byLocation(a.code, b.code);
      const x = v(a), y = v(b);
      return (typeof x === "number" ? x - (y as number) : natural(String(x), String(y))) || byLocation(a.code, b.code);
    });
    return asc ? list : list.reverse();
  }, [all, where, status, words.join(" "), col, asc]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = (c: Col, label: string) => (
    <th aria-sort={col === c ? (asc ? "ascending" : "descending") : "none"}><button className="th-btn" onClick={() => { if (col === c) setAsc(!asc); else { setCol(c); setAsc(c !== "cases"); } }}>{label}{col === c ? (asc ? " ↑" : " ↓") : ""}</button></th>
  );
  const exportView = () => {
    download(buildXlsx([{
      name: "Inventory", header: ["Location", "Brand", "Code", "Product", "Size", "Cases", "Lot", "Best before", "Arrived", "Pallet", "Status"],
      widths: [15, 14, 11, 34, 11, 7, 11, 11, 11, 8, 10],
      rows: rows.map(r => [r.code, r.product ? brandOf(r.product) : "", r.product?.code ?? "", r.product?.name ?? (r.hidden ? "(another client)" : "Empty"), r.product?.size ?? "", r.line?.cases ?? null, r.line?.lot ?? "", r.line?.bestBefore ?? "", r.line ? r.arrival ?? "" : "", r.line ? (r.partial ? "Partial" : "Full") + (r.mixed ? ", mixed" : "") : "", r.tone === "expired" ? "EXPIRED" : r.tone === "warn" ? "Expiring" : ""]),
    }]), `inventory-${status}-${today()}.xlsx`);
  };

  return (
    <div className="stack">
      <div className="stats inv-statgrid">
        <button className={`stat glass${status === "occupied" ? " on" : ""}`} onClick={() => setStatus("occupied")}><span className="stat-n">{Math.round((stats.occupied / SLOTS.length) * 100)}%</span><span className="stat-l">slots in use<small>{stats.occupied.toLocaleString()} of {SLOTS.length.toLocaleString()}</small></span></button>
        <button className={`stat glass${status === "empty" ? " on" : ""}`} onClick={() => setStatus("empty")}><span className="stat-n ok">{stats.empty.toLocaleString()}</span><span className="stat-l">empty slots<small>free for put-away</small></span></button>
        <div className="stat glass"><span className="stat-n">{stats.cases.toLocaleString()}</span><span className="stat-l">cases in stock<small>{me.clients ? me.clients.join(" + ") : "all clients"}</small></span></div>
        <button className={`stat glass${status === "floor" ? " on" : ""}`} onClick={() => setStatus("floor")}><span className="stat-n">{stats.floor}</span><span className="stat-l">pallets on the floor<small>floors and areas</small></span></button>
        <button className={`stat glass${status === "partial" ? " on" : ""}`} onClick={() => setStatus("partial")}><span className="stat-n">{stats.partial}</span><span className="stat-l">partial pallets<small>{stats.mixed} mixed</small></span></button>
        <button className={`stat glass${status === "expired" ? " on" : ""}`} onClick={() => setStatus("expired")}><span className="stat-n danger">{stats.expired.toLocaleString()}</span><span className="stat-l">cases expired<small>{`${stats.warn.toLocaleString()} expiring in ${WARN_MONTHS} months`}</small></span></button>
      </div>

      <div className="toolbar">
        <input className="input search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search location, product, code, brand or lot" aria-label="Search inventory" />
        <select className="input inv-where" value={where} onChange={e => setWhere(e.target.value)} aria-label="Rack side or area">
          <option value="">Whole warehouse</option>
          {[...new Set(FACES.map(f => f.rack))].map(r => (
            <optgroup key={r} label={rackName(r)}>{FACES.filter(f => f.rack === r).map(f => <option key={f.id} value={f.id}>{f.id} · side {f.side}</option>)}</optgroup>
          ))}
          <optgroup label="Floor areas"><option value="floor-all">All floor spots and areas</option>{AREAS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
        </select>
        <div className="segment s2" role="group" aria-label="View">
          <button aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
          <button aria-pressed={view === "racks"} onClick={() => setView("racks")}>Racks</button>
        </div>
      </div>
      <div className="chip-wrap" role="group" aria-label="Show">
        {STATUSES.map(([s, t]) => <button key={s} className={`chip-btn${status === s ? " on" : ""}`} onClick={() => setStatus(s)}>{t}</button>)}
      </div>

      {view === "table" ? (
        <div className="panel glass">
          <div className="panel-foot">
            <span className="muted small">{rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}{rows.length > limit ? ` · showing ${limit}` : ""} · click a row for everything about that location</span>
            {can(me, "export") && <span className="btns"><button className="btn small" onClick={exportView} disabled={!rows.length}>Export these rows (.xlsx)</button><button className="btn small" onClick={() => window.print()}>Print</button></span>}
          </div>
          <div className="table-wrap">
            <table className="lines inv-table">
              <thead><tr>{th("location", "Location")}{th("product", "Product")}{th("brand", "Brand")}{th("cases", "Cases")}{th("lot", "Lot")}{th("bb", "Best before")}{th("arrival", "Arrived")}<th>Pallet</th></tr></thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => (
                  <tr key={`${r.code}-${i}`} className={`${r.tone === "expired" ? "expired" : ""}${!r.line && !r.hidden ? " empty-slot" : ""}${open === r.code ? " sel" : ""}`} onClick={() => setOpen(r.code)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpen(r.code); }}>
                    <td className="mono">{r.code}</td>
                    <td>{r.product ? <>{r.product.name} <small className="muted">{r.product.size} · {r.product.code}</small></> : r.hidden ? <span className="muted">Another client's stock</span> : <span className="muted">Empty</span>}</td>
                    <td>{r.product ? brandOf(r.product) : ""}</td>
                    <td className="num">{r.line?.cases ?? ""}</td>
                    <td>{r.line?.lot ?? ""}</td>
                    <td>{r.line ? <span className={`bb ${r.tone}`}>{fmtMonth(r.line.bestBefore)}</span> : ""}</td>
                    <td>{r.line ? fmtDay(r.arrival) : ""}</td>
                    <td>{r.line ? `${r.partial ? "Partial" : "Full"}${r.mixed ? " · mixed" : ""}` : r.mixed ? "mixed" : ""}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8} className="empty-row">Nothing matches.</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > limit && <button className="btn" onClick={() => setLimit(l => l + PAGE * 2)}>Show {Math.min(PAGE * 2, rows.length - limit)} more</button>}
        </div>
      ) : <RacksView where={where} onOpen={setOpen} open={open} rows={rows} status={status} />}
      {open && <SlotDetail code={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

/** Rack sides with how full they are; pick one to see it drawn, with the current filter highlighted. */
function RacksView({ where, onOpen, open, rows, status }: { where: string; onOpen: (c: string) => void; open: string | null; rows: StockRow[]; status: Status }) {
  const { state } = useStore();
  const { me } = useSession();
  const [face, setFace] = useState(() => (FACES.some(f => f.id === where) ? where : FACES[0].id));
  useEffect(() => { if (FACES.some(f => f.id === where)) setFace(where); }, [where]);
  useEffect(() => { if (open && FACES.some(f => f.id === groupOf(open))) setFace(groupOf(open)); }, [open]);
  const viewStock = useMemo(() => {
    const out: Record<string, StockLine[]> = {};
    for (const [code, lines] of Object.entries(state.stock)) { const { shown, hidden } = visibleLines(me, lines); out[code] = hidden ? [...shown, { productId: HIDDEN_PRODUCT, cases: 0 }] : shown; }
    return out;
  }, [state.stock, me]);
  const fill = useMemo(() => FACES.map(f => {
    const slots = f.cols.flatMap(([c, s]) => s.map(([l, b]) => slotCode(f.id, c, l, b)));
    const used = slots.filter(c => state.stock[c]?.length).length;
    const floor = Object.keys(state.stock).filter(c => isFloor(c) && faceOf(c) === f.id && state.stock[c].length).length;
    return { f, used, total: slots.length, floor };
  }), [state.stock]);
  // Highlight what the current filter matches (not for "all"/"occupied", where everything would light up)
  const marks: Record<string, SlotMark> = {};
  if (status !== "all" && status !== "occupied") for (const r of rows) if (r.group === face && !marks[r.code]) marks[r.code] = { kind: status === "empty" ? "suggested" : r.tone === "expired" ? "tone-expired" : r.tone === "warn" ? "tone-warn" : "selected", label: status === "empty" ? "" : String(r.line?.cases ?? "") , partial: r.partial };
  if (open && marks[open]) marks[open] = { ...marks[open], kind: "pulse" };
  else if (open) marks[open] = { kind: "pulse", label: String((viewStock[open] ?? []).reduce((a, l) => a + l.cases, 0) || "") };
  const hits = new Map<string, number>();
  if (status !== "all" && status !== "occupied") for (const r of rows) hits.set(r.group, (hits.get(r.group) ?? 0) + 1);
  const floorSpots = Object.keys(state.stock).filter(c => isFloor(c) && faceOf(c) === face && state.stock[c].length).sort(byLocation);

  return (
    <div className="racks-view">
      <ol className="fill-list glass" aria-label="Rack sides">
        {fill.map(({ f, used, total, floor }) => (
          <li key={f.id}><button className={`fill-row${f.id === face ? " on" : ""}`} onClick={() => setFace(f.id)}>
            <b>{f.id}</b><span className="fill-bar"><i style={{ width: `${(used / total) * 100}%` }} className={used / total > 0.9 ? "hi" : ""} /></span>
            <small>{hits.has(f.id) ? <em className="fill-hit">{hits.get(f.id)}</em> : null}{used}/{total}{floor ? ` +${floor}` : ""}</small>
          </button></li>
        ))}
      </ol>
      <div className="panel glass">
        <RackView faceId={face} onFace={setFace} stock={viewStock} marks={marks} onCell={onOpen} />
        {floorSpots.length > 0 && <div className="offrack"><span className="muted small">On the floor of {face}:</span>{floorSpots.map(c => <button key={c} className={`chip-btn${c === open ? " on" : ""}`} onClick={() => onOpen(c)}>{c}</button>)}</div>}
        <p className="muted small">Click a slot for its details; with details open, the arrow keys step to the next slot.</p>
      </div>
    </div>
  );
}
