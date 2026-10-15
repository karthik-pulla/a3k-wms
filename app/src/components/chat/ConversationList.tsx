import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { conversationsFor, conversationTitle, lastMessage, mentionsFor, unreadIn, visibleText } from "../../chat/selectors";
import type { Conversation, ConversationKind } from "../../store/types";
import { PresenceDot } from "./Presence";

const SECTIONS: [ConversationKind, string][] = [["channel", "Channels"], ["dm", "Direct messages"], ["order", "Orders"], ["shipment", "Deliveries"]];

/** One line of a conversation list: title, last message, unread count and an @ when you're mentioned. */
export function ConversationRow({ c, active, onOpen, compact = false }: { c: Conversation; active: boolean; onOpen: (id: string) => void; compact?: boolean }) {
  const { state } = useStore();
  const { me } = useSession();
  const last = lastMessage(state, c.id);
  const u = unreadIn(state, me, c.id);
  const other = c.kind === "dm" ? c.members.find(id => id !== me.id) : undefined;
  const author = last && (last.authorId === me.id ? "You" : state.chat.users.find(x => x.id === last.authorId)?.name);
  return (
    <button type="button" className={`conv-row${active ? " on" : ""}${u.count ? " unread" : ""}${u.mentions ? " mentioned" : ""}`} onClick={() => onOpen(c.id)} aria-current={active ? "true" : undefined}>
      <span className="conv-ic" aria-hidden={!other}>{other ? <PresenceDot userId={other} /> : c.kind === "channel" ? "#" : c.kind === "order" ? "🧾" : "🚚"}</span>
      <span className="conv-main">
        <span className="conv-title">{conversationTitle(c, me, state.chat.users)}</span>
        {!compact && last && <small className="conv-last">{author}: {visibleText(state, me, last, "(hidden)") ? <span translate="no">{visibleText(state, me, last, "(hidden)")}</span> : "📷 Photo"}</small>}
      </span>
      {u.mentions > 0 && <span className="badge mention" aria-label={`${u.mentions} mentions`}>@</span>}
      {u.count > 0 && <span className="badge" aria-label={`${u.count} unread`}>{u.count}</span>}
    </button>
  );
}

export function ConversationList({ activeId, onOpen, onMentions, mentionsActive }: { activeId?: string; onOpen: (id: string) => void; onMentions: () => void; mentionsActive: boolean }) {
  const { state } = useStore();
  const { me } = useSession();
  const mine = conversationsFor(state, me);
  const unreadMentions = mentionsFor(state, me).filter(m => m.unread).length;
  // Order and delivery threads with no messages stay out of the list until someone writes in them
  const recent = (c: Conversation) => lastMessage(state, c.id)?.createdAt ?? "";
  return (
    <nav className="conv-list" aria-label="Conversations">
      <button type="button" className={`conv-row mentions-row${mentionsActive ? " on" : ""}`} onClick={onMentions}>
        <span className="conv-ic">@</span><span className="conv-main"><span className="conv-title">Mentions</span></span>
        {unreadMentions > 0 && <span className="badge mention">{unreadMentions}</span>}
      </button>
      {SECTIONS.map(([kind, label]) => {
        const list = mine.filter(c => c.kind === kind && (kind === "channel" || kind === "dm" || recent(c) || c.id === activeId))
          .sort((a, b) => (kind === "channel" ? 0 : recent(b).localeCompare(recent(a))));
        if (!list.length) return null;
        return (
          <section key={kind} className="conv-sec">
            <h3>{label}</h3>
            {list.map(c => <ConversationRow key={c.id} c={c} active={c.id === activeId} onOpen={onOpen} />)}
          </section>
        );
      })}
    </nav>
  );
}
