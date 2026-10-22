// Small looping animations for the landing page, one per feature, drawn with plain shapes in the WMS's own colour
// tokens (styles/global.css, "lp-art"). They run only while their panel is hovered (or, on phones, in the middle of
// the screen) and stay still when less motion is asked for. Decorative, apart from the picking rule switch.
import { useState } from "react";

export type ArtKind = "map" | "putaway" | "picking" | "count" | "labels" | "chat" | "brands";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
// A fixed, even-looking pattern of full slots (no randomness, so it's the same on every load)
const full = (i: number) => (i * 7 + (i >> 2) * 3) % 5 < 3;

export function FeatureArt({ kind }: { kind: ArtKind }) {
  const Art = ART[kind];
  return <div className={`lp-art lp-art-${kind}`}><Art /></div>;
}

const ART: Record<ArtKind, () => React.ReactNode> = {
  // The whole warehouse: rows of slots, a few pallets lighting up as they're put away and picked
  map: () => (
    <div className="lp-grid" style={{ gridTemplateColumns: "repeat(24, 1fr)" }} aria-hidden="true">
      {range(24 * 5).map(i => {
        const hot = [27, 52, 75, 90, 101, 113].indexOf(i);
        return <i key={i} className={`${full(i) ? "on" : ""}${hot >= 0 ? " hot" : ""}`} style={hot >= 0 ? { animationDelay: `${hot * 0.8}s` } : undefined} />;
      })}
    </div>
  ),
  // A pallet travels from the dock to the empty slot it was given
  putaway: () => (
    <div aria-hidden="true">
      <div className="lp-grid lp-rack">{range(18).map(i => <i key={i} className={i === 9 ? "target" : full(i + 3) ? "on" : ""} />)}</div>
      <span className="lp-dock">Dock</span>
      <i className="lp-pallet" />
    </div>
  ),
  picking: () => <Picking />,
  // Slots ticked off one after another, as several people count
  count: () => (
    <div className="lp-grid lp-counted" aria-hidden="true">
      {range(30).map(i => <i key={i} style={{ animationDelay: `${(i % 10) * 0.08 + Math.floor(i / 10) * 0.5}s` }} />)}
    </div>
  ),
  // Case labels coming off the printer (one is shown still until the panel is hovered)
  labels: () => (
    <div className="lp-labels" aria-hidden="true">
      <div className="lp-printer" />
      {range(3).map(i => <div key={i} className="lp-label" style={{ animationDelay: `${-0.6 - i * 0.6}s` }}><i /><b /><b /><b /></div>)}
    </div>
  ),
  // A slot typed in a message lights up on the map
  chat: () => (
    <div className="lp-chat" aria-hidden="true">
      <div className="lp-bubble"><span className="lp-who">Omar</span>Pallet on <span className="lp-chip">03A-07-2-1</span> is leaning</div>
      <div className="lp-grid lp-mini">{range(20).map(i => <i key={i} className={i === 7 ? "hot" : full(i) ? "on" : ""} />)}</div>
    </div>
  ),
  // Three brands' stock; a person who handles one brand sees the others as hidden
  brands: () => (
    <div className="lp-brands" aria-hidden="true">
      {["b1", "b2", "b3"].map((b, r) => <div key={b} className={`row ${b}`}>{range(9).map(i => <i key={i} className={full(i + r * 2) ? "on" : ""} />)}</div>)}
    </div>
  ),
};

/** Four pallets of one product, and the warehouse's picking rule: the pallet it plans to pick from first */
function Picking() {
  const [rule, setRule] = useState<"oldest" | "open">("oldest");
  const pallets = [
    { month: "Jan", fill: 1 }, { month: "Mar", fill: 0.4 }, { month: "Jun", fill: 1 }, { month: "Sep", fill: 0.55 },
  ];
  const first = rule === "oldest" ? 0 : 1;
  return (
    <div className="lp-picking">
      <div className="lp-rule" role="group" aria-label="Picking rule">
        <button type="button" aria-pressed={rule === "oldest"} onClick={() => setRule("oldest")}>Oldest first</button>
        <button type="button" aria-pressed={rule === "open"} onClick={() => setRule("open")}>Open pallets first</button>
      </div>
      <div className="lp-pick-row" aria-hidden="true">
        {pallets.map((p, i) => (
          <div key={p.month} className={i === first ? "first" : ""}>
            <i><b style={{ height: `${p.fill * 100}%` }} /></i>
            <span>{p.month}<small>{p.fill < 1 ? "open" : "full"}</small></span>
          </div>
        ))}
      </div>
    </div>
  );
}
