import type { ReactElement } from "react";
import { ChatIcon, InboundIcon, InventoryIcon, LogsIcon, ManageIcon, OutboundIcon, TasksIcon, WorkIcon } from "./icons";
import { can } from "../auth/permissions";
import { isOpen } from "../store/tasks";
import type { Mode } from "../router";
import { useStore } from "../store/store";
import { useSession } from "../session";
import { unreadTotals } from "../chat/selectors";

type Item = { route: Mode; label: string; icon: () => ReactElement; /** On phones, where the bar is narrow */ short?: string };
// Owners and coordinators run the warehouse; workers get their Work screen, the stock and Messages
const LEADS: Item[] = [
  { route: "inbounds", label: "In-bounds", icon: InboundIcon },
  { route: "inventory", label: "Inventory", icon: InventoryIcon },
  { route: "outbounds", label: "Out-bounds", icon: OutboundIcon },
  { route: "tasks", label: "Tasks", icon: TasksIcon },
  { route: "messages", label: "Messages", icon: ChatIcon },
  { route: "logs", label: "Logs", icon: LogsIcon },
];
const WORKERS: Item[] = [
  { route: "work", label: "Work", icon: WorkIcon },
  { route: "inventory", label: "Inventory", icon: InventoryIcon },
  { route: "messages", label: "Messages", icon: ChatIcon },
];

export function ModeNav({ current }: { current: Mode }) {
  const { state } = useStore();
  const { me } = useSession();
  const unread = unreadTotals(state, me);
  const lead = can(me, "use-inbounds");
  // Owners run the warehouse from Manage warehouse (people, racks, picking rule, announcements… and the logs)
  const owner = can(me, "manage-settings");
  const MODES = (lead ? LEADS : WORKERS).map(m => (m.route === "logs" && owner ? { route: "manage" as Mode, label: "Manage warehouse", short: "Manage", icon: ManageIcon } : m));
  const myTasks = state.tasks.filter(t => isOpen(t) && (lead ? !t.assignee : t.assignee === me.id || !t.assignee)).length;
  return (
    <nav className={`modes glass-bar${MODES.length > 4 ? " many" : ""}`} aria-label="Modes">
      {MODES.map(({ route, label, short, icon: Icon }) => {
        const badge = (route === "messages" && unread.count > 0) || ((route === "work" || route === "tasks") && myTasks > 0);
        return (
          <a key={route} href={`#/${route}`} className="mode glass" aria-current={current === route ? "page" : undefined}
            aria-label={!badge ? undefined : route === "messages" ? `${label}, ${unread.count} unread${unread.mentions ? `, ${unread.mentions} mentions` : ""}` : `${label}, ${myTasks} task${myTasks === 1 ? "" : "s"} waiting`}>
            <span className="mode-ic"><Icon />{badge && <span className={`badge nav-badge${route === "messages" && unread.mentions ? " mention" : ""}`}>{route === "messages" ? (unread.count > 99 ? "99+" : unread.count) : myTasks}</span>}</span>
            {short ? <span className="mode-label"><span className="long">{label}</span><span className="short" aria-hidden="true">{short}</span></span> : <span>{label}</span>}
          </a>
        );
      })}
    </nav>
  );
}
