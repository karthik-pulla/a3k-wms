import { useState } from "react";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { conversationTitle } from "../../chat/selectors";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { PresenceDot } from "./Presence";
import { BackIcon, InfoIcon, SearchIcon, CloseIcon } from "../icons";

/** Header, messages and composer for one conversation (the full Messages screen). */
export function ConversationView({ conversationId, focusId, onBack, onDetails, detailsOpen }: {
  conversationId: string; focusId?: string; onBack?: () => void; onDetails: () => void; detailsOpen: boolean;
}) {
  const { state } = useStore();
  const { me } = useSession();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const conv = state.chat.conversations.find(c => c.id === conversationId);
  if (!conv || !conv.members.includes(me.id)) return <div className="conv-missing"><p className="muted">This conversation isn't available to you.</p>{onBack && <button className="btn" onClick={onBack}>Back</button>}</div>;
  const other = conv.kind === "dm" ? conv.members.find(id => id !== me.id) : undefined;
  const sub = other ? null : conv.kind === "dm" ? "" : `${conv.members.length} members`;

  return (
    <section className="conv-view" aria-label={conversationTitle(conv, me, state.chat.users)}>
      <header className="conv-head">
        {onBack && <button className="iconbtn" onClick={onBack} aria-label="Back to conversations"><BackIcon /></button>}
        <div className="conv-head-t">
          <h2>{conv.kind === "channel" ? "#" : ""}{conversationTitle(conv, me, state.chat.users)}</h2>
          {other ? <span className="small muted"><PresenceDot userId={other} withLabel /></span> : <span className="small muted">{sub}</span>}
        </div>
        <button className={`iconbtn${searching ? " on" : ""}`} onClick={() => { setSearching(!searching); setQ(""); }} aria-label="Search in this conversation" aria-pressed={searching}><SearchIcon /></button>
        <button className={`iconbtn${detailsOpen ? " on" : ""}`} onClick={onDetails} aria-label="Details" aria-pressed={detailsOpen}><InfoIcon /></button>
      </header>
      {searching && (
        <div className="conv-search">
          <input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search this conversation" aria-label="Search this conversation"
            onKeyDown={e => { if (e.key === "Escape") { setSearching(false); setQ(""); } }} />
          <button className="mini" onClick={() => { setSearching(false); setQ(""); }} aria-label="Close search"><CloseIcon /></button>
        </div>
      )}
      <MessageList key={conversationId} conversationId={conversationId} search={q} focusId={focusId} />
      {conv.kind === "dm" && conv.members.length < 2
        ? <p className="note conv-left">The other person took this conversation off their list. <a className="link" href="#/messages/new">Start a new one</a></p>
        : <Composer conversationId={conversationId} />}
    </section>
  );
}
