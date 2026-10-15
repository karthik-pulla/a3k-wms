import { useEffect, useRef, useState } from "react";
import { TICKER_LINES } from "../data/sampleUpdates";

const SHOWN = 8;
const EVERY_MS = 3400;

/** The fun corner: a quiet feed of stock movements with the odd silly fact. Pauses on hover and in a hidden tab. */
export function Ticker() {
  const [start, setStart] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (paused || reduced.current) return;
    const id = window.setInterval(() => { if (!document.hidden) setStart(s => (s + 1) % TICKER_LINES.length); }, EVERY_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const lines = Array.from({ length: SHOWN }, (_, i) => ({ ...TICKER_LINES[(start + i) % TICKER_LINES.length], key: start + i }));
  return (
    <aside className="ticker" aria-label="Recent activity (sample)" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol translate="no">
        {lines.map((l, i) => (
          <li key={l.key} className={i === SHOWN - 1 ? "new" : undefined}>
            <span className={l.sign === "+" ? "plus" : l.sign === "−" ? "minus" : "fact"}>{l.text}</span>
            {i === SHOWN - 1 && <span className="cursor" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </aside>
  );
}
