import { useEffect, useState } from "react";
import { go } from "../../router";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { conversationsFor, conversationTitle, lastMessage, mentionsFor, unreadIn, unreadTotals } from "../../chat/selectors";
import { roughAgo } from "../../chat/presence";
import { ConversationRow } from "./ConversationList";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { MessageText } from "./MessageText";
import { ExpandIcon } from "../icons";

const SEL_KEY = "wms.home.chat.sel";
const readSel = () => { try { return localStorage.getItem(SEL_KEY) ?? ""; } catch { return ""; } };

/**
 * Messages on the home screen: recent conversations, the chosen one's latest messages and a quick reply.
 * It sizes itself to the space it gets (container queries): a tall column in the right rail on wide
 * screens, a full-width card among the update cards on tablets.
 */
export function HomeMessages({ placement }: { placement: "rail" | "grid" }) {
  const { state } = useStore();
  const { me } = useSession();
  const mine = conversationsFor(state, me);
  const recentAt = (id: string) => lastMessage(state, id)?.createdAt ?? "";
  const recent = mine.filter(c => recentAt(c.id)).sort((a, b) => recentAt(b.id).localeCompare(recentAt(a.id))).slice(0, 5);
  const [sel, setSel] = useState(() => readSel());
  const valid = mine.some(c => c.id === sel);
  const selected = valid ? sel : (recent.find(c => unreadIn(state, me, c.id).mentions) ?? recent[0])?.id;
  // Fix the default once, so reading it doesn't hop the module on to the next unread conversation
  useEffect(() => { if (!selected) return; if (selected !== sel) setSel(selected); try { localStorage.setItem(SEL_KEY, selected); } catch { /* per-visit only */ } }, [selected, sel]);
  // Keep the chosen conversation in the strip even when it isn't among the five most recent
  const strip = selected && !recent.some(c => c.id === selected) ? [...recent.slice(0, 4), mine.find(c => c.id === selected)!] : recent;
  const totals = unreadTotals(state, me);
  const conv = mine.find(c => c.id === selected);

  return (
    <section className={`home-msgs glass ${placement}`} aria-labelledby="hm-title">
      <header className="hm-head">
        <h2 id="hm-title">Messages</h2>
        {totals.count > 0 && <span className="badge">{totals.count}</span>}
        {totals.mentions > 0 && <a className="badge mention" href="#/messages/mentions" title="Unread mentions">@{totals.mentions}</a>}
        <button className="iconbtn hm-full" onClick={() => go(`#/messages/${selected ? encodeURIComponent(selected) : ""}`)} aria-label="Open full screen" title="Open full screen"><ExpandIcon /></button>
      </header>
      <div className="hm-body">
        <div className="hm-convs">{strip.map(c => <ConversationRow key={c.id} c={c} active={c.id === selected} onOpen={setSel} />)}</div>
        {conv ? (
          <div className="hm-thread">
            <p className="hm-thread-title">{conv.kind === "channel" ? "#" : ""}{conversationTitle(conv, me, state.chat.users)}</p>
            <MessageList key={conv.id} conversationId={conv.id} limit={8} />
            <Composer conversationId={conv.id} compact />
          </div>
        ) : <p className="muted small">No conversations yet.</p>}
      </div>
    </section>
  );
}

/** Phones: just the unread count and the latest mentions. Tapping opens the Messages tab. */
export function HomeMessagesCompact() {
  const { state } = useStore();
  const { me } = useSession();
  const totals = unreadTotals(state, me);
  const latest = mentionsFor(state, me).slice(0, 3);
  return (
    <section className="home-msgs compact glass card" aria-labelledby="hmc-title">
      <a className="hmc-link" href="#/messages"><span className="sr-only">Open Messages</span></a>
      <div className="card-head">
        <div><h3 className="card-title" id="hmc-title">Messages</h3><p className="card-sub">{totals.count ? `${totals.count} unread${totals.mentions ? ` · ${totals.mentions} mention${totals.mentions > 1 ? "s" : ""}` : ""}` : "All caught up"}</p></div>
        <span className={`count${totals.mentions ? " warn" : ""}`}>{totals.count}</span>
      </div>
      {latest.length > 0 && (
        <ul className="items">
          {latest.map(({ message: m, unread }) => (
            <li key={m.id} className={`item hmc-item${unread ? " unread" : ""}`}>
              <span className="what"><b>{state.chat.users.find(u => u.id === m.authorId)?.name}</b> <MessageText message={m} /></span>
              <span className="meta">{roughAgo(m.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
