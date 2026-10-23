import { useEffect, useState } from "react";
import { go } from "../../router";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { conversationsFor, lastMessage, unreadIn } from "../../chat/selectors";
import { ConversationList } from "../../components/chat/ConversationList";
import { ConversationView } from "../../components/chat/ConversationView";
import { DetailsPane } from "../../components/chat/DetailsPane";
import { MentionsInbox } from "../../components/chat/MentionsInbox";
import { BackIcon } from "../../components/icons";
import { NewConversation } from "../../components/chat/NewConversation";

/**
 * #/messages                 conversation list (phones) or the most relevant conversation (wider screens)
 * #/messages/mentions        Mentions inbox
 * #/messages/<id>            a conversation; #/messages/<id>/<messageId> opens it at that message
 * Wide screens show list, conversation and details side by side; phones show one pane at a time.
 */
export function MessagesPage({ parts }: { parts: string[] }) {
  const { state } = useStore();
  const { me } = useSession();
  const narrow = useMediaQuery("(max-width: 760px)");
  const wide = useMediaQuery("(min-width: 1300px)");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [first, focusId] = parts;
  const mentions = first === "mentions";
  const starting = first === "new";

  // Wider screens never show an empty middle: open the conversation with unread mentions, else unread, else the team channel
  const mine = conversationsFor(state, me);
  const fallback = !narrow && !first
    ? (mine.find(c => unreadIn(state, me, c.id).mentions) ?? mine.find(c => unreadIn(state, me, c.id).count) ?? mine.find(c => c.kind === "channel")
      ?? [...mine].sort((a, b) => (lastMessage(state, b.id)?.createdAt ?? "").localeCompare(lastMessage(state, a.id)?.createdAt ?? ""))[0])?.id
    : undefined;
  // Put the choice in the address once, so reading it doesn't make the screen jump to the next unread conversation
  useEffect(() => { if (fallback) window.location.replace(`#/messages/${encodeURIComponent(fallback)}`); }, [fallback]);
  const activeId = mentions || starting ? undefined : first ?? fallback;
  const open = (id: string, messageId?: string) => go(`#/messages/${encodeURIComponent(id)}${messageId ? `/${messageId}` : ""}`);

  const pane: "list" | "conv" | "details" | "mentions" | "new" = mentions ? "mentions" : starting ? "new" : !activeId ? "list" : narrow && detailsOpen ? "details" : "conv";
  const showList = !narrow || pane === "list";
  const showDetails = !!activeId && detailsOpen && !mentions;

  return (
    <main className={`messages${narrow ? ` one ${pane}` : ""}${showDetails ? " with-details" : ""}${wide ? " wide" : ""}`}>
      {showList && (
        <div className="msg-pane list-pane glass">
          <header className="pane-head"><h1>Messages</h1><a className={`btn small${starting ? " primary" : ""}`} href="#/messages/new" aria-current={starting ? "page" : undefined}>+ New</a></header>
          <ConversationList activeId={activeId} onOpen={id => { open(id); }} onMentions={() => go("#/messages/mentions")} mentionsActive={mentions} />
        </div>
      )}
      {mentions && (
        <div className="msg-pane glass mentions-pane">
          <header className="conv-head">
            {narrow && <button className="iconbtn" onClick={() => go("#/messages")} aria-label="Back to conversations"><BackIcon /></button>}
            <div className="conv-head-t"><h2>Mentions</h2><span className="small muted">You and your groups: {me.groups.map(g => `@${g}`).join(", ") || "none"}</span></div>
          </header>
          <div className="msg-scroll"><MentionsInbox onOpen={open} /></div>
        </div>
      )}
      {starting && (
        <div className="msg-pane glass mentions-pane">
          <header className="conv-head">
            {narrow && <button className="iconbtn" onClick={() => go("#/messages")} aria-label="Back to conversations"><BackIcon /></button>}
            <div className="conv-head-t"><h2>New message</h2><span className="small muted">Anyone in the warehouse: one person for a direct message, more for a group chat</span></div>
          </header>
          <div className="msg-scroll"><NewConversation onOpen={id => open(id)} /></div>
        </div>
      )}
      {activeId && (!narrow || pane === "conv") && (
        <div className="msg-pane glass conv-pane">
          <ConversationView key={activeId} conversationId={activeId} focusId={focusId} onBack={narrow ? () => go("#/messages") : undefined}
            onDetails={() => setDetailsOpen(o => !o)} detailsOpen={detailsOpen} />
        </div>
      )}
      {showDetails && (!narrow || pane === "details") && (
        <div className={`msg-pane glass details-pane${wide ? "" : " floating"}`}>
          <DetailsPane conversationId={activeId!} onClose={() => setDetailsOpen(false)} />
        </div>
      )}
    </main>
  );
}
