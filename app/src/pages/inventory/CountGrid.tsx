import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AREAS, FACES, describeLocation, productById, searchProducts, slotMeta, type Face, type Product } from "../../data/catalog";
import { can, canSeeClient } from "../../auth/permissions";
import { normalizeLocation } from "../../chat/refs";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { BackIcon, KeyboardIcon } from "../../components/icons";
import { buildRows, linesMatch, navIndex, nextCode, rangeBetween, scopeTotal, floorSpots, floorCode, type Dir } from "../../inventory/count";
import type { CountEntry, CountSession, StockLine } from "../../store/types";

type Lines = { productId: string; cases: number }[];
type After = "down" | "right" | "stay";
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl";
const ALT = MAC ? "⌥" : "Alt";
const AFTER_KEY = "wms.count.after";

/**
 * Keyboard count entry, like the Warehouse Count page: arrows move between slots (and down into the floor row),
 * typing starts a product search, Enter saves and moves on. Shortcuts: = repeat, - empty, Alt+A fill column,
 * Cmd/Ctrl+C X V copy, cut, paste (also from Excel), Del clear, Cmd/Ctrl+Z undo, Page Up/Down rack side, ? help.
 */
export function CountGrid({ session }: { session: CountSession }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const showExpected = !session.blind;
  const readOnly = session.status !== "open";

  const rows = useMemo(() => buildRows(session.scope, state.stock, session.entries), [session.scope, state.stock, session.entries]);
  const idx = useMemo(() => navIndex(rows), [rows]);
  const [sel, setSel] = useState(() => rows[0]?.cells[0]?.code ?? "");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [mode, setModeState] = useState<"grid" | "product" | "qty">("grid");
  // Focus handlers run synchronously inside beginEdit/choose, before React re-renders, so they read the mode from here
  const modeRef = useRef<"grid" | "product" | "qty">("grid");
  const setMode = (m: "grid" | "product" | "qty") => { modeRef.current = m; setModeState(m); };
  const [draft, setDraft] = useState<{ code: string; lines: Lines; item: string | null } | null>(null);
  const [prod, setProd] = useState("");
  const [qty, setQty] = useState("");
  const [hl, setHl] = useState(0);
  const [help, setHelp] = useState(false);
  const [after, setAfter] = useState<After>(() => { try { return (localStorage.getItem(AFTER_KEY) as After) || "right"; } catch { return "right"; } });
  useEffect(() => { try { localStorage.setItem(AFTER_KEY, after); } catch { /* per visit */ } }, [after]);
  const lastLines = useRef<Lines | null>(null);
  const undo = useRef<{ code: string; before: CountEntry | null }[][]>([]);
  const clip = useRef<{ items: { dr: number; dx: number; val: CountEntry | null }[]; text: string } | null>(null);
  const recent = useRef<string[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const prodRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const range = useMemo(() => (anchor && anchor !== sel ? new Set(rangeBetween(rows, idx, anchor, sel)) : new Set<string>()), [anchor, sel, rows, idx]);
  const order = (codes: string[]) => [...codes].sort((a, b) => idx.rowOf.get(a)! - idx.rowOf.get(b)! || idx.xOf.get(a)! - idx.xOf.get(b)!);
  const selection = useCallback(() => (range.size ? order([...range]) : [sel]), [range, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Product search (only clients this person may see) -----
  const matches: Product[] = useMemo(() => {
    if (mode !== "product") return [];
    if (!prod.trim()) return recent.current.map(id => productById(id)).filter((p): p is Product => !!p);
    return searchProducts(prod, undefined, 60).filter(p => canSeeClient(me, p.client)).slice(0, 40);
  }, [prod, mode, me]);
  useEffect(() => setHl(0), [prod]);

  // ----- Changes (one call = one undo step) -----
  const apply = useCallback((changes: { code: string; entry: CountEntry | null }[], fromUndo = false) => {
    if (!changes.length || readOnly) return;
    if (!fromUndo) { undo.current.push(changes.map(c => ({ code: c.code, before: session.entries[c.code] ?? null }))); if (undo.current.length > 200) undo.current.shift(); }
    dispatch({ type: "count/set", id: session.id, changes });
  }, [dispatch, session.id, session.entries, readOnly]);
  const entry = (lines: Lines, empty = false): CountEntry => ({ lines: lines.map(l => ({ ...l })), ...(empty ? { empty: true } : {}), by: me.name, at: new Date().toISOString() });
  const checked = (code: string) => !!session.entries[code];

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });
  const select = (code: string, extend = false) => {
    if (extend) {
      const a = anchor ?? sel;
      if (rows[idx.rowOf.get(code)!]?.group !== rows[idx.rowOf.get(a)!]?.group) return; // a selection stays on one rack side
      setAnchor(a);
    } else setAnchor(null);
    setSel(code);
  };
  const move = (dir: Dir, extend = false) => { const n = nextCode(rows, idx, sel, dir); if (n) select(n, extend); };
  // Arrow keys keep the selected slot just in view; jumping to a rack side scrolls it to the top instead (showGroup)
  const skipScroll = useRef(false);
  useLayoutEffect(() => {
    if (skipScroll.current) { skipScroll.current = false; return; }
    gridRef.current?.querySelector(`[data-code="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);
  const entryRef = useRef<HTMLDivElement>(null);
  /** Smoothly scroll a rack side (or area) so its heading sits just below the sticky entry bar */
  const showGroup = (g: string) => {
    const sec = document.getElementById(`cf-${g}`);
    if (!sec) return;
    // Where the entry bar ends once it's stuck to the top (its sticky top is 8px), whether or not it's stuck yet
    const e = entryRef.current;
    const below = (e ? parseFloat(getComputedStyle(e).top) + e.offsetHeight : 0) + 14;
    const top = window.scrollY + sec.getBoundingClientRect().top - below;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  };
  const openGroup = (g: string) => {
    const first = rows.find(r => r.group === g)?.cells[0];
    if (!first) return;
    skipScroll.current = first.code !== sel;
    select(first.code);
    focusGrid();
    showGroup(g);
  };
  const jumpFace = (delta: 1 | -1) => {
    const r = idx.rowOf.get(sel); if (r === undefined) return;
    const g = rows[r].group;
    let k = r;
    if (delta > 0) { while (k < rows.length && rows[k].group === g) k++; }
    else { while (k >= 0 && rows[k].group === g) k--; if (k < 0) return; const pg = rows[k].group; while (k > 0 && rows[k - 1].group === pg) k--; }
    if (rows[k]) openGroup(rows[k].group);
  };

  // ----- Entry -----
  const beginEdit = (text: string, keep: boolean) => {
    if (readOnly) { toast("This count is closed for counting."); return; }
    const cur = session.entries[sel];
    setDraft({ code: sel, lines: keep && cur ? cur.lines.map(l => ({ ...l })) : [], item: null });
    setMode("product"); setProd(text); setQty("");
    // Focus now, not on the next frame: the next keys typed must already land in the product box
    prodRef.current?.focus();
    requestAnimationFrame(() => { const L = prodRef.current?.value.length ?? 0; prodRef.current?.setSelectionRange(L, L); });
  };
  const choose = (p: Product) => {
    if (!draft) return;
    setDraft({ ...draft, item: p.id }); setMode("qty");
    setProd(`${p.code} ${p.name}`); setQty(p.perPallet ? String(p.perPallet) : "");
    qtyRef.current?.focus();
    requestAnimationFrame(() => qtyRef.current?.select());
  };
  const takeLine = (): Lines | null => {
    if (!draft?.item) return null;
    if (!/^\d+$/.test(qty.trim())) { toast("Enter the number of cases (a whole number)."); qtyRef.current?.focus(); return null; }
    recent.current = [draft.item, ...recent.current.filter(x => x !== draft.item)].slice(0, 8);
    return [...draft.lines, { productId: draft.item, cases: Number(qty) }];
  };
  const cancel = () => { setDraft(null); setMode("grid"); setProd(""); setQty(""); focusGrid(); };
  const commit = (lines: Lines) => {
    const code = draft!.code;
    apply([{ code, entry: lines.length ? entry(lines) : null }]);
    if (lines.length) lastLines.current = lines.map(l => ({ ...l }));
    setDraft(null); setMode("grid"); setProd(""); setQty("");
    focusGrid();
    if (after !== "stay") { const n = nextCode(rows, idx, code, after); if (n) select(n); }
  };

  // ----- Shortcuts -----
  const fillColumn = () => {
    const m = slotMeta(sel);
    if (!m) { toast(`${ALT}+A works on rack slots, not floor spots.`); return; }
    const src = session.entries[sel];
    if (!src?.lines.length) { toast(`Enter a product in this slot first, then press ${ALT}+A.`); return; }
    const one = src.lines.length === 1, p = one ? productById(src.lines[0].productId) : undefined;
    const lines = one ? [{ productId: src.lines[0].productId, cases: p?.perPallet ?? src.lines[0].cases }] : src.lines;
    const f = FACES.find(x => x.id === m.face)!;
    const col = f.cols.find(c => c[0] === m.col)!;
    const targets = col[1].map(([l, b]) => `${m.face}-${String(m.col).padStart(2, "0")}-L${l}-B${b}`).filter(c => c !== sel && !checked(c));
    const name = `${m.face}-${String(m.col).padStart(2, "0")}`;
    if (!targets.length) { toast(`Every slot in column ${name} is already counted.`); return; }
    apply(targets.map(code => ({ code, entry: entry(lines) })));
    toast(`Filled ${targets.length} slot${targets.length > 1 ? "s" : ""} in column ${name} with ${one ? `${p?.code ?? "?"} × ${lines[0].cases}` : "this mixed pallet"}. Counted slots were left alone. ${MOD}+Z to undo.`);
  };
  const doUndo = () => {
    const u = undo.current.pop();
    if (!u) { toast("Nothing to undo."); return; }
    apply(u.map(x => ({ code: x.code, entry: x.before })), true);
    setAnchor(null); setSel(u[0].code);
    toast(u.length > 1 ? `Undid the change to ${u.length} slots.` : `Undid the change at ${u[0].code}.`);
  };
  const linesText = (e: CountEntry | undefined) => (e?.lines ?? []).map(l => `${productById(l.productId)?.code ?? ""}\t${l.cases}`).join("\n");
  const copy = (cut: boolean, data: DataTransfer | null) => {
    const codes = selection();
    const r0 = Math.min(...codes.map(c => idx.rowOf.get(c)!)), x0 = Math.min(...codes.map(c => idx.xOf.get(c)!));
    const text = codes.length === 1 ? linesText(session.entries[codes[0]])
      : codes.flatMap(c => { const e = session.entries[c]; return e?.lines.length ? e.lines.map(l => `${c}\t${productById(l.productId)?.code ?? ""}\t${l.cases}`) : [`${c}\t\t`]; }).join("\n");
    clip.current = { items: codes.map(c => ({ dr: idx.rowOf.get(c)! - r0, dx: idx.xOf.get(c)! - x0, val: session.entries[c] ?? null })), text };
    data?.setData("text/plain", text);
    if (cut) apply(codes.filter(checked).map(code => ({ code, entry: null })));
    toast(`${cut ? "Cut" : "Copied"} ${codes.length} slot${codes.length > 1 ? "s" : ""}. Select where it goes and press ${MOD}+V.`);
  };
  const paste = (text: string) => {
    const targets = selection();
    if (clip.current && text === clip.current.text) {
      const c = clip.current;
      if (c.items.length === 1) { apply(targets.map(code => ({ code, entry: c.items[0].val ? entry(c.items[0].val.lines, c.items[0].val.empty) : null }))); toast(`Pasted into ${targets.length} slot${targets.length > 1 ? "s" : ""}.`); return; }
      const r0 = Math.min(...targets.map(t => idx.rowOf.get(t)!)), x0 = Math.min(...targets.map(t => idx.xOf.get(t)!)), g = rows[r0].group;
      const ch: { code: string; entry: CountEntry | null }[] = []; let skipped = 0;
      for (const it of c.items) {
        const row = rows[r0 + it.dr];
        const cell = row && row.group === g ? row.cells.find(x => Math.abs(x.x - (x0 + it.dx)) < 0.05) : undefined;
        if (cell) ch.push({ code: cell.code, entry: it.val ? entry(it.val.lines, it.val.empty) : null }); else skipped++;
      }
      apply(ch); toast(`Pasted ${ch.length} slot${ch.length === 1 ? "" : "s"}${skipped ? `; ${skipped} didn't fit on this rack side` : ""}.`); return;
    }
    // From Excel or the old sheets: rows of [Location] Item-or-code Cases, tab separated
    const items: { loc: string | null; productId: string; cases: number; guessed: boolean }[] = [];
    for (const r of text.split("\n").filter(x => x.trim())) {
      let loc: string | null = null, p: Product | undefined, q: number | null = null;
      for (const v of r.split("\t").map(s => s.trim())) {
        if (!v) continue;
        if (!loc) { const L = normalizeLocation(v); if (L) { loc = L; continue; } }
        if (!p) { const hits = searchProducts(v, undefined, 2).filter(x => canSeeClient(me, x.client)); const exact = hits.find(x => x.code.toLowerCase() === v.toLowerCase() || x.item?.replace(/\s+/g, "").toLowerCase() === v.replace(/\s+/g, "").toLowerCase()); if (exact) { p = exact; continue; } }
        if (p && q === null && /^\d+(\.0+)?$/.test(v)) q = Math.round(Number(v));
      }
      if (p) items.push({ loc, productId: p.id, cases: q ?? p.perPallet ?? 0, guessed: q === null });
    }
    if (!items.length) { toast("Couldn't find a product code in what you pasted."); return; }
    const ch = new Map<string, Lines>();
    if (items.some(i => i.loc)) { for (const i of items) if (i.loc && idx.rowOf.has(i.loc)) ch.set(i.loc, [...(ch.get(i.loc) ?? []), { productId: i.productId, cases: i.cases }]); }
    else if (items.length === 1) { for (const code of targets) ch.set(code, [{ productId: items[0].productId, cases: items[0].cases }]); }
    else {
      let t = targets;
      if (t.length < items.length) { t = [sel]; const dir: Dir = after === "stay" ? "right" : after; while (t.length < items.length) { const n = nextCode(rows, idx, t[t.length - 1], dir); if (!n) break; t.push(n); } }
      items.slice(0, t.length).forEach((i, n) => ch.set(t[n], [{ productId: i.productId, cases: i.cases }]));
    }
    apply([...ch].map(([code, lines]) => ({ code, entry: entry(lines) })));
    toast(`Pasted ${ch.size} slot${ch.size === 1 ? "" : "s"} from the clipboard.${items.some(i => i.guessed) ? " Rows with no case count got a full pallet." : ""}`);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    // Focus is back on the grid with an entry still open (clicked away): drop that entry and carry on
    if (modeRef.current !== "grid") { setDraft(null); setMode("grid"); setProd(""); setQty(""); }
    const k = e.key;
    const dirs: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end" };
    if (dirs[k]) { e.preventDefault(); move(dirs[k], e.shiftKey); return; }
    if (k === "PageDown" || k === "PageUp") { e.preventDefault(); jumpFace(k === "PageDown" ? 1 : -1); return; }
    const mod = e.ctrlKey || e.metaKey;
    const is = (L: string) => e.code === `Key${L}` || k.toLowerCase() === L.toLowerCase();
    if (mod && is("Z")) { e.preventDefault(); doUndo(); return; }
    if (e.altKey && !mod && (is("A") || k === "å")) { e.preventDefault(); fillColumn(); return; }
    if (mod || e.altKey) return; // copy, cut and paste arrive as clipboard events
    if (k === "Escape") { if (range.size) setAnchor(null); else setHelp(false); return; }
    if (k === "?") { e.preventDefault(); setHelp(h => !h); return; }
    if (k === "Enter" || k === "F2") { e.preventDefault(); beginEdit("", true); return; }
    const sels = selection(), many = range.size > 1;
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault(); const had = sels.filter(checked);
      if (had.length) { apply(had.map(code => ({ code, entry: null }))); toast(`Cleared ${had.length > 1 ? `${had.length} slots` : had[0]}. ${MOD}+Z to undo.`); }
      return;
    }
    if (k === "=") {
      e.preventDefault(); if (!lastLines.current) { toast("Nothing entered yet to repeat."); return; }
      apply(sels.map(code => ({ code, entry: entry(lastLines.current!) })));
      if (!many && after !== "stay") move(after); return;
    }
    if (k === "-") {
      e.preventDefault(); apply(sels.map(code => ({ code, entry: entry([], true) })));
      if (!many && after !== "stay") move(after); return;
    }
    if (k.length === 1 && k !== " ") { e.preventDefault(); setAnchor(null); beginEdit(k, false); }
  };
  const onProdKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); const n = Math.min(matches.length, 40); if (n) setHl(h => (h + (k === "ArrowDown" ? 1 : -1) + n) % n); return; }
    if (k === "Escape") { e.preventDefault(); cancel(); return; }
    if (k === "Enter" || (k === "Tab" && !e.shiftKey)) {
      if (!prod.trim() && draft?.lines.length && k === "Enter") { e.preventDefault(); commit(draft.lines); return; }
      if (matches.length) { e.preventDefault(); choose(matches[Math.min(hl, matches.length - 1)]); return; }
      if (k === "Enter") { e.preventDefault(); if (prod.trim()) toast("No product matches. Try the code or one word of the name."); }
      return;
    }
    if (k === "Backspace" && !prod && draft?.lines.length) { e.preventDefault(); setDraft({ ...draft, lines: draft.lines.slice(0, -1) }); }
  };
  const onQtyKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); cancel(); return; }
    if (k === "Enter") { e.preventDefault(); const l = takeLine(); if (l) commit(l); return; }
    if ((k === "Tab" && !e.shiftKey) || k === "+") {
      e.preventDefault(); const l = takeLine();
      if (l) { setDraft({ ...draft!, lines: l, item: null }); setMode("product"); setProd(""); setQty(""); requestAnimationFrame(() => prodRef.current?.focus()); }
      return;
    }
    if (k === "Tab" && e.shiftKey) { e.preventDefault(); setMode("product"); setDraft({ ...draft!, item: null }); requestAnimationFrame(() => prodRef.current?.focus()); }
  };
  // Clipboard events arrive on the focused grid
  useEffect(() => {
    const el = gridRef.current; if (!el) return;
    const onCopy = (e: ClipboardEvent) => { if (mode !== "grid") return; e.preventDefault(); copy(false, e.clipboardData); };
    const onCut = (e: ClipboardEvent) => { if (mode !== "grid") return; e.preventDefault(); copy(true, e.clipboardData); };
    const onPaste = (e: ClipboardEvent) => { if (mode !== "grid") return; e.preventDefault(); paste((e.clipboardData?.getData("text/plain") ?? "").replace(/\r/g, "").replace(/\n+$/, "")); };
    el.addEventListener("copy", onCopy); el.addEventListener("cut", onCut); el.addEventListener("paste", onPaste);
    return () => { el.removeEventListener("copy", onCopy); el.removeEventListener("cut", onCut); el.removeEventListener("paste", onPaste); };
  });

  // Stable handlers for the memoised cells; they always call the latest code
  const pickRef = useRef<(code: string, shift: boolean) => void>(() => {});
  const editRef = useRef<(code: string) => void>(() => {});
  pickRef.current = (code, shift) => { if (mode !== "grid") cancel(); select(code, shift); focusGrid(); };
  editRef.current = code => { setSel(code); beginEdit("", true); };
  const onPick = useCallback((code: string, shift: boolean) => pickRef.current(code, shift), []);
  const onEdit = useCallback((code: string) => editRef.current(code), []);

  // ----- Progress -----
  const total = scopeTotal(session.scope);
  const counted = Object.keys(session.entries).length;
  const diffCount = useMemo(() => Object.entries(session.entries).filter(([code, e]) => linesMatch(state.stock[code] ?? [], e) === false).length, [session.entries, state.stock]);
  const feed = useMemo(() => Object.entries(session.entries).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 8), [session.entries]);
  const groupDone = (g: string) => rows.filter(r => r.group === g && !r.id.endsWith("FLOOR")).flatMap(r => r.cells).filter(c => checked(c.code)).length;

  const cur = draft ?? null;
  const shownLines = cur ? cur.lines : session.entries[sel]?.lines ?? [];
  const expected = (state.stock[sel] ?? []).filter(l => { const p = productById(l.productId); return p && canSeeClient(me, p.client); });
  const item = cur?.item ? productById(cur.item) : undefined;

  return (
    <div className="count">
      <div className="count-head">
        <button className="iconbtn glass" onClick={() => go("#/inventory/count")} aria-label="All counts"><BackIcon /></button>
        <div className="count-title"><h2>{session.name}</h2><span className="muted small">{counted.toLocaleString()} counted of {total.toLocaleString()} slots · {diffCount} difference{diffCount === 1 ? "" : "s"}{session.blind ? " · blind count" : ""}</span></div>
        <span className="fill-bar count-bar"><i style={{ width: `${Math.min(100, (counted / Math.max(1, total)) * 100)}%` }} /></span>
        <label className="field inline small-field"><span>After saving</span>
          <select className="input" value={after} onChange={e => { setAfter(e.target.value as After); focusGrid(); }}>
            <option value="right">move right</option><option value="down">move down</option><option value="stay">stay</option>
          </select>
        </label>
        <button className="btn small" onClick={() => setHelp(h => !h)} aria-expanded={help}><KeyboardIcon /> Shortcuts</button>
        {session.status === "open" && (can(me, "approve-count")
          ? <button className="btn small primary" onClick={() => { dispatch({ type: "count/status", id: session.id, status: "review", by: me.name }); go(`#/inventory/count/${session.id}/review`); }}>Finish & review</button>
          : <button className="btn small" onClick={() => { dispatch({ type: "count/status", id: session.id, status: "review", by: me.name }); toast("Sent to the owners for approval."); go("#/inventory/count"); }}>Done counting</button>)}
      </div>

      <div className="entry glass" ref={entryRef} aria-live="polite">
        <div className="entry-loc">
          <b className="mono">{range.size > 1 && !cur ? `${range.size} slots` : cur?.code ?? sel}</b>
          <small>{range.size > 1 && !cur ? `${selection()[0]} to ${selection().at(-1)} selected` : describeLocation(cur?.code ?? sel)}</small>
        </div>
        <div className="entry-main">
          <div className="entry-chips">
            {shownLines.map((l, i) => { const p = productById(l.productId); return <span key={i} className="echip"><b>{p?.code}</b> {p?.name.slice(0, 30)} × <b>{l.cases}</b>{cur && <button onClick={() => setDraft({ ...cur, lines: cur.lines.filter((_, j) => j !== i) })} aria-label={`Remove ${p?.code}`}>×</button>}</span>; })}
            {!cur && session.entries[sel]?.empty && <span className="echip">Checked, empty</span>}
          </div>
          <div className="entry-inputs">
            <div className="entry-prod">
              <input ref={prodRef} className="input" value={prod} placeholder={readOnly ? "Counting is finished" : "Type a product code or name"} disabled={readOnly} aria-label="Product"
                onFocus={() => { if (modeRef.current === "grid") beginEdit("", true); }}
                onChange={e => { if (modeRef.current === "grid") beginEdit(e.target.value, true); else { setProd(e.target.value); if (mode === "qty") { setMode("product"); setDraft(d => (d ? { ...d, item: null } : d)); } } }}
                onKeyDown={onProdKey} />
              {mode === "product" && (matches.length > 0 || prod.trim()) && (
                <ul className="sugg glass" role="listbox" aria-label="Products">
                  <li className="sugg-head">{prod.trim() ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : "Recent"}</li>
                  {matches.map((p, i) => (
                    <li key={p.id} role="option" aria-selected={i === hl} className={i === hl ? "hl" : ""} onMouseDown={e => { e.preventDefault(); choose(p); }} onMouseEnter={() => setHl(i)}>
                      <span className="mono">{p.code}</span><span>{p.name} <small>{p.size}{p.units ? ` × ${p.units}` : ""} · {p.brand || p.client}</small>{/DONOTUSE/i.test(p.item ?? "") && <em className="tag warn">do not use</em>}</span><span className="muted small">{p.perPallet ? `${p.perPallet}/pallet` : ""}</span>
                    </li>
                  ))}
                  {prod.trim() && !matches.length && <li className="muted small">No product matches “{prod}”.</li>}
                </ul>
              )}
            </div>
            <input ref={qtyRef} className="input entry-qty" value={qty} inputMode="numeric" placeholder="Cases" disabled={readOnly} aria-label="Cases"
              onChange={e => setQty(e.target.value.replace(/[^\d]/g, ""))} onKeyDown={onQtyKey}
              onFocus={() => { if (modeRef.current !== "qty") prodRef.current?.focus(); }} />
          </div>
          <p className="entry-hint">
            {mode === "grid" ? <><kbd>←↑↓→</kbd> move · <kbd>Shift</kbd>+arrows select · type to enter · <kbd>=</kbd> repeat · <kbd>-</kbd> empty · <kbd>{ALT}</kbd>+<kbd>A</kbd> fill column · <kbd>{MOD}</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy, paste · <kbd>?</kbd> all shortcuts</>
              : mode === "product" ? <><kbd>↑↓</kbd> choose · <kbd>Enter</kbd> pick product{cur?.lines.length ? <> · <kbd>Enter</kbd> on an empty box saves</> : null} · <kbd>Esc</kbd> cancel</>
              : <><kbd>Enter</kbd> save and move · <kbd>Tab</kbd> add another product to this pallet · <kbd>Esc</kbd> cancel{item?.perPallet ? ` · full pallet: ${item.perPallet}` : ""}</>}
          </p>
          {showExpected && !cur && <p className="entry-was">System: {expected.length ? expected.map((l, i) => <span key={i}><b>{productById(l.productId)?.code}</b> {productById(l.productId)?.name.slice(0, 30)} × <b>{l.cases}</b>{i < expected.length - 1 ? " · " : ""}</span>) : "nothing recorded here"}</p>}
        </div>
      </div>

      {help && <ShortcutHelp onClose={() => { setHelp(false); focusGrid(); }} />}

      <div className="count-body">
        <nav className="count-index glass" aria-label="Rack sides">
          {[...new Set(rows.map(r => r.group))].map(g => {
            const f = FACES.find(x => x.id === g);
            const tot = f ? f.cols.reduce((a, c) => a + c[1].length, 0) : 0;
            const done = groupDone(g);
            const here = rows[idx.rowOf.get(sel) ?? -1]?.group === g;
            return (
              <button key={g} className={`ci${here ? " on" : ""}${f && done >= tot ? " done" : ""}`} onClick={() => openGroup(g)}>
                <b>{g.length > 6 ? AREAS.find(a => a.id === g)?.name ?? g : g}</b>{f && <small>{done}/{tot}</small>}
              </button>
            );
          })}
        </nav>
        <div className="count-grid" ref={gridRef} tabIndex={0} onKeyDown={onGridKey} aria-label="Count grid. Arrow keys move, type to enter a product.">
          {FACES.filter(f => session.scope.includes(f.id)).map(f => (
            <FaceSection key={f.id} face={f} entries={session.entries} stock={state.stock} sel={sel} range={range} showExpected={showExpected} me={me}
              floorN={floorSpots(f.id, state.stock, session.entries)} draftCode={cur?.code} onPick={onPick} onEdit={onEdit} />
          ))}
          {AREAS.filter(a => session.scope.includes(a.id)).map(a => (
            <section key={a.id} className="cface" id={`cf-${a.id}`}>
              <h3>{a.name}</h3>
              <div className="cfloor">
                {Array.from({ length: floorSpots(a.id, state.stock, session.entries) }, (_, i) => floorCode(a.id, i + 1)).map(code => (
                  <CountCell key={code} code={code} label={code.slice(-3)} entry={session.entries[code]} expected={state.stock[code]} selected={code === sel} inRange={range.has(code)} editing={code === cur?.code}
                    showExpected={showExpected} visibleTo={me} onPick={onPick} onEdit={onEdit} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {feed.length > 0 && (
        <aside className="count-feed" aria-label="Latest counts">
          <ol>{feed.map(([code, e]) => (
            <li key={code}><span className={e.lines.length ? "plus" : "fact"}>{e.lines.length ? `+${e.lines.reduce((a, l) => a + l.cases, 0)} ${code} ${productById(e.lines[0].productId)?.code ?? ""}${e.lines.length > 1 ? "+" : ""}` : `${code} empty`}</span> <small>{e.by}</small></li>
          ))}</ol>
        </aside>
      )}
    </div>
  );
}

const FaceSection = memo(function FaceSection({ face, entries, stock, sel, range, showExpected, me, floorN, draftCode, onPick, onEdit }: {
  face: Face; entries: Record<string, CountEntry>; stock: Record<string, StockLine[]>; sel: string; range: Set<string>; showExpected: boolean;
  me: Parameters<typeof canSeeClient>[0]; floorN: number; draftCode?: string; onPick: (code: string, shift: boolean) => void; onEdit: (code: string) => void;
}) {
  const bays = (c: Face["cols"][number]) => Math.max(...c[1].map(s => s[1]));
  const tracks = ["30px", ...face.cols.flatMap(c => ["6px", ...Array(bays(c)).fill("var(--ccell)")])];
  let t = 2;
  const starts = face.cols.map(c => { const s = t + 1; t += 1 + bays(c); return s; });
  return (
    <section className="cface" id={`cf-${face.id}`}>
      <h3>{face.id} <small className="muted">{face.rack === "D6" ? "Door 6" : face.rack.length > 2 ? "Junction" : `Rack ${face.rack}`} · side {face.side}</small></h3>
      <div className="cgrid" style={{ gridTemplateColumns: tracks.join(" ") }}>
        {face.cols.map((c, ci) => <div key={`h${c[0]}`} className="rack-colnum" style={{ gridRow: 1, gridColumn: `${starts[ci]} / span ${bays(c)}` }}>{String(c[0]).padStart(2, "0")}</div>)}
        {[4, 3, 2, 1].map((lv, r) => <div key={lv} className="rack-level" style={{ gridRow: r + 2, gridColumn: 1 }}>L{lv}</div>)}
        {face.cols.flatMap((c, ci) => c[1].map(([lv, bay]) => {
          const code = `${face.id}-${String(c[0]).padStart(2, "0")}-L${lv}-B${bay}`;
          return (
            <div key={code} style={{ gridRow: 6 - lv, gridColumn: starts[ci] + bay - 1 }}>
              <CountCell code={code} entry={entries[code]} expected={stock[code]} selected={code === sel} inRange={range.has(code)} editing={code === draftCode}
                showExpected={showExpected} visibleTo={me} onPick={onPick} onEdit={onEdit} />
            </div>
          );
        }))}
      </div>
      <div className="cfloor"><span className="rack-level">Floor</span>
        {Array.from({ length: floorN }, (_, i) => floorCode(face.id, i + 1)).map(code => (
          <CountCell key={code} code={code} label={code.slice(-3)} entry={entries[code]} expected={stock[code]} selected={code === sel} inRange={range.has(code)} editing={code === draftCode}
            showExpected={showExpected} visibleTo={me} onPick={onPick} onEdit={onEdit} />
        ))}
      </div>
    </section>
  );
}, (a, b) => {
  // Re-render a rack side only when something on it changed
  if (a.face !== b.face || a.showExpected !== b.showExpected || a.floorN !== b.floorN || a.me !== b.me || a.stock !== b.stock) return false;
  const mine = (code?: string | null) => !!code && (code.startsWith(`${a.face.id}-`));
  if ((mine(a.sel) || mine(b.sel)) && a.sel !== b.sel) return false;
  if ((mine(a.draftCode) || mine(b.draftCode)) && a.draftCode !== b.draftCode) return false;
  if ([...a.range, ...b.range].some(mine) && (a.range.size !== b.range.size || [...a.range].some(c => !b.range.has(c)))) return false;
  if (a.entries !== b.entries) for (const k of new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])) if (mine(k) && a.entries[k] !== b.entries[k]) return false;
  return true;
});

const CountCell = memo(function CountCell({ code, label, entry, expected, selected, inRange, editing, showExpected, visibleTo, onPick, onEdit }: {
  code: string; label?: string; entry?: CountEntry; expected?: StockLine[]; selected: boolean; inRange: boolean; editing: boolean; showExpected: boolean;
  visibleTo: Parameters<typeof canSeeClient>[0]; onPick: (code: string, shift: boolean) => void; onEdit: (code: string) => void;
}) {
  const exp = (expected ?? []).filter(l => { const p = productById(l.productId); return p && canSeeClient(visibleTo, p.client); });
  const match = entry ? linesMatch(expected ?? [], entry) : null;
  const total = entry?.lines.reduce((a, l) => a + l.cases, 0) ?? 0;
  const codes = entry ? [...new Set(entry.lines.map(l => productById(l.productId)?.code ?? "?"))] : [];
  const cls = ["ccell", entry ? (match ? "ok" : "diff") : "todo", entry?.empty ? "empty" : "", selected ? "sel" : "", inRange ? "range" : "", editing ? "editing" : ""].filter(Boolean).join(" ");
  const title = `${code}${entry ? `: counted ${entry.lines.length ? entry.lines.map(l => `${productById(l.productId)?.code} × ${l.cases}`).join(", ") : "empty"} by ${entry.by}` : ": not counted"}${showExpected ? ` · system ${exp.length ? exp.map(l => `${productById(l.productId)?.code} × ${l.cases}`).join(", ") : "empty"}` : ""}`;
  return (
    <button type="button" tabIndex={-1} className={cls} data-code={code} title={title} aria-label={title}
      onMouseDown={e => { e.preventDefault(); onPick(code, e.shiftKey); }} onDoubleClick={() => onEdit(code)}>
      {label && <span className="cc-l">{label}</span>}
      {entry ? (entry.lines.length ? <><span className="cc-code">{codes.join("+")}</span><span className="cc-q">{total}</span></> : <span className="cc-q">empty</span>)
        : showExpected && exp.length ? <><span className="cc-exp">{productById(exp[0].productId)?.code}{exp.length > 1 ? "+" : ""}</span><span className="cc-exp">{exp.reduce((a, l) => a + l.cases, 0)}</span></> : null}
    </button>
  );
});

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const K = ({ k }: { k: string }) => <>{k.split("+").map((x, i) => <span key={i}>{i ? "+" : ""}<kbd>{x}</kbd></span>)}</>;
  const rows: [string, string[], string][] = [
    ["Moving", ["←", "↑", "↓", "→"], "Move between slots, down into the floor row and on to the next rack side"],
    ["", ["Page Up", "Page Down"], "Previous or next rack side"],
    ["", ["Home", "End"], "Start or end of the row"],
    ["", ["Shift+arrows"], "Select a block of slots on one rack side (or Shift+click)"],
    ["", ["Esc"], "Clear the selection"],
    ["Entering", ["Type"], "Search products by code or name; ↑ ↓ choose, Enter picks"],
    ["", ["Enter"], "In cases: save and move on (right, down or stay; see “After saving”)"],
    ["", ["Tab"], "In cases: add another product to the same pallet (mixed pallet)"],
    ["", ["Enter", "F2"], "Edit the selected slot (double-click works too)"],
    ["", ["="], "Same product and cases as your last entry (fills every selected slot)"],
    ["", ["-"], "Checked and empty"],
    ["", [`${ALT}+A`], "Fill the uncounted slots in this rack column with this slot's product, at a full pallet"],
    ["Copy and paste", [`${MOD}+C`, `${MOD}+X`], "Copy or cut the selected slots"],
    ["", [`${MOD}+V`], "Paste: one slot fills every selected slot; a block keeps its shape; rows from Excel with a location go to that location"],
    ["", ["Del"], "Clear the selected slots"],
    ["", [`${MOD}+Z`], "Undo, including a whole fill or paste"],
  ];
  return (
    <div className="help glass" role="dialog" aria-label="Shortcuts">
      <div className="sheet-head"><h3>Shortcuts</h3><button className="btn small" onClick={onClose}>Close</button></div>
      <dl>{rows.map(([h, keys, d], i) => (
        <div key={i} className="help-row">{h && <h4>{h}</h4>}<dt>{keys.map((k, j) => <span key={j}>{j ? " " : ""}<K k={k} /></span>)}</dt><dd>{d}</dd></div>
      ))}</dl>
    </div>
  );
}
