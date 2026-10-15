import { memo } from "react";
import { AREAS, FACES, type Face } from "../../data/catalog";
import type { StockLine } from "../../store/types";
import type { ExpiryTone } from "../../chat/selectors";
import { groupOf } from "../../inventory/selectors";

export interface MapMark { tone: ExpiryTone; partial?: boolean }

/**
 * Every rack side at once, one small square per slot (level 4 on top). Highlighted squares are tinted by expiry;
 * the number on each side is how many highlighted locations it has, floor spots included. Click a side to open it.
 */
export function WarehouseMap({ stock, marks, current, onFace, onlyHits = false }: {
  stock: Record<string, StockLine[]>;
  marks: Map<string, MapMark>;
  current?: string;
  onFace: (id: string) => void;
  /** Show only the rack sides and areas with highlighted locations */
  onlyHits?: boolean;
}) {
  const perGroup = new Map<string, number>();
  const floorMarks = new Map<string, number>();
  for (const code of marks.keys()) {
    const g = groupOf(code);
    perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    if (!/-L\d-B\d$/.test(code)) floorMarks.set(g, (floorMarks.get(g) ?? 0) + 1);
  }
  const anyMarks = marks.size > 0;
  return (
    <div className={`wmap${anyMarks ? " marking" : ""}`}>
      <div className="wfaces">
        {FACES.filter(f => !onlyHits || perGroup.has(f.id)).map(f => (
          <FaceTile key={f.id} face={f} stock={stock} marks={marks} n={perGroup.get(f.id) ?? 0} floor={floorMarks.get(f.id) ?? 0} on={f.id === current} onFace={onFace} />
        ))}
      </div>
      <div className="wareas">
        {AREAS.filter(a => !onlyHits || perGroup.has(a.id)).map(a => {
          const n = perGroup.get(a.id) ?? 0;
          const used = Object.keys(stock).filter(c => c.startsWith(`${a.id}-P`) && stock[c].length).length;
          return (
            <button key={a.id} className={`warea${n ? " hit" : ""}${a.id === current ? " on" : ""}`} onClick={() => onFace(a.id)} title={`${a.name}: ${used} pallets`}>
              {a.name}<small>{n ? `${n} match${n > 1 ? "es" : ""}` : `${used} pl`}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FaceTile = memo(function FaceTile({ face, stock, marks, n, floor, on, onFace }: {
  face: Face; stock: Record<string, StockLine[]>; marks: Map<string, MapMark>; n: number; floor: number; on: boolean; onFace: (id: string) => void;
}) {
  const bays = (c: Face["cols"][number]) => Math.max(...c[1].map(s => s[1]));
  let x = 1;
  const starts = face.cols.map(c => { const s = x; x += bays(c) + 1; return s; });
  const width = x - 2;
  let used = 0, total = 0;
  const cells = face.cols.flatMap((c, ci) => c[1].map(([lv, bay]) => {
    const code = `${face.id}-${String(c[0]).padStart(2, "0")}-L${lv}-B${bay}`;
    const full = !!stock[code]?.length;
    total++; if (full) used++;
    const m = marks.get(code);
    return <i key={code} className={`wc${full ? " full" : ""}${m ? ` hit ${m.tone}` : ""}${m?.partial ? " partial" : ""}`} style={{ gridColumn: starts[ci] + bay - 1, gridRow: 5 - lv }} />;
  }));
  return (
    <button className={`wface${n ? " hit" : ""}${on ? " on" : ""}`} onClick={() => onFace(face.id)} aria-label={`${face.id}: ${used} of ${total} slots used${n ? `, ${n} matches` : ""}`}>
      <span className="wface-h"><b>{face.id}</b>{n > 0 ? <em>{n}</em> : <small>{Math.round((used / total) * 100)}%</small>}</span>
      <span className="wgrid" style={{ gridTemplateColumns: `repeat(${width}, var(--wc))` }}>{cells}</span>
      {floor > 0 && <span className="wfloor">+{floor} on floor</span>}
    </button>
  );
});
