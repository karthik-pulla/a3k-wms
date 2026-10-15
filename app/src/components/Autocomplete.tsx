import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props<T> {
  id?: string;
  /** Text shown in the box */
  value: string;
  onInput: (text: string) => void;
  onPick: (item: T) => void;
  search: (text: string) => T[];
  /** The full text that would be completed for this item (shown as grey ghost text while typing) */
  complete: (item: T) => string;
  render: (item: T) => ReactNode;
  itemKey: (item: T) => string;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Enter in an empty box (e.g. "add the last one again") */
  onEnterEmpty?: () => void;
}

/**
 * A text box that predicts what you're typing, like a search engine: the rest of the best match appears in
 * grey (Tab or → accepts it) and a list of matches opens below (↑ ↓ to choose, Enter to pick).
 */
export function Autocomplete<T>(p: Props<T>) {
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => (p.value.trim() ? p.search(p.value) : []), [p.value, p.search]);
  const top = items[0];
  // Grey prediction: the rest of the best match when it starts with what's typed, otherwise "→ best match"
  const full = top ? p.complete(top) : "";
  const prefix = !!p.value && full.toLowerCase().startsWith(p.value.toLowerCase());
  const ghost = !p.value || !full ? "" : prefix ? full.slice(p.value.length) : `  →  ${full}`;

  const pick = (item: T) => { p.onPick(item); setOpen(false); setHl(0); };
  // The list floats above everything (rendered at the page root) so tables that scroll sideways can't clip it
  const [pos, setPos] = useState<CSSProperties>({});
  const showList = open && items.length > 0;
  useLayoutEffect(() => {
    if (!showList) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom > 260 || r.top < 260;
      setPos({ position: "fixed", left: Math.max(8, Math.min(r.left, window.innerWidth - 440)), width: Math.max(r.width, 420),
        ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [showList]);
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const atEnd = e.currentTarget.selectionStart === p.value.length;
    if (e.key === "Enter" && !p.value.trim() && p.onEnterEmpty) { e.preventDefault(); p.onEnterEmpty(); return; }
    if (e.key === "Tab" && !e.shiftKey && items.length && (open || ghost)) { e.preventDefault(); pick(open ? items[Math.min(hl, items.length - 1)] : top); return; }
    if (e.key === "ArrowRight" && atEnd && ghost) { e.preventDefault(); pick(top); return; }
    if (!open || !items.length) { if (e.key === "ArrowDown" && items.length) { setOpen(true); e.preventDefault(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHl(h => (h + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl(h => (h - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(items[Math.min(hl, items.length - 1)]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className="ac">
      <div className="ac-box">
        <span className="ac-ghost" aria-hidden="true"><span className="ac-typed">{p.value}</span>{ghost}</span>
        <input
          ref={inputRef}
          id={p.id}
          className={`input ac-input${p.invalid ? " invalid" : ""}`}
          value={p.value}
          placeholder={p.placeholder}
          aria-label={p.ariaLabel}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="both"
          autoComplete="off"
          spellCheck={false}
          autoFocus={p.autoFocus}
          onChange={e => { p.onInput(e.target.value); setOpen(true); setHl(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
      </div>
      {showList && createPortal(
        <ul className="ac-list glass" id={listId} role="listbox" style={pos}>
          {items.map((it, i) => (
            <li key={p.itemKey(it)} role="option" aria-selected={i === hl} className={i === hl ? "hl" : undefined}
              onMouseDown={e => { e.preventDefault(); pick(it); }} onMouseEnter={() => setHl(i)}>
              {p.render(it)}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
