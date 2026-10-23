import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { unreadTotals } from "../../chat/selectors";
import { ChatIcon } from "../icons";

/** Messages tucked away: a tab on the right edge of the home screen brings it back (with the unread count) */
export function MessagesTab() {
  const { state } = useStore();
  const { me, update } = useSession();
  const u = unreadTotals(state, me);
  return (
    <button type="button" className="msg-tab glass" onClick={() => update({ messagesTucked: false })} aria-label={`Show Messages${u.count ? `, ${u.count} unread` : ""}`} title="Show Messages">
      <ChatIcon />
      <span className="msg-tab-label">Messages</span>
      {u.count > 0 && <span className={`badge${u.mentions ? " mention" : ""}`}>{u.count > 99 ? "99+" : u.count}</span>}
    </button>
  );
}

/** On the Messages panel: tuck it away to the side */
export function TuckButton() {
  const { update } = useSession();
  return <button type="button" className="iconbtn hm-full hm-tuck" onClick={e => { e.preventDefault(); e.stopPropagation(); update({ messagesTucked: true }); }} aria-label="Tuck Messages away to the side" title="Tuck away to the side">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /><path d="m8 10 2 2-2 2" /></svg>
  </button>;
}
