import { go } from "../../router";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useChatBackend } from "../../chat/backend";
import { conversationTitle, messagesAbout } from "../../chat/selectors";
import { roughAgo } from "../../chat/presence";
import { MessageText } from "./MessageText";

/**
 * "Messages about this" on a record's page: the latest messages in its thread or mentioning it, and a button
 * to open the thread. References are saved by id, so renaming a product or delivery doesn't break them.
 */
export function ThreadSection({ target, title = "Messages about this" }: { target: { shipment?: string; order?: string; product?: string; slot?: string }; title?: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const backend = useChatBackend();
  const list = messagesAbout(state, me, target);
  const link = target.shipment ? { type: "shipment" as const, id: target.shipment } : target.order ? { type: "order" as const, id: target.order } : null;
  const latest = list.slice(-3).reverse();
  return (
    <section className="panel glass thread-sec" aria-label={title}>
      <div className="panel-foot">
        <h2>{title} · {list.length}</h2>
        {link && <button className="btn small" onClick={() => go(`#/messages/${encodeURIComponent(backend.ensureThread(link))}`)}>Open thread</button>}
      </div>
      {latest.length ? (
        <ol className="mention-list">
          {latest.map(m => {
            const conv = state.chat.conversations.find(c => c.id === m.conversationId)!;
            return (
              <li key={m.id}>
                <div className="mention-item" role="button" tabIndex={0}
                  onClick={e => { if (!(e.target as HTMLElement).closest("button.rchip, a")) go(`#/messages/${encodeURIComponent(m.conversationId)}/${m.id}`); }}
                  onKeyDown={e => { if (e.key === "Enter") go(`#/messages/${encodeURIComponent(m.conversationId)}/${m.id}`); }}>
                  <div className="msg-head">
                    <b>{state.chat.users.find(u => u.id === m.authorId)?.name}</b>
                    <span className="muted small">in {conversationTitle(conv, me, state.chat.users)}</span>
                    <time dateTime={m.createdAt}>{roughAgo(m.createdAt)}</time>
                  </div>
                  <div className="msg-body"><MessageText message={m} /></div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="muted small">No messages yet.{link ? " Open the thread to start one." : ""}</p>}
    </section>
  );
}
