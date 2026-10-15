import { useEffect, useMemo, useRef, useState } from "react";
import { searchProducts, type Product } from "../../data/catalog";
import { canSeeClient } from "../../auth/permissions";
import { compose, GROUP_LABEL, reconcile, type Part } from "../../chat/refs";
import { byPresence } from "../../chat/presence";
import { useChatBackend } from "../../chat/backend";
import { useOverlay } from "../../chat/overlay";
import { useConnection } from "../../chat/connection";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { shrink } from "../../utils/image";
import type { GroupId, MessageRef } from "../../store/types";
import { PresenceDot } from "./Presence";
import { CameraIcon, CloseIcon, SendIcon } from "../icons";

type DraftRef = MessageRef & { label: string };
interface Draft { text: string; refs: DraftRef[]; photos: string[]; urgent: boolean }
// Drafts survive switching between the home module and the full screen (this visit only)
const drafts = new Map<string, Draft>();
const EMPTY: Draft = { text: "", refs: [], photos: [], urgent: false };

type Item =
  | { kind: "user"; id: string; name: string }
  | { kind: "group"; group: GroupId; members: number }
  | { kind: "product"; product: Product }
  | { kind: "order"; id: string; store: string }
  | { kind: "shipment"; id: string; title: string; status: string }
  | { kind: "container"; ref: string; title: string };

const TRIGGER = /(?:^|\s)([@#])([^\s@#]{0,30})$/;

/** Message box with @ people and groups, # products / orders / deliveries / containers, 📍 slots, photos and urgent. */
export function Composer({ conversationId, compact = false, autoFocus = false }: { conversationId: string; compact?: boolean; autoFocus?: boolean }) {
  const { state } = useStore();
  const { me, settings } = useSession();
  const backend = useChatBackend();
  const overlay = useOverlay();
  const { online } = useConnection();
  const [draft, setDraftState] = useState<Draft>(() => drafts.get(conversationId) ?? EMPTY);
  useEffect(() => { setDraftState(drafts.get(conversationId) ?? EMPTY); setPicker(null); }, [conversationId]);
  const setDraft = (d: Draft | ((prev: Draft) => Draft)) => setDraftState(prev => {
    const next = typeof d === "function" ? d(prev) : d;
    drafts.set(conversationId, next);
    return next;
  });
  const ta = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<{ char: "@" | "#"; query: string; start: number } | null>(null);
  const [hl, setHl] = useState(0);
  const conv = state.chat.conversations.find(c => c.id === conversationId);

  // ----- What the @ / # list offers -----
  const items: Item[] = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    if (picker.char === "@") {
      const members = state.chat.users.filter(u => conv?.members.includes(u.id) && u.id !== me.id && u.name.toLowerCase().startsWith(q))
        .sort(byPresence(me, settings, state.chat.presence));
      const groups = (Object.keys(GROUP_LABEL) as GroupId[]).filter(g => g.startsWith(q))
        .map(g => ({ kind: "group" as const, group: g, members: state.chat.users.filter(u => u.groups.includes(g)).length }));
      return [...members.map(u => ({ kind: "user" as const, id: u.id, name: u.name })), ...groups];
    }
    const products = (q ? searchProducts(picker.query, undefined, 12) : []).filter(p => canSeeClient(me, p.client)).slice(0, 6)
      .map(p => ({ kind: "product" as const, product: p }));
    const orders = state.orders.filter(o => canSeeClient(me, o.client) && (!q || o.id.toLowerCase().replace(/\s/g, "").includes(q) || o.store.toLowerCase().includes(q)))
      .slice(0, 4).map(o => ({ kind: "order" as const, id: o.id, store: o.store }));
    const visible = state.shipments.filter(s => canSeeClient(me, s.client));
    const ships = visible.filter(s => !q || `${s.client} ${s.number}`.toLowerCase().replace(/\s/g, "").includes(q) || s.number.includes(q))
      .slice(0, 4).map(s => ({ kind: "shipment" as const, id: s.id, title: `${s.client} ${s.number}`, status: s.status }));
    const containers = q.length >= 2 ? visible.filter(s => s.ref && s.ref.toLowerCase().replace(/\s/g, "").includes(q))
      .slice(0, 3).map(s => ({ kind: "container" as const, ref: s.ref, title: `${s.client} ${s.number}` })) : [];
    return [...products, ...orders, ...ships, ...containers];
  }, [picker, state, me, settings, conv]);
  useEffect(() => setHl(0), [picker?.query, picker?.char]);
  const sameCode = picker?.char === "#" ? items.filter(i => i.kind === "product" && i.product.code.toLowerCase() === picker.query.toLowerCase()) : [];

  // ----- Editing -----
  const insert = (parts: Part[], from: number, to: number) => {
    const { text: piece, refs } = compose(state, parts);
    const tail = draft.text.slice(to);
    const add = piece + (tail.startsWith(" ") ? "" : " ");
    const delta = add.length - (to - from);
    const kept = draft.refs.filter(r => r.end <= from || r.start >= to).map(r => (r.start >= to ? { ...r, start: r.start + delta, end: r.end + delta } : r));
    const fresh = refs.map(r => ({ ...r, start: r.start + from, end: r.end + from, label: piece.slice(r.start, r.end) }) as DraftRef);
    const text = draft.text.slice(0, from) + add + tail;
    setDraft({ ...draft, text, refs: [...kept, ...fresh].sort((a, b) => a.start - b.start) });
    setPicker(null);
    const caret = from + add.length;
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(caret, caret); });
  };
  const pick = (it: Item) => {
    if (!picker) return;
    const end = picker.start + 1 + picker.query.length;
    const part: Part = it.kind === "user" ? { user: it.id } : it.kind === "group" ? { group: it.group } : it.kind === "product" ? { product: it.product.id }
      : it.kind === "order" ? { order: it.id } : it.kind === "shipment" ? { shipment: it.id } : { container: it.ref };
    insert([part], picker.start, end);
  };
  const detect = (text: string, caret: number, refs: DraftRef[]) => {
    const m = TRIGGER.exec(text.slice(0, caret));
    if (!m) return setPicker(null);
    const start = caret - m[2].length - 1;
    if (refs.some(r => start >= r.start && start < r.end)) return setPicker(null);
    setPicker({ char: m[1] as "@" | "#", query: m[2], start });
  };
  const onChange = (text: string, caret: number) => {
    const refs = reconcile(text, draft.refs);
    setDraft({ ...draft, text, refs });
    detect(text, caret, refs);
  };
  /** The strip buttons type the trigger for you, so the same list opens */
  const startTrigger = (char: "@" | "#") => {
    const el = ta.current;
    const caret = el?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, caret);
    const add = (before && !/\s$/.test(before) ? " " : "") + char;
    const text = before + add + draft.text.slice(caret);
    const refs = reconcile(text, draft.refs);
    setDraft({ ...draft, text, refs });
    const pos = caret + add.length;
    setPicker({ char, query: "", start: pos - 1 });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };
  const pickSlots = () => {
    const caret = ta.current?.selectionStart ?? draft.text.length;
    overlay({ kind: "pick", onSend: codes => insert(codes.flatMap((c, i) => (i ? [", ", { slot: c }] : [{ slot: c }])) as Part[], caret, caret) });
  };

  const mentions = draft.refs.some(r => r.type === "user" || r.type === "group");
  const canSend = !!draft.text.trim() || draft.photos.length > 0;
  const send = () => {
    if (!canSend) return;
    const refs = reconcile(draft.text, draft.refs).map(({ label: _l, ...r }) => { void _l; return r as MessageRef; });
    backend.send({ conversationId, text: draft.text.trim() ? draft.text.replace(/\s+$/, "") : "", refs, photos: draft.photos, urgent: draft.urgent && mentions });
    setDraft(EMPTY);
    setPicker(null);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHl(h => (h + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHl(h => (h - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[Math.min(hl, items.length - 1)]); return; }
    }
    if (e.key === "Escape" && picker) { e.preventDefault(); setPicker(null); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  return (
    <div className={`composer${compact ? " compact" : ""}`}>
      {picker && (
        <div className="picker-pop glass" role="listbox" aria-label={picker.char === "@" ? "People and groups" : "Products, orders and deliveries"}>
          {sameCode.length > 1 && <p className="pp-head">Which product? Code {picker.query.toUpperCase()} is used by {sameCode.length} products.</p>}
          {items.length ? items.map((it, i) => (
            <button key={i} type="button" role="option" aria-selected={i === hl} className={`pp-item${i === hl ? " hl" : ""}`}
              onMouseDown={e => { e.preventDefault(); pick(it); }} onMouseEnter={() => setHl(i)}>
              {it.kind === "user" ? <><PresenceDot userId={it.id} /><b>@{it.name}</b><small>{state.chat.users.find(u => u.id === it.id)?.role}</small></>
                : it.kind === "group" ? <><span className="pp-ic">👥</span><b>@{GROUP_LABEL[it.group]}</b><small>{it.members} people</small></>
                : it.kind === "product" ? <><span className="pp-ic">📦</span><b>{it.product.name} <span className="muted">{it.product.size}</span></b><small>{it.product.code} · {it.product.client}</small></>
                : it.kind === "order" ? <><span className="pp-ic">🧾</span><b>{it.id}</b><small>{it.store}</small></>
                : it.kind === "shipment" ? <><span className="pp-ic">🚚</span><b>{it.title}</b><small>{it.status}</small></>
                : <><span className="pp-ic">#</span><b>{it.ref}</b><small>container · {it.title}</small></>}
            </button>
          )) : <p className="pp-head">{picker.char === "@" ? "No one by that name in this conversation." : picker.query ? "No matching product, order or delivery." : "Type a product name or code, an order or a delivery."}</p>}
        </div>
      )}
      <div className="tool-strip" role="toolbar" aria-label="Insert">
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => startTrigger("@")}>@ Person</button>
        <button type="button" onClick={pickSlots}>📍 Slot</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => startTrigger("#")}>📦 Product</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => startTrigger("#")}>🧾 Order</button>
      </div>
      {draft.photos.length > 0 && (
        <div className="draft-photos">
          {draft.photos.map((p, i) => (
            <span key={i} className="draft-photo"><img src={p} alt={`Photo ${i + 1} to send`} />
              <button className="mini" onClick={() => setDraft({ ...draft, photos: draft.photos.filter((_, j) => j !== i) })} aria-label="Remove photo"><CloseIcon /></button></span>
          ))}
        </div>
      )}
      <div className="compose-row">
        <label className="iconbtn compose-ic" title="Photo (camera on phones)">
          <CameraIcon /><span className="sr-only">Add photo</span>
          <input type="file" accept="image/*" capture="environment" multiple onChange={async e => {
            const files = [...(e.target.files ?? [])]; e.target.value = "";
            try { const ps = await Promise.all(files.map(shrink)); setDraft(d => ({ ...d, photos: [...d.photos, ...ps] })); } catch { /* unreadable photo: ignored */ }
          }} />
        </label>
        <textarea ref={ta} className="input compose-in" rows={1} value={draft.text} autoFocus={autoFocus}
          placeholder={`Message ${conv?.kind === "dm" ? "" : "#"}${conv ? (conv.kind === "dm" ? state.chat.users.find(u => u.id === conv.members.find(m => m !== me.id))?.name ?? "" : conv.title) : ""}`}
          aria-label="Message" onKeyDown={onKey}
          onChange={e => onChange(e.target.value, e.target.selectionStart)}
          onSelect={e => detect(e.currentTarget.value, e.currentTarget.selectionStart, draft.refs)}
          onBlur={() => setTimeout(() => setPicker(null), 120)} />
        <button type="button" className={`iconbtn compose-ic urgent${draft.urgent ? " on" : ""}`} aria-pressed={draft.urgent}
          title={mentions ? `Urgent: escalates by text if still unread after ${settings.escalateMinutes} min` : "Urgent needs an @mention"}
          onClick={() => setDraft({ ...draft, urgent: !draft.urgent })}>!</button>
        <button type="button" className="iconbtn compose-ic send" disabled={!canSend} onClick={send} aria-label={online ? "Send" : "Send when back online"}><SendIcon /></button>
      </div>
      {draft.urgent && <p className="compose-note">{mentions ? `Urgent · anyone mentioned who hasn't read it in ${settings.escalateMinutes} min gets a text` : "Urgent needs an @mention to escalate"}</p>}
      {!online && <p className="compose-note">Offline · messages wait on this device and send when you're back</p>}
    </div>
  );
}

