import { FACES, productById, rackName } from "../data/catalog";
import type { StockLine } from "../store/types";

export interface SlotMark {
  kind: "suggested" | "focus" | "pulse" | "selected" | "tone-ok" | "tone-warn" | "tone-expired";
  label: string;
  /** Partial pallet: drawn with a half fill */
  partial?: boolean;
}
/** Stock lines replaced by this id are another client's stock the viewer may not see */
export const HIDDEN_PRODUCT = "__hidden__";

/**
 * One rack side drawn like the count page: steel uprights between columns, orange beams under each level,
 * level 4 at the top. Filled slots show the item code and cases; empty slots can be picked.
 */
export function RackView({ faceId, onFace, stock, marks, onPick, onCell }: {
  faceId: string;
  onFace: (id: string) => void;
  stock: Record<string, StockLine[]>;
  marks: Record<string, SlotMark>;
  /** Called with an empty slot's code when it's clicked */
  onPick?: (code: string) => void;
  /** Called for any slot, empty or filled (map selection) */
  onCell?: (code: string, empty: boolean) => void;
}) {
  const i = Math.max(0, FACES.findIndex(f => f.id === faceId));
  const face = FACES[i];
  const maxBays = (col: [number, [number, number][]]) => Math.max(...col[1].map(s => s[1]));
  const tracks = ["32px", ...face.cols.flatMap(c => ["5px", ...Array(maxBays(c)).fill("var(--cell-w)")]), "5px"];
  let t = 2; // grid track counter (1 = level labels)
  const colStart = face.cols.map(c => { const start = t + 1; t += 1 + maxBays(c); return start; });
  const empty = face.cols.reduce((a, c) => a + c[1].filter(([l, b]) => !stock[`${face.id}-${String(c[0]).padStart(2, "0")}-L${l}-B${b}`]?.length).length, 0);
  const total = face.cols.reduce((a, c) => a + c[1].length, 0);

  return (
    <div className="rackview">
      <div className="rack-head">
        <button className="mini" onClick={() => onFace(FACES[(i - 1 + FACES.length) % FACES.length].id)} aria-label="Previous rack side">‹</button>
        <select className="input rack-select" value={face.id} onChange={e => onFace(e.target.value)} aria-label="Rack side">
          {FACES.map(f => <option key={f.id} value={f.id}>{rackName(f.rack)} · side {f.side} ({f.id})</option>)}
        </select>
        <button className="mini" onClick={() => onFace(FACES[(i + 1) % FACES.length].id)} aria-label="Next rack side">›</button>
        <span className="rack-count">{empty} of {total} slots empty</span>
      </div>
      <div className="rack-scroll">
        <div className="rack-grid" style={{ gridTemplateColumns: tracks.join(" ") }}>
          {face.cols.map((c, ci) => (
            <div key={`h${c[0]}`} className="rack-colnum" style={{ gridRow: 1, gridColumn: `${colStart[ci]} / span ${maxBays(c)}` }}>{String(c[0]).padStart(2, "0")}</div>
          ))}
          {face.cols.map((c, ci) => <div key={`u${c[0]}`} className="rack-upright" style={{ gridRow: "2 / 6", gridColumn: colStart[ci] - 1 }} />)}
          <div className="rack-upright" style={{ gridRow: "2 / 6", gridColumn: tracks.length }} />
          {[4, 3, 2, 1].map((lv, r) => <div key={`l${lv}`} className="rack-level" style={{ gridRow: r + 2, gridColumn: 1 }}>L{lv}</div>)}
          {face.cols.flatMap((c, ci) => [4, 3, 2, 1].flatMap((lv, r) => {
            const here = c[1].filter(s => s[0] === lv);
            if (!here.length) return [<div key={`v${c[0]}-${lv}`} className="rack-void" style={{ gridRow: r + 2, gridColumn: `${colStart[ci]} / span ${maxBays(c)}` }} />];
            return here.map(([, bay]) => {
              const code = `${face.id}-${String(c[0]).padStart(2, "0")}-L${lv}-B${bay}`;
              const lines = stock[code] ?? [];
              const mark = marks[code];
              const p = lines[0] ? productById(lines[0].productId) : undefined;
              const cases = lines.reduce((a, l) => a + l.cases, 0);
              const hidden = lines.length > 0 && lines.every(l => l.productId === HIDDEN_PRODUCT);
              const cls = ["rack-cell", lines.length ? "full" : "empty", hidden ? "hidden-stock" : "", mark ? mark.kind : "", mark?.partial ? "partial" : ""].join(" ");
              const title = hidden ? `${code}: another client's stock` : lines.length ? `${code}: ${lines.map(l => `${productById(l.productId)?.name ?? "hidden"} × ${l.cases}`).join(", ")}` : `${code}: empty`;
              return (
                <button key={code} className={cls} style={{ gridRow: r + 2, gridColumn: colStart[ci] + bay - 1 }} title={title}
                  disabled={onCell ? false : !!lines.length || !onPick} onClick={() => (onCell ? onCell(code, !lines.length) : onPick?.(code))} aria-label={mark ? `${title} · ${mark.label}` : title}>
                  {mark ? <span className="rc-mark">{mark.label}</span> : hidden ? <span className="rc-q">hidden</span> : lines.length ? (
                    <><span className="rc-code">{p?.code}{lines.length > 1 ? "+" : ""}</span><span className="rc-q">{cases}</span></>
                  ) : null}
                </button>
              );
            });
          }))}
        </div>
      </div>
    </div>
  );
}
