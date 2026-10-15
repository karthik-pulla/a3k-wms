import { useLayoutEffect, useRef, useState } from "react";

interface Tab { id: string; label: string; badge?: number }

/**
 * The frosted tab bar at the bottom of a mode (Dashboard, Incoming, Pending, Returns), with a glass lens
 * that springs between tabs, stretches while it moves, and can be dragged across the bar like a slider.
 */
export function SubTabs({ base, tabs, current }: { base: string; tabs: Tab[]; current: string }) {
  const barRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [lens, setLens] = useState({ x: 0, w: 0, ready: false });
  const [moving, setMoving] = useState(false);
  const [drag, setDrag] = useState<{ startX: number; startLens: number; moved: boolean } | null>(null);
  const [pressed, setPressed] = useState(false);
  const activeIndex = Math.max(0, tabs.findIndex(t => t.id === current));

  // Put the lens over the current tab (and again when the window resizes)
  useLayoutEffect(() => {
    const place = () => {
      const a = linkRefs.current[activeIndex];
      if (a) setLens({ x: a.offsetLeft, w: a.offsetWidth, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [activeIndex, tabs.length]);

  // Squash-and-stretch each time the lens travels to another tab
  const prevIndex = useRef(activeIndex);
  useLayoutEffect(() => {
    if (prevIndex.current === activeIndex) return;
    prevIndex.current = activeIndex;
    setMoving(true);
    const t = window.setTimeout(() => setMoving(false), 520);
    return () => window.clearTimeout(t);
  }, [activeIndex]);

  const nearest = (centerX: number) => {
    let best = 0, dist = Infinity;
    linkRefs.current.forEach((a, i) => {
      if (!a) return;
      const d = Math.abs(a.offsetLeft + a.offsetWidth / 2 - centerX);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setPressed(true);
    setDrag({ startX: e.clientX, startLens: lens.x, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !barRef.current) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) { barRef.current.setPointerCapture(e.pointerId); setDrag({ ...drag, moved: true }); }
    const max = barRef.current.clientWidth - lens.w - 5;
    setLens(l => ({ ...l, x: Math.min(max, Math.max(5, drag.startLens + dx)) }));
    // The lens takes the width of the tab under it as it slides
    const under = linkRefs.current[nearest(drag.startLens + dx + lens.w / 2)];
    if (under && Math.abs(under.offsetWidth - lens.w) > 1) setLens(l => ({ ...l, w: under.offsetWidth }));
  };
  const endDrag = (e: React.PointerEvent) => {
    setPressed(false);
    if (!drag) return;
    if (drag.moved) {
      const i = nearest(lens.x + lens.w / 2);
      const a = linkRefs.current[i];
      if (a) setLens(l => ({ ...l, x: a.offsetLeft, w: a.offsetWidth }));
      if (i !== activeIndex) window.location.hash = `#/${base}${tabs[i].id ? `/${tabs[i].id}` : ""}`;
      barRef.current?.releasePointerCapture?.(e.pointerId);
    }
    setDrag(null);
  };

  return (
    <nav ref={barRef} className={`subtabs glass${drag?.moved ? " dragging" : ""}`} aria-label="Sections"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onClickCapture={e => { if (drag?.moved) { e.preventDefault(); e.stopPropagation(); } }}>
      <span aria-hidden="true" className={`lens${moving ? " moving" : ""}${pressed ? " pressed" : ""}${lens.ready ? "" : " hidden"}`}
        style={{ translate: `${lens.x}px 0`, width: lens.w }} />
      {tabs.map((t, i) => (
        <a key={t.id} ref={el => { linkRefs.current[i] = el; }} href={`#/${base}${t.id ? `/${t.id}` : ""}`}
          aria-current={current === t.id ? "page" : undefined} draggable={false}>
          {t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </a>
      ))}
    </nav>
  );
}
