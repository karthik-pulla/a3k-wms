// The home page's little warehouse to play with: hover or tap a slot to see what's on it, tap a brand to light up its
// pallets (as Inventory → Products does in the WMS). Made-up brands and stock, the same on every load.
import { useMemo, useState } from "react";

const BRANDS = [
  { id: "b1", name: "Sunfield", products: ["Basmati Rice 10 lb", "Sona Masoori 20 lb"] },
  { id: "b2", name: "Blue Lotus", products: ["Toor Dal 4 lb", "Chana Dal 2 lb"] },
  { id: "b3", name: "Ridge", products: ["Mango Pickle", "Lime Pickle"] },
  { id: "b4", name: "Crunchy Bay", products: ["Spicy Mix", "Banana Chips"] },
] as const;
const SIDES = ["01A", "01B", "02A", "02B", "03A", "03B"];
const COLS = 20;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Slot { i: number; code: string; brand?: (typeof BRANDS)[number]; product?: string; cases?: number; bb?: string; partial?: boolean }

function slots(): Slot[] {
  return Array.from({ length: SIDES.length * COLS }, (_, i) => {
    const side = SIDES[Math.floor(i / COLS)], col = (i % COLS) + 1;
    const code = `${side}-${String(col).padStart(2, "0")}-1-1`;
    const h = (i * 2654435761) >>> 0;
    if (h % 7 < 2) return { i, code };
    // Brands cluster along a rack, as put-away keeps them together
    const brand = BRANDS[(Math.floor(col / 6) + Math.floor(i / COLS)) % BRANDS.length];
    const cases = 20 + (h % 41), partial = h % 5 === 0;
    return { i, code, brand, product: brand.products[h % 2], cases: partial ? Math.round(cases / 3) : cases, bb: `${MONTHS[h % 12]} ${2027 + (h % 2)}`, partial };
  });
}

export function PlayMap() {
  const all = useMemo(slots, []);
  // Starts on a full slot; picking a brand selects its first pallet
  const [picked, setPicked] = useState<number>(() => all.find(x => x.i >= 27 && x.brand)?.i ?? 0);
  const [brand, setBrand] = useState<string | null>(null);
  const s = all[picked];
  return (
    <div className="lp-play">
      <div className="lp-play-chips" role="group" aria-label="Show a brand's pallets">
        {BRANDS.map(b => (
          <button key={b.id} type="button" className={`lp-chip-btn ${b.id}${brand === b.id ? " on" : ""}`} aria-pressed={brand === b.id} onClick={() => { const on = brand !== b.id; setBrand(on ? b.id : null); if (on) setPicked(all.find(x => x.brand?.id === b.id)?.i ?? picked); }}>
            <i aria-hidden="true" />{b.name}
          </button>
        ))}
      </div>
      <div className={`lp-play-map${brand ? " filtered" : ""}`} style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {all.map(x => (
          <button key={x.i} type="button" aria-label={x.brand ? `${x.code}: ${x.product}` : `${x.code}: empty`}
            className={`${x.brand ? `full ${x.brand.id}` : "empty"}${x.partial ? " partial" : ""}${x.i === picked ? " picked" : ""}${brand && x.brand?.id === brand ? " match" : ""}`}
            tabIndex={-1} onMouseEnter={() => setPicked(x.i)} onClick={() => setPicked(x.i)} />
        ))}
      </div>
      <div className="lp-play-card" aria-live="polite">
        <span className="lp-play-code">{s.code}</span>
        {s.brand ? <>
          <b>{s.product}</b>
          <span>{s.brand.name} · {s.cases} cases{s.partial ? " · partial pallet" : ""}</span>
          <span className="muted">Best before {s.bb}</span>
        </> : <span className="muted">Empty: the next put-away might land here.</span>}
      </div>
    </div>
  );
}
