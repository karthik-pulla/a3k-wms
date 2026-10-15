import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { conversationTitle, mentionsFor } from "../../chat/selectors";
import { hhmm, roughAgo } from "../../chat/presence";
import { MessageText } from "./MessageText";

/** Every message that mentions you or one of your groups, newest first. Opening one jumps to it in its conversation. */
export function MentionsInbox({ onOpen, limit }: { onOpen: (conversationId: string, messageId: string) => void; limit?: number }) {
  const { state } = useStore();
  const { me } = useSession();
  const all = mentionsFor(state, me);
  const list = limit ? all.slice(0, limit) : all;
  if (!list.length) return <p className="muted small">No mentions yet.</p>;
  return (
    <ol className="mention-list">
      {list.map(({ message: m, unread }) => {
        const conv = state.chat.conversations.find(c => c.id === m.conversationId)!;
        return (
          <li key={m.id}>
            <div className={`mention-item${unread ? " unread" : ""}${m.urgent ? " urgent" : ""}`} role="button" tabIndex={0}
              onClick={e => { if (!(e.target as HTMLElement).closest("button.rchip, a")) onOpen(m.conversationId, m.id); }}
              onKeyDown={e => { if (e.key === "Enter") onOpen(m.conversationId, m.id); }}>
              <div className="msg-head">
                <b>{state.chat.users.find(u => u.id === m.authorId)?.name}</b>
                <span className="muted small">in {conv.kind === "dm" ? "a direct message" : conversationTitle(conv, me, state.chat.users)}</span>
                <time dateTime={m.createdAt} title={hhmm(m.createdAt)}>{roughAgo(m.createdAt)}</time>
                {m.urgent && <span className="urgent-tag">Urgent</span>}
              </div>
              <div className="msg-body"><MessageText message={m} /></div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
