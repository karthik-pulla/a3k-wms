import { useEffect, useMemo, useRef, useState } from "react";
import { tickerLines } from "../home/updates";
import { useStore } from "../store/store";
import { useSession } from "../session";

const SHOWN = 8;
const EVERY_MS = 3400;

/** The fun corner: a quiet feed of the latest stock movements and orders, with the odd fact. Pauses on hover and in a hidden tab. */
export function Ticker() {
  const { state } = useStore();
  const { me } = useSession();
  const all = useMemo(() => tickerLines(state, me), [state, me]);
  const [start, setStart] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // Oldest of the shown lines at the top, newest last; it scrolls only when there's more than fits
  const ordered = useMemo(() => [...all].reverse(), [all]);
  const scrolls = ordered.length > SHOWN;

  useEffect(() => {
    if (paused || reduced.current || !scrolls) return;
    const id = window.setInterval(() => { if (!document.hidden) setStart(s => s + 1); }, EVERY_MS);
    return () => window.clearInterval(id);
  }, [paused, scrolls]);

  const shown = Math.min(SHOWN, ordered.length);
  const from = scrolls ? start : 0;
  const lines = Array.from({ length: shown }, (_, i) => ({ ...ordered[(from + i) % ordered.length], key: from + i }));
  return (
    <aside className="ticker" aria-label="Recent activity" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol translate="no">
        {lines.map((l, i) => (
          <li key={l.key} className={i === shown - 1 ? "new" : undefined}>
            <span className={l.sign === "+" ? "plus" : l.sign === "−" ? "minus" : "fact"}>{l.text}</span>
            {i === shown - 1 && <span className="cursor" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </aside>
  );
}
