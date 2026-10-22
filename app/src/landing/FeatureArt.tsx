// Small looping animations for the landing page, one per feature, drawn with plain shapes in the WMS's own colour
// tokens (styles/global.css, "lp-art"). Decorative: hidden from screen readers; still when less motion is asked for.

export type ArtKind = "map" | "putaway" | "fifo" | "count" | "labels" | "chat" | "brands";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
// A fixed, even-looking pattern of full slots (no randomness, so it's the same on every load)
const full = (i: number) => (i * 7 + (i >> 2) * 3) % 5 < 3;

export function FeatureArt({ kind }: { kind: ArtKind }) {
  return <div className={`lp-art lp-art-${kind}`} aria-hidden="true">{ART[kind]()}</div>;
}

const ART: Record<ArtKind, () => React.ReactNode> = {
  // The whole warehouse: rows of slots, a few pallets lighting up as they're put away and picked
  map: () => (
    <div className="lp-grid" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
      {range(24 * 5).map(i => {
        const hot = [27, 52, 75, 90, 101, 113].indexOf(i);
        return <i key={i} className={`${full(i) ? "on" : ""}${hot >= 0 ? " hot" : ""}`} style={hot >= 0 ? { animationDelay: `${hot * 0.8}s` } : undefined} />;
      })}
    </div>
  ),
  // A pallet travels from the dock to the empty slot it was given
  putaway: () => (
    <>
      <div className="lp-grid lp-rack" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {range(18).map(i => <i key={i} className={i === 9 ? "target" : full(i + 3) ? "on" : ""} />)}
      </div>
      <span className="lp-dock">Dock</span>
      <i className="lp-pallet" />
    </>
  ),
  // Four pallets of one product: the oldest is picked first
  fifo: () => (
    <div className="lp-fifo">
      {["Jan", "Apr", "Jul", "Oct"].map((m, i) => <div key={m} className={i === 0 ? "oldest" : ""}><i /><span>{m}</span></div>)}
    </div>
  ),
  // Slots ticked off one after another
  count: () => (
    <div className="lp-grid lp-counted" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
      {range(24).map(i => <i key={i} style={{ animationDelay: `${(i % 8) * 0.09 + Math.floor(i / 8) * 0.55}s` }} />)}
    </div>
  ),
  // Case labels coming off the printer
  labels: () => (
    <div className="lp-labels">
      <div className="lp-printer" />
      {range(3).map(i => <div key={i} className="lp-label" style={{ animationDelay: `${i * 0.6}s` }}><i /><b /><b /></div>)}
    </div>
  ),
  // A slot typed in a message lights up on the map
  chat: () => (
    <div className="lp-chat">
      <div className="lp-bubble">Pallet on <span className="lp-chip">06B-08-L3-B1</span> is leaning</div>
      <div className="lp-grid lp-mini" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {range(15).map(i => <i key={i} className={i === 7 ? "hot" : full(i) ? "on" : ""} />)}
      </div>
    </div>
  ),
  // Three brands' stock; a person who handles one brand sees the others as hidden
  brands: () => (
    <div className="lp-brands">
      {["b1", "b2", "b3"].map((b, r) => (
        <div key={b} className={`row ${b}`}>{range(7).map(i => <i key={i} className={full(i + r * 2) ? "on" : ""} />)}</div>
      ))}
    </div>
  ),
};
