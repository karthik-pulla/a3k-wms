import { t } from "../../i18n";
import { useState } from "react";
import { go } from "../../router";
import { searchPeople } from "../../chat/selectors";
import { productById } from "../../data/catalog";
import { canSeeClient } from "../../auth/permissions";
import { byPresence, manualLabel } from "../../chat/presence";
import { useChatBackend } from "../../chat/backend";
import { useOverlay } from "../../chat/overlay";
import { useStore, shipmentTitle } from "../../store/store";
import { useSession } from "../../session";
import type { ManualStatus } from "../../store/types";
import { PresenceDot } from "./Presence";
import { CloseIcon } from "../icons";

/** Who's in the conversation and what they're doing, plus the slots and products mentioned in it. */
export function DetailsPane({ conversationId, onClose }: { conversationId: string; onClose?: () => void }) {
  const { state } = useStore();
  const { me, settings } = useSession();
  const overlay = useOverlay();
  const conv = state.chat.conversations.find(c => c.id === conversationId);
  if (!conv) return null;
  const members = state.chat.users.filter(u => conv.members.includes(u.id)).sort(byPresence(me, settings, state.chat.presence));
  const msgs = state.chat.messages.filter(m => m.conversationId === conversationId);
  const slots = [...new Set(msgs.flatMap(m => m.refs.flatMap(r => (r.type === "slot" ? [r.code] : []))))];
  const products = [...new Set(msgs.flatMap(m => m.refs.flatMap(r => (r.type === "product" ? [r.productId] : []))))]
    .filter(id => { const p = productById(id); return p && canSeeClient(me, p.client); });
  const record = conv.link?.type === "shipment" ? state.shipments.find(s => s.id === conv.link!.id) : undefined;

  return (
    <aside className="details" aria-label="Conversation details">
      <div className="details-head">
        <h2>Details</h2>
        {onClose && <button className="iconbtn" onClick={onClose} aria-label="Close details"><CloseIcon /></button>}
      </div>
      {record && <a className="link" href={`#/inbounds/${record.status === "incoming" ? "incoming" : "pending"}/${record.id}`}>Open delivery {shipmentTitle(record)} ›</a>}
      {conv.link?.type === "order" && <p className="muted small">Order pages come with Out-bounds; this thread keeps the order's messages until then.</p>}

      {(conv.kind === "group" || conv.kind === "dm") && <ManageConversation id={conv.id} />}

      <section>
        <h3>Your status</h3>
        <MyStatus />
      </section>

      <section>
        <h3>Members · {members.length}</h3>
        <ul className="members">
          {members.map(u => (
            <li key={u.id}>
              <span className="mem-name">{u.id === me.id ? `${u.name} (you)` : u.name}<small>{u.role}{u.sample ? " · sample" : ""}</small></span>
              <span className="mem-presence"><PresenceDot userId={u.id} withLabel /></span>
            </li>
          ))}
        </ul>
      </section>

      {slots.length > 0 && (
        <section>
          <h3>Slots mentioned · {slots.length}</h3>
          <div className="chip-wrap">{slots.map(c => <button key={c} className="rchip slot" onClick={() => overlay({ kind: "slots", codes: [c] })}><span aria-hidden="true">📍</span>{c}</button>)}</div>
          {slots.length > 1 && <button className="link small" onClick={() => overlay({ kind: "slots", codes: slots })}>Show all on map</button>}
        </section>
      )}
      {products.length > 0 && (
        <section>
          <h3>Products mentioned · {products.length}</h3>
          <div className="chip-wrap">{products.map(id => { const p = productById(id)!; return <button key={id} className="rchip product" onClick={() => overlay({ kind: "product", productId: id })}><span aria-hidden="true">📦</span>{p.name} {p.size}</button>; })}</div>
        </section>
      )}
    </aside>
  );
}

/** Group chats: the creator renames it, adds or removes people and deletes it; anyone may leave. Direct messages: off your list. */
function ManageConversation({ id }: { id: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const backend = useChatBackend();
  const conv = state.chat.conversations.find(c => c.id === id)!;
  const mine = conv.kind === "group" && conv.createdBy === me.id;
  const [title, setTitle] = useState(conv.title);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const others = searchPeople(state.chat.users.filter(u => !conv.members.includes(u.id)), q).slice(0, 8);
  const creator = state.chat.users.find(u => u.id === conv.createdBy)?.name;
  const leave = () => { if (window.confirm(t(conv.kind === "dm" ? "Take this conversation off your list? The other person keeps it." : "Leave this group chat?"))) { backend.leave(id); go("#/messages"); } };
  return (
    <section>
      <h3>{conv.kind === "group" ? "Group chat" : "Direct message"}</h3>
      {conv.kind === "group" && <p className="muted small">Started by {conv.createdBy === me.id ? "you" : creator ?? "someone"}{mine ? "; you can rename it, change who's in it, or delete it." : "."}</p>}
      {mine && <>
        <div className="link-row"><input className="input" value={title} onChange={e => setTitle(e.target.value)} aria-label="Group name" maxLength={60} /><button className="btn small" disabled={!title.trim() || title === conv.title} onClick={() => backend.updateGroup(id, { title })}>Rename</button></div>
        <ul className="members">{state.chat.users.filter(u => conv.members.includes(u.id) && u.id !== me.id).map(u => (
          <li key={u.id}><span className="mem-name">{u.name}</span><button className="btn small" onClick={() => backend.updateGroup(id, { members: conv.members.filter(m => m !== u.id) })}>Remove</button></li>
        ))}</ul>
        {adding ? <div className="stack">
          <input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Add someone: search a name" aria-label="Search people to add" />
          <ul className="members">{others.map(u => <li key={u.id}><span className="mem-name">{u.name}<small>{u.role}</small></span><button className="btn small" onClick={() => backend.updateGroup(id, { members: [...conv.members, u.id] })}>Add</button></li>)}</ul>
          <button className="link small" onClick={() => setAdding(false)}>Done adding</button>
        </div> : <button className="btn small" onClick={() => setAdding(true)}>+ Add people</button>}
      </>}
      <div className="btns">
        {mine
          ? <button className="btn small danger" onClick={() => { if (window.confirm(t("Delete this group chat for everyone? Its messages are kept but nobody can see or write in it."))) { backend.updateGroup(id, { deleted: true }); go("#/messages"); } }}>Delete group chat</button>
          : <button className="btn small" onClick={leave}>{conv.kind === "dm" ? "Remove from my list" : "Leave group chat"}</button>}
      </div>
    </section>
  );
}

/** Manual status: On forklift, On break (clears itself), Receiving at Door N, Off today. */
export function MyStatus() {
  const { state } = useStore();
  const { me, settings } = useSession();
  const backend = useChatBackend();
  const cur = state.chat.presence[me.id]?.manual;
  const [door, setDoor] = useState(cur?.kind === "receiving" ? cur.door : 2);
  const set = (s: ManualStatus | undefined) => backend.setManualStatus(s);
  return (
    <div className="my-status">
      <p className="small">{manualLabel(cur) ?? "No status set"}</p>
      <div className="status-btns">
        <button className={`chip-btn${cur?.kind === "forklift" ? " on" : ""}`} onClick={() => set({ kind: "forklift" })}>On forklift</button>
        <button className={`chip-btn${cur?.kind === "break" ? " on" : ""}`} onClick={() => set({ kind: "break", until: new Date(Date.now() + settings.breakMinutes * 6e4).toISOString() })}>On break ({settings.breakMinutes} min)</button>
        <span className="door-pick">
          <button className={`chip-btn${cur?.kind === "receiving" ? " on" : ""}`} onClick={() => set({ kind: "receiving", door })}>Receiving at Door</button>
          <select className="input" value={door} aria-label="Door" onChange={e => { const d = Number(e.target.value); setDoor(d); if (cur?.kind === "receiving") set({ kind: "receiving", door: d }); }}>
            {[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </span>
        <button className={`chip-btn${cur?.kind === "off" ? " on" : ""}`} onClick={() => set({ kind: "off" })}>Off today</button>
        {cur && <button className="chip-btn" onClick={() => set(undefined)}>Clear</button>}
      </div>
    </div>
  );
}
