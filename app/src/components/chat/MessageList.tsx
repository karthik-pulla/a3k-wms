import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useChatBackend } from "../../chat/backend";
import { useOverlay } from "../../chat/overlay";
import { isMentioned, visibleText } from "../../chat/selectors";
import { hhmm } from "../../chat/presence";
import type { Message } from "../../store/types";
import { MessageText } from "./MessageText";

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

/**
 * Messages of one conversation. A message counts as read only once it has actually been on screen
 * (at least 60% visible while the app is in front); the "New" line marks where unread messages started.
 */
export function MessageList({ conversationId, search = "", limit, focusId }: { conversationId: string; search?: string; limit?: number; focusId?: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const backend = useChatBackend();
  const overlay = useOverlay();
  const scroller = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const conv = state.chat.conversations.find(c => c.id === conversationId);

  const all = useMemo(() => state.chat.messages.filter(m => m.conversationId === conversationId), [state.chat.messages, conversationId]);
  const q = search.trim().toLowerCase();
  const matches = q ? all.filter(m => visibleText(state, me, m).toLowerCase().includes(q)) : all;
  const shown = limit ? matches.slice(-limit) : matches;

  // Where "New" goes: fixed when the conversation opens, so it doesn't jump as messages get read
  const [readMark, setReadMark] = useState(() => state.chat.reads[me.id]?.[conversationId] ?? "");
  useEffect(() => { setReadMark(state.chat.reads[me.id]?.[conversationId] ?? ""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conversationId, me.id]);
  const firstUnread = shown.find(m => m.authorId !== me.id && m.createdAt > readMark)?.id;

  // Read tracking
  const latestSeen = useRef("");
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    latestSeen.current = state.chat.reads[me.id]?.[conversationId] ?? "";
    const io = new IntersectionObserver(entries => {
      if (document.hidden) return;
      let best = latestSeen.current;
      for (const e of entries) {
        const at = (e.target as HTMLElement).dataset.at ?? "";
        if (e.isIntersecting && at > best) best = at;
      }
      if (best > latestSeen.current) { latestSeen.current = best; backend.markRead(conversationId, best); }
    }, { root, threshold: 0.6 });
    const observe = () => root.querySelectorAll<HTMLElement>("[data-unread]").forEach(el => io.observe(el));
    observe();
    // Coming back to the app: look again at what's on screen (observing anew reports current visibility)
    const onVisible = () => { if (!document.hidden) { io.disconnect(); observe(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVisible); };
    // Re-observe when messages change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, shown.length, backend, me.id]);

  // Open at the first unread message (or a message from the Mentions inbox), else at the bottom; stay pinned to the bottom as new messages arrive
  const stick = useRef(true);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const target = (focusId && root.querySelector(`[data-id="${focusId}"]`)) || (firstUnread && root.querySelector(`[data-id="${firstUnread}"]`));
    if (target instanceof HTMLElement) root.scrollTop = target.offsetTop - root.offsetTop - 40;
    else root.scrollTop = root.scrollHeight;
    stick.current = !target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, focusId]);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (root && stick.current) root.scrollTop = root.scrollHeight;
  }, [shown.length]);

  const others = conv?.members.filter(id => id !== me.id) ?? [];
  const readers = (m: Message) => others.filter(id => (state.chat.reads[id]?.[conversationId] ?? "") >= m.createdAt);
  const name = (id: string) => state.chat.users.find(u => u.id === id)?.name ?? "Someone";

  let lastDay = "", lastAuthor = "", lastAt = 0;
  return (
    <div className="msg-scroll" ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {q && <p className="msg-search-count">{matches.length ? `${matches.length} message${matches.length > 1 ? "s" : ""} with “${search.trim()}”` : `No messages with “${search.trim()}”`}</p>}
      {limit && matches.length > limit && <p className="msg-more muted small">{matches.length - limit} earlier messages</p>}
      {!shown.length && !q && <p className="muted small msg-empty">No messages yet. Say hello.</p>}
      <ol className="msgs">
        {shown.map(m => {
          const day = dayLabel(m.createdAt);
          const t = new Date(m.createdAt).getTime();
          const showDay = day !== lastDay;
          const grouped = !showDay && lastAuthor === m.authorId && t - lastAt < 5 * 6e4;
          lastDay = day; lastAuthor = m.authorId; lastAt = t;
          const mine = m.authorId === me.id;
          const unread = !mine && m.createdAt > (state.chat.reads[me.id]?.[conversationId] ?? "");
          const slots = m.refs.filter(r => r.type === "slot");
          const read = mine ? readers(m) : [];
          return (
            <li key={m.id} className="msg-li">
              {showDay && <div className="day-sep"><span>{day}</span></div>}
              {m.id === firstUnread && !q && <div className="new-sep"><span>New</span></div>}
              <div data-id={m.id} data-at={m.createdAt} data-unread={unread ? "" : undefined}
                className={`msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}${isMentioned(m, me) ? " mention" : ""}${m.urgent ? " urgent" : ""}${m.id === focusId ? " focus" : ""}`}>
                {!grouped && <div className="msg-head"><b>{mine ? "You" : name(m.authorId)}</b><time dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>
                  {m.urgent && <span className="urgent-tag">Urgent{m.escalatedAt ? ` · texted ${hhmm(m.escalatedAt)}` : ""}</span>}</div>}
                {m.text && <div className="msg-body"><MessageText message={m} highlight={q || undefined} /></div>}
                {m.photos.length > 0 && (
                  <div className="msg-photos">{m.photos.map((p, i) => <button key={i} className="msg-photo" onClick={() => setPhoto(p)} aria-label={`Open photo ${i + 1}`}><img src={p} alt="" /></button>)}</div>
                )}
                <div className="msg-foot">
                  {slots.length > 1 && (
                    <button className="link small" onClick={() => overlay({ kind: "slots", codes: slots.map(s => s.code), snapshots: Object.fromEntries(slots.map(s => [s.code, s.snapshot.lines])) })}>
                      Show all {slots.length} on map
                    </button>
                  )}
                  {grouped && <time className="msg-time-g" dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>}
                  {mine && <Ticks m={m} read={read.length} of={others.length} names={read.map(name)} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {photo && <div className="lightbox" onClick={() => setPhoto(null)} role="dialog" aria-label="Photo"><img src={photo} alt="" /></div>}
    </div>
  );
}

function Ticks({ m, read, of, names }: { m: Message; read: number; of: number; names: string[] }) {
  if (m.status === "queued") return <span className="ticks queued" title="Waiting for a connection">🕓 waiting</span>;
  if (read > 0 && read >= of) return <span className="ticks read" title={`Read by ${names.join(", ")}`}>✓✓ Read</span>;
  if (read > 0) return <span className="ticks read-some" title={`Read by ${names.join(", ")}`}>✓✓ Read by {read}</span>;
  if (m.status === "delivered") return <span className="ticks" title="Delivered">✓✓</span>;
  return <span className="ticks" title="Sent">✓</span>;
}
